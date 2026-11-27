import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import type {
  DramaExportFormat,
  DramaExportResultV1,
  ShotReviewRecordV1,
  ShotReviewStatus,
} from './protocol'

/**
 * Pure rough-cut package compiler for Drama Studio v2.
 * Produces sanitized Cut Manifest JSON, CMX 3600 EDL, and UTF-8 BOM shotlist CSV
 * with deterministic SMPTE timecodes and zero host paths / credentials.
 */

export const VALID_EXPORT_FORMATS: readonly DramaExportFormat[] = [
  'cut_manifest_v1',
  'cmx3600_edl',
  'shotlist_csv',
] as const

export const VALID_EXPORT_FPS = [24, 25, 30] as const
export type DramaExportFps = (typeof VALID_EXPORT_FPS)[number]

const MEDIA_ROLES = ['keyframe', 'reference', 'video', 'voice', 'music', 'sfx'] as const
type MediaRole = (typeof MEDIA_ROLES)[number]
const AUDIO_ROLES: readonly MediaRole[] = ['voice', 'music', 'sfx'] as const

export class DramaExportInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface DramaExportMediaRef {
  sha256?: string
  elementId?: string
  mime?: string
}

export interface DramaExportShotMediaInput extends DramaExportMediaRef {
  role: MediaRole
  artifactId?: string
}

export interface DramaExportShotInput {
  order: number
  sceneRef: string
  shotRef: string
  episodeRef?: string
  plannedDurationMicros: number
  inMs?: number
  outMs?: number
  linkedMedia?: readonly DramaExportShotMediaInput[]
}

export interface DramaExportBuildInput {
  format: DramaExportFormat
  projectId: string
  title: string
  fps?: number
  aspectRatio?: string
  shots: readonly DramaExportShotInput[]
  reviews?: ReadonlyMap<string, ShotReviewRecordV1> | readonly ShotReviewRecordV1[]
  generatedAt?: string
}

interface CompiledShot {
  order: number
  sceneRef: string
  shotRef: string
  inMs: number
  outMs: number
  durationMs: number
  inTc: string
  outTc: string
  reviewStatus: ShotReviewStatus
  reviewNote?: string
  reviewTags: string[]
  media: Partial<Record<MediaRole, DramaExportMediaRef>>
}

function pad(n: number, width = 2): string {
  return String(Math.max(0, Math.floor(n))).padStart(width, '0')
}

/**
 * Convert milliseconds to non-drop-frame SMPTE timecode `HH:MM:SS:FF`.
 * Guarantees non-negative values and monotonic progression.
 */
