import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  DramaSessionView,
  SESSION_LOG_PREFIX,
  THEATER_ROOM_STORAGE_KEY,
  TheaterPage,
  WorkspaceShell,
  appendSessionLog,
  createFallbackTranslator,
  createMuweaveRpcClient,
  getActiveTheaterRoomId,
  registerMuweaveCreatorPlugin,
  theaterSeatOwner,
  type DshClientContextLike,
  getTheaterRooms,
} from '@yeisme/dsh-muweave-core/client'
import { apply as applyWorkbench } from '@yeisme/dsh-muweave-workbench/client'
import { apply as applyEikona } from '@yeisme/dsh-muweave-eikona/client'
import { apply as applyScript } from '@yeisme/dsh-muweave-script/client'
import { apply as applyDrama } from '@yeisme/dsh-muweave-drama/client'
import { apply as applyKit } from '@yeisme/dsh-muweave-kit/client'

const t = createFallbackTranslator('zh')

const emptyRpc = createMuweaveRpcClient(async () =>
  new Response(JSON.stringify({ ok: true, generation: 1, data: { elements: [] } }), { status: 200 }),
)

/** Host registries shared by several fake plugin contexts, like one DSH client. */
function createHost() {
  const slots: string[] = []
  const rightTabs: string[] = []
  const triggers: string[] = []
  const selected: Array<string | null> = []
  const dicts = new Map<string, Record<string, string>>()
  const remove = (list: string[], id: string) => () => {
    const idx = list.indexOf(id)
    if (idx >= 0) list.splice(idx, 1)
  }
  function plugin() {
    const disposers: Array<() => void> = []
    const ctx: DshClientContextLike = {
      effect(fn) {
        const d = fn()
        if (typeof d === 'function') disposers.push(d as () => void)
      },
      slots: {
        inject(_key, cb) {
          return cb()
        },
        register(opts) {
          const id = `${String(opts.name)}:${String(opts.key ?? opts.id ?? '')}`
          slots.push(id)
          return remove(slots, id)
        },
      },
      locale: {
        register(ns, d) {
          dicts.set(ns, d.zh)
          return () => {
            dicts.delete(ns)
          }
        },
        bind: (ns) => (k) => dicts.get(ns)?.[k] ?? k,
      },
      sidebarRightTabs: {
        register(def) {
          rightTabs.push(def.id)
          return remove(rightTabs, def.id)
        },
      },
      layout: {
        selectPanel(id) {
          selected.push(id)
        },
        panelInfo: { getSnapshot: () => ({ activePanelId: 'muweave-theater' }) },
      },
      inputTriggers: {
        registerSource(src) {
          const id = `${src.trigger}:${src.name}`
          triggers.push(id)
          return remove(triggers, id)
        },
      },
    }
    const dispose = () => {
      while (disposers.length > 0) disposers.pop()?.()
    }
    return { ctx, dispose }
  }
  const count = (list: string[], id: string) => list.filter((x) => x === id).length
  return { slots, rightTabs, triggers, selected, plugin, count }
}

function registerRoom(
  ctx: DshClientContextLike,
  id: string,
  order: number,
  roomTitle: string,
  extra: Partial<Parameters<typeof registerMuweaveCreatorPlugin>[1]> = {},
) {
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: `ns-${id}`,
    dictionaries: { zh: {}, en: {} },
    pane: {
      pluginId: id,
      panelId: id,
      order,
      title: () => `${roomTitle} 全名`,
      roomTitle: () => roomTitle,
      domains: [id === 'room-drama' ? 'drama' : id],
      companionId: `${id}/companion`,
      companionTitle: () => `${roomTitle} 伴侣`,
      icon: () => null,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    },
    MainComponent: () => (
      <WorkspaceShell title={`${roomTitle} 全名`} rpc={emptyRpc} t={t} stageTabs={[]} />
    ),
    CompanionComponent: () => <div data-testid="companion">{roomTitle}</div>,
    rpc: emptyRpc,
    ...extra,
  })
}

afterEach(() => {
  cleanup()
  globalThis.localStorage?.clear()
})

describe('做剧剧场: one sidebar entry with owner handoff', () => {
  it('registers exactly one theater entry for several plugins and hands it on when the owner unloads', () => {
    const host = createHost()
    const a = host.plugin()
    const b = host.plugin()
    const c = host.plugin()
    registerRoom(a.ctx, 'room-overview', 41, '总览')
    registerRoom(b.ctx, 'room-drama', 44, '分镜生产', { sessionView: { id: 'muweave-drama', order: 20 } })
    registerRoom(c.ctx, 'room-kit', 45, '工具箱')

    const shared = [
      'sidebar.panellist:muweave-theater',
      'main:muweave-theater',
      'sidebar.right.pane.tab:muweave-theater/companion',
      'shell.overlay:muweave.floating-agent',
      'conversation.session.header.actions:muweave.theater',
    ]
    for (const id of shared) expect(host.count(host.slots, id)).toBe(1)
    expect(host.slots.filter((s) => s.startsWith('sidebar.panellist:'))).toEqual(['sidebar.panellist:muweave-theater'])
    expect(host.rightTabs).toEqual(['muweave-theater/companion'])
    expect(host.triggers).toEqual(['@:muweave-elements', '/:muweave-creator-slash'])
    expect(host.count(host.slots, 'conversation.view:muweave-drama')).toBe(1)
    expect(host.selected).toEqual([])

    // The first plugin (the seat owner) unloads: the entry stays, exactly once.
    const ownerBefore = theaterSeatOwner('theater')
    a.dispose()
    expect(theaterSeatOwner('theater')).not.toBe(ownerBefore)
    for (const id of shared) expect(host.count(host.slots, id)).toBe(1)
    expect(host.rightTabs).toEqual(['muweave-theater/companion'])
    expect(host.triggers).toEqual(['@:muweave-elements', '/:muweave-creator-slash'])

    b.dispose()
    for (const id of shared) expect(host.count(host.slots, id)).toBe(1)
    expect(host.count(host.slots, 'conversation.view:muweave-drama')).toBe(0)

    c.dispose()
    expect(host.slots).toEqual([])
    expect(host.rightTabs).toEqual([])
    expect(host.triggers).toEqual([])
    expect(theaterSeatOwner('theater')).toBeUndefined()
  })
})

