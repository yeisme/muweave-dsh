import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TaskLedger } from '../packages/dsh-muweave-core/src/bot-task/tasks'
import { EventLog } from '../packages/dsh-muweave-core/src/bot-task/events'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

type Bot = {
  botId: string
  role: 'manager' | 'worker'
  presetRef: string
  capabilityGrants: string[]
  ownerScopes: string[]
  workspaceScopes: string[]
  budgetEnvelope: { unit: 'none' }
  state: 'active' | 'paused' | 'retired'
  revision: number
}

const manager = (overrides: Partial<Bot> = {}): Bot => ({
  botId: 'manager', role: 'manager', presetRef: 'manager', capabilityGrants: ['shots.read'], ownerScopes: [],
  workspaceScopes: ['ws_test'], budgetEnvelope: { unit: 'none' }, state: 'active', revision: 1, ...overrides,
})
const worker = (overrides: Partial<Bot> = {}): Bot => ({
  botId: 'worker', role: 'worker', presetRef: 'worker', capabilityGrants: ['shots.read'], ownerScopes: [],
  workspaceScopes: ['ws_test'], budgetEnvelope: { unit: 'none' }, state: 'active', revision: 1, ...overrides,
})

async function makeLedger(bots: Bot[] = [manager(), worker()]): Promise<TaskLedger> {
  const dir = await mkdtemp(path.join(tmpdir(), 'muweave-delegate-'))
  dirs.push(dir)
  await writeFile(path.join(dir, 'bots.v1.json'), JSON.stringify({ schema: 'muweave.bots.v1', bots, pauses: {} }))
  return new TaskLedger({ pluginDataDir: dir })
}

function delegate(ledger: TaskLedger, extra: Record<string, unknown> = {}) {
  return ledger.handle('task.delegate', {
    workspaceId: 'ws_test', goal: 'make a shot', assignedBy: { botId: 'manager' }, assignedToBotId: 'worker',
    idempotencyKey: 'delegate-1', ...extra,
  })
}

function errorCode(response: unknown): string {
  return (response as { ok: false; error: { code: string } }).error.code
}

describe('task.delegate', () => {
  it('passes the five gates for an active manager to active worker delegation', async () => {
    const ledger = await makeLedger()
    const response = await delegate(ledger)
    expect(response.ok).toBe(true)
    expect((response as any).data.task).toEqual(expect.objectContaining({ assignedBy: { botId: 'manager' }, assignedTo: { botId: 'worker' }, depth: 0 }))
  })

  it('gate 1 rejects a caller that is not an active manager', async () => {
    const ledger = await makeLedger([manager({ state: 'paused' }), worker()])
    expect(errorCode(await delegate(ledger))).toBe('BOT_DELEGATION_FORBIDDEN')
  })

  it('gate 2 rejects a missing, paused, or retired target', async () => {
    const ledger = await makeLedger([manager(), worker({ state: 'paused' })])
    expect(errorCode(await delegate(ledger))).toBe('BOT_TARGET_UNAVAILABLE')
  })

  it('gate 3 rejects manager-to-manager delegation', async () => {
    const ledger = await makeLedger([manager(), worker({ botId: 'another-manager', role: 'manager' })])
    expect(errorCode(await delegate(ledger, { assignedToBotId: 'another-manager' }))).toBe('BOT_DELEGATION_FORBIDDEN')
  })

  it('gate 4 rejects missing capability intersection or workspace scope', async () => {
    const ledger = await makeLedger([manager(), worker({ capabilityGrants: ['shots.write'], workspaceScopes: ['*'] })])
    expect(errorCode(await delegate(ledger))).toBe('BOT_CAPABILITY_NOT_GRANTED')
  })

  it('gate 5 reuses create depth and fanout limits', async () => {
    const ledger = await makeLedger()
    const root = await ledger.handle('task.create', { workspaceId: 'ws_test', goal: 'root', idempotencyKey: 'root' })
    const rootTaskId = (root as any).data.task.taskId
    const child = await delegate(ledger, { idempotencyKey: 'child', parentTaskRef: rootTaskId })
    const childTaskId = (child as any).data.task.taskId
    const grandchild = await delegate(ledger, { idempotencyKey: 'grandchild', parentTaskRef: childTaskId })
    const grandchildTaskId = (grandchild as any).data.task.taskId
    expect(errorCode(await delegate(ledger, { idempotencyKey: 'too-deep', parentTaskRef: grandchildTaskId }))).toBe('BOT_DEPTH_EXCEEDED')
    for (let i = 0; i < 3; i++) await delegate(ledger, { idempotencyKey: 'fan-' + i, parentTaskRef: rootTaskId })
    expect(errorCode(await delegate(ledger, { idempotencyKey: 'fan-4', parentTaskRef: rootTaskId }))).toBe('BOT_FANOUT_EXCEEDED')
  })

  it('returns the original task for the same idempotency key and digest', async () => {
    const ledger = await makeLedger()
    const first = await delegate(ledger)
    const replay = await delegate(ledger)
    expect((replay as any).data.task.taskId).toBe((first as any).data.task.taskId)
  })

  it('rejects a different digest for an idempotency key and records task.delegated', async () => {
    const ledger = await makeLedger()
    const first = await delegate(ledger)
    expect(errorCode(await delegate(ledger, { goal: 'different goal' }))).toBe('TASK_IDEMPOTENCY_CONFLICT')
    const events = await new EventLog({ pluginDataDir: (ledger as any).deps.pluginDataDir }).handle('event.list', { taskId: (first as any).data.task.taskId })
    expect((events as any).data.events).toEqual([expect.objectContaining({ event: 'task.delegated' })])
  })
})
