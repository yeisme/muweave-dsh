import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createMuweaveRpcClient, type MuweaveTranslator } from '@yeisme/dsh-muweave-core/client'
import { WorkbenchMainPage } from '@yeisme/dsh-muweave-workbench/client'
import { ClaimWizard, discoverClaimCandidates, truncateId, type ClaimCandidate } from '../packages/dsh-muweave-workbench/src/claim-wizard'
import { ProjectPanel } from '../packages/dsh-muweave-workbench/src/project-panel'

// docs/design/project-features-next.md F2: discovering unregistered bundles and the two-step claim wizard.

type Reply = { ok: true; data: unknown } | { ok: false; code?: string; message?: string }
type Handler = (payload: Record<string, unknown>) => Reply
interface Call {
  action: string
  payload: Record<string, unknown>
}

function createRpc(handlers: Record<string, Handler>) {
  const calls: Call[] = []
  const rpc = createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
    calls.push({ action: body.action, payload: body.payload ?? {} })
    const handler = handlers[body.action]
    const reply = handler ? handler(body.payload ?? {}) : ({ ok: true, data: {} } as Reply)
    return Response.json(
      reply.ok
        ? { ok: true, generation: 1, data: reply.data }
        : { ok: false, generation: 1, error: { code: reply.code ?? 'muweave/test_failure', message: reply.message ?? 'failed' } },
    )
  })
  return { rpc, calls, of: (action: string) => calls.filter((c) => c.action === action) }
}

const index = (projectId: string | undefined, extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  data: { initialized: true, index: { projectId, title: 'manifest ' + projectId, revision: 4, counts: { total: 3 }, ...extra } },
})

const REGISTERED = { id: 'proj_live', title: '在制项目', status: 'in_production', archived: true, workspaceRefs: ['ws_live'], updatedAt: '2026-11-19T00:00:00Z' }

/** One registered bundle, one claimable bundle, plus every shape discovery must skip. */
const discoveryHandlers: Record<string, Handler> = {
  'project.list': () => ({ ok: true, data: { projects: [REGISTERED] } }),
  'workspace.list': () => ({
    ok: true,
    data: {
      workspaces: [
        { workspaceId: 'ws_live', label: '在制', hasBundle: true },
        { workspaceId: 'ws_old', label: '旧片场', hasBundle: true },
        { workspaceId: 'ws_none', label: '空目录', hasBundle: false },
        { workspaceId: 'ws_uninit', label: '未初始化' },
        { workspaceId: 'ws_broken', label: '读失败', hasBundle: true },
        { workspaceId: 'ws_noid', label: '无 id', hasBundle: true },
        { label: '缺 workspaceId' },
        'garbage',
      ],
    },
  }),
  'bundle.status': (payload) => {
    switch (payload.workspaceId) {
      case 'ws_live':
        return index('proj_live')
      case 'ws_old':
        return index('proj_old_2026_bundle_a91f')
      case 'ws_uninit':
        return { ok: true, data: { initialized: false } }
      case 'ws_noid':
        return index(undefined)
      default:
        return { ok: false, code: 'muweave/bundle_unreadable' }
    }
  },
}

const keyEcho = ((key: string) => key) as unknown as MuweaveTranslator
const $ = (selector: string) => document.querySelector(selector) as HTMLElement | null

beforeEach(() => {
  cleanup()
  globalThis.localStorage?.clear()
})

