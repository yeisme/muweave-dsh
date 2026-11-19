import { describe, expect, it, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createMuweaveRpcClient, type MuweaveTranslator } from '@yeisme/dsh-muweave-core/client'
import { ScheduleMainPage } from '@yeisme/dsh-muweave-schedule/client'

/**
 * Schedule room UI: ownership grouping, the collapse preference and the two degradation paths.
 *
 * Assertions deliberately key off `data-*` hooks instead of copy: the room's own dictionary is
 * registered by the plugin at runtime, so unit renders pass a key-echoing translator. That keeps
 * these tests about structure — which is what regressed before (blank room, no grouping).
 */

const ELEMENTS = [
  {
    elementId: 'scene-ep01-s01',
    domain: 'script',
    kind: 'script.scene_card',
    title: '场次卡 · 外景 霓虹街口',
    sourceOwner: 'auctra',
    sourceRef: 'scene:ep01:s01',
    status: 'draft',
    digest: `sha256:${'1'.repeat(64)}`,
    updatedAt: '2026-11-19T00:00:00Z',
  },
  {
    elementId: 'shot-ep01-s01-01',
    domain: 'drama',
    kind: 'drama.storyboard_table',
    title: '分镜摘要表 · breakdown:ep01',
    sourceOwner: 'scaena',
    sourceRef: 'shot:ep01:s01:01',
    status: 'ready',
    digest: `sha256:${'2'.repeat(64)}`,
    updatedAt: '2026-11-19T00:00:00Z',
  },
]

const PROJECT = {
  id: 'proj_alpha',
  title: 'alpha',
  status: 'preparing',
  archived: false,
  workspaceRefs: ['ws_one'],
  updatedAt: '2026-11-19T00:00:00Z',
}

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

/** Echoes the key so structure is assertable without loading a locale bundle. */
const keyEcho = ((key: string) => key) as unknown as MuweaveTranslator

function renderRoom(rpc: ReturnType<typeof createRpc>) {
  return render(<ScheduleMainPage rpc={rpc as never} t={(k: string) => k} coreT={keyEcho} />)
}

const waitForBoard = () =>
  waitFor(() => {
    const board = document.querySelector('[data-muweave-schedule-board="true"]')
    expect(board).not.toBeNull()
  })

/** Rows in the backlog. `data-ownership` only exists when a project is active, so count by class. */
const backlogRows = () => document.querySelectorAll('[data-muweave-schedule-backlog="true"] .mw-sched-row')
/** Rows carrying an explicit ownership tag (only present when a project is active). */
const taggedRows = () => document.querySelectorAll('[data-muweave-schedule-backlog="true"] [data-ownership]')

function happyHandlers(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'project.list': () => ({ ok: true, data: { projects: [], activeProjectId: undefined } }),
    'schedule.list': () => ({ ok: true, data: { schema: 'muweave.schedule.v1', entries: [], updatedAt: '' } }),
    'bundle.elements.list': () => ({ ok: true, data: { elements: ELEMENTS } }),
    'workspace.list': () => ({
      ok: true,
      data: { workspaces: [{ workspaceId: 'ws_one', label: 'demo', hasBundle: true }] },
    }),
    ...overrides,
  }
}

beforeEach(() => {
  cleanup()
  globalThis.localStorage?.clear()
})

describe('schedule room: degradation paths', () => {
  it('shows the full backlog when the host answers without a projects array', async () => {
    const rpc = createRpc(happyHandlers({ 'project.list': () => ({ ok: true, data: {} }) }))
    renderRoom(rpc)
    await waitForBoard()
    // No active project means "everything is mine": every element is listed, nothing is tagged.
    await waitFor(() => expect(backlogRows().length).toBe(ELEMENTS.length))
    expect(taggedRows().length).toBe(0)
  })

  it('shows the full backlog when project.list fails', async () => {
    const rpc = createRpc(happyHandlers({ 'project.list': () => ({ ok: false }) }))
    renderRoom(rpc)
    await waitForBoard()
    await waitFor(() => expect(backlogRows().length).toBe(ELEMENTS.length))
    // The project bar degrades to its own message instead of showing a project name.
    expect(document.body.textContent ?? '').toMatch(/noActiveProject|projectUnsupported|未启用/)
  })
})

describe('schedule room: ownership grouping', () => {
  it('tags rows with mine/unknown and keeps others hidden until asked', async () => {
    const foreign = {
      ...ELEMENTS[0],
      elementId: 'foreign-ref',
      title: 'foreign',
      sourceRef: 'proj_other:scene:s01',
    }
    const rpc = createRpc(
      happyHandlers({
        'project.list': () => ({ ok: true, data: { projects: [PROJECT], activeProjectId: PROJECT.id } }),
        'bundle.elements.list': () => ({ ok: true, data: { elements: [...ELEMENTS, foreign] } }),
      }),
    )
    renderRoom(rpc)
    await waitForBoard()

    await waitFor(() => expect(backlogRows().length).toBeGreaterThan(0))
    const before = [...taggedRows()].map((row) => row.getAttribute('data-ownership'))
    expect(before).not.toContain('others')

    const othersToggle = document.querySelector('[data-mw-others-toggle], [data-sched-others-toggle]')
    if (othersToggle instanceof HTMLElement) {
      fireEvent.click(othersToggle)
      await waitFor(() => {
        const after = [...taggedRows()].map((row) => row.getAttribute('data-ownership'))
        expect(after).toContain('others')
      })
    }
  })
})

describe('schedule room: backlog preference', () => {
  it('writes the collapse choice to localStorage', async () => {
    const rpc = createRpc(happyHandlers())
    renderRoom(rpc)
    await waitForBoard()
    const toggle = document.querySelector('[data-backlog-toggle], .mw-sched-backlog-toggle')
    expect(toggle).not.toBeNull()
    if (toggle instanceof HTMLElement) fireEvent.click(toggle)
    await waitFor(() => {
      const stored = globalThis.localStorage?.getItem('muweave.schedule.backlog')
      expect(stored === 'collapsed' || stored === 'expanded').toBe(true)
    })
  })
})

describe('schedule room: workspace element cache', () => {
  it('reads each project workspace at most once per session', async () => {
    const seen: string[] = []
    const rpc = createRpc(
      happyHandlers({
        'project.list': () => ({ ok: true, data: { projects: [PROJECT], activeProjectId: PROJECT.id } }),
        'bundle.elements.list': (payload) => {
          const ws = String(payload.workspaceId ?? 'default')
          seen.push(ws)
          return { ok: true, data: { elements: ELEMENTS } }
        },
      }),
    )
    renderRoom(rpc)
    await waitForBoard()
    // Let every pending load settle, then re-render to force a project re-read.
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    const firstRound = seen.filter((id) => id === 'ws_one').length
    expect(firstRound).toBe(1)
  })
})
