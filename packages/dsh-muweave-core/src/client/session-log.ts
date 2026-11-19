/**
 * Per-session record of the MuWeave elements a conversation has touched: @ mentions in the
 * composer and items handed off from the floating agent. Kept in localStorage under
 * `muweave.session-log.<sessionId>` (newest first, at most 50) so the session's 做剧 view can
 * show "what this session worked on" without a host round trip.
 */

export const SESSION_LOG_PREFIX = 'muweave.session-log.'
export const SESSION_LOG_MAX = 50

export type SessionLogKind = 'mentioned' | 'staged' | 'handoff'

export interface SessionLogEntry {
  at: number
  kind: SessionLogKind
  /** Trigger ref (`elementId|owner|sourceRef|digest`) or a template/skill ref. */
  ref: string
  label: string
  itemKind?: 'element' | 'template' | 'skill'
}

interface SessionLogHolder {
  listeners: Set<() => void>
  cache: Map<string, readonly SessionLogEntry[]>
}

declare global {
  // eslint-disable-next-line no-var
  var __YEISME_MUWEAVE_SESSION_LOG__: SessionLogHolder | undefined
}

const EMPTY: readonly SessionLogEntry[] = []

function holder(): SessionLogHolder {
  if (!globalThis.__YEISME_MUWEAVE_SESSION_LOG__) {
    globalThis.__YEISME_MUWEAVE_SESSION_LOG__ = { listeners: new Set(), cache: new Map() }
  }
  return globalThis.__YEISME_MUWEAVE_SESSION_LOG__
}

function isEntry(v: unknown): v is SessionLogEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return typeof e.at === 'number' && typeof e.ref === 'string' && typeof e.label === 'string' && typeof e.kind === 'string'
}

/** Snapshot for `useSyncExternalStore`: stable identity until the session's log changes. */
export function readSessionLog(sessionId: string | undefined): readonly SessionLogEntry[] {
  if (!sessionId) return EMPTY
  const h = holder()
  const cached = h.cache.get(sessionId)
  if (cached) return cached
  let entries: readonly SessionLogEntry[] = EMPTY
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_LOG_PREFIX + sessionId)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) entries = parsed.filter(isEntry).slice(0, SESSION_LOG_MAX)
  } catch {
    entries = EMPTY
  }
  h.cache.set(sessionId, entries)
  return entries
}

export function appendSessionLog(sessionId: string | undefined, entry: Omit<SessionLogEntry, 'at'> & { at?: number }): void {
  if (!sessionId || !entry.ref) return
  const next: SessionLogEntry = { ...entry, at: entry.at ?? Date.now() }
  const kept = readSessionLog(sessionId).filter((e) => !(e.ref === next.ref && e.kind === next.kind))
  const entries = [next, ...kept].slice(0, SESSION_LOG_MAX)
  const h = holder()
  h.cache.set(sessionId, entries)
  try {
    globalThis.localStorage?.setItem(SESSION_LOG_PREFIX + sessionId, JSON.stringify(entries))
  } catch {
    // Quota or private mode: the log still holds for this page.
  }
  for (const fn of h.listeners) fn()
}

export function subscribeSessionLog(listener: () => void): () => void {
  const h = holder()
  h.listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(SESSION_LOG_PREFIX)) {
      h.cache.delete(e.key.slice(SESSION_LOG_PREFIX.length))
      listener()
    }
  }
  globalThis.addEventListener?.('storage', onStorage)
  return () => {
    h.listeners.delete(listener)
    globalThis.removeEventListener?.('storage', onStorage)
  }
}

/** Element id out of a trigger ref (`elementId|owner|sourceRef|digest`). */
export function elementIdFromRef(ref: string): string {
  return ref.split('|')[0] ?? ref
}
