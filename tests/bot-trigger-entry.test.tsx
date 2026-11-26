import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createMuweaveBotAtSource, clearRecentTriggers, createMuweaveElementAtSource } from '../packages/dsh-muweave-core/src/client/triggers'
import { JobRow } from '../packages/dsh-muweave-core/src/client/generation-jobs'
import type { JobRecordV1 } from '../packages/dsh-muweave-core/src/capability-protocol'
import type { MuweaveRpcClient } from '../packages/dsh-muweave-core/src/client/rpc-client'

const signal = () => new AbortController().signal

function botRpc(bots: unknown[], session?: unknown): MuweaveRpcClient {
  return {
    call: vi.fn(async (action: string) => {
      if (action === 'bot.roster') return { ok: true as const, generation: 1, data: { bots } }
      if (action === 'bot.session.get') return { ok: true as const, generation: 1, data: session ?? {} }
      return { ok: true as const, generation: 1, data: {} }
    }) as MuweaveRpcClient['call'],
    resolveMediaUrl: vi.fn(async () => undefined),
    generation: () => 1,
  }
}

function job(over: Partial<JobRecordV1> = {}): JobRecordV1 {
  return {
    jobId: 'job_bot', workspaceId: 'ws', capabilityId: 'eikona.image.generate', owner: 'eikona', kind: 'image',
    title: '定妆', promptDigest: 'sha256:x', requestedBy: 'agent', status: 'completed', estimate: { unit: 'none' },
    idempotencyKey: 'idempotent', slots: [], createdAt: '2026-11-26T00:00:00Z', updatedAt: '2026-11-26T00:00:00Z',
    nextAction: 'none', ...over,
  }
}

afterEach(() => {
  cleanup()
  clearRecentTriggers()
})

describe('@bot trigger entry', () => {
  it('completes @bot:muweave-manager from the roster', async () => {
    const source = createMuweaveBotAtSource({ rpc: botRpc([
      { botId: 'muweave-manager', role: 'manager', state: 'active' },
      { botId: 'worker-a', role: 'worker', state: 'active' },
    ]) })
    const rows = await source.candidates({ sessionId: 's1' }, { query: 'bot:muweave-manager', signal: signal() })
    expect(rows.map((row) => row.name)).toEqual(['muweave-manager'])
  })

  it('keeps @bot: results to bots and does not mix element candidates', async () => {
    const rpc = botRpc([{ botId: 'worker-a', role: 'worker', state: 'active' }])
    const source = createMuweaveElementAtSource({ rpc })
    const rows = await source.candidates({ sessionId: 's1' }, { query: 'bot:', signal: signal() })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('worker-a')
    expect(rows[0]?.description).toContain('worker')
  })

  it('reports BOT_SESSION_UNAVAILABLE when a selected bot has no session', async () => {
    const onError = vi.fn()
    const source = createMuweaveBotAtSource({ rpc: botRpc([{ botId: 'worker-a', role: 'worker' }]), onError })
    const rows = await source.candidates({ sessionId: 's1' }, { query: 'bot:worker-a', signal: signal() })
    const picked = await source.onPick({ candidate: rows[0]! })
    expect(picked).toMatchObject({ error: { code: 'BOT_SESSION_UNAVAILABLE' } })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'BOT_SESSION_UNAVAILABLE' }))
  })

  it('opens the roster session and remembers the bot selection', async () => {
    const openSession = vi.fn()
    const source = createMuweaveBotAtSource({ rpc: botRpc([{ botId: 'worker-a', role: 'worker' }], { sessionRef: 'session:worker-a' }), openSession })
    const rows = await source.candidates({ sessionId: 's1' }, { query: 'bot:worker', signal: signal() })
    await source.onPick({ candidate: rows[0]! })
    expect(openSession).toHaveBeenCalledWith('session:worker-a')
  })
})

describe('generation job requester display', () => {
  it('prefers requester.botId and falls back to owner', () => {
    const rpc = botRpc([])
    const t = (key: string) => key
    const { container, rerender } = render(<JobRow rpc={rpc} t={t} job={job({ requester: { botId: 'worker-a' } })} paidEnabled onChanged={() => undefined} lang="en" />)
    expect(container.querySelector('.mw-chip')?.textContent).toBe('worker-a')
    rerender(<JobRow rpc={rpc} t={t} job={job()} paidEnabled onChanged={() => undefined} lang="en" />)
    expect(container.querySelector('.mw-chip')?.textContent).toBe('eikona')
  })
})
