import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readCasBlobVerified } from '@yeisme/muweave-bundle'
import { containsHostPath, findPlaintextCredential, isSha256Digest } from '@yeisme/muweave-bundle/consumer'
import { applyEpisodeCut } from './drama-cut-store'
import type {
  CutTransitionKind,
  DramaExportFormat,
  DramaExportResultV1,
  EpisodeCutOverrideV1,
  ShotReviewRecordV1,
  ShotReviewStatus,
} from './protocol'

/**
 * Pure rough-cut package compiler for Drama Studio v2/v7.
 * Produces sanitized Cut Manifest JSON, CMX 3600 EDL, UTF-8 BOM shotlist CSV,
 * FCPXML 1.10, and Jianying/CapCut draft_content.json with deterministic SMPTE timecodes
 * and zero host paths / credentials.
 */

export const VALID_EXPORT_FORMATS: readonly DramaExportFormat[] = [
  'cut_manifest_v1',
  'cmx3600_edl',
  'shotlist_csv',
  'fcpxml_1_10',
  'jianying_draft_v1',
  'srt_subtitles',
  'webvtt_subtitles',
  'review_deck_html',
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
  dialogue?: string
  cells?: Record<string, unknown>
  linkedMedia?: readonly DramaExportShotMediaInput[]
}

