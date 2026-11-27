import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FloatingAgentOverlay,
  ShortcutsHelpModal,
  createFallbackTranslator,
  createMuweaveRpcClient,
  removeStagedItemFromFloatingAgent,
  setActiveTheaterRoom,
  stageItemToFloatingAgent,
  type MuweaveRpcClient,
} from '@yeisme/dsh-muweave-core/client'
import { registerMuweavePanelId } from '../packages/dsh-muweave-core/src/client/floating-agent'
import { registerTheaterRoom } from '../packages/dsh-muweave-core/src/client/theater/registry'
import { DramaMainPage } from '@yeisme/dsh-muweave-drama/client'
import { apply as applyKitHost, MUWEAVE_RUNTIME_SKILLS } from '@yeisme/dsh-muweave-kit'
import { KitMainPage } from '@yeisme/dsh-muweave-kit/client'
import { useState } from 'react'

afterEach(() => {
  cleanup()
  removeStagedItemFromFloatingAgent('element:shot:ep01:s01:01')
})

function createMockDramaRpc(): MuweaveRpcClient {
  const boardSummary = {
    elementId: 'el_board_ep01',
    domain: 'drama',
    kind: 'drama.storyboard_table',
    sourceOwner: 'scaena',
    sourceRef: 'breakdown:ep01',
    title: '第一集分镜表',
    status: 'ready',
    stale: false,
    digest: 'sha256:board01',
    updatedAt: '2026-11-27T00:00:00Z',
  }
  const boardDetail = {
    ...boardSummary,
    payload: {
      episodeRef: 'breakdown:ep01',
      aspectRatio: '9:16',
      rows: [
        {
          sceneRef: 'scene:ep01:s01',
          shotRef: 'shot:ep01:s01:01',
          order: 1,
          plannedDurationMicros: 3_000_000,
          cells: { visual: '雨夜街口怀表特写' },
          restrictedFields: [],
          linkedMedia: [{ role: 'keyframe', sha256: 'a'.repeat(64) }],
        },
        {
          sceneRef: 'scene:ep01:s01',
          shotRef: 'shot:ep01:s01:02',
          order: 2,
          plannedDurationMicros: 4_000_000,
          cells: { visual: '主角回头凝视霓虹招牌' },
          restrictedFields: [],
          linkedMedia: [],
        },
      ],
    },
  }
  const reviews = [
    {
      workspaceId: 'ws_demo',
      shotRef: 'shot:ep01:s01:01',
      sceneRef: 'scene:ep01:s01',
      status: 'approved',
      note: '怀表光影节奏准确',
      tags: ['光影'],
      revision: 1,
      updatedAt: '2026-11-27T00:00:00Z',
    },
    {
      workspaceId: 'ws_demo',
      shotRef: 'shot:ep01:s01:02',
      sceneRef: 'scene:ep01:s01',
      status: 'needs_revision',
      note: '补拍回头情绪特写',
      tags: ['构图'],
      revision: 1,
      updatedAt: '2026-11-27T00:00:00Z',
    },
  ]

  return createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
    if (body.action === 'bundle.elements.list') {
      const domain = body.payload?.domain
      const kind = body.payload?.kind
      const elements =
        domain === 'drama' || kind === 'drama.storyboard_table' || (!domain && !kind) ? [boardSummary] : []
      return Response.json({ ok: true, generation: 1, data: { elements, ownerStates: { scaena: 'ready' } } })
    }
    if (body.action === 'bundle.element.get') {
      return Response.json({ ok: true, generation: 1, data: { element: boardDetail } })
    }
    if (body.action === 'drama.shot.review.list') {
      return Response.json({ ok: true, generation: 1, data: { reviews } })
    }
    if (body.action === 'timing.projection') {
      return Response.json({
        ok: true,
        generation: 1,
        data: { capturedAt: '2026-11-27T00:00:00Z', activeCount: 0, waitingHumanCount: 0, reconcileRequiredCount: 0, spans: [] },
      })
    }
    return Response.json({ ok: true, generation: 1, data: {} })
  })
}

