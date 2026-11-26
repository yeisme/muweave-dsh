import { describe, expect, it } from 'vitest'
import { createBotToolDefinitions, registerBotTools } from '../packages/dsh-muweave-kit/src/bot-tools'

type Tool = ReturnType<typeof createBotToolDefinitions>[number]

function toolsByName(): Map<string, Tool> {
  const registered = new Map<string, Tool>()
  registerBotTools({
    register(def) {
      const tool = def as Tool
      registered.set(tool.name, tool)
      return () => registered.delete(tool.name)
    },
  })
  return registered
}

function response(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, generation: 0, data }), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('MuWeave kit bot tools', () => {
  it('registers the four narrow bot tools by their public names', () => {
    expect([...toolsByName().keys()]).toEqual([
      'muweave_bot_roster',
      'muweave_task_delegate',
      'muweave_task_status',
      'muweave_task_trace',
    ])
  })

  it('rejects missing required input fields through every zod schema', () => {
    for (const tool of toolsByName().values()) {
      expect((tool as Tool & { inputSchema: { safeParse(value: unknown): { success: boolean } } }).inputSchema.safeParse({}).success).toBe(false)
    }
  })

  it('returns BOT_DELEGATION_FORBIDDEN when a worker session tries to delegate', async () => {
    const tool = toolsByName().get('muweave_task_delegate')!
    const calls: string[] = []
    const result = await tool.execute({
      workspaceId: 'ws_test', goal: 'make a shot', assignedToBotId: 'worker', idempotencyKey: 'delegate-1',
    }, {
      sessionRef: 'session-worker',
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { action: string }
        calls.push(body.action)
        return response({ bot: { botId: 'worker', role: 'worker', state: 'active' } })
      },
    })
    expect(result).toMatchObject({ ok: false, code: 'BOT_DELEGATION_FORBIDDEN' })
    expect(calls).toEqual(['bot.session.get'])
  })

  it('looks up a manager session before sending task.delegate over RPC', async () => {
    const tool = toolsByName().get('muweave_task_delegate')!
    const calls: string[] = []
    const result = await tool.execute({
      workspaceId: 'ws_test', goal: 'make a shot', assignedToBotId: 'worker', idempotencyKey: 'delegate-2',
    }, {
      sessionRef: 'session-manager',
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { action: string; payload: Record<string, unknown> }
        calls.push(body.action)
        if (body.action === 'bot.session.get') return response({ bot: { botId: 'manager', role: 'manager', state: 'active' } })
        return response({ task: { taskId: 'task_1', status: 'assigned', attention: 'needs_assignment' } })
      },
    })
    expect(result).toMatchObject({ ok: true, taskRef: 'task_1', status: 'assigned' })
    expect(calls).toEqual(['bot.session.get', 'task.delegate'])
  })

  it('redacts absolute paths from task and trace projections', async () => {
    const tools = toolsByName()
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action: string }
      if (body.action === 'task.get') return response({ task: { taskId: 'task_1', status: 'running', summary: '/home/alice/private/prompt.txt' } })
      return response({ task: { taskId: 'task_1', status: 'running', summary: 'ok' }, jobs: [{ jobId: 'job_1' }], events: [{ summary: '/tmp/raw-event.txt' }] })
    }
    const status = await tools.get('muweave_task_status')!.execute({ taskId: 'task_1' }, { fetch })
    const trace = await tools.get('muweave_task_trace')!.execute({ taskId: 'task_1' }, { fetch })
    expect(JSON.stringify(status)).not.toContain('/home/alice')
    expect(JSON.stringify(trace)).not.toContain('/tmp/raw-event')
  })
})
