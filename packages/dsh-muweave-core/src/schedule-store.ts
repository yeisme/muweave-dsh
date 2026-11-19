import { existsSync, readFileSync, renameSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ScheduleBoardV1, ScheduleEntryV1 } from './protocol'

/**
 * Standalone publishing schedule board (docs/design/desk-v4.md): one row per `.muweave/` reference
 * ("when do I publish this"), stored beside the job ledger so `muweave-bundle` stays the single
 * source of truth for the elements themselves. Nothing here is canonical domain data.
 */

export const SCHEDULE_SCHEMA = 'muweave.schedule.v1'
export const MAX_SCHEDULE_ENTRIES = 500

export type { ScheduleBoardV1, ScheduleEntryV1 }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real calendar day in `YYYY-MM-DD` form (rejects 2026-02-31). */
export function isValidScheduleDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function validEntry(raw: unknown): ScheduleEntryV1 | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Partial<ScheduleEntryV1>
  if (typeof r.ref !== 'string' || !r.ref.trim()) return undefined
  if (typeof r.date !== 'string' || !isValidScheduleDate(r.date)) return undefined
  return {
    ref: r.ref.trim(),
    label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : r.ref.trim(),
    kind: typeof r.kind === 'string' && r.kind.trim() ? r.kind.trim() : 'element',
    date: r.date,
    note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  }
}

export class ScheduleStore {
  private entries: ScheduleEntryV1[] = []
  /** Set when the file was unreadable; the original is renamed aside so nothing is silently lost. */
  corruptFile?: string

  constructor(private readonly file: string) {
    this.load()
  }

  list(): ScheduleBoardV1 {
    return {
      schema: SCHEDULE_SCHEMA,
      entries: [...this.entries].sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref)),
      updatedAt: this.updatedAt(),
    }
  }

  /** Upsert by ref: one reference holds exactly one date. */
  plan(input: { ref: string; date: string; label?: string; kind?: string; note?: string }): ScheduleBoardV1 {
    const ref = input.ref.trim()
    if (!ref) throw new ScheduleInputError('muweave/invalid_ref', 'ref is required')
    if (!isValidScheduleDate(input.date)) throw new ScheduleInputError('muweave/invalid_date', 'date must be YYYY-MM-DD')
    const idx = this.entries.findIndex((e) => e.ref === ref)
    const prev = idx >= 0 ? this.entries[idx] : undefined
    // Moving a slot keeps whatever the caller did not restate (label/kind/note stay put).
    const next: ScheduleEntryV1 = {
      ref,
      label: input.label?.trim() || prev?.label || ref,
      kind: input.kind?.trim() || prev?.kind || 'element',
      date: input.date,
      note: input.note?.trim() || prev?.note,
      updatedAt: new Date().toISOString(),
    }
    if (idx >= 0) this.entries[idx] = next
    else this.entries.push(next)
    this.entries = this.entries
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_SCHEDULE_ENTRIES)
    this.persist()
    return this.list()
  }

  clear(ref: string): ScheduleBoardV1 {
    const target = ref.trim()
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.ref !== target)
    if (this.entries.length !== before) this.persist()
    return this.list()
  }

  private updatedAt(): string {
    return this.entries.reduce((latest, e) => (e.updatedAt > latest ? e.updatedAt : latest), '')
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      const rows = typeof parsed === 'object' && parsed !== null ? (parsed as { entries?: unknown }).entries : undefined
      if (!Array.isArray(rows)) throw new Error('entries is not an array')
      this.entries = rows.map(validEntry).filter((e): e is ScheduleEntryV1 => e !== undefined)
    } catch {
      this.entries = []
      const aside = path.join(path.dirname(this.file), `schedule.v1.corrupt-${Date.now()}.json`)
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
    const tmp = `${this.file}.tmp.${process.pid}`
    writeFileSync(tmp, `${JSON.stringify({ schema: SCHEDULE_SCHEMA, entries: this.entries }, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, this.file)
  }
}

/** Typed input failure the RPC layer turns into a stable error envelope. */
export class ScheduleInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}
