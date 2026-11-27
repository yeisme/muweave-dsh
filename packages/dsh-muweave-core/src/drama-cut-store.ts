import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import type {
  CutTransitionKind,
  EpisodeCutOverrideV1,
  EpisodeCutSetInputV1,
} from './protocol'

/**
 * Non-destructive episode cut override store (`pluginDataDir/drama-cuts.v1.json`).
 * Stores shot ordering, omissions, duration trims, and transitions without mutating Scaena canonical data.
 */

export const DRAMA_CUTS_SCHEMA = 'muweave.drama-cuts.v1' as const
export const MIN_SHOT_DURATION_MICROS = 200_000 // 0.2s
export const MAX_SHOT_DURATION_MICROS = 300_000_000 // 300s
export const MAX_EPISODE_CUTS = 200
const MAX_REF_LEN = 128

const VALID_TRANSITIONS = new Set<CutTransitionKind>(['cut', 'crossfade', 'dip_to_black'])

export class DramaCutInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

function isSafeOpaqueRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_REF_LEN) return false
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return false
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return false
  if (containsHostPath(trimmed) || findPlaintextCredential(trimmed)) return false
  return true
}

function requireSafeRef(value: unknown, field: string): string {
  if (!isSafeOpaqueRef(value)) {
    throw new DramaCutInputError(
      'muweave/invalid_cut_input',
      `${field} must be a safe opaque reference (<= ${MAX_REF_LEN} chars, no /, \\, .., host paths, or credentials)`,
    )
  }
  return value.trim()
}

function validateRefArray(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) {
    throw new DramaCutInputError('muweave/invalid_cut_input', `${field} must be an array of shot refs`)
  }
  if (raw.length > 500) {
    throw new DramaCutInputError('muweave/invalid_cut_input', `${field} exceeds maximum length of 500`)
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const ref = requireSafeRef(item, field)
    if (!seen.has(ref)) {
      seen.add(ref)
      out.push(ref)
    }
  }
  return out
}

function validateDurations(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DramaCutInputError('muweave/invalid_cut_input', 'durationOverridesMicros must be an object')
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ref = requireSafeRef(k, 'durationOverridesMicros key')
    if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_SHOT_DURATION_MICROS || v > MAX_SHOT_DURATION_MICROS) {
      throw new DramaCutInputError(
        'muweave/invalid_cut_input',
        `duration for ${ref} must be an integer between ${MIN_SHOT_DURATION_MICROS} and ${MAX_SHOT_DURATION_MICROS} micros`,
      )
    }
    out[ref] = v
  }
  return out
}

function validateTransitions(raw: unknown): Record<string, CutTransitionKind> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DramaCutInputError('muweave/invalid_cut_input', 'transitions must be an object')
  }
  const out: Record<string, CutTransitionKind> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ref = requireSafeRef(k, 'transitions key')
    if (typeof v !== 'string' || !VALID_TRANSITIONS.has(v as CutTransitionKind)) {
      throw new DramaCutInputError(
        'muweave/invalid_cut_input',
        `transition for ${ref} must be one of: cut, crossfade, dip_to_black`,
      )
    }
    out[ref] = v as CutTransitionKind
  }
  return out
}

function validStoredCut(raw: unknown): EpisodeCutOverrideV1 | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  if (findPlaintextCredential(raw) || containsHostPath(raw)) return undefined
  const r = raw as Partial<EpisodeCutOverrideV1>
  if (!isSafeOpaqueRef(r.workspaceId) || !isSafeOpaqueRef(r.episodeRef)) return undefined
  if (typeof r.revision !== 'number' || !Number.isInteger(r.revision) || r.revision < 1) return undefined
  if (typeof r.updatedAt !== 'string' || Number.isNaN(Date.parse(r.updatedAt))) return undefined
  try {
    return {
      workspaceId: r.workspaceId.trim(),
      episodeRef: r.episodeRef.trim(),
      shotOrder: r.shotOrder ? validateRefArray(r.shotOrder, 'shotOrder') : [],
      omittedShotRefs: r.omittedShotRefs ? validateRefArray(r.omittedShotRefs, 'omittedShotRefs') : [],
      durationOverridesMicros: r.durationOverridesMicros ? validateDurations(r.durationOverridesMicros) : {},
      transitions: r.transitions ? validateTransitions(r.transitions) : {},
      revision: r.revision,
      updatedAt: r.updatedAt,
    }
  } catch {
    return undefined
  }
}

function cloneCut(cut: EpisodeCutOverrideV1): EpisodeCutOverrideV1 {
  return {
    ...cut,
    shotOrder: [...cut.shotOrder],
    omittedShotRefs: [...cut.omittedShotRefs],
    durationOverridesMicros: { ...cut.durationOverridesMicros },
    transitions: { ...cut.transitions },
  }
}

export class DramaCutStore {
  private cuts: EpisodeCutOverrideV1[] = []
  corruptFile?: string

  constructor(private readonly file: string) {
    this.load()
  }

  get(workspaceId: string, episodeRef: string): EpisodeCutOverrideV1 | undefined {
    const found = this.cuts.find((c) => c.workspaceId === workspaceId && c.episodeRef === episodeRef)
    return found ? cloneCut(found) : undefined
  }

