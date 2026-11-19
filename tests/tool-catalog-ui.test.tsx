import { describe, expect, it, beforeEach, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createMuweaveRpcClient, type MuweaveTranslator } from '@yeisme/dsh-muweave-core/client'
import { DramaSessionView } from '@yeisme/dsh-muweave-core/client'
import { getGenerationSnapshot } from '@yeisme/dsh-muweave-core/client'

/**
 * The tool catalog used to be display-only. These tests pin the wiring: a ready capability opens the
 * generation desk, and a paid one only *opens the desk* — it must never be submitted from here.
 */

const keyEcho = ((key: string) => key) as unknown as MuweaveTranslator

type Reply = { ok: true; data: unknown } | { ok: false }
type Handler = (payload: Record<string, unknown>) => Reply

function createRpc(handlers: Record<string, Handler>) {
  return createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
    const handler = handlers[body.action]
    const reply = handler ? handler(body.payload ?? {}) : ({ ok: true, data: {} } as Reply)
    return Response.json(
      reply.ok
        ? { ok: true, generation: 1, data: reply.data }
        : { ok: false, generation: 1, error: { code: 'muweave/test_failure', message: 'failed' } },
    )
  })
}

const CATALOG = {
  schema: 'muweave.capability.catalog.v1',
  capabilities: [
    {
      capabilityId: 'eikona.image.generate',
      title: '出图',
      summary: '生成候选图',
      stage: 'visual',
      costClass: 'paid',
      costUnit: 'image',
      available: true,
    },
    {
      capabilityId: 'sonora.voice.tts',
      title: '配音',
      summary: '生成配音',
      stage: 'audio',
      costClass: 'paid',
      costUnit: 'second',
      available: true,
    },
    {
      capabilityId: 'scaena.shot.video',
      title: '出视频',
      summary: '生成镜头视频',
      stage: 'production',
      costClass: 'paid',
      costUnit: 'second',
      available: false,
      unavailableReason: 'missing owner parameter',
    },
  ],
}

const baseHandlers = (): Record<string, Handler> => ({
  'capability.catalog': () => ({ ok: true, data: CATALOG }),
  'session.log': () => ({ ok: true, data: { entries: [] } }),
  'drama.digest': () => ({ ok: true, data: { assets: [], axes: {} } }),
  'timing.projection': () => ({ ok: true, data: {} }),
  'job.request': () => ({ ok: true, data: { job: { id: 'job_1', state: 'waiting_approval' } } }),
})

beforeEach(() => {
  cleanup()
})

describe('session view: tool catalog is executable', () => {
  it('opens the generation desk for a ready capability and never submits a job', async () => {
    const calls: string[] = []
    const rpc = createRpc({
      ...baseHandlers(),
      'job.request': (payload) => {
        calls.push('job.request')
        return { ok: true, data: { job: { id: 'job_x' } } }
      },
    })

    render(<DramaSessionView rpc={rpc as never} t={keyEcho} sessionId="s1" onOpenTheater={() => {}} />)
    // Switch to the catalog section.
    const tab = await waitFor(() => {
      const el = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('catalogTitle'))
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    fireEvent.click(tab)

    const row = await waitFor(() => {
      const el = document.querySelector('[data-tool-id="eikona.image.generate"] button')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    fireEvent.click(row)

    // Desk opened → this is the wiring that used to be missing.
    await waitFor(() => expect(getGenerationSnapshot().open).toBe(true))
    // And nothing was submitted from the catalog.
    expect(calls).not.toContain('job.request')
  })

  it('keeps blocked capabilities disabled and explains why', async () => {
    const rpc = createRpc(baseHandlers())
    render(<DramaSessionView rpc={rpc as never} t={keyEcho} sessionId="s1" onOpenTheater={() => {}} />)
    const tab = await waitFor(() => {
      const el = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('catalogTitle'))
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    fireEvent.click(tab)

    const row = await waitFor(() => {
      const el = document.querySelector('[data-tool-id="scaena.shot.video"] button')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    expect(row.getAttribute('disabled')).not.toBeNull()
    expect(document.body.textContent ?? '').toContain('missing owner parameter')
  })
})
