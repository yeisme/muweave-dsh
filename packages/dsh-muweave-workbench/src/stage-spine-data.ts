import type { JobRecordV1, LinkedMediaRef, MuweaveElementSummaryV1, ScheduleEntryViewV1 } from '@yeisme/dsh-muweave-core/client'
import { SPINE_STAGE_IDS, type SpineStageId } from './stage-map'

export type StageSpineGroups = Record<SpineStageId, readonly MuweaveElementSummaryV1[]>
export type SpineMetric = 'total' | 'review' | 'stale' | 'shots' | 'overdue'
export type StageSpineMetrics = Record<SpineMetric, number | undefined>
export interface SpineShotRow {
  shotRef: string
  sceneRef?: string
  linkedMedia?: readonly LinkedMediaRef[]
}

const REVIEW_STATUSES = new Set(['waiting_review', 'pending_review'])
const AUDIO_KINDS = new Set(['voice', 'music', 'sfx'])

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return [date.getFullYear(), month, day].join('-')
}

function belongsToProject(entry: ScheduleEntryViewV1, projectId: string | undefined): boolean {
  if (!projectId) return true
  if (entry.projectId) return entry.projectId === projectId
  return entry.legacy === true && entry.ref.split(/[:/]/, 1)[0] === projectId
}

function soundOutputs(jobs: readonly JobRecordV1[]) {
  return jobs.filter((job) => job.owner === 'sonora' && AUDIO_KINDS.has(job.kind))
    .flatMap((job) => job.slots.filter((slot) => slot.status === 'done').map((slot) => ({
      jobId: job.jobId,
      shotRef: job.anchor?.shotRef,
      digest: slot.sha256,
      review: slot.review,
    })))
}

export function stageSpineMetrics({
  groups,
  jobs,
  entries,
  storyboardRows,
  projectId,
  now = new Date(),
}: {
  groups: StageSpineGroups
  jobs?: readonly JobRecordV1[]
  entries?: readonly ScheduleEntryViewV1[]
  storyboardRows?: readonly SpineShotRow[]
  projectId?: string
  now?: Date
}): Record<SpineStageId, StageSpineMetrics> {
  const audio = jobs && soundOutputs(jobs)
  const shots = Object.fromEntries(SPINE_STAGE_IDS.map((stage) => [stage, new Set<string>()])) as Record<SpineStageId, Set<string>>
  const scriptScenes = new Set(groups.script.flatMap((row) => row.sceneRef ? [row.sceneRef] : []))
  const visualIds = new Set(groups.visual.map((row) => row.elementId))
  const visualDigests = new Set(groups.visual.flatMap((row) => row.mediaBlobs?.map((blob) => blob.blobDigest) ?? []))
  const audioDigests = new Set(audio?.flatMap((output) => output.digest ? [output.digest] : []))
  const refs = new Map<string, Set<SpineStageId>>()
  const addRef = (ref: string, stage: SpineStageId) => {
    const matches = refs.get(ref) ?? new Set<SpineStageId>()
    matches.add(stage)
    refs.set(ref, matches)
  }
  for (const stage of SPINE_STAGE_IDS) {
    for (const row of groups[stage]) {
      addRef(row.elementId, stage)
      addRef(row.sourceRef, stage)
      for (const shot of row.shotRefs ?? []) {
        shots[stage].add(shot)
        if (stage === 'storyboard') addRef(shot, stage)
      }
    }
  }
  for (const row of storyboardRows ?? []) {
    shots.storyboard.add(row.shotRef)
    addRef(row.shotRef, 'storyboard')
    if (row.sceneRef && scriptScenes.has(row.sceneRef)) shots.script.add(row.shotRef)
    for (const source of row.linkedMedia ?? []) {
      if (source.role === 'keyframe' || source.role === 'reference') {
        if ((source.elementId && visualIds.has(source.elementId)) || (source.sha256 && visualDigests.has(source.sha256))) {
          shots.visual.add(row.shotRef)
        }
      }
      if (AUDIO_KINDS.has(source.role) && source.sha256 && audioDigests.has(source.sha256)) shots.sound.add(row.shotRef)
    }
  }
  for (const output of audio ?? []) {
    addRef(output.jobId, 'sound')
    if (output.shotRef) shots.sound.add(output.shotRef)
  }

  const overdue = new Map<SpineStageId, Set<string>>()
  const today = localDay(now)
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.ref !== 'string' || typeof entry.date !== 'string' || entry.date >= today || !belongsToProject(entry, projectId)) continue
    const stages = refs.get(entry.ref)
    if (stages?.size !== 1) continue
    for (const stage of stages) {
      const matched = overdue.get(stage) ?? new Set<string>()
      matched.add(entry.ref)
      overdue.set(stage, matched)
    }
  }

  const hasBoards = groups.storyboard.some((row) => row.kind === 'drama.storyboard_table')
  return Object.fromEntries(SPINE_STAGE_IDS.map((stage) => {
    const rows = groups[stage]
    const shotCount = shots[stage].size
    const missingShots = rows.length > 0 && (
      ((stage === 'script' || stage === 'visual') && hasBoards && storyboardRows === undefined) ||
      (stage === 'final' && rows.some((row) => !Array.isArray(row.shotRefs)))
    )
    const late = entries === undefined ? undefined : overdue.get(stage)?.size ?? 0
    if (stage === 'sound') {
      return [stage, {
        total: audio?.length,
        review: audio?.filter((slot) => slot.review === 'unreviewed').length,
        stale: undefined,
        shots: audio && shotCount,
        overdue: audio && late,
      }]
    }
    return [stage, {
      total: rows.length,
      review: rows.filter((row) => REVIEW_STATUSES.has(row.status)).length,
      stale: rows.filter((row) => row.stale || row.status === 'stale').length,
      shots: missingShots ? undefined : shotCount,
      overdue: late,
    }]
  })) as Record<SpineStageId, StageSpineMetrics>
}
