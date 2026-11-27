/**
 * Overview stage axis model (docs/design/desk-v8-proposal.md §8). Bundle domains and production
 * stages are two vocabularies; the mapping is a front-end constant, never a protocol field (§8.4).
 * Everything here is pure so the axis, the workbench and the tests share one counting rule.
 */

import type { JobRecordV1, JobSlotV1, MuweaveDomain, MuweaveElementSummaryV1 } from '@yeisme/dsh-muweave-core/client'

export type StageId = 'inspiration' | 'script' | 'visual' | 'storyboard' | 'sound'
export type SpineStageId = StageId | 'final'

export const STAGES: readonly { id: StageId; labelZh: string; labelEn: string; domain?: MuweaveDomain }[] = [
  { id: 'inspiration', labelZh: '灵感', labelEn: 'Inspiration', domain: 'harness' },
  { id: 'script', labelZh: '剧本', labelEn: 'Script', domain: 'script' },
  { id: 'visual', labelZh: '视觉', labelEn: 'Visual', domain: 'eikona' },
  { id: 'storyboard', labelZh: '分镜', labelEn: 'Storyboard', domain: 'drama' },
  // Audio arrives through the job ledger, outside the bundle's four domains.
  { id: 'sound', labelZh: '声音', labelEn: 'Sound' },
]

export const STAGE_IDS: readonly StageId[] = STAGES.map((s) => s.id)
export const SPINE_STAGE_IDS: readonly SpineStageId[] = [...STAGE_IDS, 'final']

export function stageOfDomain(domain: MuweaveDomain | string): StageId | undefined {
  return STAGES.find((s) => s.domain !== undefined && s.domain === domain)?.id
}

export function stageLabel(stage: SpineStageId, lang: string): string {
  if (stage === 'final') return lang === 'en' ? 'Final cut' : '成片'
  const def = STAGES.find((s) => s.id === stage)
  return def ? (lang === 'en' ? def.labelEn : def.labelZh) : stage
}

/** Buckets elements by stage in their incoming order; unknown domains are dropped, never guessed. */
export function groupByStage(elements: readonly MuweaveElementSummaryV1[]): Record<StageId, MuweaveElementSummaryV1[]> {
  const out: Record<StageId, MuweaveElementSummaryV1[]> = { inspiration: [], script: [], visual: [], storyboard: [], sound: [] }
  for (const el of elements ?? []) {
    const stage = stageOfDomain(el?.domain ?? '')
    if (stage) out[stage].push(el)
  }
  return out
}

export function groupBySpineStage(elements: readonly MuweaveElementSummaryV1[]): Record<SpineStageId, MuweaveElementSummaryV1[]> {
  const groups = groupByStage(elements)
  return {
    ...groups,
    storyboard: groups.storyboard.filter((el) => el.kind !== 'drama.edit_timeline'),
    final: groups.storyboard.filter((el) => el.kind === 'drama.edit_timeline'),
  }
}

const PENDING_STATUSES = new Set(['waiting_review', 'draft', 'stale'])

/** An element needs the human: waiting for review, still a draft, or behind its baseline. */
export function isPending(el: MuweaveElementSummaryV1): boolean {
  return PENDING_STATUSES.has(el.status) || el.stale === true
}

export function pendingCount(rows: readonly MuweaveElementSummaryV1[]): number {
  return (rows ?? []).filter(isPending).length
}

/** Axis dot: done = items and nothing pending, doing = something pending, empty = no items. */
export type StageDotState = 'done' | 'doing' | 'empty'

export function stageDotState(rows: readonly MuweaveElementSummaryV1[]): StageDotState {
  if (!rows || rows.length === 0) return 'empty'
  return pendingCount(rows) > 0 ? 'doing' : 'done'
}

/**
 * Where the Overview opens: the first stage (top-down) that has any element, so the axis reads like
 * a pipeline from the top; falls back to the first stage when the bundle is empty.
 */
export function defaultStage(groups: Record<StageId, readonly MuweaveElementSummaryV1[]>): StageId {
  return STAGE_IDS.find((id) => (groups[id]?.length ?? 0) > 0) ?? STAGE_IDS[0]!
}

export function defaultSpineStage(groups: Record<SpineStageId, readonly MuweaveElementSummaryV1[]>): SpineStageId {
  return SPINE_STAGE_IDS.find((id) => groups[id].length > 0) ?? 'inspiration'
}

/** j / k: next or previous stage, clamped at the ends. */
export function stepStage(current: StageId, delta: number): StageId {
  return stepAmongStages(STAGE_IDS, current, delta)
}

export function stepAmongStages<T extends SpineStageId>(stages: readonly T[], current: T, delta: number): T {
  const i = Math.max(0, stages.indexOf(current))
  const next = Math.min(stages.length - 1, Math.max(0, i + delta))
  return stages[next] ?? current
}

