import { describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  FloatingAgentOverlay,
  MUWEAVE_LOCALE_NS,
  WorkspaceShell,
  createFallbackTranslator,
  createMuweaveElementAtSource,
  createMuweaveRpcClient,
  createMuweaveSlashSource,
  publishKnownElementsForTriggers,
  registerMuweaveCreatorPlugin,
  getTheaterRooms,
  stageItemToFloatingAgent,
  type DshClientContextLike,
} from '@yeisme/dsh-muweave-core/client'
import { MUWEAVE_STYLE_ATTR } from '../packages/dsh-muweave-core/src/client/styles'

describe('@yeisme/dsh-muweave-core/client dual-mode Tab/Pane, 3-state Floating Agent, triggers & ProgressStrip', () => {
  it('registers global page + rightbar dockkit tab + shell.overlay without calling selectPanel, and cleans up on hot-reload', () => {
    const slotsRegistered: string[] = []
    const rightTabsRegistered: string[] = []
    const triggersRegistered: string[] = []
    const disposers: Array<() => void> = []
    let selectPanelCalled = false

    const fakeCtx: DshClientContextLike = {
      effect(fn) {
        const d = fn()
        if (typeof d === 'function') disposers.push(d)
      },
      slots: {
        inject(_key, cb) {
          return cb()
        },
        register(opts) {
          const id = `${String(opts.name)}:${String(opts.key ?? opts.id ?? '')}`
          slotsRegistered.push(id)
          return () => {
            const idx = slotsRegistered.indexOf(id)
            if (idx >= 0) slotsRegistered.splice(idx, 1)
          }
        },
      },
      locale: {
        register() {
          return () => undefined
        },
        bind() {
          return (k) => k
        },
      },
      sidebarRightTabs: {
        register(def) {
          rightTabsRegistered.push(def.id)
          return () => {
            const idx = rightTabsRegistered.indexOf(def.id)
            if (idx >= 0) rightTabsRegistered.splice(idx, 1)
          }
        },
      },
      layout: {
        selectPanel() {
          selectPanelCalled = true
        },
        panelInfo: {
          getSnapshot: () => ({ activePanelId: 'test-panel' }),
        },
      },
      inputTriggers: {
        registerSource(src) {
          triggersRegistered.push(`${src.trigger}:${src.name}`)
          return () => {
            const idx = triggersRegistered.indexOf(`${src.trigger}:${src.name}`)
            if (idx >= 0) triggersRegistered.splice(idx, 1)
          }
        },
      },
    }

    const fakeRpc = createMuweaveRpcClient(async () =>
      new Response(JSON.stringify({ ok: true, generation: 1, data: { elements: [] } }), { status: 200 }),
    )

    registerMuweaveCreatorPlugin(fakeCtx, {
      pluginNamespace: 'testNs',
      dictionaries: { zh: { title: '测试面板' }, en: { title: 'Test Panel' } },
      pane: {
        pluginId: 'test-plugin',
        panelId: 'test-panel',
        order: 50,
        title: () => '测试面板',
        companionId: 'test-plugin/companion',
        companionTitle: () => '测试伴侣',
        icon: () => null,
        stageTabs: [],
        renderRightbarCompanion: () => null,
      },
      MainComponent: () => <div>Main</div>,
      CompanionComponent: () => <div>Companion</div>,
      rpc: fakeRpc,
    })

    expect(selectPanelCalled).toBe(false)
    // One theater entry replaces the per-plugin page; the plugin becomes a room in it.
    expect(slotsRegistered).toContain('main:muweave-theater')
    expect(slotsRegistered).toContain('sidebar.panellist:muweave-theater')
    expect(slotsRegistered).not.toContain('sidebar.panellist:test-panel')
    expect(slotsRegistered).toContain('sidebar.right.pane.tab:muweave-theater/companion')
    expect(slotsRegistered).toContain('shell.overlay:muweave.floating-agent')
    expect(slotsRegistered).toContain('conversation.session.header.actions:muweave.theater')
    expect(rightTabsRegistered).toEqual(['muweave-theater/companion'])
    expect(getTheaterRooms().map((r) => r.id)).toEqual(['test-panel'])
    expect(triggersRegistered).toEqual(['@:muweave-elements', '/:muweave-creator-slash'])
    expect(document.querySelectorAll(`style[${MUWEAVE_STYLE_ATTR}]`)).toHaveLength(1)

    // Hot-reload dispose all
    while (disposers.length > 0) {
      disposers.pop()?.()
    }
    expect(slotsRegistered).toEqual([])
    expect(getTheaterRooms()).toEqual([])
    expect(rightTabsRegistered).toEqual([])
    expect(triggersRegistered).toEqual([])
    expect(document.querySelectorAll(`style[${MUWEAVE_STYLE_ATTR}]`)).toHaveLength(0)
  })

  it('switches WorkspaceShell tabs, split compare views, and renders drama-process-timing ProgressStrip + 3-state Floating Agent', async () => {
    cleanup()
    const t = createFallbackTranslator('zh')
    const fakeRpc = createMuweaveRpcClient(async (_url, init) => {
      const req = JSON.parse(String(init?.body ?? '{}')) as { action: string }
      if (req.action === 'timing.projection') {
        return new Response(
          JSON.stringify({
            ok: true,
            generation: 2,
            data: {
              capturedAt: '2026-11-12T00:00:00Z',
              activeCount: 0,
              waitingHumanCount: 0,
              reconcileRequiredCount: 1,
              spans: [
                {
                  spanId: 'sp_1',
                  operationRef: 'op_eikona_01',
                  owner: 'eikona',
                  stageLabel: 'eikona.asset.handoff',
                  status: 'reconcile_required',
                  startedAt: '2026-11-12T00:00:00Z',
                  updatedAt: '2026-11-12T00:00:02Z',
                  elapsedMs: 2000,
                  nextAction: 'reconcile_original',
                },
              ],
            },
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ ok: true, generation: 2, data: { operation: { status: 'completed' } } }), {
        status: 200,
      })
    })

    // Registering a room claims the theater seat, which marks `muweave-theater` as a MuWeave panel
    const disposeReg = (() => {
      let d: (() => void) | undefined
      registerMuweaveCreatorPlugin(
        {
          effect(fn) {
            const r = fn()
            if (!d && typeof r === 'function') d = r
          },
          slots: { inject: (_k, cb) => cb(), register: () => () => undefined },
          locale: { register: () => () => undefined, bind: () => (k) => k },
        },
        {
          pluginNamespace: MUWEAVE_LOCALE_NS,
          dictionaries: { zh: { x: 'x' }, en: { x: 'x' } },
          pane: {
            pluginId: 'p',
            panelId: 'active-mw',
            order: 1,
            title: () => 't',
            companionId: 'p/c',
            companionTitle: () => 'c',
            icon: () => null,
            stageTabs: [],
            renderRightbarCompanion: () => null,
          },
          MainComponent: () => null,
          CompanionComponent: () => null,
          rpc: fakeRpc,
        },
      )
      return d
    })()

    render(
      <div>
        <WorkspaceShell
          title="剧本与做剧工作台"
          rpc={fakeRpc}
          t={t}
          leftTree={<div>左侧目录树</div>}
          rightInspector={<div>右侧检查器</div>}
          stageTabs={[
            {
              id: 'tab-a',
              label: () => '主视图A',
              render: ({ onPinCompare }) => (
                <div>
                  <span>内容A</span>
                  <button type="button" onClick={() => onPinCompare(<div>对比内容B</div>)}>
                    固定到对比窗
                  </button>
                </div>
              ),
            },
            {
              id: 'tab-b',
              label: () => '主视图B',
              render: () => <div>内容B</div>,
            },
          ]}
        />
        <FloatingAgentOverlay t={t} activePanelIdFallback="muweave-theater" />
      </div>,
    )

    // Desk v3: the room tree is a popover, so the stage is full width by default
    expect(screen.queryByText('左侧目录树')).toBeNull()
    expect(screen.getByText('内容A')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(t('filterPaneLabel')))
    expect(screen.getByText('左侧目录树')).toBeTruthy()
    fireEvent.keyDown(screen.getByText('左侧目录树'), { key: 'Escape' })

    // Desk v3: ⌘K lists stage views and runs the picked one
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const palette = screen.getByRole('dialog', { name: t('commandPalette') })
    expect(palette).toBeTruthy()
    expect(screen.getByRole('option', { name: /主视图A/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /主视图B/ }))
    expect(screen.queryByRole('dialog', { name: t('commandPalette') })).toBeNull()
    expect(screen.getByText('内容B')).toBeTruthy()
    fireEvent.click(screen.getByText('主视图A'))

    // Pin compare switches to horizontal split and renders secondary compare pane
    fireEvent.click(screen.getByText('固定到对比窗'))
    expect(screen.getByText('对比内容B')).toBeTruthy()

    // Floating Agent transitions: bar -> panel -> pill -> staged item reopens bar
    const agentDialog = screen.getByRole('dialog', { name: t('agentPillLabel') })
    expect(agentDialog.getAttribute('data-ready')).toBe('true')

    fireEvent.click(screen.getByLabelText(t('agentExpandPanel')))
    expect(screen.getByRole('dialog', { name: t('agentPillLabel') }).getAttribute('data-muweave-floating-agent')).toBe('panel')
    // The panel body must not repeat the input placeholder (it lives only in the input attribute):
    // it carries the keyboard hint instead.
    expect(screen.queryAllByText(t('agentBarPlaceholder'))).toHaveLength(0)
    expect(screen.getByText(t('agentPanelHint'))).toBeTruthy()

    fireEvent.click(screen.getByLabelText(t('agentMinimizePill')))
    const pillRegion = screen.getByRole('region', { name: t('agentPillLabel') })
    expect(pillRegion.getAttribute('data-ready')).toBe('true')
    expect(pillRegion.getAttribute('data-muweave-floating-agent')).toBe('pill')

    act(() => {
      stageItemToFloatingAgent({
        kind: 'element',
        ref: 'eikona-candidates-01',
        label: '女主角林雾候选组',
        serializedLine: '[MuWeaveElement id=eikona-candidates-01]',
      })
    })
    expect(screen.getByText('@女主角林雾候选组')).toBeTruthy()

    // Verify @ and / trigger sources
    publishKnownElementsForTriggers([
      {
        elementId: 'eikona-candidates-01',
        domain: 'eikona',
        kind: 'eikona.candidate_group',
        title: '林雾雨夜定妆组',
        sourceOwner: 'eikona',
        sourceRef: 'eikona://runs/r1',
        status: 'waiting_review',
        digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        updatedAt: '2026-11-12T00:00:00Z',
      },
    ])
    const atSource = createMuweaveElementAtSource()
    const atCands = await atSource.candidates({ sessionId: 's1' }, { query: '林雾', signal: new AbortController().signal })
    expect(atCands).toHaveLength(1)
    const serialized = await atSource.codec!.serialize(String(atCands[0]!.value))
    expect(serialized).toContain('MuWeaveElement id=eikona-candidates-01')

    const slashSource = createMuweaveSlashSource()
    const slashCands = await slashSource.candidates({ sessionId: 's1' }, { query: '分镜', signal: new AbortController().signal })
    expect(slashCands.length).toBeGreaterThanOrEqual(1)
    const picked = slashSource.onPick({ candidate: slashCands[0]!, position: 'inline' })
    expect(picked).toEqual({ text: ' /muweave-storyboard-breakdown ' })

    disposeReg?.()
    cleanup()
  })

  it('drops stale generations and classifies abort, HTTP, malformed, and retryable transport failures', async () => {
    const pending: Array<(response: Response) => void> = []
    const client = createMuweaveRpcClient(async () => new Promise((resolve) => pending.push(resolve)))
    const older = client.call('workspace.list', {})
    const newer = client.call('workspace.list', {})
    const newerResolver = pending[1]
    const olderResolver = pending[0]
    if (!newerResolver || !olderResolver) throw new Error('requests were not issued')
    newerResolver(Response.json({ ok: true, generation: 4, data: { workspaces: ['new'] } }))
    await expect(newer).resolves.toMatchObject({ ok: true, generation: 4 })
    olderResolver(Response.json({ ok: false, generation: 3, error: { code: 'OLD', message: 'old' } }))
    await expect(older).resolves.toMatchObject({ ok: false, generation: 4, error: { code: 'muweave/stale_generation_dropped' } })
    expect(client.generation()).toBe(4)

    const abortClient = createMuweaveRpcClient(async (_url, init) => {
      if (init?.signal?.aborted) throw new DOMException('secret abort detail', 'AbortError')
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('secret abort detail', 'AbortError'))))
    })
    const controller = new AbortController()
    const aborted = abortClient.call('workspace.list', {}, controller.signal)
    controller.abort()
    const abortResult = await aborted
    expect(abortResult.ok).toBe(false)
    if (abortResult.ok) return
    expect(abortResult.error).toMatchObject({ code: 'muweave/aborted', retryable: false })
    expect(JSON.stringify(abortResult)).not.toContain('secret')

    const httpClient = createMuweaveRpcClient(async () => new Response('provider body /tmp/private', { status: 503 }))
    await expect(httpClient.call('workspace.list')).resolves.toMatchObject({ error: { code: 'muweave/http_error', retryable: true } })
    const malformedClient = createMuweaveRpcClient(async () => Response.json({ ok: true }))
    await expect(malformedClient.call('workspace.list')).resolves.toMatchObject({ error: { code: 'muweave/malformed_envelope', retryable: false } })
    const networkClient = createMuweaveRpcClient(async () => { throw new Error('connect /tmp/private ECONNREFUSED') })
    const networkResult = await networkClient.call('workspace.list')
    expect(networkResult.ok).toBe(false)
    if (!networkResult.ok) {
      expect(networkResult.error).toMatchObject({ code: 'muweave/network_unreachable', retryable: true })
      expect(networkResult.error.message).not.toContain('/tmp/private')
    }
  })
})
