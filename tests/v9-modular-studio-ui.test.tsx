import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ModuleManagerPage,
  createFallbackTranslator,
  createMuweaveRpcClient,
  getModuleLayoutState,
  resetModuleLayout,
  type MuweaveRpcClient,
} from '@yeisme/dsh-muweave-core/client'
import { getTheaterRooms, registerTheaterRoom } from '../packages/dsh-muweave-core/src/client/theater/registry'
import { getFloatingAgentSnapshot } from '../packages/dsh-muweave-core/src/client/floating-agent'
import { CanvasMainPage } from '../packages/dsh-muweave-canvas/src/client'
import { Stage3dMainPage } from '../packages/dsh-muweave-stage3d/src/client'
import {
  createDefaultStage3dScene,
  detectStageAxisCrossing,
} from '../packages/dsh-muweave-stage3d/src/projection3d'
import { AudioMainPage } from '../packages/dsh-muweave-audio/src/client'
import { AssetsMainPage } from '../packages/dsh-muweave-assets/src/client'

afterEach(() => {
  cleanup()
  resetModuleLayout()
})

interface RpcLog {
  action: string
  payload: Record<string, unknown>
}

describe('MuWeave DSH v9 Modular Studio UI (Module Manager, Canvas, Stage3D, Audio, Assets)', () => {
  it('supports ModuleManagerPage presets, pin/unpin, reorder, and reset', async () => {
    const unsubs = [
      registerTheaterRoom({ id: 'muweave-workbench', order: 41, group: 'core', title: () => '总览', description: () => '总览', domains: [], icon: () => null, Main: () => null, Companion: () => null }),
      registerTheaterRoom({ id: 'muweave-drama', order: 44, group: 'core', title: () => '分镜', description: () => '分镜', domains: ['drama'], icon: () => null, Main: () => null, Companion: () => null }),
      registerTheaterRoom({ id: 'muweave-canvas', order: 44.6, group: 'studio', title: () => '画布', description: () => '画布', domains: [], icon: () => null, Main: () => null, Companion: () => null }),
      registerTheaterRoom({ id: 'muweave-stage3d', order: 44.7, group: 'studio', title: () => '3D导演台', description: () => '3D', domains: [], icon: () => null, Main: () => null, Companion: () => null }),
      registerTheaterRoom({ id: 'muweave-kit', order: 45, group: 'ops', title: () => '工具箱', description: () => '工具箱', domains: [], icon: () => null, Main: () => null, Companion: () => null }),
    ]
    try {
      const rpc = createMuweaveRpcClient(async () => Response.json({ ok: true, generation: 1, data: {} }))
      render(<ModuleManagerPage rpc={rpc} t={createFallbackTranslator('zh')} rooms={getTheaterRooms()} />)

      expect(document.querySelector('[data-muweave-module-manager="true"]')).not.toBeNull()

      // Switch preset to full_studio
      fireEvent.click(document.querySelector('[data-module-preset="full_studio"]')!)
      expect(getModuleLayoutState().preset).toBe('full_studio')

      // Unpin muweave-canvas
      const pinBtn = document.querySelector('[data-module-pin="muweave-canvas"]') as HTMLButtonElement | null
      expect(pinBtn).not.toBeNull()
      fireEvent.click(pinBtn!)
      expect(getModuleLayoutState().pinnedRoomIds).not.toContain('muweave-canvas')

      // Reorder muweave-stage3d up
      const upBtn = document.querySelector('[data-module-up="muweave-stage3d"]') as HTMLButtonElement | null
      if (upBtn && !upBtn.disabled) {
        fireEvent.click(upBtn)
      }

      // Reset to default
      fireEvent.click(document.querySelector('[data-module-reset="true"]')!)
      expect(getModuleLayoutState().preset).toBe('default')
    } finally {
      for (const u of unsubs) u()
    }
  })

  it('supports Canvas auto-layout, adding a note, saving board, and Mermaid outline export', async () => {
    const calls: RpcLog[] = []
    const rpc: MuweaveRpcClient = createMuweaveRpcClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
      calls.push({ action: body.action, payload: body.payload ?? {} })

      if (body.action === 'bundle.elements.list') {
        return Response.json({
          ok: true,
          generation: 1,
          data: {
            elements: [
              {
                elementId: 'el_sc_01',
                domain: 'script',
                kind: 'script.scene_card',
                sourceOwner: 'auctra',
                sourceRef: 'scene:ep01:s01',
                title: '雨夜街口',
                status: 'ready',
                stale: false,
                digest: 'sha256:sc01',
                updatedAt: '2026-11-28T00:00:00Z',
              },
            ],
          },
        })
      }
      if (body.action === 'canvas.board.get') {
        return Response.json({
          ok: true,
          generation: 1,
          data: { board: { schema: 'muweave.canvas-board.v1', workspaceId: 'ws', nodes: [], edges: [], revision: '1', updatedAt: '2026-11-28T00:00:00Z' } },
        })
      }
      if (body.action === 'canvas.board.save') {
        return Response.json({
          ok: true,
          generation: 2,
          data: { board: { ...(body.payload ?? {}), revision: '2', updatedAt: '2026-11-28T00:00:00Z' } },
        })
      }
      return Response.json({ ok: true, generation: 1, data: {} })
    })

    render(<CanvasMainPage rpc={rpc} t={(k) => k} coreT={createFallbackTranslator('zh')} />)

    await waitFor(() => {
      expect(document.querySelector('[data-canvas-board="true"]')).not.toBeNull()
    })

    fireEvent.click(document.querySelector('[data-canvas-autolayout="true"]')!)
    fireEvent.click(document.querySelector('[data-canvas-add-note="true"]')!)
    await act(async () => {
      fireEvent.click(document.querySelector('[data-canvas-save="true"]')!)
    })
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'canvas.board.save')).toBe(true)
    })

    // Switch to outline tab and export Mermaid
    fireEvent.click(screen.getByRole('tab', { name: 'tabOutline' }))
    const mermaidBtn = await waitFor(() => {
      const btn = document.querySelector('[data-canvas-mermaid="true"]') as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      return btn!
    })
    fireEvent.click(mermaidBtn)
    await waitFor(() => {
      expect(document.querySelector('[data-canvas-mermaid-output="true"]')?.textContent).toContain('flowchart')
    })
  })

  it('supports Stage3D presets, 180-degree axis-crossing detection, prompt compilation, save, and greybox snapshot bind', async () => {
    // Pure 180° axis-crossing math check (actors sit near z=-0.65; z=+4 vs z=-5 crosses the 180° line)
    const baseScene = createDefaultStage3dScene('shot:ep01:s01:01')
    const prevScene = {
      ...baseScene,
      camera: { ...baseScene.camera, x: 0, y: 1.6, z: 4 },
    }
    const crossedScene = {
      ...baseScene,
      shotRef: 'shot:ep01:s01:02',
      camera: { ...baseScene.camera, x: 0, y: 1.6, z: -5 },
    }
    expect(detectStageAxisCrossing(prevScene, crossedScene).crossed).toBe(true)

    const calls: RpcLog[] = []
    const rpc: MuweaveRpcClient = createMuweaveRpcClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
      calls.push({ action: body.action, payload: body.payload ?? {} })

      if (body.action === 'bundle.elements.list') {
        return Response.json({
          ok: true,
          generation: 1,
          data: {
            elements: [
              {
                elementId: 'el_sb_01',
                domain: 'drama',
                kind: 'drama.storyboard_table',
                sourceOwner: 'scaena',
                sourceRef: 'breakdown:ep01',
                title: '第 1 集分镜',
                status: 'ready',
                stale: false,
                digest: 'sha256:sb01',
                updatedAt: '2026-11-28T00:00:00Z',
              },
            ],
          },
        })
      }
      if (body.action === 'bundle.element.get') {
        return Response.json({
          ok: true,
          generation: 1,
          data: {
            element: {
              elementId: 'el_sb_01',
              payload: {
                episodeRef: 'episode:01',
                rows: [{ shotRef: 'shot:ep01:s01:01', sceneRef: 'scene:ep01:s01', order: 1, plannedDurationMicros: 3_000_000, cells: {}, restrictedFields: [], linkedMedia: [] }],
              },
            },
          },
        })
      }
      if (body.action === 'stage3d.scene.save') {
        return Response.json({ ok: true, generation: 2, data: { scenes: { revision: '2', scenes: {} } } })
      }
      if (body.action === 'stage3d.snapshot.save') {
        return Response.json({
          ok: true,
          generation: 3,
          data: { sha256: 'a'.repeat(64), mime: 'image/png', bytes: 120, boundShotRef: 'shot:ep01:s01:01' },
        })
      }
      return Response.json({ ok: true, generation: 1, data: {} })
    })

    render(<Stage3dMainPage rpc={rpc} t={(k) => k} coreT={createFallbackTranslator('zh')} />)

    await waitFor(() => {
      expect(document.querySelector('[data-stage3d-monitor="true"]')).not.toBeNull()
      expect(document.querySelector('[data-stage3d-floorplan="true"]')).not.toBeNull()
    })

    fireEvent.click(document.querySelector('[data-stage3d-preset="hero_low"]')!)
    expect(document.querySelector('[data-stage3d-prompt="true"]')?.textContent?.trim().length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(document.querySelector('[data-stage3d-save="true"]')!)
    })
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'stage3d.scene.save')).toBe(true)
    })

    await act(async () => {
      fireEvent.click(document.querySelector('[data-stage3d-snapshot-bind="true"]')!)
    })
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'stage3d.snapshot.save')).toBe(true)
      expect(document.querySelector('[data-stage3d-snapshot-receipt="true"]')).not.toBeNull()
    })
  })

  it('supports Audio Mixer mute/solo/save and Dialogue Cues lip-sync warning + SRT export', async () => {
    const calls: RpcLog[] = []
    const rpc: MuweaveRpcClient = createMuweaveRpcClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
      calls.push({ action: body.action, payload: body.payload ?? {} })

      if (body.action === 'bundle.elements.list') {
        return Response.json({
          ok: true,
          generation: 1,
          data: {
            elements: [
              {
                elementId: 'el_sb_audio',
                domain: 'drama',
                kind: 'drama.storyboard_table',
                sourceOwner: 'scaena',
                sourceRef: 'breakdown:ep01',
                title: '第 1 集分镜',
                status: 'ready',
                stale: false,
                digest: 'sha256:sba',
                updatedAt: '2026-11-28T00:00:00Z',
              },
            ],
          },
        })
      }
      if (body.action === 'bundle.element.get') {
        return Response.json({
          ok: true,
          generation: 1,
          data: {
            element: {
              elementId: 'el_sb_audio',
              payload: {
                episodeRef: 'episode:01',
                rows: [
                  {
                    shotRef: 'shot:ep01:s01:01',
                    sceneRef: 'scene:ep01:s01',
                    order: 1,
                    plannedDurationMicros: 9_500_000,
                    cells: { dialogue: '这枚怀表停在三年前的雨夜。' },
                    restrictedFields: [],
                    linkedMedia: [{ role: 'voice', sha256: 'c'.repeat(64) }],
                  },
                ],
              },
            },
          },
        })
      }
      if (body.action === 'audio.mix.save') {
        return Response.json({ ok: true, generation: 2, data: { mix: { revision: '2' } } })
      }
      if (body.action === 'drama.export.manifest') {
        return Response.json({ ok: true, generation: 2, data: { filename: 'episode-01.srt' } })
      }
      return Response.json({ ok: true, generation: 1, data: {} })
    })

    render(<AudioMainPage rpc={rpc} t={(k) => k} coreT={createFallbackTranslator('zh')} />)

    await waitFor(() => {
      expect(document.querySelector('[data-audio-mixer="true"]')).not.toBeNull()
    })

    fireEvent.click(document.querySelector('[data-audio-mute="voice"]')!)
    fireEvent.click(document.querySelector('[data-audio-solo="music"]')!)
    await act(async () => {
      fireEvent.click(document.querySelector('[data-audio-save="true"]')!)
    })
    await waitFor(() => {
      const saveCall = calls.find((c) => c.action === 'audio.mix.save')
      expect(saveCall).toBeDefined()
      expect((saveCall?.payload.tracks as Record<string, { muted: boolean }>).voice.muted).toBe(true)
      expect(document.querySelector('[data-audio-receipt="true"]')).not.toBeNull()
    })

    // Switch to cues tab -> >8s lip-sync drift badge & SRT quick export
    fireEvent.click(screen.getByRole('tab', { name: 'tabCues' }))
    await waitFor(() => {
      expect(document.querySelector('[data-audio-cues="true"]')).not.toBeNull()
      expect(document.querySelector('[data-audio-lipsync-warn="true"]')).not.toBeNull()
    })
    await act(async () => {
      fireEvent.click(document.querySelector('[data-audio-export-srt="true"]')!)
    })
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'drama.export.manifest' && c.payload.format === 'srt_subtitles')).toBe(true)
    })
  })

  it('supports Asset Vault catalog filtering, bind-to-shot, @ staging, and bidirectional usage matrix', async () => {
    const calls: RpcLog[] = []
    const rpc: MuweaveRpcClient = createMuweaveRpcClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
      calls.push({ action: body.action, payload: body.payload ?? {} })

      if (body.action === 'bundle.elements.list') {
        return Response.json({
          ok: true,
          generation: 1,
          data: {
            elements: [
              {
                elementId: 'el_char_linwu',
                domain: 'eikona',
                kind: 'eikona.character_master',
                sourceOwner: 'eikona',
                sourceRef: 'char:linwu',
                title: '林雾定妆母版',
                status: 'ready',
                stale: false,
                digest: 'sha256:char1',
                updatedAt: '2026-11-28T00:00:00Z',
              },
              {
                elementId: 'el_sb_vault',
                domain: 'drama',
                kind: 'drama.storyboard_table',
                sourceOwner: 'scaena',
                sourceRef: 'breakdown:ep01',
                title: '第 1 集分镜',
                status: 'ready',
                stale: false,
                digest: 'sha256:sbv',
                updatedAt: '2026-11-28T00:00:00Z',
              },
            ],
          },
        })
      }
      if (body.action === 'bundle.element.get') {
        return Response.json({
          ok: true,
          generation: 1,
          data: {
            element: {
              elementId: 'el_sb_vault',
              payload: {
                rows: [{ shotRef: 'shot:ep01:s01:01', sceneRef: 'scene:ep01:s01', order: 1, plannedDurationMicros: 3_000_000, linkedMedia: [] }],
              },
            },
          },
        })
      }
      if (body.action === 'project.bible.get') {
        return Response.json({
          ok: true,
          generation: 1,
          data: { bible: { characterAnchors: [{ name: '陆沉', wardrobe: '黑大衣', immutableTraits: '怀表' }] } },
        })
      }
      if (body.action === 'eikona.asset.bind') {
        return Response.json({ ok: true, generation: 2, data: { bound: true } })
      }
      return Response.json({ ok: true, generation: 1, data: {} })
    })

    render(<AssetsMainPage rpc={rpc} t={(k) => k} coreT={createFallbackTranslator('zh')} />)

    await waitFor(() => {
      expect(document.querySelector('[data-assets-catalog="true"]')).not.toBeNull()
      expect(document.querySelector('[data-asset-card="el_char_linwu"]')).not.toBeNull()
    })

    fireEvent.click(document.querySelector('[data-assets-cat="character"]')!)
    expect(document.querySelector('[data-asset-card="el_char_linwu"]')).not.toBeNull()

    await act(async () => {
      fireEvent.click(document.querySelector('[data-asset-bind-btn="el_char_linwu"]')!)
    })
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'eikona.asset.bind')).toBe(true)
    })

    fireEvent.click(document.querySelector('[data-asset-stage-btn="el_char_linwu"]')!)
    expect(getFloatingAgentSnapshot().staged.some((s) => s.ref === 'el_char_linwu')).toBe(true)

    // Switch to Usage Matrix tab
    fireEvent.click(screen.getByRole('tab', { name: 'tabUsage' }))
    await waitFor(() => {
      expect(document.querySelector('[data-assets-usage="true"]')).not.toBeNull()
      expect(document.querySelector('[data-asset-unused="true"]')).not.toBeNull()
      expect(document.querySelector('[data-shot-missing="true"]')).not.toBeNull()
    })
  })
})