/** G then a digit: the Nth stage (1-based); undefined for anything else. */
export function stageAtDigit(key: string): StageId | undefined {
  if (!/^[1-9]$/.test(key)) return undefined
  return STAGE_IDS[Number(key) - 1]
}

/** L1: the user's selection when it lives in this stage, else the first pending row, else the first row. */
export function pickPrimary(rows: readonly MuweaveElementSummaryV1[], selectedId?: string): MuweaveElementSummaryV1 | undefined {
  return rows.find((el) => el.elementId === selectedId) ?? rows.find(isPending) ?? rows[0]
}

/**
 * The job that produced an element's variants. Elements carry no job id, so the link is the
 * production anchor: same owner, and the job's shot (or scene) is one the element covers. No anchor,
 * no link — variants are never inferred from titles or timing.
 */
export function jobForElement(el: MuweaveElementSummaryV1, jobs: readonly JobRecordV1[]): JobRecordV1 | undefined {
  const matches = (jobs ?? []).filter((job) => {
    const anchor = job?.anchor
    if (!anchor || job.owner !== (el.sourceOwner as string)) return false
    if (anchor.shotRef && (el.shotRefs ?? []).includes(anchor.shotRef)) return true
    return Boolean(anchor.sceneRef && el.sceneRef && anchor.sceneRef === el.sceneRef)
  })
  return [...matches].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
}

/** Variant band rows: only a job with more than one slot is a choice worth showing. */
export function variantSlots(job: JobRecordV1 | undefined): JobSlotV1[] {
  const slots = Array.isArray(job?.slots) ? job.slots : []
  return slots.length > 1 ? [...slots].sort((a, b) => a.index - b.index) : []
}

/**
 * Version label from the element's own revision. A numeric revision is "vN"; anything else (a digest)
 * is shown shortened as-is; no revision means no label. History is not in the summary, so no v1…vN-1.
 */
export function versionLabel(el: Pick<MuweaveElementSummaryV1, 'sourceRevision'> | undefined): string | undefined {
  const rev = el?.sourceRevision?.trim()
  if (!rev) return undefined
  if (/^\d+$/.test(rev)) return `v${rev}`
  if (/^v\d+$/i.test(rev)) return rev.toLowerCase()
  return rev.replace(/^sha256:/, '').slice(0, 8)
}

