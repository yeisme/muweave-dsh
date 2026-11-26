import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { rpcFail, rpcOk } from '../protocol'
import type { RpcEnvelope } from '../protocol'
import type { BotTaskLogger } from './protocol'

export const TASKS_SCHEMA = 'muweave.tasks.v1'
export type TaskStatus = 'proposed' | 'assigned' | 'running' | 'waiting_approval' | 'waiting_for_human' | 'succeeded' | 'failed' | 'cancelled' | 'orphaned'
export type TaskAttention = 'needs_assignment' | 'working' | 'waiting_approval' | 'waiting_for_human' | 'none'
export interface TaskBotRef { botId: string; sessionId?: string }
export interface TaskRecordV1 {
  taskId: string
  workspaceId: string
  parentTaskRef?: string
  rootTaskId: string
  assignedBy?: TaskBotRef
  assignedTo?: TaskBotRef
  goal: string
  status: TaskStatus
  attention: TaskAttention
  idempotencyKey: string
  payloadDigest: string
  traceId: string
  depth: number
  deadline?: string
  revision: number
  createdAt: string
  updatedAt: string
}
export interface TaskLedgerDeps { pluginDataDir: string; logger?: BotTaskLogger }
interface StoredTasks { schema: typeof TASKS_SCHEMA; tasks: TaskRecordV1[] }
const STATUSES = new Set<TaskStatus>(['proposed', 'assigned', 'running', 'waiting_approval', 'waiting_for_human', 'succeeded', 'failed', 'cancelled', 'orphaned'])
const TERMINAL = new Set<TaskStatus>(['succeeded', 'failed', 'cancelled'])

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}
function digest(value: unknown): string { return 'sha256:' + createHash('sha256').update(canonicalJson(value)).digest('hex') }
class LedgerError extends Error { constructor(readonly code: string, message: string) { super(message) } }
function required(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new LedgerError('muweave/invalid_payload', field + ' must be a non-empty string')
  return value.trim()
}
function optional(value: unknown, field: string, max = 160): string | undefined { return value === undefined || value === null || value === '' ? undefined : required(value, field, max) }
function ref(value: unknown, field: string): TaskBotRef | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return { botId: required(value, field + '.botId') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LedgerError('muweave/invalid_payload', field + ' must be an object')
  const raw = value as Record<string, unknown>
  const botId = required(raw.botId, field + '.botId')
  const sessionId = optional(raw.sessionId, field + '.sessionId')
  return sessionId ? { botId, sessionId } : { botId }
}
function redact(value: string): string {
  return value
    .replace(/(?<![A-Za-z0-9._-])\/(?:home|Users|root|var|tmp|etc|opt|private|mnt|srv|proc)\/[^\s"'<>]+/g, '[path-redacted]')
    .replace(/\b(?:sk|ghp|aig_live)_[A-Za-z0-9_-]{8,}/g, '[credential-redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/gi, '[credential-redacted]')
}
function attention(status: TaskStatus): TaskAttention {
  if (status === 'proposed' || status === 'assigned') return 'needs_assignment'
  if (status === 'running' || status === 'orphaned') return 'working'
  if (status === 'waiting_approval') return 'waiting_approval'
  if (status === 'waiting_for_human') return 'waiting_for_human'
  return 'none'
}
function valid(raw: unknown): TaskRecordV1 | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<TaskRecordV1>
  if (typeof r.taskId !== 'string' || typeof r.workspaceId !== 'string' || typeof r.rootTaskId !== 'string' || typeof r.goal !== 'string' || typeof r.idempotencyKey !== 'string' || typeof r.payloadDigest !== 'string' || typeof r.traceId !== 'string' || typeof r.depth !== 'number' || !Number.isInteger(r.depth) || r.depth < 0 || r.depth > 2 || typeof r.revision !== 'number' || !Number.isInteger(r.revision) || r.revision < 0 || typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string' || !STATUSES.has(r.status as TaskStatus)) return undefined
  const status = r.status as TaskStatus
  return { taskId: r.taskId, workspaceId: r.workspaceId, ...(typeof r.parentTaskRef === 'string' ? { parentTaskRef: r.parentTaskRef } : {}), rootTaskId: r.rootTaskId, ...(r.assignedBy && typeof r.assignedBy === 'object' ? { assignedBy: r.assignedBy as TaskBotRef } : {}), ...(r.assignedTo && typeof r.assignedTo === 'object' ? { assignedTo: r.assignedTo as TaskBotRef } : {}), goal: redact(r.goal), status, attention: attention(status), idempotencyKey: r.idempotencyKey, payloadDigest: r.payloadDigest, traceId: r.traceId, depth: r.depth, ...(typeof r.deadline === 'string' ? { deadline: r.deadline } : {}), revision: r.revision, createdAt: r.createdAt, updatedAt: r.updatedAt }
}

export class TaskLedger {
  private readonly file: string
  private readonly tasks = new Map<string, TaskRecordV1>()
  private readonly idempotency = new Map<string, TaskRecordV1>()
  private disposed = false
  constructor(private readonly deps: TaskLedgerDeps) { this.file = path.join(deps.pluginDataDir, 'tasks.v1.json'); this.load() }
  private log(event: string, fields: Record<string, unknown> = {}): void { this.deps.logger?.(event, fields) }
  private key(workspaceId: string, key: string): string { return workspaceId + ':' + key }
  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredTasks>
      if (!Array.isArray(parsed.tasks)) throw new Error('tasks must be an array')
      let changed = false
      for (const raw of parsed.tasks) {
        const task = valid(raw)
        if (!task) continue
        if (!TERMINAL.has(task.status) && task.status !== 'proposed' && task.status !== 'orphaned') { task.status = 'orphaned'; task.attention = attention(task.status); task.revision += 1; task.updatedAt = new Date().toISOString(); changed = true }
        this.tasks.set(task.taskId, task)
        this.idempotency.set(this.key(task.workspaceId, task.idempotencyKey), task)
      }
      if (changed) this.persist()
    } catch {
      this.tasks.clear(); this.idempotency.clear()
      try { renameSync(this.file, path.join(path.dirname(this.file), 'tasks.v1.corrupt-' + Date.now() + '.json')) } catch { /* best effort */ }
      this.log('bot_task.tasks_load_failed', { errorCode: 'TASK_LEDGER_UNREADABLE' })
    }
  }
  private persist(): void {
    mkdirSync(this.deps.pluginDataDir, { recursive: true })
    const tmp = this.file + '.tmp.' + process.pid + '.' + randomUUID()
    const body: StoredTasks = { schema: TASKS_SCHEMA, tasks: [...this.tasks.values()] }
    writeFileSync(tmp, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, this.file)
  }
  private get(value: unknown): TaskRecordV1 { const task = this.tasks.get(required(value, 'taskId')); if (!task) throw new LedgerError('TASK_NOT_FOUND', 'Task does not exist'); return task }
  private children(id: string): TaskRecordV1[] { return [...this.tasks.values()].filter((task) => task.parentTaskRef === id) }
  private create(payload: Record<string, unknown>): { task: TaskRecordV1 } {
    const workspaceId = required(payload.workspaceId, 'workspaceId')
    const idempotencyKey = required(payload.idempotencyKey, 'idempotencyKey')
    const goal = redact(required(payload.goal, 'goal', 2000))
    const parentTaskRef = optional(payload.parentTaskRef, 'parentTaskRef')
    const parent = parentTaskRef ? this.tasks.get(parentTaskRef) : undefined
    if (parentTaskRef && !parent) throw new LedgerError('TASK_NOT_FOUND', 'Parent task does not exist')
    const assignedBy = ref(payload.assignedBy, 'assignedBy')
    const assignedTo = ref(payload.assignedTo, 'assignedTo')
    const depth = parent ? parent.depth + 1 : 0
    if (payload.depth !== undefined && (typeof payload.depth !== 'number' || !Number.isInteger(payload.depth) || payload.depth !== depth)) throw new LedgerError('BOT_DEPTH_EXCEEDED', 'Task delegation depth cannot exceed 2')
    if (depth > 2) throw new LedgerError('BOT_DEPTH_EXCEEDED', 'Task delegation depth cannot exceed 2')
    if (parent && this.children(parent.taskId).length >= 4) throw new LedgerError('BOT_FANOUT_EXCEEDED', 'A task cannot have more than 4 child tasks')
    const traceId = optional(payload.traceId, 'traceId') || 'trace_' + randomUUID().replaceAll('-', '')
    const deadline = optional(payload.deadline, 'deadline', 80)
    const payloadDigest = digest({ workspaceId, parentTaskRef: parentTaskRef || null, assignedBy: assignedBy || null, assignedTo: assignedTo || null, goal, traceId, depth, deadline: deadline || null })
    const prior = this.idempotency.get(this.key(workspaceId, idempotencyKey))
    if (prior) { if (prior.payloadDigest !== payloadDigest) throw new LedgerError('TASK_IDEMPOTENCY_CONFLICT', 'Same idempotencyKey was used for a different task'); return { task: prior } }
    const now = new Date().toISOString()
    const status: TaskStatus = assignedTo ? 'assigned' : 'proposed'
    const task: TaskRecordV1 = { taskId: 'task_' + randomUUID().replaceAll('-', '').slice(0, 20), workspaceId, ...(parentTaskRef ? { parentTaskRef } : {}), rootTaskId: '', ...(assignedBy ? { assignedBy } : {}), ...(assignedTo ? { assignedTo } : {}), goal, status, attention: attention(status), idempotencyKey, payloadDigest, traceId, depth, ...(deadline ? { deadline } : {}), revision: 0, createdAt: now, updatedAt: now }
    task.rootTaskId = parent?.rootTaskId || task.taskId
    this.tasks.set(task.taskId, task); this.idempotency.set(this.key(workspaceId, idempotencyKey), task); this.persist()
    this.log('bot_task.created', { taskRef: task.taskId, workspaceId: task.workspaceId, traceId: task.traceId, depth: task.depth })
    return { task }
  }
  private list(payload: Record<string, unknown>): { tasks: TaskRecordV1[] } {
    const workspaceId = optional(payload.workspaceId, 'workspaceId'); const rootTaskId = optional(payload.rootTaskId, 'rootTaskId'); const botId = optional(payload.botId, 'botId'); const status = payload.status === undefined ? undefined : required(payload.status, 'status')
    if (status && !STATUSES.has(status as TaskStatus)) throw new LedgerError('muweave/invalid_payload', 'Unknown task status')
    return { tasks: [...this.tasks.values()].filter((task) => !workspaceId || task.workspaceId === workspaceId).filter((task) => !rootTaskId || task.rootTaskId === rootTaskId).filter((task) => !botId || task.assignedBy?.botId === botId || task.assignedTo?.botId === botId).filter((task) => !status || task.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  }
  private cancel(payload: Record<string, unknown>): { task: TaskRecordV1; cancelledTaskIds: string[] } {
    const root = this.get(payload.taskId); const queue = [root.taskId]; const cancelledTaskIds: string[] = []; const now = new Date().toISOString()
    while (queue.length) { const id = queue.shift() as string; const task = this.tasks.get(id); if (!task) continue; queue.push(...this.children(id).map((child) => child.taskId)); if (TERMINAL.has(task.status)) continue; task.status = 'cancelled'; task.attention = attention(task.status); task.revision += 1; task.updatedAt = now; cancelledTaskIds.push(id) }
    if (cancelledTaskIds.length) this.persist(); this.log('bot_task.cancelled', { taskRef: root.taskId, count: cancelledTaskIds.length }); return { task: root, cancelledTaskIds }
  }
  private trace(payload: Record<string, unknown>): Record<string, unknown> {
    const task = this.get(payload.taskId); const jobs: unknown[] = []; const jobsFile = path.join(this.deps.pluginDataDir, 'jobs.v1.json')
    if (existsSync(jobsFile)) { try { const parsed = JSON.parse(readFileSync(jobsFile, 'utf8')) as { jobs?: unknown[] }; for (const raw of parsed.jobs || []) { if (!raw || typeof raw !== 'object') continue; const job = raw as Record<string, unknown>; const requester = job.requester as Record<string, unknown> | undefined; if (requester?.taskId !== task.taskId && job.traceId !== task.traceId) continue; jobs.push({ ...(typeof job.jobId === 'string' ? { jobId: job.jobId } : {}), ...(typeof job.capabilityId === 'string' ? { capabilityId: job.capabilityId } : {}), ...(typeof job.status === 'string' ? { status: job.status } : {}), ...(typeof job.payloadDigest === 'string' ? { payloadDigest: job.payloadDigest } : {}), ...(typeof job.traceId === 'string' ? { traceId: job.traceId } : {}), ...(typeof job.errorCode === 'string' ? { code: job.errorCode } : {}), slotCount: Array.isArray(job.slots) ? job.slots.length : 0 }) } } catch { this.log('bot_task.trace_jobs_unreadable', { taskRef: task.taskId }) } }
    // TODO: connect EventLog once its append/list contract is available. Do not read events.v1.jsonl here.
    return { task: { taskId: task.taskId, workspaceId: task.workspaceId, ...(task.parentTaskRef ? { parentTaskRef: task.parentTaskRef } : {}), rootTaskId: task.rootTaskId, status: task.status, attention: task.attention, payloadDigest: task.payloadDigest, traceId: task.traceId, depth: task.depth, revision: task.revision, createdAt: task.createdAt, updatedAt: task.updatedAt }, jobs, events: [] }
  }
  async handle(action: string, payload: Record<string, unknown>, generation = 0): Promise<RpcEnvelope<unknown>> { if (this.disposed) return rpcFail(generation, 'muweave/disposed', 'Task ledger is disposed'); try { switch (action) { case 'task.create': return rpcOk(generation, this.create(payload)); case 'task.list': return rpcOk(generation, this.list(payload)); case 'task.get': return rpcOk(generation, { task: this.get(payload.taskId) }); case 'task.cancel': return rpcOk(generation, this.cancel(payload)); case 'task.trace': return rpcOk(generation, this.trace(payload)); default: return rpcFail(generation, 'muweave/unknown_action', action + ' is not a task action') } } catch (error) { if (error instanceof LedgerError) return rpcFail(generation, error.code, error.message); this.log('bot_task.tasks_failed', { action, errorCode: 'TASK_LEDGER_FAILURE' }); return rpcFail(generation, 'muweave/internal_error', 'Task ledger operation failed') } }
  dispose(): void { this.disposed = true }
}