describe('做剧剧场: the five real plugins', () => {
  it('collapse into one sidebar entry with six short-named rooms (workbench owns two), and only drama adds the session tab', () => {
    const host = createHost()
    const plugins = [applyWorkbench, applyEikona, applyScript, applyDrama, applyKit].map((apply) => {
      const p = host.plugin()
      apply(p.ctx)
      return p
    })
    expect(host.slots.filter((s) => s.startsWith('sidebar.panellist:'))).toEqual(['sidebar.panellist:muweave-theater'])
    expect(host.slots.filter((s) => s.startsWith('main:'))).toEqual(['main:muweave-theater'])
    expect(host.slots.filter((s) => s.startsWith('conversation.view:'))).toEqual(['conversation.view:muweave-drama'])
    expect(host.rightTabs).toEqual(['muweave-theater/companion'])
    expect(getTheaterRooms().map((r) => [r.id, r.title()])).toEqual([
      ['muweave-workbench', '总览'],
      ['muweave-eikona', '视觉'],
      ['muweave-script', '剧本'],
      ['muweave-drama', '分镜生产'],
      ['muweave-draft', '成稿'],
      ['muweave-kit', '工具箱'],
    ])
    for (const p of plugins) p.dispose()
    expect(host.slots).toEqual([])
    expect(getTheaterRooms()).toEqual([])
  })
})

describe('做剧剧场: workspace switcher', () => {
  it('opens a menu of rooms, switches by keyboard and Alt+N, closes on Escape and remembers the room', async () => {
    const host = createHost()
    const a = host.plugin()
    const b = host.plugin()
    const c = host.plugin()
    registerRoom(a.ctx, 'room-overview', 41, '总览')
    registerRoom(b.ctx, 'room-drama', 44, '分镜生产')
    registerRoom(c.ctx, 'room-kit', 45, '工具箱')

    let back = 0
    render(<TheaterPage t={t} onBackToChat={() => (back += 1)} />)

    // The switcher replaces the page title; the full room name stays as the (visually hidden) h1.
    const switcher = screen.getByRole('button', { name: /切换工作区: 总览/ })
    expect(screen.getByRole('heading', { level: 1, name: '总览 全名' })).toBeTruthy()
    expect(switcher.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(switcher)
    const menu = screen.getByRole('menu', { name: '剧场工作区' })
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('总览'),
      expect.stringContaining('分镜生产'),
      expect.stringContaining('工具箱'),
    ])
    expect(items[0]?.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(items[0])
    expect(items[1]?.textContent).toContain('Alt+2')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.click(items[1] as HTMLElement)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(getActiveTheaterRoomId()).toBe('room-drama')
    expect(globalThis.localStorage.getItem(THEATER_ROOM_STORAGE_KEY)).toBe('room-drama')
    const switcherNow = screen.getByRole('button', { name: /切换工作区: 分镜生产/ })
    expect(document.activeElement).toBe(switcherNow)

    // Escape closes and returns focus to the switcher.
    fireEvent.click(switcherNow)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(switcherNow)

    // Alt+3 jumps straight to the third room.
    act(() => {
      fireEvent.keyDown(window, { key: '3', code: 'Digit3', altKey: true })
    })
    expect(screen.getByRole('button', { name: /切换工作区: 工具箱/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '回到对话' }))
    expect(back).toBe(1)

    // The room disappears with its plugin; the theater falls back to the first remaining room.
    c.dispose()
    expect(getActiveTheaterRoomId()).toBe('room-overview')
    a.dispose()
    b.dispose()
  })
})

describe('会话「做剧」view', () => {
  it('shows an empty state with a way into the theater, then the session log once it has entries', async () => {
    let opened: unknown[] = []
    const { rerender } = render(
      <DramaSessionView rpc={emptyRpc} t={t} sessionId="s-empty" onOpenTheater={(target) => opened.push(target)} />,
    )
    expect(screen.getByText('这个会话还没碰过做剧内容。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '进入做剧剧场' }))
    expect(opened).toEqual([undefined])

    opened = []
    act(() => {
      appendSessionLog('s-1', { kind: 'mentioned', ref: 'el_shot_01|scaena|bd/1|sha256:abc', label: '第一场 / 镜 1' })
      appendSessionLog('s-1', { kind: 'handoff', ref: 'el_scene_02|auctra|sc/2|sha256:def', label: '第二场' })
    })
    expect(JSON.parse(globalThis.localStorage.getItem(`${SESSION_LOG_PREFIX}s-1`) ?? '[]')).toHaveLength(2)
    rerender(<DramaSessionView rpc={emptyRpc} t={t} sessionId="s-1" onOpenTheater={(target) => opened.push(target)} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]?.textContent).toContain('第二场')
    expect(rows[0]?.textContent).toContain('交接到对话')
    expect(rows[1]?.textContent).toContain('@ 引用')
    fireEvent.click(screen.getAllByRole('button', { name: '在剧场定位' })[1] as HTMLElement)
    expect(opened).toEqual([{ ref: 'el_shot_01|scaena|bd/1|sha256:abc' }])
    expect(screen.getByRole('group', { name: '会话做剧分区' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '本会话 2' }).getAttribute('aria-pressed')).toBe('true')
  })
})