export interface DramaExportBuildInput {
  format: DramaExportFormat
  projectId: string
  title: string
  fps?: number
  aspectRatio?: string
  episodeRef?: string
  cutOverride?: EpisodeCutOverrideV1
  complianceDisclosure?: string
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
  transition: CutTransitionKind
  dialogue?: string
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
  episodeRef?: string,
  cutOverride?: EpisodeCutOverrideV1,
): { compiled: CompiledShot[]; totalDurationMs: number } {
  const epFiltered = episodeRef
    ? shots.filter((s) => !s.episodeRef || s.episodeRef === episodeRef)
    : [...shots]
  const hasCut = Boolean(cutOverride)
  const ordered = hasCut
    ? applyEpisodeCut(epFiltered, cutOverride)
    : [...epFiltered]
        .sort((a, b) => a.order - b.order || a.shotRef.localeCompare(b.shotRef))
        .map((s) => ({ ...s, transition: 'cut' as CutTransitionKind }))

  let cursorMs = 0
  const compiled: CompiledShot[] = []

  for (const shot of ordered) {
    let inMs: number
    let outMs: number
    if (
      !hasCut &&
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
    const cellDialogue =
      typeof shot.dialogue === 'string' && shot.dialogue.trim()
        ? shot.dialogue.trim()
        : typeof shot.cells?.dialogue === 'string' && shot.cells.dialogue.trim()
          ? shot.cells.dialogue.trim()
          : typeof shot.cells?.subtitle === 'string' && shot.cells.subtitle.trim()
            ? shot.cells.subtitle.trim()
            : typeof shot.cells?.action === 'string' && shot.cells.action.trim()
              ? shot.cells.action.trim()
              : undefined
    compiled.push({
      order: shot.order,
      sceneRef: shot.sceneRef,
      shotRef: shot.shotRef,
      inMs,
      outMs,
      durationMs,
      inTc: msToSmpte(inMs, fps),
      outTc: msToSmpte(outMs, fps),
      transition: shot.transition,
      ...(cellDialogue ? { dialogue: cellDialogue } : {}),
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

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function portableMediaExt(mime?: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'video/mp4': return 'mp4'
    case 'video/webm': return 'webm'
    case 'audio/mpeg': return 'mp3'
    case 'audio/wav': return 'wav'
    case 'audio/ogg': return 'ogg'
    default: return 'png'
  }
}

export function portableRelativeMediaPath(sha256: string, mime?: string): string {
  const hex = sha256.replace(/^sha256:/, '').slice(0, 12)
  return `media/${hex}.${portableMediaExt(mime)}`
}

function renderFcpxml110(
  title: string,
  fps: number,
  aspectRatio: string,
  totalDurationMs: number,
  shots: readonly CompiledShot[],
): string {
  const isVertical = aspectRatio === '9:16'
  const width = isVertical ? 1080 : 1920
  const height = isVertical ? 1920 : 1080
  const frameDuration = `1/${fps}s`
  const toRational = (ms: number) => `${Math.max(0, Math.round((ms * fps) / 1000))}/${fps}s`

  const assets: string[] = []
  const spineItems: string[] = []
  let assetCounter = 1

  for (const shot of shots) {
    const visual = shot.media.video ?? shot.media.keyframe ?? shot.media.reference
    const assetId = `r${++assetCounter}`
    const relSrc = visual?.sha256
      ? portableRelativeMediaPath(visual.sha256, visual.mime)
      : `media/${safeSlug(shot.shotRef)}.png`
    const dur = toRational(shot.durationMs)
    const offset = toRational(shot.inMs)
    const hasVideo = Boolean(shot.media.video)
    assets.push(
      `    <asset id="${assetId}" name="${xmlEscape(shot.shotRef)}" src="${xmlEscape(relSrc)}" start="0s" duration="${dur}" hasVideo="1" hasAudio="${hasVideo ? '1' : '0'}" format="r1"/>`,
    )
    spineItems.push(
      `            <asset-clip ref="${assetId}" offset="${offset}" name="${xmlEscape(`${shot.shotRef} (${shot.sceneRef})`)}" start="0s" duration="${dur}">`,
    )
    spineItems.push(
      `              <note>${xmlEscape(`[${shot.reviewStatus}] transition=${shot.transition}${shot.reviewNote ? ` ${shot.reviewNote}` : ''}`)}</note>`,
    )
    for (const audioRole of AUDIO_ROLES) {
      const audio = shot.media[audioRole]
      if (!audio) continue
      const audioAssetId = `r${++assetCounter}`
      const audioSrc = audio.sha256
        ? portableRelativeMediaPath(audio.sha256, audio.mime ?? 'audio/mpeg')
        : `media/${safeSlug(shot.shotRef)}-${audioRole}.mp3`
      assets.push(
        `    <asset id="${audioAssetId}" name="${xmlEscape(`${shot.shotRef}_${audioRole}`)}" src="${xmlEscape(audioSrc)}" start="0s" duration="${dur}" hasVideo="0" hasAudio="1"/>`,
      )
      spineItems.push(
        `              <asset-clip ref="${audioAssetId}" lane="-1" offset="0s" name="${xmlEscape(`${shot.shotRef}_${audioRole}`)}" start="0s" duration="${dur}"/>`,
      )
    }
    spineItems.push('            </asset-clip>')
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.10">',
    '  <resources>',
    `    <format id="r1" name="FFVideoFormat${width}x${height}p${fps}" frameDuration="${frameDuration}" width="${width}" height="${height}"/>`,
    ...assets,
    '  </resources>',
    '  <library>',
    `    <event name="${xmlEscape(title)}">`,
    `      <project name="${xmlEscape(title)}">`,
    `        <sequence format="r1" duration="${toRational(totalDurationMs)}" tcStart="0s" tcFormat="NDF">`,
    '          <spine>',
    ...spineItems,
    '          </spine>',
    '        </sequence>',
    '      </project>',
    '    </event>',
    '  </library>',
    '</fcpxml>',
    '',
  ].join('\n')
}

function renderJianyingDraftV1(
  projectId: string,
  title: string,
  fps: number,
  aspectRatio: string,
  totalDurationMs: number,
  shots: readonly CompiledShot[],
): string {
  const isVertical = aspectRatio === '9:16'
  const width = isVertical ? 1080 : 1920
  const height = isVertical ? 1920 : 1080

  const videos: Array<Record<string, unknown>> = []
  const audios: Array<Record<string, unknown>> = []
  const videoSegments: Array<Record<string, unknown>> = []
  const audioSegments: Array<Record<string, unknown>> = []

  for (const shot of shots) {
    const startUs = shot.inMs * 1000
    const durationUs = shot.durationMs * 1000
    const visual = shot.media.video ?? shot.media.keyframe ?? shot.media.reference
    const matId = `mat_v_${shot.order}_${shot.shotRef}`
    const relPath = visual?.sha256
      ? portableRelativeMediaPath(visual.sha256, visual.mime)
      : `media/${safeSlug(shot.shotRef)}.png`
    videos.push({
      id: matId,
      type: shot.media.video ? 'video' : 'photo',
      material_name: shot.shotRef,
      path: relPath,
      width,
      height,
      duration: durationUs,
    })
    videoSegments.push({
      id: `seg_v_${shot.order}_${shot.shotRef}`,
      material_id: matId,
      target_timerange: { start: startUs, duration: durationUs },
      source_timerange: { start: 0, duration: durationUs },
      transition: shot.transition,
      extra_material_refs: [],
    })

    for (const audioRole of AUDIO_ROLES) {
      const audio = shot.media[audioRole]
      if (!audio) continue
      const audioId = `mat_a_${shot.order}_${shot.shotRef}_${audioRole}`
      const audioPath = audio.sha256
        ? portableRelativeMediaPath(audio.sha256, audio.mime ?? 'audio/mpeg')
        : `media/${safeSlug(shot.shotRef)}-${audioRole}.mp3`
      audios.push({
        id: audioId,
        type: 'extract_music',
        name: `${shot.shotRef}_${audioRole}`,
        path: audioPath,
        duration: durationUs,
      })
      audioSegments.push({
        id: `seg_a_${shot.order}_${shot.shotRef}_${audioRole}`,
        material_id: audioId,
        target_timerange: { start: startUs, duration: durationUs },
        source_timerange: { start: 0, duration: durationUs },
      })
    }
  }

  const draft = {
    schema: 'muweave.jianying-draft.v1',
    id: projectId,
    name: title,
    fps,
    duration: totalDurationMs * 1000,
    canvas_config: { width, height, ratio: aspectRatio },
    materials: { videos, audios, texts: [] },
    tracks: [
      { id: 'track_video_main', type: 'video', segments: videoSegments },
      ...(audioSegments.length ? [{ id: 'track_audio_main', type: 'audio', segments: audioSegments }] : []),
    ],
  }
  return `${JSON.stringify(draft, null, 2)}\n`
}

function formatSubtitleTimestamp(ms: number, sep: ',' | '.'): string {
  const safeMs = Math.max(0, Math.round(ms))
  const millis = safeMs % 1000
  const totalSec = Math.floor(safeMs / 1000)
  const secs = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const mins = totalMin % 60
  const hours = Math.floor(totalMin / 60)
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}${sep}${pad(millis, 3)}`
}

function renderSrtSubtitles(shots: readonly CompiledShot[]): string {
  const blocks: string[] = []
  shots.forEach((shot, idx) => {
    const caption = sanitizeSingleLine(shot.dialogue || `${shot.shotRef} (${shot.sceneRef})`)
    blocks.push(
      `${idx + 1}\n${formatSubtitleTimestamp(shot.inMs, ',')} --> ${formatSubtitleTimestamp(shot.outMs, ',')}\n${caption}`,
    )
  })
  return blocks.length ? `${blocks.join('\n\n')}\n` : ''
}

function renderWebvttSubtitles(shots: readonly CompiledShot[]): string {
  const blocks: string[] = ['WEBVTT']
  shots.forEach((shot, idx) => {
    const caption = sanitizeSingleLine(shot.dialogue || `${shot.shotRef} (${shot.sceneRef})`)
    blocks.push(
      `${idx + 1}\n${formatSubtitleTimestamp(shot.inMs, '.')} --> ${formatSubtitleTimestamp(shot.outMs, '.')}\n${caption}`,
    )
  })
  return `${blocks.join('\n\n')}\n`
}

function safeJsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function renderReviewDeckHtml(
  title: string,
  aspectRatio: string,
  totalDurationMs: number,
  shots: readonly CompiledShot[],
  complianceDisclosure?: string,
): string {
  const deckState = {
    title,
    aspectRatio,
    totalDurationMs,
    complianceDisclosure: complianceDisclosure?.trim() || '',
    shots: shots.map((s) => {
      const visual = s.media.video ?? s.media.keyframe ?? s.media.reference
      const audio = s.media.voice ?? s.media.sfx ?? s.media.music
      return {
        order: s.order,
        sceneRef: s.sceneRef,
        shotRef: s.shotRef,
        durationMs: s.durationMs,
        inTc: s.inTc,
        outTc: s.outTc,
        dialogue: s.dialogue ?? '',
        status: s.reviewStatus,
        note: s.reviewNote ?? '',
        tags: s.reviewTags,
        visualSrc: visual?.sha256 ? portableRelativeMediaPath(visual.sha256, visual.mime) : '',
        visualKind: s.media.video ? 'video' : 'image',
        audioSrc: audio?.sha256 ? portableRelativeMediaPath(audio.sha256, audio.mime ?? 'audio/mpeg') : '',
      }
    }),
  }

  const escapedTitle = xmlEscape(title)
  const escapedDisclosure = complianceDisclosure?.trim() ? xmlEscape(complianceDisclosure.trim()) : ''
  const embeddedJson = safeJsonForHtmlScript(deckState)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapedTitle} — Offline Client Review Deck</title>
<style>
:root{--bg:#111318;--card:#1a1e26;--ink:#f3f5f8;--muted:#9aa3b2;--line:#2a3140;--ok:#22c55e;--warn:#eab308;--accent:#38bdf8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--line);background:var(--card)}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;border:1px solid var(--line);color:var(--muted)}
.badge.disclosure{border-color:var(--accent);color:var(--accent)}
main{max-width:1120px;margin:0 auto;padding:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.shot{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.stage{aspect-ratio:${aspectRatio === '16:9' ? '16/9' : '9/16'};max-height:360px;background:#090b0f;display:flex;align-items:center;justify-content:center;position:relative}
.stage img,.stage video{width:100%;height:100%;object-fit:contain}
.poster{padding:16px;text-align:center;color:var(--muted)}
.body{padding:12px;display:flex;flex-direction:column;gap:8px}
.row{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
button{cursor:pointer;border:1px solid var(--line);background:#232936;color:var(--ink);padding:6px 10px;border-radius:8px;font-size:12px}
button.active-ok{border-color:var(--ok);color:var(--ok)}
button.active-warn{border-color:var(--warn);color:var(--warn)}
button.primary{background:var(--accent);color:#081018;border-color:var(--accent);font-weight:600}
textarea{width:100%;min-height:56px;background:#111318;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit}
</style>
</head>
<body>
<header>
  <div>
    <strong>${escapedTitle}</strong>
    <span class="badge">${shots.length} 镜 · ${(totalDurationMs / 1000).toFixed(1)}s · ${xmlEscape(aspectRatio)}</span>
    ${escapedDisclosure ? `<span class="badge disclosure" data-compliance-disclosure="true">${escapedDisclosure}</span>` : ''}
  </div>
  <button id="download-btn" class="primary" type="button">导出审片反馈 (review-feedback.json)</button>
</header>
<main id="deck-root"></main>
<script id="muweave-deck-data" type="application/json">${embeddedJson}</script>
<script>
(function(){
  const data = JSON.parse(document.getElementById('muweave-deck-data').textContent || '{}');
  const state = (data.shots || []).map((s) => ({ ...s }));
  const root = document.getElementById('deck-root');
  function render() {
    root.innerHTML = '';
    state.forEach((shot, idx) => {
      const card = document.createElement('article');
      card.className = 'shot';
      const stage = document.createElement('div');
      stage.className = 'stage';
      if (shot.visualSrc) {
        const el = document.createElement(shot.visualKind === 'video' ? 'video' : 'img');
        el.src = shot.visualSrc;
        if (shot.visualKind === 'video') el.controls = true;
        else el.alt = shot.shotRef;
        el.onerror = () => { stage.innerHTML = '<div class="poster">' + shot.shotRef + '</div>'; };
        stage.appendChild(el);
      } else {
        const p = document.createElement('div');
        p.className = 'poster';
        p.textContent = '#' + shot.order + ' ' + shot.shotRef;
        stage.appendChild(p);
      }
      const body = document.createElement('div');
      body.className = 'body';
      const head = document.createElement('div');
      head.className = 'row';
      const label = document.createElement('strong');
      label.textContent = '#' + shot.order + ' ' + shot.shotRef + ' (' + shot.sceneRef + ')';
      const tc = document.createElement('span');
      tc.className = 'badge';
      tc.textContent = shot.inTc + ' → ' + shot.outTc;
      head.append(label, tc);
      body.appendChild(head);
      if (shot.dialogue) {
        const cap = document.createElement('div');
        cap.style.color = '#9aa3b2';
        cap.textContent = shot.dialogue;
        body.appendChild(cap);
      }
      const actions = document.createElement('div');
      actions.className = 'row';
      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.textContent = '通过 (approved)';
      if (shot.status === 'approved' || shot.status === 'locked') okBtn.className = 'active-ok';
      okBtn.onclick = () => { state[idx].status = 'approved'; render(); };
      const revBtn = document.createElement('button');
      revBtn.type = 'button';
      revBtn.textContent = '需修改 (needs_revision)';
      if (shot.status === 'needs_revision') revBtn.className = 'active-warn';
      revBtn.onclick = () => { state[idx].status = 'needs_revision'; render(); };
      actions.append(okBtn, revBtn);
      body.appendChild(actions);
      const note = document.createElement('textarea');
      note.placeholder = '输入审片批注...';
      note.value = shot.note || '';
      note.oninput = (e) => { state[idx].note = e.target.value; };
      body.appendChild(note);
      card.append(stage, body);
      root.appendChild(card);
    });
  }
  document.getElementById('download-btn').onclick = () => {
    const payload = state.map((s) => ({
      shotRef: s.shotRef,
      status: s.status || 'in_review',
      ...(s.note && s.note.trim() ? { note: s.note.trim() } : {}),
      tags: Array.isArray(s.tags) ? s.tags : [],
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'review-feedback.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  render();
})();
</script>
</body>
</html>
`
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
  const { compiled, totalDurationMs } = compileShots(
    input.shots,
    reviewMap,
    fps,
    input.episodeRef,
    input.cutOverride,
  )
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
  } else if (input.format === 'fcpxml_1_10') {
    content = renderFcpxml110(input.title, fps, aspectRatio, totalDurationMs, compiled)
    filename = `${slug}.fcpxml`
    mimeType = 'application/xml'
  } else if (input.format === 'jianying_draft_v1') {
    content = renderJianyingDraftV1(
      input.projectId,
      input.title,
      fps,
      aspectRatio,
      totalDurationMs,
      compiled,
    )
    filename = 'draft_content.json'
    mimeType = 'application/json'
  } else if (input.format === 'srt_subtitles') {
    content = renderSrtSubtitles(compiled)
    filename = `${slug}.srt`
    mimeType = 'application/x-subrip'
  } else if (input.format === 'webvtt_subtitles') {
    content = renderWebvttSubtitles(compiled)
    filename = `${slug}.vtt`
    mimeType = 'text/vtt'
  } else if (input.format === 'review_deck_html') {
    content = renderReviewDeckHtml(
      input.title,
      aspectRatio,
      totalDurationMs,
      compiled,
      input.complianceDisclosure,
    )
    filename = `${slug}-review-deck.html`
    mimeType = 'text/html'
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

export interface PortableBundleExportInput {
  workspaceDir: string
  exportResult: DramaExportResultV1
  bundleDir: string
  mediaBlobs: ReadonlyArray<{ sha256: string; mime?: string }>
  subtitlesSrt?: string
}

export interface PortableBundleExportResult {
  ok: true
  filename: string
  format: DramaExportFormat
  copiedMediaFiles: string[]
  subtitlesFile?: 'subtitles.srt'
  readmeFile: 'README.txt'
}

/**
 * Materializes a self-contained portable NLE handoff or offline review deck folder:
 * `<bundleDir>/<exportResult.filename>`, `<bundleDir>/media/<sha12>.<ext>`, optional `subtitles.srt`,
 * and `<bundleDir>/README.txt` with zero host filesystem paths inside any written file.
 */
export async function exportDramaPortableBundle(
  input: PortableBundleExportInput,
): Promise<PortableBundleExportResult> {
  const outDir = path.resolve(input.bundleDir)
  const mediaDir = path.join(outDir, 'media')
  await mkdir(mediaDir, { recursive: true })

  await writeFile(path.join(outDir, input.exportResult.filename), input.exportResult.content, 'utf8')

  let subtitlesFile: 'subtitles.srt' | undefined
  if (input.exportResult.format === 'review_deck_html') {
    const srtContent = input.subtitlesSrt ?? ''
    if (containsHostPath(srtContent) || findPlaintextCredential(srtContent)) {
      throw new DramaExportInputError('muweave/unsafe_export_payload', 'Subtitles failed sanitization check')
    }
    await writeFile(path.join(outDir, 'subtitles.srt'), srtContent, 'utf8')
    subtitlesFile = 'subtitles.srt'
  }

  const seen = new Set<string>()
  const copiedMediaFiles: string[] = []
  for (const item of input.mediaBlobs) {
    if (!isSha256Digest(item.sha256) || seen.has(item.sha256)) continue
    seen.add(item.sha256)
    const rel = portableRelativeMediaPath(item.sha256, item.mime)
    try {
      const bytes = await readCasBlobVerified(input.workspaceDir, item.sha256)
      await writeFile(path.join(outDir, rel), bytes)
      copiedMediaFiles.push(rel)
    } catch {
      /* skip missing/unverified CAS blobs cleanly */
    }
  }

  const readme = [
    'MuWeave DSH Portable Rough-Cut / Review Bundle',
    `Format: ${input.exportResult.format}`,
    `Primary File: ${input.exportResult.filename}`,
    ...(subtitlesFile ? [`Subtitles File: ${subtitlesFile}`] : []),
    `Shots: ${input.exportResult.shotCount} | Duration: ${(input.exportResult.totalDurationMs / 1000).toFixed(2)}s | FPS: ${input.exportResult.fps} | Aspect: ${input.exportResult.aspectRatio}`,
    `Media Files (${copiedMediaFiles.length}):`,
    ...copiedMediaFiles.map((f) => `  - ${f}`),
    '',
    input.exportResult.format === 'review_deck_html'
      ? 'Open the HTML file directly in any browser (works offline), review shots, and export review-feedback.json to import back via `muweave review import`.'
      : 'Import the timeline file into Final Cut Pro / DaVinci Resolve / Premiere / Jianying with the sibling media/ folder intact.',
    '',
  ].join('\n')

  if (containsHostPath(readme) || findPlaintextCredential(readme)) {
    throw new DramaExportInputError('muweave/unsafe_export_payload', 'Portable bundle README failed sanitization check')
  }
  await writeFile(path.join(outDir, 'README.txt'), readme, 'utf8')

  return {
    ok: true,
    filename: input.exportResult.filename,
    format: input.exportResult.format,
    copiedMediaFiles,
    ...(subtitlesFile ? { subtitlesFile } : {}),
    readmeFile: 'README.txt',
  }
}