describe('MuWeave DSH v5 UX & Tri-Surface Kit Polish', () => {
  it('opens ShortcutsHelpModal via ? trigger and closes on Escape', async () => {
    const coreT = createFallbackTranslator('zh')

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <div>
          <button type="button" data-muweave-shortcuts-btn="true" onClick={() => setOpen((v) => !v)}>
            ?
          </button>
          <ShortcutsHelpModal open={open} onClose={() => setOpen(false)} t={coreT} />
        </div>
      )
    }

    render(<Harness />)
    expect(document.querySelector('[data-muweave-shortcuts-modal="true"]')).toBeNull()

    fireEvent.click(document.querySelector('[data-muweave-shortcuts-btn="true"]')!)
    await waitFor(() => {
      expect(document.querySelector('[data-muweave-shortcuts-modal="true"]')).not.toBeNull()
    })
    expect(document.querySelectorAll('[data-shortcuts-group]').length).toBe(4)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(document.querySelector('[data-muweave-shortcuts-modal="true"]')).toBeNull()
    })
  })

  it('supports FloatingAgentOverlay per-chip × removal and room-specific quick prompt chips', async () => {
    const coreT = createFallbackTranslator('zh')
    const unregisterPanel = registerMuweavePanelId('muweave-theater')
    const unregisterRoom = registerTheaterRoom({
      id: 'muweave-drama',
      order: 44,
      title: () => '分镜生产',
      description: () => '做剧分镜与生产台',
      domains: ['drama'],
      icon: () => null,
      Main: () => null,
      Companion: () => null,
    })
    try {
      setActiveTheaterRoom('muweave-drama')
      stageItemToFloatingAgent({
        kind: 'element',
        ref: 'shot:ep01:s01:01',
        label: '镜头 01',
        serializedLine: '[MuWeaveShot ref=shot:ep01:s01:01]',
      })

      render(<FloatingAgentOverlay t={coreT} activePanelIdFallback="muweave-theater" />)

      // Per-chip remove button removes the staged chip
      const removeBtn = document.querySelector('[data-remove-staged-chip="element:shot:ep01:s01:01"]') as HTMLButtonElement | null
      expect(removeBtn).not.toBeNull()
      fireEvent.click(removeBtn!)
      await waitFor(() => {
        expect(document.querySelector('[data-remove-staged-chip="element:shot:ep01:s01:01"]')).toBeNull()
      })

      // Room-specific quick chips appear for Drama and populate draft input on click
      const quickBar = document.querySelector('[data-float-quick-chips="true"]')
      expect(quickBar).not.toBeNull()
      expect(quickBar?.getAttribute('data-active-room')).toBe('muweave-drama')
      const firstQuickChip = quickBar?.querySelector('button[data-quick-chip]') as HTMLButtonElement | null
      expect(firstQuickChip).not.toBeNull()
      fireEvent.click(firstQuickChip!)

      const input = document.querySelector('[data-muweave-floating-agent] input, [data-muweave-floating-agent] textarea') as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null
      expect(input?.value.trim().length).toBeGreaterThan(0)
    } finally {
      unregisterRoom()
      unregisterPanel()
    }
  })

  it('supports Drama storyboard search, ShotInspector filmstrip jump, and Timeline Markdown review copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const rpc = createMockDramaRpc()
    const coreT = createFallbackTranslator('zh')
    const t = (k: string) => k

    render(<DramaMainPage rpc={rpc} t={t} coreT={coreT} />)

    await waitFor(() => {
      expect(screen.getByText('shot:ep01:s01:01')).toBeTruthy()
      expect(screen.getByText('shot:ep01:s01:02')).toBeTruthy()
    })

    // 1. Storyboard keyword search filters by director review note / cell text
    const searchInput = document.querySelector('[data-drama-shot-search="true"]') as HTMLInputElement | null
    expect(searchInput).not.toBeNull()
    fireEvent.change(searchInput!, { target: { value: '补拍回头' } })
    await waitFor(() => {
      expect(screen.queryByText('shot:ep01:s01:01')).toBeNull()
      expect(screen.getByText('shot:ep01:s01:02')).toBeTruthy()
    })
    fireEvent.change(searchInput!, { target: { value: '' } })
    await waitFor(() => {
      expect(screen.getByText('shot:ep01:s01:01')).toBeTruthy()
    })

    // 2. Open ShotInspector and jump directly via bottom filmstrip
    const inspectBtn = screen.getByRole('button', { name: 'inspectShot shot:ep01:s01:01' })
    fireEvent.click(inspectBtn)
    await waitFor(() => {
      expect(document.querySelector('[data-inspector-filmstrip="true"]')).not.toBeNull()
    })
    const jumpShot2 = document.querySelector('[data-filmstrip-shot="shot:ep01:s01:02"]') as HTMLButtonElement | null
    expect(jumpShot2).not.toBeNull()
    fireEvent.click(jumpShot2!)
    await waitFor(() => {
      expect(document.querySelector('[data-filmstrip-shot="shot:ep01:s01:02"]')?.getAttribute('aria-current')).toBe('true')
    })

    // 3. Switch to Timeline tab and copy Markdown review summary
    const timelineTab = screen.getByRole('tab', { name: 'tabTimeline' })
    fireEvent.click(timelineTab)
    const copyMdBtn = await waitFor(() => {
      const btn = document.querySelector('[data-drama-copy-review-md="true"]') as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      return btn!
    })
    fireEvent.click(copyMdBtn)
    await waitFor(() => {
      expect(document.querySelector('[data-drama-md-copied="true"]')).not.toBeNull()
    })
    expect(writeText).toHaveBeenCalled()
    const copiedMd = String(writeText.mock.calls.at(-1)?.[0] ?? '')
    expect(copiedMd).toContain('shot:ep01:s01:01')
    expect(copiedMd).not.toMatch(/\/Users\/|\/home\//)
  })

  it('renders Kit CLI & MCP Config card with 3 modes, copy receipt, zero host paths, and registers v5 Kit agent tools', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const rpc = createMuweaveRpcClient(async () => Response.json({ ok: true, generation: 1, data: {} }))
    const coreT = createFallbackTranslator('zh')
    render(<KitMainPage rpc={rpc} t={(k) => k} coreT={coreT} />)

    fireEvent.click(screen.getByRole('tab', { name: 'tabCli' }))
    await waitFor(() => {
      expect(document.querySelector('[data-kit-mcp-card="true"]')).not.toBeNull()
    })

    // Verify stdio -> remote-http -> proxy mode switching and zero host paths
    const checkSnippet = (mode: string, expectedSubstr: string) => {
      const pre = document.querySelector(`[data-kit-mcp-snippet="${mode}"]`)
      expect(pre).not.toBeNull()
      const text = pre?.textContent ?? ''
      expect(text).toContain(expectedSubstr)
      expect(text).not.toMatch(/\/Users\/|\/home\/|sk-/)
    }

    checkSnippet('stdio', '${workspaceFolder}')

    fireEvent.click(document.querySelector('[data-mcp-mode="remote-http"]')!)
    checkSnippet('remote-http', 'Bearer <your-mcp-token>')

    fireEvent.click(document.querySelector('[data-mcp-mode="proxy"]')!)
    checkSnippet('proxy', 'http://127.0.0.1:3741')

    await act(async () => {
      fireEvent.click(document.querySelector('[data-kit-copy-mcp="true"]')!)
    })
    await waitFor(() => {
      expect(document.querySelector('[data-kit-mcp-copied="true"]')).not.toBeNull()
    })
    expect(writeText).toHaveBeenCalled()

    // Verify v5 Kit agent tools and runtime skill registration (never exposing approve)
    const registeredSkills: string[] = []
    const registeredTools: string[] = []
    applyKitHost(
      {
        effect(fn) {
          fn()
        },
        inject(deps, cb) {
          if (deps.includes('skills')) {
            cb({
              effect(fn: () => void) {
                fn()
              },
              skills: {
                register(def: { name: string }) {
                  registeredSkills.push(def.name)
                  return () => undefined
                },
              },
            })
          }
          if (deps.includes('tools')) {
            cb({
              effect(fn: () => void) {
                fn()
              },
              tools: {
                register(def: { name: string }) {
                  registeredTools.push(def.name)
                  return () => undefined
                },
              },
            })
          }
        },
      },
      { role: 'agent' },
    )

    expect(registeredSkills).toContain('muweave-cli-mcp-assist')
    expect(MUWEAVE_RUNTIME_SKILLS.some((s) => s.name === 'muweave-cli-mcp-assist')).toBe(true)
    expect(registeredTools).toEqual(
      expect.arrayContaining([
        'muweave_drama_shots_list',
        'muweave_drama_review_set',
        'muweave_drama_export',
        'muweave_project_diagnose',
      ]),
    )
    expect(registeredTools.some((n) => /approve/i.test(n))).toBe(false)
  })
})
