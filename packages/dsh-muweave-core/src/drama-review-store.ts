import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import type {
  ShotReviewBatchItemResultV1,
  ShotReviewBatchResultV1,
  ShotReviewImportEntryResultV1,
  ShotReviewImportItemV1,
  ShotReviewImportResultV1,
  ShotReviewRecordV1,
  ShotReviewSetInputV1,
  ShotReviewStatus,
} from './protocol'

/**
 * Director shot-review persistence store: keeps per-shot review status, tags, and notes
 * inside `pluginDataDir/drama-reviews.v1.json` without touching canonical owner databases.
 */

export const DRAMA_REVIEWS_SCHEMA = 'muweave.drama-reviews.v1' as const
export const MAX_DRAMA_REVIEWS = 2000
export const MAX_REVIEW_NOTE_LENGTH = 500
export const MAX_REVIEW_TAGS = 8
export const MAX_REVIEW_TAG_LENGTH = 32
export const MAX_REVIEW_REF_LENGTH = 128

export const VALID_SHOT_REVIEW_STATUSES: readonly ShotReviewStatus[] = [
  'draft',
  'in_review',
  'needs_revision',
  'approved',
  'locked',
] as const

const STATUS_SET = new Set<ShotReviewStatus>(VALID_SHOT_REVIEW_STATUSES)

export class DramaReviewInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function isValidShotReviewStatus(value: unknown): value is ShotReviewStatus {
  return typeof value === 'string' && STATUS_SET.has(value as ShotReviewStatus)
}

function isSafeOpaqueRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_REVIEW_REF_LENGTH) return false
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return false
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return false
  if (containsHostPath(trimmed) || findPlaintextCredential(trimmed)) return false
  return true
}

function requireSafeRef(value: unknown, field: string): string {
  if (!isSafeOpaqueRef(value)) {
    throw new DramaReviewInputError(
      'muweave/invalid_review_input',
      `${field} must be a non-empty opaque reference (<= ${MAX_REVIEW_REF_LENGTH} chars, no /, \\, .., host paths, or credentials)`,
    )
  }
  return value.trim()
}

function optionalSafeRef(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireSafeRef(value, field)
}

function validateNote(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new DramaReviewInputError('muweave/invalid_review_input', 'note must be a string')
  }
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_REVIEW_NOTE_LENGTH) {
    throw new DramaReviewInputError(
      'muweave/invalid_review_input',
      `note must be at most ${MAX_REVIEW_NOTE_LENGTH} characters`,
    )
  }
  if (findPlaintextCredential(trimmed) || containsHostPath(trimmed)) {
    throw new DramaReviewInputError(
      'muweave/invalid_review_input',
      'note must not contain plaintext credentials or host filesystem paths',
    )
  }
  return trimmed
}

function validateTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new DramaReviewInputError('muweave/invalid_review_input', 'tags must be an array of strings')
  }
  if (value.length > MAX_REVIEW_TAGS) {
    throw new DramaReviewInputError(
      'muweave/invalid_review_input',
      `tags must have at most ${MAX_REVIEW_TAGS} entries`,
    )
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new DramaReviewInputError('muweave/invalid_review_input', 'each tag must be a string')
    }
    const trimmed = item.trim()
    if (!trimmed) continue
    if (trimmed.length > MAX_REVIEW_TAG_LENGTH) {
      throw new DramaReviewInputError(
        'muweave/invalid_review_input',
        `each tag must be at most ${MAX_REVIEW_TAG_LENGTH} characters`,
      )
    }
    if (findPlaintextCredential(trimmed) || containsHostPath(trimmed)) {
      throw new DramaReviewInputError(
        'muweave/invalid_review_input',
        'tags must not contain plaintext credentials or host filesystem paths',
      )
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

function validStoredRecord(raw: unknown): ShotReviewRecordV1 | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const r = raw as Partial<ShotReviewRecordV1>
  if (!isSafeOpaqueRef(r.workspaceId) || !isSafeOpaqueRef(r.shotRef)) return undefined
  if (!isValidShotReviewStatus(r.status)) return undefined
  if (typeof r.revision !== 'number' || !Number.isInteger(r.revision) || r.revision < 1) return undefined
  if (typeof r.updatedAt !== 'string' || Number.isNaN(Date.parse(r.updatedAt))) return undefined

  let sceneRef: string | undefined
  let episodeRef: string | undefined
  let note: string | undefined
  let tags: string[]
  try {
    sceneRef = optionalSafeRef(r.sceneRef, 'sceneRef')
    episodeRef = optionalSafeRef(r.episodeRef, 'episodeRef')
    note = validateNote(r.note)
    tags = r.tags === undefined ? [] : validateTags(r.tags)
  } catch {
    return undefined
  }

  return {
    workspaceId: r.workspaceId.trim(),
    shotRef: r.shotRef.trim(),
    ...(sceneRef ? { sceneRef } : {}),
    ...(episodeRef ? { episodeRef } : {}),
    status: r.status,
    ...(note ? { note } : {}),
    tags,
    revision: r.revision,
    updatedAt: r.updatedAt,
  }
}

