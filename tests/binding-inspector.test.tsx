import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMuweaveRpcClient, type MuweaveElementSummaryV1, type MuweaveTranslator } from '@yeisme/dsh-muweave-core/client'
import { WorkbenchMainPage } from '@yeisme/dsh-muweave-workbench/client'
import { BindingInspector } from '../packages/dsh-muweave-workbench/src/binding-inspector'
import { ProjectPanel } from '../packages/dsh-muweave-workbench/src/project-panel'
import { UNLABELED_GROUP, elementGroupKey, groupElements } from '../packages/dsh-muweave-workbench/src/stage-map'

// docs/design/project-features-next.md F1: the binding inspector and the four derived element groups.

const el = (id: string, extra: Partial<MuweaveElementSummaryV1>): MuweaveElementSummaryV1 => ({
  elementId: id,
  domain: 'script',
  kind: 'script.scene_card',
  title: id,
  sourceOwner: 'auctra',
  sourceRef: 'ref:' + id,
  status: 'draft',
  digest: `sha256:${'a'.repeat(64)}`,
  updatedAt: '2026-11-19T00:00:00Z',
  ...extra,
})

const ELEMENTS: MuweaveElementSummaryV1[] = [
  el('e1', { sceneRef: 'scene:10', characterRefs: ['char:lin', 'char:zhou'], status: 'ready' }),
  el('e2', { sourceRef: 'scene:02#context', status: 'draft' }),
  el('e3', { domain: 'eikona', kind: 'eikona.candidate_group', sourceOwner: 'eikona', sourceRef: 'eikona://runs/r1', characterRefs: ['char:lin'], status: 'ready' }),
  el('e4', { domain: 'drama', kind: 'drama.storyboard_table', sourceOwner: 'scaena', sourceRef: 'shot:ep01:s01:01', status: '' }),
  el('e5', { sceneRef: 'scene:2', characterRefs: [], kind: '' as MuweaveElementSummaryV1['kind'] }),
]

const shape = (by: Parameters<typeof groupElements>[1]) => groupElements(ELEMENTS, by).map((g) => [g.key, g.rows.map((r) => r.elementId)])

describe('F1 derived grouping (pure)', () => {
  it('groups by scene from sceneRef, then an explicit scene: segment of sourceRef; a shot ref is not parsed', () => {
    expect(shape('scene')).toEqual([
      ['scene:02', ['e2']],
      ['scene:2', ['e5']],
      ['scene:10', ['e1']],
      [UNLABELED_GROUP, ['e3', 'e4']],
    ])
  })

  it('groups by the first character ref only, so a row is never counted twice', () => {
    expect(shape('character')).toEqual([
      ['char:lin', ['e1', 'e3']],
      [UNLABELED_GROUP, ['e2', 'e4', 'e5']],
    ])
    expect(groupElements(ELEMENTS, 'character').reduce((n, g) => n + g.rows.length, 0)).toBe(ELEMENTS.length)
  })

  it('groups by status; an empty status is unlabeled', () => {
    expect(shape('status')).toEqual([
      ['draft', ['e2', 'e5']],
      ['ready', ['e1', 'e3']],
      [UNLABELED_GROUP, ['e4']],
    ])
  })

  it('groups by kind prefix with reader labels; an empty kind is unlabeled', () => {
    const groups = groupElements(ELEMENTS, 'media')
    expect(groups.map((g) => [g.key, g.label, g.rows.map((r) => r.elementId)])).toEqual([
      ['drama', 'Scaena 分镜', ['e4']],
      ['eikona', 'Eikona 视觉', ['e3']],
      ['script', 'Auctra 剧本', ['e1', 'e2']],
      [UNLABELED_GROUP, UNLABELED_GROUP, ['e5']],
    ])
  })

  it('never invents a key and tolerates junk input', () => {
    expect(elementGroupKey(el('x', { sourceRef: 'shot:ep01:s01:01' }), 'scene')).toBeUndefined()
    expect(elementGroupKey(el('x', { title: '林：独白' }), 'character')).toBeUndefined()
    expect(groupElements(undefined as unknown as MuweaveElementSummaryV1[], 'status')).toEqual([])
    expect(groupElements([null as unknown as MuweaveElementSummaryV1], 'status')).toEqual([])
  })
})