describe('F2 discovery', () => {
  it('offers only initialized bundles whose projectId the registry (archived included) does not hold', async () => {
    const { rpc, of } = createRpc(discoveryHandlers)
    const result = await discoverClaimCandidates(rpc)
    expect(result).toEqual({
      ok: true,
      candidates: [
        { workspaceId: 'ws_old', label: '旧片场', projectId: 'proj_old_2026_bundle_a91f', title: 'manifest proj_old_2026_bundle_a91f', revision: 4, elementCount: 3, conflict: false },
      ],
    })
    expect(of('project.list')[0]?.payload).toEqual({ includeArchived: true })
    // hasBundle=false is never asked; malformed workspace rows are dropped before any call.
    expect(of('bundle.status').map((c) => c.payload.workspaceId).sort()).toEqual(['ws_broken', 'ws_live', 'ws_noid', 'ws_old', 'ws_uninit'])
  })

  it('marks one projectId found in two workspaces as a conflict instead of merging', async () => {
    const { rpc } = createRpc({
      'project.list': () => ({ ok: true, data: { projects: [] } }),
      'workspace.list': () => ({ ok: true, data: { workspaces: [{ workspaceId: 'ws_1', label: 'A' }, { workspaceId: 'ws_2', label: 'B' }] } }),
      // No counts: the element count falls back to index.elements, then to unknown.
      'bundle.status': (p) => index('proj_dup', p.workspaceId === 'ws_1' ? { counts: undefined, elements: [{}, {}] } : { counts: 'bad' }),
    })
    const result = await discoverClaimCandidates(rpc)
    expect(result.ok && result.candidates.map((c) => [c.workspaceId, c.conflict, c.elementCount])).toEqual([
      ['ws_1', true, 2],
      ['ws_2', true, undefined],
    ])
  })

  it('offers nothing when the registry cannot be read, rather than risk a collision', async () => {
    const { rpc, of } = createRpc({ ...discoveryHandlers, 'project.list': () => ({ ok: true, data: {} }) })
    const result = await discoverClaimCandidates(rpc)
    expect(result.ok).toBe(false)
    expect(of('bundle.status')).toHaveLength(0)
  })

  it('truncates long ids in the middle so both ends stay readable', () => {
    expect(truncateId('proj_short')).toBe('proj_short')
    const cut = truncateId('proj_old_2026_bundle_a91f')
    expect(cut).toHaveLength(18)
    expect(cut.startsWith('proj_old_')).toBe(true)
    expect(cut.endsWith('a91f')).toBe(true)
  })
})

const CANDIDATE: ClaimCandidate = { workspaceId: 'ws_old', label: '旧片场', projectId: 'proj_old', title: '旧标题', revision: 4, elementCount: 3, conflict: false }
const CLAIMED = { id: 'proj_old', title: '旧片场', status: 'preparing', archived: false, workspaceRefs: ['ws_old'], updatedAt: '2026-11-20T00:00:00Z' }