export interface DramaReviewListResultV1 {
  schema: typeof DRAMA_REVIEWS_SCHEMA
  reviews: ShotReviewRecordV1[]
  updatedAt: string
}

export class DramaReviewStore {
  private records: ShotReviewRecordV1[] = []
  /** Set when the file was unreadable; the original is renamed aside so nothing is silently lost. */
  corruptFile?: string

  constructor(private readonly file: string) {
    this.load()
  }

  list(filter?: {
    workspaceId?: string
    sceneRef?: string
    status?: ShotReviewStatus
  }): DramaReviewListResultV1 {
    const filtered = this.records
      .filter((r) => !filter?.workspaceId || r.workspaceId === filter.workspaceId)
      .filter((r) => !filter?.sceneRef || r.sceneRef === filter.sceneRef)
      .filter((r) => !filter?.status || r.status === filter.status)
      .map((r) => ({ ...r, tags: [...r.tags] }))
      .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId) || a.shotRef.localeCompare(b.shotRef))
    return {
      schema: DRAMA_REVIEWS_SCHEMA,
      reviews: filtered,
      updatedAt: this.updatedAt(filtered),
    }
  }

  get(workspaceId: string, shotRef: string): ShotReviewRecordV1 | undefined {
    const found = this.records.find((r) => r.workspaceId === workspaceId && r.shotRef === shotRef)
    return found ? { ...found, tags: [...found.tags] } : undefined
  }

  set(workspaceId: string, input: ShotReviewSetInputV1): ShotReviewRecordV1 {
    const wsId = requireSafeRef(workspaceId, 'workspaceId')
    const next = this.applyOne(wsId, input)
    this.persist()
    return { ...next, tags: [...next.tags] }
  }

  setBatch(workspaceId: string, items: readonly ShotReviewSetInputV1[]): ShotReviewBatchResultV1 {
    const wsId = requireSafeRef(workspaceId, 'workspaceId')
    if (!Array.isArray(items) || items.length === 0) {
      throw new DramaReviewInputError('muweave/invalid_review_input', 'items must be a non-empty array')
    }
    if (items.length > 200) {
      throw new DramaReviewInputError('muweave/invalid_review_input', 'items must contain at most 200 entries')
    }
    const results: ShotReviewBatchItemResultV1[] = []
    let succeededCount = 0
    let failedCount = 0

    for (const rawItem of items) {
      const item = (typeof rawItem === 'object' && rawItem !== null ? rawItem : {}) as ShotReviewSetInputV1
      const rawShotRef = typeof item.shotRef === 'string' ? item.shotRef.trim() : ''
      try {
        const record = this.applyOne(wsId, item)
        succeededCount += 1
        results.push({
          shotRef: record.shotRef,
          ok: true,
          record: { ...record, tags: [...record.tags] },
        })
      } catch (err) {
        failedCount += 1
        if (err instanceof DramaReviewInputError) {
          results.push({
            shotRef: rawShotRef,
            ok: false,
            errorCode: err.code,
            message: err.message,
            ...(typeof err.details?.currentRevision === 'number'
              ? { currentRevision: err.details.currentRevision }
              : {}),
          })
        } else {
          results.push({
            shotRef: rawShotRef,
            ok: false,
            errorCode: 'muweave/invalid_review_input',
            message: 'Failed to update shot review',
          })
        }
      }
    }

    if (succeededCount > 0) {
      this.persist()
    }
    return { results, succeededCount, failedCount }
  }

  /**
   * Import external client review feedback (`review-feedback.json`).
   * Validates credentials/host paths/status and SKIPS currently `locked` shots unless `allowLocked === true`.
   */
  importFeedback(
    workspaceId: string,
    items: readonly ShotReviewImportItemV1[],
    options: { allowLocked?: boolean } = {},
  ): ShotReviewImportResultV1 {
    const wsId = requireSafeRef(workspaceId, 'workspaceId')
    if (!Array.isArray(items) || items.length === 0) {
      throw new DramaReviewInputError('muweave/invalid_review_input', 'items must be a non-empty array')
    }
    if (items.length > 500) {
      throw new DramaReviewInputError('muweave/invalid_review_input', 'items must contain at most 500 entries')
    }
    const allowLocked = options.allowLocked === true
    const results: ShotReviewImportEntryResultV1[] = []
    let importedCount = 0
    let skippedLockedCount = 0
    let invalidCount = 0

    for (const rawItem of items) {
      const item = (typeof rawItem === 'object' && rawItem !== null ? rawItem : {}) as Partial<ShotReviewImportItemV1>
      const rawShotRef = typeof item.shotRef === 'string' ? item.shotRef.trim() : ''
      try {
        const shotRef = requireSafeRef(item.shotRef, 'shotRef')
        if (!isValidShotReviewStatus(item.status)) {
          throw new DramaReviewInputError('muweave/invalid_review_input', 'Invalid review status')
        }
        const existing = this.records.find((r) => r.workspaceId === wsId && r.shotRef === shotRef)
        if (existing?.status === 'locked' && !allowLocked) {
          skippedLockedCount += 1
          results.push({
            shotRef,
            action: 'skipped_locked',
            status: existing.status,
            reason: 'locked_by_director',
          })
          continue
        }
        const updated = this.applyOne(wsId, {
          shotRef,
          status: item.status,
          ...(item.note !== undefined ? { note: item.note } : {}),
          ...(item.tags !== undefined ? { tags: item.tags } : {}),
        })
        importedCount += 1
        results.push({
          shotRef: updated.shotRef,
          action: 'imported',
          status: updated.status,
        })
      } catch (err) {
        invalidCount += 1
        results.push({
          shotRef: rawShotRef,
          action: 'invalid',
          reason: err instanceof DramaReviewInputError ? err.code : 'muweave/invalid_review_input',
        })
      }
    }

    if (importedCount > 0) {
      this.persist()
    }
    return { importedCount, skippedLockedCount, invalidCount, results }
  }

  private applyOne(wsId: string, input: ShotReviewSetInputV1): ShotReviewRecordV1 {
    const shotRef = requireSafeRef(input.shotRef, 'shotRef')
    const sceneRef = optionalSafeRef(input.sceneRef, 'sceneRef')
    const episodeRef = optionalSafeRef(input.episodeRef, 'episodeRef')
    if (!isValidShotReviewStatus(input.status)) {
      throw new DramaReviewInputError(
        'muweave/invalid_review_input',
        `status must be one of: ${VALID_SHOT_REVIEW_STATUSES.join(', ')}`,
      )
    }

    const idx = this.records.findIndex((r) => r.workspaceId === wsId && r.shotRef === shotRef)
    const prev = idx >= 0 ? this.records[idx] : undefined
    const currentRevision = prev ? prev.revision : 0

    if (input.expectedRevision !== undefined) {
      if (
        typeof input.expectedRevision !== 'number' ||
        !Number.isInteger(input.expectedRevision) ||
        input.expectedRevision < 0
      ) {
        throw new DramaReviewInputError(
          'muweave/invalid_review_input',
          'expectedRevision must be a non-negative integer',
        )
      }
      if (input.expectedRevision !== currentRevision) {
        throw new DramaReviewInputError(
          'muweave/review_revision_conflict',
          `Review revision conflict for ${shotRef}: expected ${input.expectedRevision}, current is ${currentRevision}`,
          { currentRevision },
        )
      }
    }

    const note = input.note !== undefined ? validateNote(input.note) : prev?.note
    const tags = input.tags !== undefined ? validateTags(input.tags) : prev ? [...prev.tags] : []
    const resolvedSceneRef = sceneRef ?? prev?.sceneRef
    const resolvedEpisodeRef = episodeRef ?? prev?.episodeRef

    const next: ShotReviewRecordV1 = {
      workspaceId: wsId,
      shotRef,
      ...(resolvedSceneRef ? { sceneRef: resolvedSceneRef } : {}),
      ...(resolvedEpisodeRef ? { episodeRef: resolvedEpisodeRef } : {}),
      status: input.status,
      ...(note ? { note } : {}),
      tags,
      revision: currentRevision + 1,
      updatedAt: new Date().toISOString(),
    }

    if (idx >= 0) this.records[idx] = next
    else this.records.push(next)

    if (this.records.length > MAX_DRAMA_REVIEWS) {
      this.records = this.records
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, MAX_DRAMA_REVIEWS)
    }

    return next
  }

  private updatedAt(records: readonly ShotReviewRecordV1[]): string {
    return records.reduce((latest, r) => (r.updatedAt > latest ? r.updatedAt : latest), '')
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      const rows =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as { reviews?: unknown }).reviews
          : undefined
      if (!Array.isArray(rows)) throw new Error('reviews is not an array')
      this.records = rows
        .map(validStoredRecord)
        .filter((r): r is ShotReviewRecordV1 => r !== undefined)
    } catch {
      this.records = []
      const aside = path.join(path.dirname(this.file), `drama-reviews.v1.corrupt-${Date.now()}.json`)
      try {
        renameSync(this.file, aside)
        this.corruptFile = aside
      } catch {
        this.corruptFile = this.file
      }
    }
  }

  private persist(): void {
    const dir = path.dirname(this.file)
    mkdirSync(dir, { recursive: true })
    const tmp = `${this.file}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
    writeFileSync(
      tmp,
      `${JSON.stringify({ schema: DRAMA_REVIEWS_SCHEMA, reviews: this.records }, null, 2)}\n`,
      { mode: 0o600 },
    )
    renameSync(tmp, this.file)
  }
}
