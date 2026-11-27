import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import type {
  AudioCueOverrideV1,
  AudioMixConfigV1,
  AudioMixSaveInputV1,
  AudioTrackKind,
  AudioTrackMixV1,
} from './protocol'

export const AUDIO_MIX_SCHEMA = 'muweave.audio-mix.v1' as const

const TRACK_KINDS: readonly AudioTrackKind[] = ['voice', 'music', 'sfx'] as const
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

export class AudioMixInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

function clampGain(v: unknown, fallback = 100): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.max(0, Math.min(150, Math.round(n)))
}

function clampFade(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.max(0, Math.min(10_000, Math.round(n)))
}

function defaultTracks(): Record<AudioTrackKind, AudioTrackMixV1> {
  return {
    voice: { track: 'voice', gainPct: 100, muted: false, solo: false, fadeInMs: 0, fadeOutMs: 0 },
    music: { track: 'music', gainPct: 75, muted: false, solo: false, fadeInMs: 300, fadeOutMs: 500 },
    sfx: { track: 'sfx', gainPct: 90, muted: false, solo: false, fadeInMs: 0, fadeOutMs: 0 },
  }
}

function defaultMix(workspaceId: string, episodeRef?: string): AudioMixConfigV1 {
  return {
    schema: AUDIO_MIX_SCHEMA,
    workspaceId,
    ...(episodeRef ? { episodeRef } : {}),
    masterGainPct: 100,
    tracks: defaultTracks(),
    cues: [],
    revision: '0',
    updatedAt: '',
  }
}

function validateCues(raw: unknown): AudioCueOverrideV1[] {
  if (!Array.isArray(raw)) throw new AudioMixInputError('muweave/invalid_audio_input', 'cues must be an array')
  if (raw.length > 500) throw new AudioMixInputError('muweave/invalid_audio_input', 'cues exceeds max 500')
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new AudioMixInputError('muweave/invalid_audio_input', `cues[${idx}] must be an object`)
    }
    const c = item as Record<string, unknown>
    const shotRef = typeof c.shotRef === 'string' ? c.shotRef.trim() : ''
    const track = c.track as AudioTrackKind
    if (!SAFE_ID_RE.test(shotRef) || !TRACK_KINDS.includes(track)) {
      throw new AudioMixInputError('muweave/invalid_audio_input', `cues[${idx}] has invalid shotRef or track`)
    }
    return {
      shotRef,
      track,
      ...(typeof c.offsetMs === 'number' && Number.isFinite(c.offsetMs) ? { offsetMs: Math.round(c.offsetMs) } : {}),
      ...(c.gainPct !== undefined ? { gainPct: clampGain(c.gainPct) } : {}),
      ...(c.fadeInMs !== undefined ? { fadeInMs: clampFade(c.fadeInMs) } : {}),
      ...(c.fadeOutMs !== undefined ? { fadeOutMs: clampFade(c.fadeOutMs) } : {}),
      ...(typeof c.muted === 'boolean' ? { muted: c.muted } : {}),
    }
  })
}

function cloneMix(m: AudioMixConfigV1): AudioMixConfigV1 {
  return {
    ...m,
    tracks: {
      voice: { ...m.tracks.voice },
      music: { ...m.tracks.music },
      sfx: { ...m.tracks.sfx },
    },
    cues: m.cues.map((c) => ({ ...c })),
  }
}

export class AudioMixStore {
  private readonly file: string
  private readonly configs = new Map<string, AudioMixConfigV1>()
  corruptFile?: string

  constructor(pluginDataDir: string) {
    this.file = path.join(pluginDataDir, 'audio-mix.v1.json')
    this.load()
  }

  private key(workspaceId: string, episodeRef?: string): string {
    return `${workspaceId}::${episodeRef ?? ''}`
  }

  get(workspaceId: string, episodeRef?: string): AudioMixConfigV1 {
    const hit = this.configs.get(this.key(workspaceId, episodeRef))
    return hit ? cloneMix(hit) : defaultMix(workspaceId, episodeRef)
  }

