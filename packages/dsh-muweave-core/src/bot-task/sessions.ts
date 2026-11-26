import { readFileSync } from 'node:fs'
import path from 'node:path'
import { atomicWriteJson, findPlaintextCredential } from '@yeisme/muweave-bundle'
import { rpcFail, rpcOk, type RpcEnvelope } from '../protocol'
import type { BotTaskLogger } from './protocol'
import { BotRoster } from './roster'

export interface BotSessionRecordV1 {
  botId: string
  workspaceId: string
  sessionRef: string
  createdAt: string
  lastSeenAt: string
}

export interface BotSessionsDeps {
  /** Absolute path of the plugin data directory. Session bindings live here, never in .muweave/. */
  pluginDataDir: string
  logger?: BotTaskLogger
}

interface StoredSessions {
  schema: 'muweave.bot-sessions.v1'
  sessions: BotSessionRecordV1[]
}

const SCHEMA: StoredSessions['schema'] = 'muweave.bot-sessions.v1'
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/
const queues = new Map<string, Promise<void>>()

function validRef(value: unknown): value is string {
  return typeof value === 'string' && REF.test(value) && !findPlaintextCredential(value)
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

function validRecord(value: unknown): value is BotSessionRecordV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<BotSessionRecordV1>
  return validRef(record.botId) && validRef(record.workspaceId) && validRef(record.sessionRef) &&
    validTimestamp(record.createdAt) && validTimestamp(record.lastSeenAt)
}

function key(botId: string, workspaceId: string): string {
  return `${workspaceId}\u0000${botId}`
}

class BotSessionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export class BotSessions {
  private readonly file: string
  private readonly roster: BotRoster
  private sessions = new Map<string, BotSessionRecordV1>()

  constructor(private readonly deps: BotSessionsDeps) {
    this.file = path.resolve(deps.pluginDataDir, 'bot-sessions.v1.json')
    this.roster = new BotRoster({ pluginDataDir: deps.pluginDataDir, logger: deps.logger })
    this.load()
  }

  get(botId: string, workspaceId: string): BotSessionRecordV1 | undefined {
    const record = this.sessions.get(key(botId, workspaceId))
    return record ? { ...record } : undefined
  }

  async bind(botId: string, workspaceId: string, sessionRef: string): Promise<BotSessionRecordV1> {
    this.requireRef(botId, 'botId')
    this.requireRef(workspaceId, 'workspaceId')
    this.requireRef(sessionRef, 'sessionRef')
    return this.transact(async () => {
      const rosterResponse = await this.roster.handle('bot.get', { botId, workspaceId })
      if (!rosterResponse.ok) {
        throw new BotSessionError(rosterResponse.error.code, rosterResponse.error.message)
      }
      const bot = (rosterResponse.data as { bot?: { state?: string } }).bot
      if (!bot || bot.state === 'paused' || bot.state === 'retired') {
        throw new BotSessionError('BOT_SESSION_UNAVAILABLE', 'The bot is unavailable for a session binding')
      }
      const previous = this.sessions.get(key(botId, workspaceId))
      const now = new Date().toISOString()
      const record: BotSessionRecordV1 = {
        botId,
        workspaceId,
        sessionRef,
        createdAt: previous?.createdAt ?? now,
        lastSeenAt: now,
      }
      const next = new Map(this.sessions)
      next.set(key(botId, workspaceId), record)
      await this.persist(next)
      this.sessions = next
      return { ...record }
    })
  }

  async unbind(botId: string, workspaceId: string): Promise<boolean> {
    this.requireRef(botId, 'botId')
    this.requireRef(workspaceId, 'workspaceId')
    return this.transact(async () => {
      const bindingKey = key(botId, workspaceId)
      if (!this.sessions.has(bindingKey)) return false
      const next = new Map(this.sessions)
      next.delete(bindingKey)
      await this.persist(next)
      this.sessions = next
      return true
    })
  }

  list(workspaceId?: string): BotSessionRecordV1[] {
    return [...this.sessions.values()]
      .filter(record => workspaceId === undefined || record.workspaceId === workspaceId)
      .map(record => ({ ...record }))
  }

  async handle(action: string, payload: Record<string, unknown>, generation = 0): Promise<RpcEnvelope<unknown>> {
    try {
      if (action === 'bot.session.get') {
        const { botId, workspaceId } = this.readBindingPayload(payload)
        return rpcOk(generation, { session: this.get(botId, workspaceId) ?? null })
      }
      if (action === 'bot.session.bind') {
        const { botId, workspaceId, sessionRef } = this.readBindingPayload(payload)
        if (sessionRef === undefined) throw new BotSessionError('muweave/invalid_payload', 'sessionRef must be a valid reference')
        return rpcOk(generation, { session: await this.bind(botId, workspaceId, sessionRef) })
      }
      return rpcFail(generation, 'muweave/unknown_action', 'Unknown bot session action')
    } catch (error) {
      if (error instanceof BotSessionError) return rpcFail(generation, error.code, error.message)
      this.deps.logger?.('bot_task.sessions_failed', { errorCode: 'SESSION_STORE_FAILED' })
      return rpcFail(generation, 'muweave/internal_error', 'Bot session operation failed')
    }
  }

  dispose(): void {}

  private readBindingPayload(payload: Record<string, unknown>): { botId: string; workspaceId: string; sessionRef?: string } {
    const botId = this.requireRef(payload.botId, 'botId')
    const workspaceId = this.requireRef(payload.workspaceId, 'workspaceId')
    if (payload.sessionRef === undefined) return { botId, workspaceId }
    return { botId, workspaceId, sessionRef: this.requireRef(payload.sessionRef, 'sessionRef') }
  }

  private requireRef(value: unknown, field: string): string {
    if (!validRef(value)) throw new BotSessionError('muweave/invalid_payload', `${field} must be a valid reference`)
    return value
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredSessions>
      if (parsed.schema !== SCHEMA || !Array.isArray(parsed.sessions) || parsed.sessions.some(record => !validRecord(record))) {
        throw new Error('invalid session ledger')
      }
      const loaded = new Map<string, BotSessionRecordV1>()
      for (const record of parsed.sessions) loaded.set(key(record.botId, record.workspaceId), { ...record })
      this.sessions = loaded
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.sessions.clear()
      this.deps.logger?.('bot_task.sessions_load_failed', { errorCode: 'SESSIONS_UNREADABLE' })
    }
  }

  private async persist(sessions: Map<string, BotSessionRecordV1>): Promise<void> {
    const body: StoredSessions = { schema: SCHEMA, sessions: [...sessions.values()] }
    await atomicWriteJson(this.file, body)
  }

  private transact<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.file) ?? Promise.resolve()
    const run = previous.then(operation)
    const settled = run.then(() => undefined, () => undefined)
    queues.set(this.file, settled)
    return run.finally(() => {
      if (queues.get(this.file) === settled) queues.delete(this.file)
    })
  }
}
