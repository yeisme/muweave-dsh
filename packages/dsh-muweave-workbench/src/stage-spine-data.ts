import type { JobRecordV1, MuweaveElementSummaryV1, ScheduleEntryViewV1 } from '@yeisme/dsh-muweave-core/client'
import { SPINE_STAGE_IDS, type SpineStageId } from './stage-map'

export type StageSpineGroups = Record<SpineStageId, readonly MuweaveElementSummaryV1[]>
export type SpineMetric = 'total' | 'review' | 'stale' | 'shots' | 'overdue'
export type StageSpineMetrics = Record<SpineMetric, number | undefined>

const REVIEW_STATUSES = new Set(['waiting_review', 'pending_review'])
const AUDIO_KINDS = new Set(['voice', 'music', 'sfx'])

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return [date.getFullYear(), month, day].join('-')
}

function soundOutputs(jobs: readonly JobRecordV1[]) {
  return jobs.filter((job) => job.owner === 'sonora' && AUDIO_KINDS.has(job.kind))
    .flatMap((job) => job.slots.filter((slot) => slot.status === 'done').map((slot) => ({
      jobId: job.jobId,
      shotRef: job.anchor?.shotRef,
      review: slot.review,
    })))
}

export function stageSpineMetrics({
  groups,
  jobs,
  entries,
  projectId,
  now = new Date(),
}: {
  groups: StageSpineGroups
  jobs?: readonly JobRecordV1[]
  entries?: readonly ScheduleEntryViewV1[]
  projectId?: string
  now?: Date
}): Record<SpineStageId, StageSpineMetrics> {
  const audio = jobs && soundOutputs(jobs)
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
    }
  }
  for (const row of groups.storyboard) {
    for (const shot of row.shotRefs ?? []) addRef(shot, 'storyboard')
  }
  for (const output of audio ?? []) addRef(output.jobId, 'sound')

  const overdue = new Map<SpineStageId, Set<string>>()
  const today = localDay(now)
  for (const entry of entries ?? []) {
    if (entry.date >= today || (projectId && entry.projectId !== projectId)) continue
    const stages = refs.get(entry.ref)
    if (stages?.size !== 1) continue
    for (const stage of stages) {
      const matched = overdue.get(stage) ?? new Set<string>()
      matched.add(entry.ref)
      overdue.set(stage, matched)
    }
  }

  return Object.fromEntries(SPINE_STAGE_IDS.map((stage) => {
    const rows = groups[stage]
    const shots = new Set(rows.flatMap((row) => row.shotRefs ?? []))
    const late = entries === undefined ? undefined : overdue.get(stage)?.size ?? 0
    if (stage === 'sound') {
      return [stage, {
        total: audio?.length,
        review: audio?.filter((slot) => slot.review === 'unreviewed').length,
        stale: undefined,
        shots: audio && new Set(audio.flatMap((output) => output.shotRef ? [output.shotRef] : [])).size,
        overdue: audio && late,
      }]
    }
    return [stage, {
      total: rows.length,
      review: rows.filter((row) => REVIEW_STATUSES.has(row.status)).length,
      stale: rows.filter((row) => row.stale || row.status === 'stale').length,
      shots: shots.size,
      overdue: late,
    }]
  })) as Record<SpineStageId, StageSpineMetrics>
}