  save(workspaceId: string, input: AudioMixSaveInputV1): AudioMixConfigV1 {
    if (findPlaintextCredential(input) || containsHostPath(input)) {
      throw new AudioMixInputError('muweave/invalid_audio_input', 'Audio mix must not contain credentials or host paths')
    }
    const wsId = workspaceId.trim()
    if (!SAFE_ID_RE.test(wsId)) {
      throw new AudioMixInputError('muweave/invalid_audio_input', 'workspaceId is invalid')
    }
    const episodeRef = typeof input.episodeRef === 'string' && input.episodeRef.trim() ? input.episodeRef.trim() : undefined
    if (episodeRef && !SAFE_ID_RE.test(episodeRef)) {
      throw new AudioMixInputError('muweave/invalid_audio_input', 'episodeRef is invalid')
    }

    const k = this.key(wsId, episodeRef)
    const prev = this.configs.get(k)
    const currentRev = prev ? Number(prev.revision) || 0 : 0
    if (input.expectedRevision !== undefined && input.expectedRevision !== '') {
      if (String(input.expectedRevision) !== String(currentRev)) {
        throw new AudioMixInputError(
          'muweave/audio_revision_conflict',
          `Audio mix revision conflict: expected ${input.expectedRevision}, current is ${currentRev}`,
          { currentRevision: String(currentRev) },
        )
      }
    }

    const base = prev ?? defaultMix(wsId, episodeRef)
    const tracks = defaultTracks()
    for (const kind of TRACK_KINDS) {
      const prevTrack = base.tracks[kind]
      const patch = input.tracks?.[kind]
      tracks[kind] = {
        track: kind,
        gainPct: clampGain(patch?.gainPct, prevTrack.gainPct),
        muted: typeof patch?.muted === 'boolean' ? patch.muted : prevTrack.muted,
        solo: typeof patch?.solo === 'boolean' ? patch.solo : prevTrack.solo,
        fadeInMs: clampFade(patch?.fadeInMs, prevTrack.fadeInMs),
        fadeOutMs: clampFade(patch?.fadeOutMs, prevTrack.fadeOutMs),
      }
    }

    const next: AudioMixConfigV1 = {
      schema: AUDIO_MIX_SCHEMA,
      workspaceId: wsId,
      ...(episodeRef ? { episodeRef } : {}),
      masterGainPct: clampGain(input.masterGainPct, base.masterGainPct),
      tracks,
      cues: input.cues !== undefined ? validateCues(input.cues) : base.cues.map((c) => ({ ...c })),
      revision: String(currentRev + 1),
      updatedAt: new Date().toISOString(),
    }

    this.configs.set(k, next)
    this.persist()
    return cloneMix(next)
  }

  reset(workspaceId: string, episodeRef?: string): AudioMixConfigV1 {
    const k = this.key(workspaceId, episodeRef)
    const deleted = this.configs.delete(k)
    if (deleted) this.persist()
    return defaultMix(workspaceId, episodeRef)
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      const list = typeof parsed === 'object' && parsed !== null ? (parsed as { mixes?: unknown }).mixes : undefined
      if (!Array.isArray(list)) throw new Error('mixes is not an array')
      for (const raw of list) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
        if (findPlaintextCredential(raw) || containsHostPath(raw)) continue
        const r = raw as Partial<AudioMixConfigV1>
        if (typeof r.workspaceId !== 'string' || !SAFE_ID_RE.test(r.workspaceId)) continue
        const ep = typeof r.episodeRef === 'string' && SAFE_ID_RE.test(r.episodeRef) ? r.episodeRef : undefined
        const tracks = defaultTracks()
        for (const kind of TRACK_KINDS) {
          const t = r.tracks?.[kind]
          if (!t) continue
          tracks[kind] = {
            track: kind,
            gainPct: clampGain(t.gainPct, tracks[kind].gainPct),
            muted: Boolean(t.muted),
            solo: Boolean(t.solo),
            fadeInMs: clampFade(t.fadeInMs, tracks[kind].fadeInMs),
            fadeOutMs: clampFade(t.fadeOutMs, tracks[kind].fadeOutMs),
          }
        }
        try {
          this.configs.set(this.key(r.workspaceId, ep), {
            schema: AUDIO_MIX_SCHEMA,
            workspaceId: r.workspaceId,
            ...(ep ? { episodeRef: ep } : {}),
            masterGainPct: clampGain(r.masterGainPct, 100),
            tracks,
            cues: r.cues ? validateCues(r.cues) : [],
            revision: typeof r.revision === 'string' ? r.revision : '1',
            updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
          })
        } catch {
          /* skip invalid mix */
        }
      }
    } catch {
      this.configs.clear()
      const aside = path.join(path.dirname(this.file), `audio-mix.v1.corrupt-${Date.now()}.json`)
      try {
        renameSync(this.file, aside)
        this.corruptFile = aside
      } catch {
        this.corruptFile = this.file
      }
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
    writeFileSync(
      tmp,
      `${JSON.stringify({ schema: AUDIO_MIX_SCHEMA, mixes: [...this.configs.values()] }, null, 2)}\n`,
      { mode: 0o600 },
    )
    renameSync(tmp, this.file)
  }
}
