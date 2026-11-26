import { constants } from 'node:fs'
import { mkdir, open, type FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle'
import { rpcFail, rpcOk, type RpcEnvelope } from '../protocol'
import type { BotTaskLogger } from './protocol'

export interface BotEventV1 {
  ts: string
  event: string
  botId?: string
  sessionId?: string
  taskId?: string
  jobId?: string
  workspaceId?: string
  traceId?: string
  code?: string
  digest?: string
  ref?: string
  status?: string
  summary?: string
  durationMs?: number
  count?: number
}

export interface EventLogDeps {
  pluginDataDir?: string
  logger?: BotTaskLogger
}

interface EventPage {
  events: BotEventV1[]
  nextCursor: string | null
  corruptLines: number
}

const LOG_NAME = 'events.v1.jsonl'
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const EVENT = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/
const CODE = /^(?:[a-z][a-z0-9_]*\/)?[A-Za-z][A-Za-z0-9_.-]*$/
const SENSITIVE = /(?:^|[^a-z0-9])sk-|ghp_|AKIA|Bearer\s|^\/|\\|[A-Za-z]:\//i

// Both boundaries use the same closed schema. In particular an extra prompt, response
// object or free-text message can never hitch a ride on an otherwise valid event.
function validEvent(raw: unknown): raw is BotEventV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const record = raw as Record<string, unknown>
  if (typeof record.ts !== 'string' || typeof record.event !== 'string') return false
  const time = Date.parse(record.ts)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== record.ts) return false

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && (value.length > 256 || SENSITIVE.test(value) || containsHostPath(value) || findPlaintextCredential(value))) return false
    switch (key) {
      case 'ts': break
      case 'event': if (!EVENT.test(record.event)) return false; break
      case 'code': if (value !== undefined && !(typeof value === 'string' && CODE.test(value))) return false; break
      case 'digest': if (value !== undefined && !(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value))) return false; break
      case 'ref': if (value !== undefined && !(typeof value === 'string' && REF.test(value))) return false; break
      case 'status': if (value !== undefined && !(typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value))) return false; break
      case 'summary': if (value !== undefined && typeof value !== 'string') return false; break
      case 'botId': case 'sessionId': case 'taskId': case 'jobId': case 'workspaceId': case 'traceId':
        if (value !== undefined && !(typeof value === 'string' && REF.test(value))) return false
        break
      case 'durationMs':
        if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) return false
        break
      case 'count':
        if (value !== undefined && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return false
        break
      default: return false
    }
  }
  return true
}

async function writeRecord(dir: string, record: BotEventV1): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = await open(join(dir, LOG_NAME), constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
  try {
    const { mode, size } = await file.stat()
    if ((mode & 0o777) !== 0o600) await file.chmod(0o600)
    // A torn final line must not swallow the next healthy event. O_APPEND writes the
    // delimiter (if needed) and the bounded record together even across instances.
    const tail = Buffer.alloc(1)
    if (size > 0) await file.read(tail, 0, 1, size - 1)
    const delimiter = size > 0 && tail[0] !== 0x0a ? '\n' : ''
    await file.writeFile(delimiter + JSON.stringify(record) + '\n')
  } finally {
    await file.close()
  }
}

function matchesFilter(filter: unknown): boolean {
  return filter === undefined || (typeof filter === 'string' && REF.test(filter))
}

export class EventLog {
  constructor(private readonly deps: EventLogDeps = {}) {}

  async append(event: Omit<BotEventV1, 'ts'>): Promise<void> {
    const dir = this.deps.pluginDataDir
    if (!dir) throw new Error('Event log directory is not configured')
    const ts = new Date().toISOString()
    const record = { ...event, ts }
    const accepted = validEvent(record) && !Object.hasOwn(event, 'ts')
    try {
      await writeRecord(dir, accepted ? record : { ts, event: 'event.rejected_sensitive' })
    } catch {
      throw new Error('Event log write failed')
    }
    if (!accepted) {
      this.deps.logger?.('event.rejected_sensitive', {})
      throw new Error('event.rejected_sensitive')
    }
  }

  async handle(action: string, payload: Record<string, unknown>, generation = 0): Promise<RpcEnvelope<EventPage>> {
    if (action !== 'event.list') return rpcFail(generation, 'muweave/unknown_action', 'Unknown event action')
    const { traceId, taskId, limit = 50, cursor = '0' } = payload
    const start = typeof cursor === 'string' && /^\d+$/.test(cursor) ? Number(cursor) : cursor
    if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0 ||
        typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 ||
        !matchesFilter(traceId) || !matchesFilter(taskId)) {
      return rpcFail(generation, 'muweave/invalid_input', 'Invalid event list filter, limit or cursor')
    }
    const dir = this.deps.pluginDataDir
    if (!dir) return rpcFail(generation, 'muweave/event_log_unavailable', 'Event log directory is not configured')
    const page: EventPage = { events: [], nextCursor: null, corruptLines: 0 }
    let file: FileHandle | undefined
    try {
      file = await open(join(dir, LOG_NAME), constants.O_RDONLY | constants.O_NOFOLLOW)
      let lineNumber = 0
      for await (const line of file.readLines()) {
        const index = lineNumber++
        if (index < start) continue
        let record: unknown
        try { record = JSON.parse(line) } catch { /* counted below */ }
        if (!validEvent(record)) {
          page.corruptLines++
          continue
        }
        if (traceId !== undefined && record.traceId !== traceId) continue
        if (taskId !== undefined && record.taskId !== taskId) continue
        if (page.events.length === Math.min(500, limit)) {
          page.nextCursor = String(index)
          break
        }
        page.events.push(record)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return rpcFail(generation, 'muweave/event_log_unavailable', 'Event log read failed')
      }
    } finally {
      await file?.close()
    }
    return rpcOk(generation, page)
  }

  dispose(): void {}
}

/** Standalone writer for the standard DSH host. Custom hosts use their own EventLog instance. */
export function append(event: Omit<BotEventV1, 'ts'>): Promise<void> {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return new EventLog({ pluginDataDir: join(dshHome, 'plugin-data', 'muweave-dsh') }).append(event)
}
