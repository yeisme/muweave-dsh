/**
 * Zero-dependency HTML5 Animatic (rough-cut storyboard) preview player.
 * Sequences shots by `plannedDurationMicros`, resolves media via `/api/muweave-dsh/media`
 * short-TTL grants, supports 9:16 / 16:9 aspect toggle, scrub bar, mute, and review badges.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { ShotReviewRecordV1 } from '../protocol'
import { Poster } from './editorial'
import type { MuweaveDictKey, MuweaveTranslator } from './i18n'
import { useMediaUrl } from './media'
import type { MuweaveRpcClient } from './rpc-client'
import { keyframeDigest, mediaForRole, shotDescription, type LinkedMediaRef } from './shot-media'
import { Segmented, StatusTag } from './ui'

export type AnimaticAspect = '9:16' | '16:9'

export interface AnimaticShotRow {
  sceneRef: string
  shotRef: string
  order: number
  plannedDurationMicros: number
  cells?: Record<string, unknown>
  restrictedFields?: readonly string[]
  linkedMedia?: readonly LinkedMediaRef[]
}

export interface AnimaticPlayerProps {
  rpc: MuweaveRpcClient
  rows: readonly AnimaticShotRow[]
  reviews?: ReadonlyMap<string, ShotReviewRecordV1> | Readonly<Record<string, ShotReviewRecordV1>>
  initialShotRef?: string
  onSelectShot?: (shotRef: string) => void
  t: MuweaveTranslator | ((key: string) => string)
}

const MIN_SHOT_MS = 500
const TICK_MS = 50

function safeLang(t: AnimaticPlayerProps['t']): 'zh' | 'en' {
  try {
    const code = t('langCode' as MuweaveDictKey)
    if (code === 'en') return 'en'
  } catch {
    // ignore
  }
  return 'zh'
}

function formatTimecode(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalTenths = Math.floor(clamped / 100)
  const tenths = totalTenths % 10
  const totalSec = Math.floor(totalTenths / 10)
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60)
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenths}`
}

function shotDurationMs(row: AnimaticShotRow | undefined): number {
  if (!row) return MIN_SHOT_MS
  const ms = Math.round((row.plannedDurationMicros || 0) / 1000)
  return ms >= MIN_SHOT_MS ? ms : MIN_SHOT_MS
}

function lookupReview(
  reviews: AnimaticPlayerProps['reviews'],
  shotRef: string | undefined,
): ShotReviewRecordV1 | undefined {
  if (!reviews || !shotRef) return undefined
  if (reviews instanceof Map) return reviews.get(shotRef)
  return (reviews as Readonly<Record<string, ShotReviewRecordV1>>)[shotRef]
}

function useTypedMediaUrl(
  rpc: MuweaveRpcClient,
  sha256: string | undefined,
  mime: string | undefined,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    setUrl(undefined)
    if (!sha256) return
    let cancelled = false
    void rpc
      .resolveMediaUrl(sha256, mime ?? 'application/octet-stream')
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [rpc, sha256, mime])
  return url
}

function safePlay(el: HTMLMediaElement | null): void {
  if (!el || typeof el.play !== 'function') return
  try {
    const p = el.play()
    if (p && typeof p.catch === 'function') void p.catch(() => undefined)
  } catch {
    // jsdom / autoplay policy
  }
}

function safePause(el: HTMLMediaElement | null): void {
  if (!el || typeof el.pause !== 'function') return
  try {
    el.pause()
  } catch {
    // ignore
  }
}

export function AnimaticPlayer({
  rpc,
  rows,
  reviews,
  initialShotRef,
  onSelectShot,
  t,
}: AnimaticPlayerProps) {
  const lang = safeLang(t)
  const labels =
    lang === 'en'
      ? {
          title: 'Animatic Preview',
          play: 'Play',
          pause: 'Pause',
          prev: 'Previous shot',
          next: 'Next shot',
          mute: 'Mute',
          unmute: 'Unmute',
          aspect: 'Aspect ratio',
          scrub: 'Seek timeline',
          empty: 'No storyboard shots to preview.',
          shot: 'Shot',
          kbdPlayPause: 'Play/Pause',
          kbdStep: 'Prev/Next',
          safeZone: '9:16 Safe Zone',
        }
      : {
          title: 'Animatic 动态预演',
          play: '播放',
          pause: '暂停',
          prev: '上一镜',
          next: '下一镜',
          mute: '静音',
          unmute: '取消静音',
          aspect: '画幅比例',
          scrub: '拖动进度',
          empty: '暂无可预演的分镜。',
          shot: '镜头',
          kbdPlayPause: '播停',
          kbdStep: '切镜',
          safeZone: '9:16 安全区',
        }

  const [aspect, setAspect] = useState<AnimaticAspect>('9:16')
  const [showSafeZone, setShowSafeZone] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)

  const initialIdx = useMemo(() => {
    if (!initialShotRef) return 0
    const idx = rows.findIndex((r) => r.shotRef === initialShotRef)
    return idx >= 0 ? idx : 0
  }, [rows, initialShotRef])

  const [shotIdx, setShotIdx] = useState(initialIdx)
  const [shotElapsedMs, setShotElapsedMs] = useState(0)

  useEffect(() => {
    if (rows.length === 0) {
      setShotIdx(0)
      setShotElapsedMs(0)
      setPlaying(false)
      return
    }
    if (shotIdx >= rows.length) {
      setShotIdx(0)
      setShotElapsedMs(0)
    }
  }, [rows.length, shotIdx])

  useEffect(() => {
    if (!initialShotRef) return
    const idx = rows.findIndex((r) => r.shotRef === initialShotRef)
    if (idx >= 0) {
      setShotIdx(idx)
      setShotElapsedMs(0)
    }
  }, [initialShotRef, rows])

  const timeline = useMemo(() => {
    let cursor = 0
    const starts: number[] = []
    const durations: number[] = []
    for (const row of rows) {
      starts.push(cursor)
      const dur = shotDurationMs(row)
      durations.push(dur)
      cursor += dur
    }
    return { starts, durations, totalMs: cursor }
  }, [rows])

  const currentRow = rows[shotIdx]
  const currentDurationMs = timeline.durations[shotIdx] ?? MIN_SHOT_MS
  const globalElapsedMs = Math.min(timeline.totalMs, (timeline.starts[shotIdx] ?? 0) + shotElapsedMs)
  const progressPct = timeline.totalMs > 0 ? Math.min(100, Math.max(0, (globalElapsedMs / timeline.totalMs) * 100)) : 0

  const goToShot = useCallback(
    (nextIdx: number) => {
      if (rows.length === 0) return
      const clamped = Math.max(0, Math.min(rows.length - 1, nextIdx))
      setShotIdx(clamped)
      setShotElapsedMs(0)
      const target = rows[clamped]
      if (target) onSelectShot?.(target.shotRef)
    },
    [rows, onSelectShot],
  )

  useEffect(() => {
    if (!playing || rows.length === 0) return
    const id = setInterval(() => {
      setShotElapsedMs((prev) => {
        const next = prev + TICK_MS
        if (next >= currentDurationMs) {
          if (shotIdx + 1 < rows.length) {
            const nextIdx = shotIdx + 1
            setShotIdx(nextIdx)
            const nextRow = rows[nextIdx]
            if (nextRow) onSelectShot?.(nextRow.shotRef)
            return 0
          }
          setPlaying(false)
          return currentDurationMs
        }
        return next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [playing, rows, shotIdx, currentDurationMs, onSelectShot])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const voiceRef = useRef<HTMLAudioElement | null>(null)
  const sfxRef = useRef<HTMLAudioElement | null>(null)

  const videoLink = useMemo(
    () => mediaForRole(currentRow?.linkedMedia, 'video').find((m) => m.sha256),
    [currentRow],
  )
  const voiceLink = useMemo(
    () => mediaForRole(currentRow?.linkedMedia, 'voice').find((m) => m.sha256),
    [currentRow],
  )
  const sfxLink = useMemo(
    () =>
      mediaForRole(currentRow?.linkedMedia, 'sfx').find((m) => m.sha256) ??
      mediaForRole(currentRow?.linkedMedia, 'music').find((m) => m.sha256),
    [currentRow],
  )

  const keyframeUrl = useMediaUrl(rpc, keyframeDigest(currentRow?.linkedMedia))
  const videoUrl = useTypedMediaUrl(rpc, videoLink?.sha256, videoLink?.mime ?? 'video/mp4')
  const voiceUrl = useTypedMediaUrl(rpc, voiceLink?.sha256, voiceLink?.mime ?? 'audio/mpeg')
  const sfxUrl = useTypedMediaUrl(rpc, sfxLink?.sha256, sfxLink?.mime ?? 'audio/mpeg')

  useEffect(() => {
    const mediaEls: Array<HTMLMediaElement | null> = [videoRef.current, voiceRef.current, sfxRef.current]
    for (const el of mediaEls) {
      if (!el) continue
      el.muted = muted
      if (playing) safePlay(el)
      else safePause(el)
    }
  }, [playing, muted, shotIdx, videoUrl, voiceUrl, sfxUrl])

  const handleScrub = useCallback(
    (ratio: number) => {
      if (rows.length === 0 || timeline.totalMs <= 0) return
      const targetMs = Math.max(0, Math.min(timeline.totalMs, ratio * timeline.totalMs))
      let foundIdx = rows.length - 1
      for (let i = 0; i < timeline.starts.length; i += 1) {
        const start = timeline.starts[i] ?? 0
        const dur = timeline.durations[i] ?? MIN_SHOT_MS
        if (targetMs < start + dur) {
          foundIdx = i
          break
        }
      }
      setShotIdx(foundIdx)
      setShotElapsedMs(Math.max(0, targetMs - (timeline.starts[foundIdx] ?? 0)))
      const target = rows[foundIdx]
      if (target) onSelectShot?.(target.shotRef)
    },
    [rows, timeline, onSelectShot],
  )

  const togglePlay = useCallback(() => {
    if (!playing && shotIdx === rows.length - 1 && shotElapsedMs >= currentDurationMs) {
      setShotIdx(0)
      setShotElapsedMs(0)
    }
    setPlaying((p) => !p)
  }, [playing, shotIdx, rows.length, shotElapsedMs, currentDurationMs])

  const handleKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLElement>) => {
      if (ev.nativeEvent.isComposing) return
      const tag = (ev.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (ev.key === ' ' || ev.code === 'Space') {
        ev.preventDefault()
        togglePlay()
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault()
        goToShot(shotIdx - 1)
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault()
        goToShot(shotIdx + 1)
      }
    },
    [togglePlay, goToShot, shotIdx],
  )

  if (rows.length === 0 || !currentRow) {
    return (
      <section className="dr-animatic" data-aspect={aspect} data-muweave-animatic="true" aria-label={labels.title}>
        <p className="mw-dsh-muted">{labels.empty}</p>
      </section>
    )
  }

  const review = lookupReview(reviews, currentRow.shotRef)
  const desc = currentRow.cells ? shotDescription(currentRow.cells, currentRow.restrictedFields ?? []) : ''
  const orderLabel = String(currentRow.order).padStart(2, '0')

  return (
    <section
      className="dr-animatic"
      data-aspect={aspect}
      data-muweave-animatic="true"
      aria-label={labels.title}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="dr-animatic-head">
        <div className="mw-row" data-gap="xs">
          <span className="mw-title">{labels.title}</span>
          <span className="mw-chip" data-mono="true" data-muweave-animatic-shot={currentRow.shotRef}>
            {`${orderLabel} · ${currentRow.shotRef}`}
          </span>
          {review ? <StatusTag status={review.status} lang={lang} /> : null}
        </div>
        <div className="mw-row" data-gap="xs">
          <button
            type="button"
            className="mw-dsh-btn"
            data-variant="quiet"
            data-size="sm"
            aria-pressed={showSafeZone}
            data-animatic-safezone-toggle="true"
            onClick={() => setShowSafeZone((v) => !v)}
          >
            {labels.safeZone}
          </button>
          <Segmented<AnimaticAspect>
            label={labels.aspect}
            value={aspect}
            options={[
              { value: '9:16', label: '9:16' },
              { value: '16:9', label: '16:9' },
            ]}
            onChange={setAspect}
          />
        </div>
      </div>

      <div className="dr-animatic-cinema">
        <div className="dr-animatic-stage">
          {videoUrl ? (
            <video
              ref={videoRef}
              className="dr-animatic-media"
              src={videoUrl}
              muted={muted}
              playsInline
              data-muweave-animatic-video="true"
            />
          ) : keyframeUrl ? (
            <img
              className="dr-animatic-media"
              src={keyframeUrl}
              alt={`${orderLabel} ${currentRow.shotRef}`}
              data-muweave-animatic-image="true"
            />
          ) : (
            <Poster title={orderLabel} meta={`${currentRow.sceneRef} · ${currentRow.shotRef}`} />
          )}
          {voiceUrl ? <audio ref={voiceRef} src={voiceUrl} muted={muted} data-muweave-animatic-voice="true" /> : null}
          {sfxUrl ? <audio ref={sfxRef} src={sfxUrl} muted={muted} data-muweave-animatic-sfx="true" /> : null}
          {showSafeZone ? (
            <div className="dr-safe-zone-overlay" data-safe-zone-overlay="true" aria-hidden="true">
              <span className="dr-safe-zone-top" />
              <span className="dr-safe-zone-right" />
              <span className="dr-safe-zone-bottom" />
              <span className="dr-safe-zone-inner" />
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className="dr-animatic-scrub"
        aria-label={labels.scrub}
        data-muweave-animatic-scrub="true"
        style={{ '--mw-progress': `${progressPct.toFixed(1)}%` } as CSSProperties}
        onClick={(ev) => {
          const rect = ev.currentTarget.getBoundingClientRect()
          if (rect.width > 0) handleScrub((ev.clientX - rect.left) / rect.width)
        }}
      >
        <span className="dr-animatic-scrub-fill" aria-hidden="true" />
      </button>

      <div className="dr-animatic-controls">
        <div className="mw-row" data-gap="xs">
          <button
            type="button"
            className="mw-dsh-btn"
            data-variant="quiet"
            data-size="sm"
            disabled={shotIdx <= 0}
            data-muweave-animatic-prev="true"
            onClick={() => goToShot(shotIdx - 1)}
          >
            {labels.prev}
          </button>
          <button
            type="button"
            className="mw-dsh-btn"
            data-variant="primary"
            data-size="sm"
            data-muweave-animatic-play="true"
            aria-pressed={playing}
            onClick={togglePlay}
          >
            {playing ? labels.pause : labels.play}
          </button>
          <button
            type="button"
            className="mw-dsh-btn"
            data-variant="quiet"
            data-size="sm"
            disabled={shotIdx >= rows.length - 1}
            data-muweave-animatic-next="true"
            onClick={() => goToShot(shotIdx + 1)}
          >
            {labels.next}
          </button>
          <button
            type="button"
            className="mw-dsh-btn"
            data-variant="quiet"
            data-size="sm"
            data-muweave-animatic-mute="true"
            aria-pressed={muted}
            onClick={() => setMuted((m) => !m)}
          >
            {muted ? labels.unmute : labels.mute}
          </button>
        </div>

        <span className="dr-animatic-timecode" data-muweave-animatic-timecode="true">
          {`${formatTimecode(globalElapsedMs)} / ${formatTimecode(timeline.totalMs)}`}
        </span>
      </div>

      <div className="dr-animatic-caption">
        <span className="mw-chip">{currentRow.sceneRef}</span>
        <span className="mw-dsh-muted mw-clamp-2">{desc || `${labels.shot} ${currentRow.shotRef}`}</span>
        <span className="dr-kbd-hints" aria-hidden="true">
          <kbd>Space</kbd>
          <span>{labels.kbdPlayPause}</span>
          <kbd>←</kbd>
          <kbd>→</kbd>
          <span>{labels.kbdStep}</span>
        </span>
      </div>
    </section>
  )
}
