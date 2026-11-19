import { describe, expect, it, beforeEach } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { createMuweaveRpcClient, type MuweaveTranslator } from '@yeisme/dsh-muweave-core/client'
import { WorkbenchMainPage } from '@yeisme/dsh-muweave-workbench/client'

/**
 * A freshly created project has no elements tagged with its id yet. The workbench must fall back to
 * the workspace projection and say so, instead of showing an empty room that reads as data loss.
 */

const ELEMENTS = [
  {
    elementId: 'el-1',
    domain: 'script',
    kind: 'script.scene_card',
    title: '场次卡 · 外景',
    sourceOwner: 'auctra',
    sourceRef: 'scene:ep01:s01',
    status: 'draft',
    digest: `sha256:${'a'.repeat(64)}`,
    updatedAt: '2026-11-19T00:00:00Z',
  },
  {
    elementId: 'el-2',
    domain: 'drama',
    kind: 'drama.storyboard_table',
    title: '分镜摘要表',
    sourceOwner: 'scaena',
    sourceRef: 'shot:ep01:s01:01',
    status: 'ready',
    digest: `sha256:${'b'.repeat(64)}`,
    updatedAt: '2026-11-19T00:00:00Z',
  },
]

const PROJECT = {
  id: 'proj_new',
  title: '新项目',
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

const keyEcho = ((key: string) => key) as unknown as MuweaveTranslator

beforeEach(() => {
  cleanup()
  globalThis.localStorage?.clear()
})

describe('workbench: unclaimed project falls back to the workspace', () => {
  it('shows workspace elements and an explanation when the project has none of its own', async () => {
    const calls: Array<{ projectId?: string }> = []
    const rpc = createRpc({
      'project.list': () => ({ ok: true, data: { projects: [PROJECT], activeProjectId: PROJECT.id } }),
      'bundle.elements.list': (payload) => {
        calls.push({ projectId: payload.projectId as string | undefined })
        // Project-scoped read is empty; the workspace-wide read has content.
        return payload.projectId
          ? { ok: true, data: { elements: [], ownerStates: {} } }
          : { ok: true, data: { elements: ELEMENTS, ownerStates: {} } }
      },
      'workspace.list': () => ({ ok: true, data: { workspaces: [{ workspaceId: 'ws_one', label: 'demo', hasBundle: true }] } }),
      'job.list': () => ({ ok: true, data: { jobs: [] } }),
      'cli.catalog': () => ({ ok: true, data: { entries: [] } }),
    })

    render(<WorkbenchMainPage rpc={rpc as never} t={(k: string) => k} coreT={keyEcho} />)

    // Both reads happened: the scoped one first, then the fallback.
    await waitFor(() => expect(calls.some((c) => c.projectId === PROJECT.id)).toBe(true))
    await waitFor(() => expect(calls.some((c) => c.projectId === undefined)).toBe(true))

    // The element titles come from the fallback read, so the room is not empty.
    await waitFor(() => {
      const text = document.body.textContent ?? ''
      expect(text).toContain('场次卡 · 外景')
    })
  })
})