export function msToSmpte(ms: number, fps: number = 24): string {
  const safeFps = VALID_EXPORT_FPS.includes(fps as DramaExportFps) ? fps : 24
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0
  const totalFrames = Math.round((safeMs * safeFps) / 1000)
  const frames = totalFrames % safeFps
  const totalSec = Math.floor(totalFrames / safeFps)
  const secs = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const mins = totalMin % 60
  const hours = Math.floor(totalMin / 60)
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`
}

export function isValidDramaExportFormat(value: unknown): value is DramaExportFormat {
  return typeof value === 'string' && (VALID_EXPORT_FORMATS as readonly string[]).includes(value)
}

function safeSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return cleaned || 'drama'
}

function sanitizeEdlReel(shotRef: string, order: number): string {
  const alnum = shotRef.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (alnum.length > 0) return alnum.slice(0, 8).padEnd(8, ' ')
  return `SHOT${pad(order, 3)}`.slice(0, 8).padEnd(8, ' ')
}

function sanitizeSingleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function mediaLabel(ref?: DramaExportMediaRef): string {
  if (!ref) return ''
  return ref.sha256 || ref.elementId || ''
}

function normalizeMediaMap(
  linkedMedia?: readonly DramaExportShotMediaInput[],
): Partial<Record<MediaRole, DramaExportMediaRef>> {
  const out: Partial<Record<MediaRole, DramaExportMediaRef>> = {}
  if (!linkedMedia) return out
  for (const item of linkedMedia) {
    if (!MEDIA_ROLES.includes(item.role)) continue
    if (out[item.role]) continue
    const safe: DramaExportMediaRef = {
      ...(typeof item.sha256 === 'string' && item.sha256.trim() ? { sha256: item.sha256.trim() } : {}),
      ...(typeof item.elementId === 'string' && item.elementId.trim() ? { elementId: item.elementId.trim() } : {}),
      ...(typeof item.mime === 'string' && item.mime.trim() ? { mime: item.mime.trim() } : {}),
    }
    if (safe.sha256 || safe.elementId) {
      out[item.role] = safe
    }
  }
  return out
}

function buildReviewLookup(
  reviews?: ReadonlyMap<string, ShotReviewRecordV1> | readonly ShotReviewRecordV1[],
): Map<string, ShotReviewRecordV1> {
  if (!reviews) return new Map()
  if (reviews instanceof Map) return new Map(reviews)
  const map = new Map<string, ShotReviewRecordV1>()
  for (const r of reviews as readonly ShotReviewRecordV1[]) {
    map.set(r.shotRef, r)
  }
  return map
}

function compileShots(
  shots: readonly DramaExportShotInput[],
  reviewMap: Map<string, ShotReviewRecordV1>,
  fps: number,
): { compiled: CompiledShot[]; totalDurationMs: number } {
  const ordered = [...shots].sort(
    (a, b) => a.order - b.order || a.shotRef.localeCompare(b.shotRef),
  )
  let cursorMs = 0
  const compiled: CompiledShot[] = []

  for (const shot of ordered) {
    let inMs: number
    let outMs: number
    if (
      typeof shot.inMs === 'number' &&
      typeof shot.outMs === 'number' &&
      Number.isFinite(shot.inMs) &&
      Number.isFinite(shot.outMs) &&
      shot.outMs >= shot.inMs &&
      shot.inMs >= cursorMs
    ) {
      inMs = Math.max(0, Math.round(shot.inMs))
      outMs = Math.max(inMs, Math.round(shot.outMs))
    } else {
      const durationMs = Math.max(
        0,
        Math.round((Number.isFinite(shot.plannedDurationMicros) ? shot.plannedDurationMicros : 0) / 1000),
      )
      inMs = cursorMs
      outMs = cursorMs + durationMs
    }
    cursorMs = outMs
    const durationMs = outMs - inMs
    const review = reviewMap.get(shot.shotRef)
    compiled.push({
      order: shot.order,
      sceneRef: shot.sceneRef,
      shotRef: shot.shotRef,
      inMs,
      outMs,
      durationMs,
      inTc: msToSmpte(inMs, fps),
      outTc: msToSmpte(outMs, fps),
      reviewStatus: review?.status ?? 'draft',
      ...(review?.note ? { reviewNote: review.note } : {}),
      reviewTags: review ? [...review.tags] : [],
      media: normalizeMediaMap(shot.linkedMedia),
    })
  }

  return { compiled, totalDurationMs: cursorMs }
}

function renderCutManifest(
  projectId: string,
  title: string,
  fps: number,
  aspectRatio: string,
  totalDurationMs: number,
  shots: readonly CompiledShot[],
): string {
  const doc = {
    schema: 'muweave.cut_manifest.v1',
    projectId,
    title,
    fps,
    aspectRatio,
    totalDurationMs,
    shots: shots.map((s) => ({
      order: s.order,
      sceneRef: s.sceneRef,
      shotRef: s.shotRef,
      inMs: s.inMs,
      outMs: s.outMs,
      durationMs: s.durationMs,
      inTc: s.inTc,
      outTc: s.outTc,
      reviewStatus: s.reviewStatus,
      ...(s.reviewNote ? { reviewNote: s.reviewNote } : {}),
      reviewTags: s.reviewTags,
      media: s.media,
    })),
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}

function renderCmx3600Edl(
  title: string,
  fps: number,
  shots: readonly CompiledShot[],
): string {
  const lines: string[] = [
    `TITLE: ${sanitizeSingleLine(title) || 'Untitled'}`,
    'FCM: NON-DROP FRAME',
  ]
  let eventIndex = 0
  for (const shot of shots) {
    eventIndex += 1
    const reel = sanitizeEdlReel(shot.shotRef, shot.order)
    const srcIn = msToSmpte(0, fps)
    const srcOut = msToSmpte(shot.durationMs, fps)
    const recIn = shot.inTc
    const recOut = shot.outTc
    lines.push(
      `${pad(eventIndex, 3)}  ${reel} V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`,
    )
    lines.push(
      `* FROM CLIP NAME: ${sanitizeSingleLine(shot.shotRef)} (${sanitizeSingleLine(shot.sceneRef)}) [${shot.reviewStatus}]`,
    )
    for (const audioRole of AUDIO_ROLES) {
      if (!shot.media[audioRole]) continue
      eventIndex += 1
      lines.push(
        `${pad(eventIndex, 3)}  ${reel} A     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`,
      )
      lines.push(`* AUDIO ROLE: ${audioRole}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function renderShotlistCsv(shots: readonly CompiledShot[]): string {
  const header = 'Order,Scene,Shot,DurationSec,ReviewStatus,Keyframe,Video,Voice,SFX,Music,Note'
  const rows = shots.map((s) =>
    [
      String(s.order),
      s.sceneRef,
      s.shotRef,
      (s.durationMs / 1000).toFixed(2),
      s.reviewStatus,
      mediaLabel(s.media.keyframe),
      mediaLabel(s.media.video),
      mediaLabel(s.media.voice),
      mediaLabel(s.media.sfx),
      mediaLabel(s.media.music),
      s.reviewNote ?? '',
    ]
      .map(csvEscape)
      .join(','),
  )
  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`
}

export function buildDramaExportPackage(input: DramaExportBuildInput): DramaExportResultV1 {
  if (!isValidDramaExportFormat(input.format)) {
    throw new DramaExportInputError(
      'muweave/invalid_export_format',
      `format must be one of: ${VALID_EXPORT_FORMATS.join(', ')}`,
    )
  }
  const fps = input.fps === undefined ? 24 : input.fps
  if (!VALID_EXPORT_FPS.includes(fps as DramaExportFps)) {
    throw new DramaExportInputError(
      'muweave/invalid_export_input',
      `fps must be one of: ${VALID_EXPORT_FPS.join(', ')}`,
    )
  }
  const aspectRatio = (input.aspectRatio ?? '9:16').trim() || '9:16'
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const reviewMap = buildReviewLookup(input.reviews)
  const { compiled, totalDurationMs } = compileShots(input.shots, reviewMap, fps)
  const slug = safeSlug(input.title || input.projectId)

  let content: string
  let filename: string
  let mimeType: DramaExportResultV1['mimeType']

  if (input.format === 'cut_manifest_v1') {
    content = renderCutManifest(
      input.projectId,
      input.title,
      fps,
      aspectRatio,
      totalDurationMs,
      compiled,
    )
    filename = `${slug}-cut-manifest.v1.json`
    mimeType = 'application/json'
  } else if (input.format === 'cmx3600_edl') {
    content = renderCmx3600Edl(input.title, fps, compiled)
    filename = `${slug}-rough-cut.edl`
    mimeType = 'text/plain'
  } else {
    content = renderShotlistCsv(compiled)
    filename = `${slug}-shotlist.csv`
    mimeType = 'text/csv'
  }

  const result: DramaExportResultV1 = {
    schema: 'muweave.drama-export.v1',
    format: input.format,
    filename,
    mimeType,
    shotCount: compiled.length,
    totalDurationMs,
    fps,
    aspectRatio,
    content,
    generatedAt,
  }

  if (containsHostPath(result) || findPlaintextCredential(result)) {
    throw new DramaExportInputError(
      'muweave/unsafe_export_payload',
      'Export package contains prohibited host paths or plaintext credentials',
    )
  }

  return result
}
