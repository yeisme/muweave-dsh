import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TaskLedger } from '../packages/dsh-muweave-core/src/bot-task/tasks'
import { BotTaskService } from '../packages/dsh-muweave-core/src/bot-task/service'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function makeLedger() { const dir = await mkdtemp(path.join(tmpdir(), 'muweave-tasks-')); dirs.push(dir); return { dir, ledger: new TaskLedger({ pluginDataDir: dir }) } }
function create(ledger: TaskLedger, extra: Record<string, unknown> = {}) { return ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'make a shot', idempotencyKey: 'key-' + Math.random(), ...extra }) }

describe('task ledger', () => {
  it('persists and replays idempotent requests, conflicts on a different digest', async () => {
    const { dir, ledger } = await makeLedger()
    const payload = { workspaceId: 'ws_test', goal: 'same', idempotencyKey: 'same-key', traceId: 'trace-fixed' }
    const first = await ledger.handle('task.create', payload)
    const replay = await ledger.handle('task.create', payload)
    expect(replay.ok).toBe(true)
    expect((replay as any).data.task.taskId).toBe((first as any).data.task.taskId)
    const conflict = await ledger.handle('task.create', { ...payload, goal: 'different' })
    expect(conflict.ok ? '' : conflict.error.code).toBe('TASK_IDEMPOTENCY_CONFLICT')
    const restored = new TaskLedger({ pluginDataDir: dir })
    const listed = await restored.handle('task.list', { workspaceId: 'ws_test' })
    expect((listed as any).data.tasks).toHaveLength(1)
    const service = new BotTaskService({ pluginDataDir: dir })
    const fromService = await service.handle('task.get', { taskId: (first as any).data.task.taskId })
    expect(fromService.ok).toBe(true)
    service.dispose()
    expect((await stat(path.join(dir, 'tasks.v1.json'))).mode & 0o777).toBe(0o600)
    expect(await readFile(path.join(dir, 'tasks.v1.json'), 'utf8')).not.toContain('/home/')
  })

  it('enforces depth and fanout and keeps more than 200 tasks', async () => {
    const { ledger } = await makeLedger()
    const root = await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'root', idempotencyKey: 'root' })
    const rootId = (root as any).data.task.taskId
    const child = await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'child', idempotencyKey: 'child', parentTaskRef: rootId })
    const childId = (child as any).data.task.taskId
    const grand = await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'grand', idempotencyKey: 'grand', parentTaskRef: childId })
    const grandId = (grand as any).data.task.taskId
    const tooDeep = await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'deep', idempotencyKey: 'deep', parentTaskRef: grandId })
    expect(tooDeep.ok ? '' : tooDeep.error.code).toBe('BOT_DEPTH_EXCEEDED')
    for (let i = 0; i < 4; i++) await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'fanout', idempotencyKey: 'fan-' + i, parentTaskRef: rootId })
    const tooWide = await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'fanout', idempotencyKey: 'fan-4', parentTaskRef: rootId })
    expect(tooWide.ok ? '' : tooWide.error.code).toBe('BOT_FANOUT_EXCEEDED')
    for (let i = 0; i < 210; i++) await ledger.handle('task.create', { workspaceId: 'ws_many', goal: 'item', idempotencyKey: 'many-' + i })
    const many = await ledger.handle('task.list', { workspaceId: 'ws_many' })
    expect((many as any).data.tasks).toHaveLength(210)
  })

  it('cancels a subtree while leaving terminal descendants unchanged', async () => {
    const { ledger } = await makeLedger()
    const root = await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'root', idempotencyKey: 'cancel-root' })
    const rootId = (root as any).data.task.taskId
    const child = await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'child', idempotencyKey: 'cancel-child', parentTaskRef: rootId })
    const childId = (child as any).data.task.taskId
    const terminal = await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'terminal', idempotencyKey: 'cancel-terminal', parentTaskRef: rootId })
    const terminalId = (terminal as any).data.task.taskId
    const stored = JSON.parse(await readFile(path.join((ledger as any).deps.pluginDataDir, 'tasks.v1.json'), 'utf8'))
    stored.tasks.find((task: any) => task.taskId === terminalId).status = 'succeeded'
    await import('node:fs/promises').then(({ writeFile }) => writeFile(path.join((ledger as any).deps.pluginDataDir, 'tasks.v1.json'), JSON.stringify(stored)))
    const restored = new TaskLedger({ pluginDataDir: (ledger as any).deps.pluginDataDir })
    const cancel = await restored.handle('task.cancel', { taskId: rootId })
    expect((cancel as any).data.cancelledTaskIds).toContain(rootId)
    expect((cancel as any).data.cancelledTaskIds).toContain(childId)
    const terminalRead = await restored.handle('task.get', { taskId: terminalId })
    expect((terminalRead as any).data.task.status).toBe('succeeded')
  })
})