type Reply = { ok: true; data: unknown } | { ok: false; code?: string }
type Handler = (payload: Record<string, unknown>) => Reply

function createRpc(handlers: Record<string, Handler>, log: string[]) {
  return createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
    log.push(body.action)
    const handler = handlers[body.action]
    const reply = handler ? handler(body.payload ?? {}) : ({ ok: true, data: {} } as Reply)
    return Response.json(
      reply.ok
        ? { ok: true, generation: 1, data: reply.data }
        : { ok: false, generation: 1, error: { code: reply.code ?? 'muweave/test_failure', message: 'failed' } },
    )
  })
}

const keyEcho = ((key: string) => key) as unknown as MuweaveTranslator

beforeEach(() => {
  cleanup()
  globalThis.localStorage?.clear()
})

describe('F1 group switch is view-only', () => {
  it('switching through every grouping issues no RPC at all', async () => {
    const log: string[] = []
    const rpc = createRpc({ 'bundle.elements.list': () => ({ ok: true, data: { elements: ELEMENTS, ownerStates: {} } }) }, log)
    render(<WorkbenchMainPage rpc={rpc} t={(k) => k} coreT={keyEcho} />)
    fireEvent.click(await screen.findByRole('button', { name: 'viewAll' }))
    const bar = await screen.findByRole('group', { name: 'groupLabel' })
    await waitFor(() => expect(screen.getAllByText('e1').length).toBeGreaterThan(0))
    // Let the mount-time reads settle before counting.
    await new Promise((r) => setTimeout(r, 50))
    const before = log.length

    for (const [label, by, firstKey] of [
      ['groupScene', 'scene', 'scene:02'],
      ['groupCharacter', 'character', 'char:lin'],
      ['groupStatus', 'status', 'draft'],
      ['groupMedia', 'media', 'drama'],
    ] as const) {
      fireEvent.click(within(bar).getByRole('button', { name: label }))
      const list = document.querySelector(`[data-element-group-by="${by}"]`)
      expect(list).not.toBeNull()
      const groups = [...list!.querySelectorAll('[data-element-group]')].map((n) => n.getAttribute('data-element-group'))
      expect(groups[0]).toBe(firstKey)
      if (by !== 'character') expect(groups.at(-1)).toBe(UNLABELED_GROUP)
    }
    fireEvent.click(within(bar).getByRole('button', { name: 'groupNone' }))
    expect(document.querySelector('[data-element-group-by]')).toBeNull()

    await new Promise((r) => setTimeout(r, 50))
    expect(log.slice(before)).toEqual([])
  })
})

const PROJECT = {
  id: 'proj_a',
  title: '项目 A',
  status: 'in_production',
  archived: false,
  workspaceRefs: ['ws_one'],
  updatedAt: '2026-11-19T00:00:00Z',
  ownerBindings: [
    { workspaceId: 'ws_one', owner: 'eikona', refs: ['run_0001', 'run_0002'], bindingState: 'bound', updatedAt: '2026-11-19T01:00:00Z' },
    { workspaceId: 'ws_one', owner: 'auctra', refs: ['scene:01'], bindingState: 'conflict', updatedAt: '2026-11-19T02:00:00Z' },
  ],
}