  list(workspaceId?: string): EpisodeCutOverrideV1[] {
    return this.cuts
      .filter((c) => !workspaceId || c.workspaceId === workspaceId)
      .sort((a, b) => a.episodeRef.localeCompare(b.episodeRef))
      .map(cloneCut)
  }

  set(workspaceId: string, input: EpisodeCutSetInputV1): EpisodeCutOverrideV1 {
    if (findPlaintextCredential(input) || containsHostPath(input)) {
      throw new DramaCutInputError(
        'muweave/invalid_cut_input',
        'Cut override must not contain plaintext credentials or host paths',
      )
    }
    const wsId = requireSafeRef(workspaceId, 'workspaceId')
    const episodeRef = requireSafeRef(input.episodeRef, 'episodeRef')

    const idx = this.cuts.findIndex((c) => c.workspaceId === wsId && c.episodeRef === episodeRef)
    const prev = idx >= 0 ? this.cuts[idx] : undefined
    const currentRevision = prev ? prev.revision : 0

    if (input.expectedRevision !== undefined) {
      if (
        typeof input.expectedRevision !== 'number' ||
        !Number.isInteger(input.expectedRevision) ||
        input.expectedRevision < 0
      ) {
        throw new DramaCutInputError('muweave/invalid_cut_input', 'expectedRevision must be a non-negative integer')
      }
      if (input.expectedRevision !== currentRevision) {
        throw new DramaCutInputError(
          'muweave/cut_revision_conflict',
          `Cut revision conflict for ${episodeRef}: expected ${input.expectedRevision}, current is ${currentRevision}`,
          { currentRevision },
        )
      }
    }

    const shotOrder = input.shotOrder !== undefined ? validateRefArray(input.shotOrder, 'shotOrder') : (prev ? [...prev.shotOrder] : [])
    const omittedShotRefs = input.omittedShotRefs !== undefined ? validateRefArray(input.omittedShotRefs, 'omittedShotRefs') : (prev ? [...prev.omittedShotRefs] : [])
    const durationOverridesMicros = input.durationOverridesMicros !== undefined
      ? validateDurations(input.durationOverridesMicros)
      : (prev ? { ...prev.durationOverridesMicros } : {})
    const transitions = input.transitions !== undefined
      ? validateTransitions(input.transitions)
      : (prev ? { ...prev.transitions } : {})

    const next: EpisodeCutOverrideV1 = {
      workspaceId: wsId,
      episodeRef,
      shotOrder,
      omittedShotRefs,
      durationOverridesMicros,
      transitions,
      revision: currentRevision + 1,
      updatedAt: new Date().toISOString(),
    }

    if (idx >= 0) this.cuts[idx] = next
    else this.cuts.push(next)

    if (this.cuts.length > MAX_EPISODE_CUTS) {
      this.cuts = this.cuts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_EPISODE_CUTS)
    }

    this.persist()
    return cloneCut(next)
  }

  reset(workspaceId: string, episodeRef: string): boolean {
    const wsId = requireSafeRef(workspaceId, 'workspaceId')
    const ep = requireSafeRef(episodeRef, 'episodeRef')
    const before = this.cuts.length
    this.cuts = this.cuts.filter((c) => !(c.workspaceId === wsId && c.episodeRef === ep))
    if (this.cuts.length !== before) {
      this.persist()
      return true
    }
    return false
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      const rows = typeof parsed === 'object' && parsed !== null ? (parsed as { cuts?: unknown }).cuts : undefined
      if (!Array.isArray(rows)) throw new Error('cuts is not an array')
      this.cuts = rows.map(validStoredCut).filter((c): c is EpisodeCutOverrideV1 => c !== undefined)
    } catch {
      this.cuts = []
      const aside = path.join(path.dirname(this.file), `drama-cuts.v1.corrupt-${Date.now()}.json`)
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
      `${JSON.stringify({ schema: DRAMA_CUTS_SCHEMA, cuts: this.cuts }, null, 2)}\n`,
      { mode: 0o600 },
    )
    renameSync(tmp, this.file)
  }
}

/**
 * Pure non-destructive overlay helper: filters omitted shots, applies shotOrder and duration overrides,
 * and attaches transition metadata without mutating input rows.
 */
export function applyEpisodeCut<
  T extends { shotRef: string; order: number; plannedDurationMicros: number },
>(
  rows: readonly T[],
  override?: EpisodeCutOverrideV1,
): Array<T & { transition: CutTransitionKind }> {
  const omitted = new Set(override?.omittedShotRefs ?? [])
  const visible = rows.filter((r) => !omitted.has(r.shotRef))

  const orderIndex = new Map<string, number>()
  for (let i = 0; i < (override?.shotOrder ?? []).length; i += 1) {
    orderIndex.set(override!.shotOrder[i]!, i)
  }

  const sorted = [...visible].sort((a, b) => {
    const ai = orderIndex.get(a.shotRef)
    const bi = orderIndex.get(b.shotRef)
    if (ai !== undefined && bi !== undefined) return ai - bi
    if (ai !== undefined) return -1
    if (bi !== undefined) return 1
    return a.order - b.order || a.shotRef.localeCompare(b.shotRef)
  })

  return sorted.map((row, idx) => ({
    ...row,
    order: idx + 1,
    plannedDurationMicros:
      override?.durationOverridesMicros[row.shotRef] ?? row.plannedDurationMicros,
    transition: override?.transitions[row.shotRef] ?? 'cut',
  }))
}