/** "11-19 14:20" in local time; empty for an unparsable timestamp. */
export function shortTime(iso: string | undefined): string {
  const d = iso ? new Date(iso) : undefined
  if (!d || Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The N in a "vN" or "vN·x" label; undefined for a shortened digest or no label (never guessed). */
export function versionNumber(label: string | undefined): number | undefined {
  const m = label?.trim().match(/^v(\d+)(?:·|$)/i)
  return m ? Number(m[1]) : undefined
}

export interface CompareSide {
  version?: string
  digest?: string
  updatedAt?: string
}

export interface CompareSummary {
  /** Where the compared side `b` sits relative to the current side `a`. */
  versionDiff: 'same' | 'older' | 'newer' | 'unknown'
  /** |a − b| in versions; present only when both sides carry a numeric version. */
  versionsApart?: number
  /** 'unknown' when either side has no digest: absent data is not "different". */
  digestDiff: 'same' | 'different' | 'unknown'
  hoursApart?: number
}

/**
 * Desk v8 P1 §2.2: the three facts the data can back — version order, digest equality, time gap.
 * Never a quality verdict; there is no score to base one on.
 */
export function compareSummary(a: CompareSide | undefined, b: CompareSide | undefined): CompareSummary {
  const va = versionNumber(a?.version)
  const vb = versionNumber(b?.version)
  const versionDiff = va === undefined || vb === undefined ? 'unknown' : vb === va ? 'same' : vb < va ? 'older' : 'newer'
  const da = a?.digest?.trim()
  const db = b?.digest?.trim()
  const digestDiff = !da || !db ? 'unknown' : da === db ? 'same' : 'different'
  const ta = a?.updatedAt ? Date.parse(a.updatedAt) : Number.NaN
  const tb = b?.updatedAt ? Date.parse(b.updatedAt) : Number.NaN
  const out: CompareSummary = { versionDiff, digestDiff }
  if (va !== undefined && vb !== undefined) out.versionsApart = Math.abs(va - vb)
  if (Number.isFinite(ta) && Number.isFinite(tb)) out.hoursApart = Math.round(Math.abs(ta - tb) / 3_600_000)
  return out
}

/** First image blob of an element: the only honest cover; undefined when the owner ships none. */
export function coverDigest(el: Pick<MuweaveElementSummaryV1, 'mediaBlobs'> | undefined): string | undefined {
  const blobs = Array.isArray(el?.mediaBlobs) ? el.mediaBlobs : []
  return blobs.find((b) => typeof b?.mimeType === 'string' && b.mimeType.startsWith('image/') && b.blobDigest)?.blobDigest
}

/** One side of the compare pane, as plain data (the pane renders it; nothing is pinned as markup). */
export interface CompareSubject extends CompareSide {
  /** Stable identity: element id, or job id + slot id for a variant. */
  key: string
  kind: 'element' | 'variant'
  title: string
  owner: string
  /** Image digest for the thumbnail; absent means placeholder. */
  sha256?: string
}

/**
 * An element as a compare side. `basis: 'media'` compares the cover bytes (needed against a variant
 * slot, whose sha256 is image bytes, not an element digest); the default compares element digests.
 */
export function elementSubject(el: MuweaveElementSummaryV1, basis: 'element' | 'media' = 'element'): CompareSubject {
  const cover = coverDigest(el)
  return {
    key: el.elementId,
    kind: 'element',
    title: el.title ?? el.elementId,
    owner: String(el.sourceOwner ?? ''),
    version: versionLabel(el),
    digest: basis === 'media' ? cover : el.digest,
    updatedAt: el.updatedAt,
    sha256: cover,
  }
}

/** A variant slot as a compare side; its tag ("v3·b") doubles as the version label. */
export function variantSubject(job: JobRecordV1, slot: JobSlotV1, version: string | undefined): CompareSubject {
  const letter = String.fromCharCode(97 + (slot.index % 26))
  const tag = version ? `${version}·${letter}` : letter
  const isImage = typeof slot.mime === 'string' && slot.mime.startsWith('image/')
  return {
    key: `${job.jobId}/${slot.slotId}`,
    kind: 'variant',
    title: slot.label ? `${tag} · ${slot.label}` : `${tag} · ${job.title}`,
    owner: String(job.owner ?? ''),
    version: tag,
    digest: slot.sha256,
    updatedAt: job.updatedAt,
    sha256: isImage ? slot.sha256 : undefined,
  }
}

/**
 * F1 derived grouping (docs/design/project-features-next.md F1). A view projection over the element
 * summaries already in hand: no RPC, no registry write, no bundle revision. A key the data does not
 * carry lands in 「未标注」, never a guessed one.
 */
export type ElementGroupBy = 'scene' | 'character' | 'status' | 'media'

export const UNLABELED_GROUP = '未标注'

export interface ElementGroup<E> {
  key: string
  label: string
  rows: E[]
}

type GroupableElement = Pick<MuweaveElementSummaryV1, 'kind' | 'status' | 'sourceRef'> &
  Partial<Pick<MuweaveElementSummaryV1, 'sceneRef' | 'characterRefs'>>

/**
 * An explicit `scene:` segment of an opaque ref ("scene:01#context" and "proj:scene:s01" both carry
 * one). A shot ref such as "shot:ep01:s01:01" names no scene segment, so it is not parsed for one.
 */
function sceneFromRef(ref: string | undefined): string | undefined {
  const m = typeof ref === 'string' ? ref.trim().match(/(?:^|:)scene:([^#\s]+)/) : null
  return m ? `scene:${m[1]}` : undefined
}

const MEDIA_LABELS: Record<string, string> = {
  eikona: 'Eikona 视觉',
  script: 'Auctra 剧本',
  drama: 'Scaena 分镜',
  harness: 'Pi / DSH 工件',
}

/** The one group key an element contributes for a dimension, or undefined when the data has none. */
export function elementGroupKey(el: GroupableElement, by: ElementGroupBy): string | undefined {
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  switch (by) {
    case 'scene':
      return clean(el?.sceneRef) ?? sceneFromRef(el?.sourceRef)
    case 'character':
      // Only the first character ref: expanding every ref would count one row in several groups.
      return clean(Array.isArray(el?.characterRefs) ? el.characterRefs[0] : undefined)
    case 'status':
      return clean(el?.status)
    case 'media': {
      const kind = clean(el?.kind)
      const prefix = kind && kind.includes('.') ? kind.slice(0, kind.indexOf('.')) : undefined
      return clean(prefix)
    }
  }
}

/**
 * Buckets elements by one dimension. Rows keep their incoming order inside a group; groups sort by
 * key (numeric-aware, so s2 precedes s10; code-point order breaks ties) and 「未标注」 always comes last.
 */
export function groupElements<E extends GroupableElement>(elements: readonly E[], by: ElementGroupBy): ElementGroup<E>[] {
  const buckets = new Map<string, E[]>()
  const unlabeled: E[] = []
  for (const el of elements ?? []) {
    if (!el) continue
    const key = elementGroupKey(el, by)
    if (key === undefined) unlabeled.push(el)
    else buckets.set(key, [...(buckets.get(key) ?? []), el])
  }
  const groups: ElementGroup<E>[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, rows]) => ({ key, label: by === 'media' ? (MEDIA_LABELS[key] ?? key) : key, rows }))
  if (unlabeled.length > 0) groups.push({ key: UNLABELED_GROUP, label: UNLABELED_GROUP, rows: unlabeled })
  return groups
}