describe('F2 claim wizard', () => {
  it('shows the empty state when nothing is waiting', () => {
    const { rpc } = createRpc({})
    render(<ClaimWizard rpc={rpc} candidates={[]} onClaimed={() => undefined} onCancel={() => undefined} onReload={() => undefined} />)
    expect($('[data-claim-wizard="true"]')?.getAttribute('data-claim-step')).toBe('1')
    expect($('[data-claim-empty="true"]')?.textContent).toBe('没有待认领的 bundle')
    expect($('[data-claim-item]')).toBeNull()
  })

  it('walks two steps and submits project.claim once, with the bundle projectId and an idempotency key', async () => {
    const { rpc, of } = createRpc({ 'project.claim': () => ({ ok: true, data: { project: CLAIMED, workspaceRefs: ['ws_old'], claimed: true } }) })
    const onClaimed = vi.fn()
    render(<ClaimWizard rpc={rpc} candidates={[CANDIDATE]} onClaimed={onClaimed} onCancel={() => undefined} onReload={() => undefined} />)

    const item = $('[data-claim-item="ws_old"]')!
    expect(item.textContent).toContain('旧片场')
    expect(item.textContent).toContain('proj_old')
    expect(item.textContent).toContain('3 个元件')
    fireEvent.click(item)

    expect($('[data-claim-wizard="true"]')?.getAttribute('data-claim-step')).toBe('2')
    // Title is prefilled from the workspace label; the projectId is fixed text, not an input.
    expect((document.querySelector('.mw-claim-form input') as HTMLInputElement).value).toBe('旧片场')
    expect($('[data-claim-project-id="proj_old"]')?.tagName).toBe('CODE')
    expect($('[data-claim-note="true"]')?.textContent).toContain('认领只登记，不会修改 bundle 里的 projectId')

    const submit = $('[data-claim-submit="true"]')!
    fireEvent.click(submit)
    fireEvent.click(submit)
    await waitFor(() => expect(onClaimed).toHaveBeenCalledTimes(1))

    expect(of('project.claim')).toHaveLength(1)
    const payload = of('project.claim')[0]!.payload
    expect(payload).toMatchObject({ workspaceId: 'ws_old', projectId: 'proj_old', title: '旧片场', status: 'preparing' })
    expect(typeof payload.idempotencyKey).toBe('string')
    expect(String(payload.idempotencyKey).length).toBeGreaterThan(0)
    expect(onClaimed.mock.calls[0]![0]).toMatchObject({ id: 'proj_old', title: '旧片场' })
  })

  it('keeps the form on a known error, reuses the key for an identical retry and mints one after an edit', async () => {
    const { rpc, of } = createRpc({ 'project.claim': () => ({ ok: false, code: 'muweave/project_exists', message: 'exists' }) })
    const onClaimed = vi.fn()
    render(<ClaimWizard rpc={rpc} candidates={[CANDIDATE]} initialWorkspaceId="ws_old" onClaimed={onClaimed} onCancel={() => undefined} onReload={() => undefined} />)
    // Opened for a specific bundle: straight to the confirm step.
    await waitFor(() => expect($('[data-claim-wizard="true"]')?.getAttribute('data-claim-step')).toBe('2'))

    fireEvent.click($('[data-claim-submit="true"]')!)
    await waitFor(() => expect($('[data-claim-error="muweave/project_exists"]')).not.toBeNull())
    expect($('[data-claim-error="muweave/project_exists"]')?.textContent).toContain('重新读取')
    expect($('[data-claim-wizard="true"]')?.getAttribute('data-claim-step')).toBe('2')

    await waitFor(() => expect(($('[data-claim-submit="true"]') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click($('[data-claim-submit="true"]')!)
    await waitFor(() => expect(of('project.claim')).toHaveLength(2))
    const [first, second] = of('project.claim').map((c) => c.payload.idempotencyKey)
    expect(second).toBe(first)

    await waitFor(() => expect(($('[data-claim-submit="true"]') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(document.querySelector('.mw-claim-form input')!, { target: { value: '改过的标题' } })
    fireEvent.click($('[data-claim-submit="true"]')!)
    await waitFor(() => expect(of('project.claim')).toHaveLength(3))
    expect(of('project.claim')[2]!.payload.idempotencyKey).not.toBe(first)
    expect(of('project.claim')[2]!.payload.title).toBe('改过的标题')
    expect(onClaimed).not.toHaveBeenCalled()
  })

  it('treats ok without a project row as an unknown outcome, not a success', async () => {
    const { rpc } = createRpc({ 'project.claim': () => ({ ok: true, data: { claimed: true } }) })
    const onClaimed = vi.fn()
    render(<ClaimWizard rpc={rpc} candidates={[CANDIDATE]} initialWorkspaceId="" onClaimed={onClaimed} onCancel={() => undefined} onReload={() => undefined} />)
    // No matching workspace, but a single candidate: still jumps to confirm.
    await waitFor(() => expect($('[data-claim-step="2"]')).not.toBeNull())
    fireEvent.click($('[data-claim-submit="true"]')!)
    await waitFor(() => expect($('[data-claim-error="muweave/claim_unknown"]')).not.toBeNull())
    expect(onClaimed).not.toHaveBeenCalled()
  })
})

describe('F2 entry points', () => {
  it('does not discover at startup; opening the popover does, and the entry claims then activates', async () => {
    const { rpc, of, calls } = createRpc({
      ...discoveryHandlers,
      'project.claim': () => ({ ok: true, data: { project: CLAIMED, workspaceRefs: ['ws_old'], claimed: true } }),
      'project.activate': () => ({ ok: true, data: { project: CLAIMED } }),
      'bundle.elements.list': () => ({ ok: true, data: { elements: [] } }),
    })
    const onActivate = vi.fn()
    render(<ProjectPanel rpc={rpc} t={keyEcho} onActivate={onActivate} />)
    await waitFor(() => expect(of('workspace.list').length).toBeGreaterThan(0))
    expect(of('bundle.status')).toHaveLength(0)

    fireEvent.click(document.querySelector('[aria-haspopup="true"]')!)
    await waitFor(() => expect($('[data-claim-entry="true"]')?.getAttribute('data-claim-count')).toBe('1'))
    expect(of('bundle.status').length).toBeGreaterThan(0)
    expect(($('[data-claim-entry="true"]') as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click($('[data-claim-entry="true"]')!)
    fireEvent.click($('[data-claim-item="ws_old"]')!)
    fireEvent.click($('[data-claim-submit="true"]')!)
    await waitFor(() => expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'proj_old' })))
    expect(of('project.claim')).toHaveLength(1)
    const actions = calls.map((c) => c.action)
    expect(actions.indexOf('project.activate', actions.indexOf('project.claim'))).toBeGreaterThan(actions.indexOf('project.claim'))
    expect(of('project.activate').at(-1)?.payload).toEqual({ projectId: 'proj_old' })
  })

  it('disables the entry with an explanation when no bundle is waiting', async () => {
    const { rpc } = createRpc({ ...discoveryHandlers, 'workspace.list': () => ({ ok: true, data: { workspaces: [{ workspaceId: 'ws_live', label: '在制' }] } }) })
    render(<ProjectPanel rpc={rpc} t={keyEcho} onActivate={() => undefined} />)
    fireEvent.click(document.querySelector('[aria-haspopup="true"]')!)
    await waitFor(() => expect($('[data-claim-entry="true"]')?.getAttribute('data-claim-count')).toBe('0'))
    expect(($('[data-claim-entry="true"]') as HTMLButtonElement).disabled).toBe(true)
    expect($('.mw-claim-entry-wrap')?.getAttribute('title')).toContain('没有待认领的 bundle')
  })

  it('opens the wizard on step 2 from the workspace-fallback notice', async () => {
    const project = { id: 'proj_new', title: '新项目', status: 'preparing', archived: false, workspaceRefs: ['ws_old'], updatedAt: '2026-11-19T00:00:00Z' }
    const { rpc, of } = createRpc({
      ...discoveryHandlers,
      'project.list': () => ({ ok: true, data: { projects: [REGISTERED, project], activeProjectId: project.id } }),
      'bundle.elements.list': (payload) =>
        payload.projectId
          ? { ok: true, data: { elements: [], ownerStates: {} } }
          : { ok: true, data: { elements: [{ elementId: 'el-1', domain: 'script', kind: 'script.scene_card', title: '场次卡', sourceOwner: 'auctra', sourceRef: 'scene:1', status: 'draft', digest: 'sha256:' + 'a'.repeat(64), updatedAt: '2026-11-19T00:00:00Z' }], ownerStates: {} } },
      'job.list': () => ({ ok: true, data: { jobs: [] } }),
      'cli.catalog': () => ({ ok: true, data: { entries: [] } }),
    })
    render(<WorkbenchMainPage rpc={rpc as never} t={(k: string) => k} coreT={keyEcho} />)
    await waitFor(() => expect($('[data-project-unclaimed="true"] [data-claim-open="true"]')).not.toBeNull())
    expect(of('bundle.status')).toHaveLength(0)

    fireEvent.click($('[data-claim-open="true"]')!)
    await waitFor(() => expect($('[data-claim-wizard="true"]')?.getAttribute('data-claim-step')).toBe('2'))
    expect($('[data-claim-project-id="proj_old_2026_bundle_a91f"]')).not.toBeNull()
    expect(of('project.claim')).toHaveLength(0)
  })
})