describe('F1 binding inspector', () => {
  it('shows the empty state when the project has no owner binding', () => {
    const log: string[] = []
    render(<BindingInspector rpc={createRpc({}, log)} project={{ id: 'p', ownerBindings: undefined }} onChanged={() => undefined} />)
    const root = document.querySelector('[data-binding-inspector="true"]')
    expect(root).not.toBeNull()
    expect(root!.textContent).toContain('这个项目还没有绑定 owner')
    expect(root!.querySelectorAll('[data-binding-row]')).toHaveLength(0)
    expect(log).toEqual([])
  })

  it('renders one row per binding with workspace, owner, refs and state', () => {
    render(<BindingInspector rpc={createRpc({}, [])} project={PROJECT} onChanged={() => undefined} />)
    const rows = [...document.querySelectorAll('[data-binding-row]')]
    expect(rows.map((r) => r.getAttribute('data-binding-owner'))).toEqual(['eikona', 'auctra'])
    expect(rows[0]!.textContent).toContain('ws_one')
    expect(rows[0]!.textContent).toContain('run_0002')
    expect(rows[0]!.querySelector('[data-binding-state="bound"]')?.getAttribute('data-tone')).toBe('ok')
    expect(rows[1]!.querySelector('[data-binding-state="conflict"]')?.getAttribute('data-tone')).toBe('bad')
  })

  it('replaces one ref through a single project.bind carrying the full swapped list', async () => {
    const log: string[] = []
    const sent: Record<string, unknown>[] = []
    let changed = 0
    const rpc = createRpc({ 'project.bind': (p) => (sent.push(p), { ok: true, data: { project: PROJECT } }) }, log)
    render(<BindingInspector rpc={rpc} project={PROJECT} onChanged={() => void (changed += 1)} />)
    const row = document.querySelector('[data-binding-owner="eikona"]') as HTMLElement
    fireEvent.click(within(row).getAllByRole('button', { name: '替换' })[0]!)
    fireEvent.change(within(row).getByRole('textbox', { name: '替换 run_0001' }), { target: { value: 'run_0009' } })
    fireEvent.click(within(row).getByRole('button', { name: '确认替换' }))
    await waitFor(() => expect(changed).toBe(1))
    expect(log).toEqual(['project.bind'])
    expect(sent[0]).toMatchObject({ projectId: 'proj_a', workspaceId: 'ws_one', owner: 'eikona', refs: ['run_0009', 'run_0002'] })
    expect(String(sent[0]!.idempotencyKey)).not.toBe('')
  })

  it('asks before unbinding, then calls project.unbind once and nothing else', async () => {
    const log: string[] = []
    const rpc = createRpc({ 'project.unbind': () => ({ ok: true, data: { project: PROJECT, removed: true } }) }, log)
    render(<BindingInspector rpc={rpc} project={PROJECT} onChanged={() => undefined} />)
    const row = document.querySelector('[data-binding-owner="auctra"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '解绑' }))
    expect(log).toEqual([])
    expect(row.textContent).toContain('不会删除 owner 原件')
    fireEvent.click(within(row).getByRole('button', { name: '确认解绑' }))
    await waitFor(() => expect(log).toEqual(['project.unbind']))
  })

  it('keeps the draft and offers a re-read on a revision conflict', async () => {
    const log: string[] = []
    const rpc = createRpc({ 'project.bind': () => ({ ok: false, code: 'muweave/revision_conflict' }) }, log)
    render(<BindingInspector rpc={rpc} project={PROJECT} onChanged={() => undefined} />)
    const row = document.querySelector('[data-binding-owner="auctra"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '替换' }))
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'scene:02' } })
    fireEvent.click(within(row).getByRole('button', { name: '确认替换' }))
    expect(await screen.findByRole('button', { name: '重新读取并重试' })).toBeTruthy()
    expect((within(row).getByRole('textbox') as HTMLInputElement).value).toBe('scene:02')
  })

  it('appears in the project popover for the selected project', async () => {
    const log: string[] = []
    const rpc = createRpc(
      {
        'project.list': () => ({ ok: true, data: { projects: [PROJECT], activeProjectId: PROJECT.id } }),
        'workspace.list': () => ({ ok: true, data: { workspaces: [] } }),
        'bundle.elements.list': () => ({ ok: true, data: {} }),
      },
      log,
    )
    render(<ProjectPanel rpc={rpc} t={keyEcho} activeProjectId={PROJECT.id} onActivate={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: /项目 A/ }))
    await waitFor(() => expect(document.querySelectorAll('[data-binding-row]')).toHaveLength(2))
  })
})
