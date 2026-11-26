import { z } from 'zod'

const RPC_PATH = '/api/muweave-dsh/rpc'

type RpcEnvelope = {
  ok: boolean
  data?: unknown
  error?: { code?: string; message?: string }
}

type ToolContext = {
  sessionRef?: string
  session_ref?: string
  session?: { ref?: string; sessionRef?: string }
  fetch?: typeof fetch
}

export type BotToolDefinition = Record<string, unknown> & {
  name: string
  execute: (args: unknown, context?: ToolContext) => Promise<unknown>
}

const rosterInput = z.object({ workspaceId: z.string().trim().min(1) }).strict()
const delegateInput = z.object({
  workspaceId: z.string().trim().min(1),
  goal: z.string().trim().min(1).max(2000),
  assignedToBotId: z.string().trim().min(1),
  parentTaskRef: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1),
  deadline: z.string().trim().min(1).optional(),
}).strict()
const taskInput = z.object({ taskId: z.string().trim().min(1) }).strict()

const jsonSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

function pathSafe(value: string): string {
  return value
    .replace(/(?<![A-Za-z0-9._-])\/(?:home|Users|root|var|tmp|etc|opt|private|mnt|srv|proc)\/[^\s"'<>]+/g, '[path-redacted]')
    .replace(/\b[A-Za-z]:\\[^\s"'<>]+/g, '[path-redacted]')
}

function safeString(value: unknown): string {
  return pathSafe(typeof value === 'string' ? value : JSON.stringify(value) ?? '')
    .replace(/\b(?:sk|ghp|aig_live)_[A-Za-z0-9_-]{8,}/g, '[credential-redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/gi, '[credential-redacted]')
}

function ref(value: unknown, fallback = 'unknown'): string {
  return typeof value === 'string' && value.length > 0 ? safeString(value) : fallback
}

function failure(response: RpcEnvelope, fallback = 'RPC request failed'): Record<string, unknown> {
  return { ok: false, code: response.error?.code ?? 'MUWEAVE_RPC_FAILED', summary: safeString(response.error?.message ?? fallback), counts: {} }
}

async function rpc(action: string, payload: Record<string, unknown>, context?: ToolContext): Promise<RpcEnvelope> {
  const fetcher = context?.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function') return { ok: false, error: { code: 'MUWEAVE_RPC_UNAVAILABLE', message: 'RPC transport is unavailable' } }
  try {
    const response = await fetcher(RPC_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    })
    return await response.json() as RpcEnvelope
  } catch {
    return { ok: false, error: { code: 'MUWEAVE_RPC_UNAVAILABLE', message: 'RPC transport is unavailable' } }
  }
}

function sessionRef(context?: ToolContext): string | undefined {
  return context?.sessionRef ?? context?.session_ref ?? context?.session?.sessionRef ?? context?.session?.ref
}

function taskProjection(data: unknown): Record<string, unknown> {
  const task = (data && typeof data === 'object' && 'task' in data ? (data as { task?: unknown }).task : data)
  const record = task && typeof task === 'object' ? task as Record<string, unknown> : {}
  return {
    taskRef: ref(record.taskId ?? record.taskRef),
    status: ref(record.status, 'unknown'),
    summary: safeString(record.summary ?? record.attention ?? ''),
    counts: {
      depth: typeof record.depth === 'number' ? record.depth : 0,
      revision: typeof record.revision === 'number' ? record.revision : 0,
    },
  }
}

function traceProjection(data: unknown): Record<string, unknown> {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const taskProjectionValue = taskProjection({ task: record.task })
  const jobs = Array.isArray(record.jobs) ? record.jobs : []
  const events = Array.isArray(record.events) ? record.events : []
  return {
    ...taskProjectionValue,
    summary: safeString(record.summary ?? taskProjectionValue.summary),
    counts: { jobs: jobs.length, events: events.length },
  }
}

export function createBotToolDefinitions(): BotToolDefinition[] {
  return [
    {
      name: 'muweave_bot_roster',
      description: 'List the bots available in a workspace with compact capability summaries.',
      parameters: jsonSchema({ workspaceId: { type: 'string' } }, ['workspaceId']),
      inputSchema: rosterInput,
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            bots: { type: 'array' },
            counts: { type: 'object' },
          },
          required: ['ok', 'bots', 'counts'],
          additionalProperties: false,
        },
        render(value: unknown) { return JSON.stringify(value) },
      },
      isConcurrencySafe() { return true },
      async execute(rawArgs: unknown, context?: ToolContext) {
        const args = rosterInput.parse(rawArgs)
        const response = await rpc('bot.roster', args, context)
        if (!response.ok) return failure(response)
        const bots = response.data && typeof response.data === 'object' && Array.isArray((response.data as { bots?: unknown[] }).bots)
          ? (response.data as { bots: unknown[] }).bots : []
        return {
          ok: true,
          bots: bots.map((raw) => {
            const bot = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
            const grants = Array.isArray(bot.capabilityGrants) ? bot.capabilityGrants.filter((item): item is string => typeof item === 'string').map(safeString) : []
            return { botId: ref(bot.botId), role: ref(bot.role, 'unknown'), state: ref(bot.state, 'unknown'), capabilities: grants.slice(0, 32), capabilityCount: grants.length }
          }),
          counts: { bots: bots.length },
        }
      },
    },
    {
      name: 'muweave_task_delegate',
      description: 'Delegate one bounded task from the currently bound manager bot to a worker bot.',
      parameters: jsonSchema({
        workspaceId: { type: 'string' }, goal: { type: 'string' }, assignedToBotId: { type: 'string' },
        parentTaskRef: { type: 'string' }, idempotencyKey: { type: 'string' }, deadline: { type: 'string' },
      }, ['workspaceId', 'goal', 'assignedToBotId', 'idempotencyKey']),
      inputSchema: delegateInput,
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' }, taskRef: { type: 'string' }, status: { type: 'string' },
            summary: { type: 'string' }, counts: { type: 'object' }, code: { type: 'string' },
          },
          required: ['ok', 'counts'],
          additionalProperties: false,
        },
        render(value: unknown) { return JSON.stringify(value) },
      },
      async execute(rawArgs: unknown, context?: ToolContext) {
        const args = delegateInput.parse(rawArgs)
        const boundSession = sessionRef(context)
        if (!boundSession) return { ok: false, code: 'BOT_DELEGATION_FORBIDDEN', summary: 'A bound manager session is required', counts: {} }
        const session = await rpc('bot.session.get', { sessionRef: boundSession, workspaceId: args.workspaceId }, context)
        const sessionData = session.data && typeof session.data === 'object' ? session.data as Record<string, unknown> : {}
        const bot = sessionData.bot ?? (sessionData.session && typeof sessionData.session === 'object' ? (sessionData.session as Record<string, unknown>).bot : undefined) ?? sessionData
        const identity = bot && typeof bot === 'object' ? bot as Record<string, unknown> : {}
        if (!session.ok || identity.role !== 'manager' || identity.state === 'paused' || identity.state === 'retired' || typeof identity.botId !== 'string') {
          return { ok: false, code: 'BOT_DELEGATION_FORBIDDEN', summary: 'Only an active manager session can delegate', counts: {} }
        }
        const response = await rpc('task.delegate', {
          ...args, assignedBy: { botId: identity.botId, sessionId: boundSession },
        }, context)
        if (!response.ok) return failure(response)
        return { ok: true, ...taskProjection(response.data) }
      },
    },
    {
      name: 'muweave_task_status',
      description: 'Read one task status and its compact, redacted summary.',
      parameters: jsonSchema({ taskId: { type: 'string' } }, ['taskId']),
      inputSchema: taskInput,
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' }, taskRef: { type: 'string' }, status: { type: 'string' },
            summary: { type: 'string' }, counts: { type: 'object' }, code: { type: 'string' },
          },
          required: ['ok', 'counts'],
          additionalProperties: false,
        },
        render(value: unknown) { return JSON.stringify(value) },
      },
      isConcurrencySafe() { return true },
      async execute(rawArgs: unknown, context?: ToolContext) {
        const args = taskInput.parse(rawArgs)
        const response = await rpc('task.get', args, context)
        if (!response.ok) return failure(response)
        return { ok: true, ...taskProjection(response.data) }
      },
    },
    {
      name: 'muweave_task_trace',
      description: 'Read a task to job to event trace as redacted references and counts.',
      parameters: jsonSchema({ taskId: { type: 'string' } }, ['taskId']),
      inputSchema: taskInput,
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' }, taskRef: { type: 'string' }, status: { type: 'string' },
            summary: { type: 'string' }, counts: { type: 'object' }, code: { type: 'string' },
          },
          required: ['ok', 'counts'],
          additionalProperties: false,
        },
        render(value: unknown) { return JSON.stringify(value) },
      },
      isConcurrencySafe() { return true },
      async execute(rawArgs: unknown, context?: ToolContext) {
        const args = taskInput.parse(rawArgs)
        const response = await rpc('task.trace', args, context)
        if (!response.ok) return failure(response)
        return { ok: true, ...traceProjection(response.data) }
      },
    },
  ]
}

export function registerBotTools(
  toolsSvc: { register(def: Record<string, unknown>): () => void },
  effect?: (fn: () => () => void, label?: string) => void,
): void {
  for (const tool of createBotToolDefinitions()) {
    const dispose = toolsSvc.register(tool)
    effect?.(() => dispose, `muweave-kit: tool ${tool.name}`)
  }
}
