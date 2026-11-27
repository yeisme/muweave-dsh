import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFallbackTranslator,
  createMuweaveRpcClient,
  type MuweaveRpcClient,
} from '@yeisme/dsh-muweave-core/client'
import { DramaMainPage } from '@yeisme/dsh-muweave-drama/client'
import { ScriptMainPage } from '@yeisme/dsh-muweave-script/client'
import { KitMainPage } from '@yeisme/dsh-muweave-kit/client'

afterEach(() => {
  cleanup()
})

interface RpcCallLog {
  action: string
  payload: Record<string, unknown>
}

function createV7DramaRpc() {
  const calls: RpcCallLog[] = []
  let cutOverride: Record<string, unknown> | null = null
  let cutRevision = 0

  const ep1Summary = {
    elementId: 'el_board_ep01',
    domain: 'drama',
    kind: 'drama.storyboard_table',
    sourceOwner: 'scaena',
    sourceRef: 'breakdown:ep01',
    episodeRef: 'episode:01',
    title: '第 1 集分镜表',
    status: 'ready',
    stale: false,
    digest: 'sha256:board01',
    updatedAt: '2026-11-27T00:00:00Z',
  }
  const ep2Summary = {
    elementId: 'el_board_ep02',
    domain: 'drama',
    kind: 'drama.storyboard_table',
    sourceOwner: 'scaena',
    sourceRef: 'breakdown:ep02',
    episodeRef: 'episode:02',
    title: '第 2 集分镜表',
    status: 'ready',
    stale: false,
    digest: 'sha256:board02',
    updatedAt: '2026-11-27T00:00:00Z',
  }

  const ep1Detail = {
    ...ep1Summary,
    payload: {
      episodeRef: 'episode:01',
      aspectRatio: '9:16',
      rows: [
        {
          sceneRef: 'scene:ep01:s01',
          shotRef: 'shot:ep01:s01:01',
          order: 1,
          plannedDurationMicros: 3_000_000,
          cells: { visual: '雨夜怀表特写' },
          restrictedFields: [],
          linkedMedia: [{ role: 'keyframe', sha256: 'a'.repeat(64) }],
        },
        {
          sceneRef: 'scene:ep01:s01',
          shotRef: 'shot:ep01:s01:02',
          order: 2,
          plannedDurationMicros: 4_000_000,
          cells: { visual: '主角回头看雨巷' },
          restrictedFields: [],
          linkedMedia: [],
        },
      ],
    },
  }
  const ep2Detail = {
    ...ep2Summary,
    payload: {
      episodeRef: 'episode:02',
      aspectRatio: '9:16',
      rows: [
        {
          sceneRef: 'scene:ep02:s01',
          shotRef: 'shot:ep02:s01:01',
          order: 1,
          plannedDurationMicros: 3_500_000,
          cells: { visual: '天台对峙全景' },
          restrictedFields: [],
          linkedMedia: [],
        },
      ],
    },
  }

  const rpc: MuweaveRpcClient = createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
    calls.push({ action: body.action, payload: body.payload ?? {} })

    if (body.action === 'bundle.elements.list') {
      const domain = body.payload?.domain
      const kind = body.payload?.kind
      const elements =
        domain === 'drama' || kind === 'drama.storyboard_table' || (!domain && !kind) ? [ep1Summary, ep2Summary] : []
      return Response.json({ ok: true, generation: 1, data: { elements, ownerStates: { scaena: 'ready' } } })
    }
    if (body.action === 'bundle.element.get') {
      const id = body.payload?.elementId
      const element = id === 'el_board_ep02' ? ep2Detail : ep1Detail
      return Response.json({ ok: true, generation: 1, data: { element } })
    }
    if (body.action === 'drama.shot.review.list') {
      return Response.json({ ok: true, generation: 1, data: { reviews: [] } })
    }
    if (body.action === 'drama.cut.get') {
      return Response.json({ ok: true, generation: 1, data: { cut: cutOverride } })
    }
    if (body.action === 'drama.cut.set') {
      cutRevision += 1
      cutOverride = {
        workspaceId: 'ws_demo',
        episodeRef: String(body.payload?.episodeRef ?? 'episode:01'),
        shotOrder: body.payload?.shotOrder ?? [],
        durationOverridesMicros: body.payload?.durationOverridesMicros ?? {},
        omittedShotRefs: body.payload?.omittedShotRefs ?? [],
        transitions: body.payload?.transitions ?? {},
        revision: cutRevision,
        updatedAt: '2026-11-27T00:00:00Z',
      }
      return Response.json({ ok: true, generation: cutRevision + 1, data: { cut: cutOverride } })
    }
    if (body.action === 'drama.cut.reset') {
      cutOverride = null
      cutRevision = 0
      return Response.json({ ok: true, generation: 99, data: { reset: true } })
    }
    if (body.action === 'drama.export.manifest') {
      const format = String(body.payload?.format ?? 'fcpxml_1_10')
      return Response.json({
        ok: true,
        generation: 1,
        data: {
          schema: 'muweave.drama-export.v1',
          format,
          filename: format === 'fcpxml_1_10' ? 'episode-01.fcpxml' : 'draft_content.json',
          mimeType: format === 'fcpxml_1_10' ? 'application/xml' : 'application/json',
          shotCount: 2,
          totalDurationMs: 7000,
          fps: 24,
          aspectRatio: '9:16',
          content: format === 'fcpxml_1_10' ? '<fcpxml version="1.10"/>' : '{"id":"draft"}',
          generatedAt: '2026-11-27T00:00:00Z',
        },
      })
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

  return { rpc, calls }
}

describe('MuWeave DSH v7 Product UI (Multi-Episode, Cut Layer, FCPXML/Jianying, Custom Bridge)', () => {
  it('supports Drama multi-episode switcher, non-destructive cut move/omit/trim/reset, and FCPXML/Jianying export', async () => {
    const { rpc, calls } = createV7DramaRpc()
    const coreT = createFallbackTranslator('zh')
    render(<DramaMainPage rpc={rpc} t={(k) => k} coreT={coreT} />)

    // 1. Multi-episode switcher renders and filters shots by episode
    await waitFor(() => {
      expect(document.querySelector('[data-episode-switcher="true"]')).not.toBeNull()
      expect(screen.getByText('shot:ep01:s01:01')).toBeTruthy()
      expect(screen.getByText('shot:ep02:s01:01')).toBeTruthy()
    })

    const ep2Pill = document.querySelector('[data-episode-pill="episode:02"]') as HTMLButtonElement | null
    expect(ep2Pill).not.toBeNull()
    fireEvent.click(ep2Pill!)
    await waitFor(() => {
      expect(screen.queryByText('shot:ep01:s01:01')).toBeNull()
      expect(screen.getByText('shot:ep02:s01:01')).toBeTruthy()
    })

    // Switch to episode:01 for cut layer operations
    const ep1Pill = document.querySelector('[data-episode-pill="episode:01"]') as HTMLButtonElement | null
    expect(ep1Pill).not.toBeNull()
    fireEvent.click(ep1Pill!)
    await waitFor(() => {
      expect(screen.getByText('shot:ep01:s01:01')).toBeTruthy()
      expect(screen.queryByText('shot:ep02:s01:01')).toBeNull()
    })

    // 2. Reorder shot 01 down -> drama.cut.set
    const moveDownBtn = document.querySelector('[data-cut-move-down="shot:ep01:s01:01"]') as HTMLButtonElement | null
    expect(moveDownBtn).not.toBeNull()
    fireEvent.click(moveDownBtn!)
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'drama.cut.set')).toBe(true)
      expect(document.querySelector('[data-drama-cut-banner="true"]')).not.toBeNull()
    })

    // 3. Omit shot 02 -> drama.cut.set
    const omitBtn = document.querySelector('[data-cut-toggle-omit="shot:ep01:s01:02"]') as HTMLButtonElement | null
    expect(omitBtn).not.toBeNull()
    fireEvent.click(omitBtn!)
    await waitFor(() => {
      const cutSets = calls.filter((c) => c.action === 'drama.cut.set')
      expect(cutSets.length).toBeGreaterThanOrEqual(2)
    })

    // 4. Open ShotInspector and trim +0.5s via inspector cut controls
    const inspectBtn = screen.getByRole('button', { name: 'inspectShot shot:ep01:s01:01' })
    fireEvent.click(inspectBtn)
    await waitFor(() => {
      expect(document.querySelector('[data-inspector-cut-controls="true"]')).not.toBeNull()
    })
    const trimPlus = document.querySelector('[data-cut-trim-plus="true"]') as HTMLButtonElement | null
    expect(trimPlus).not.toBeNull()
    fireEvent.click(trimPlus!)
    await waitFor(() => {
      const cutSets = calls.filter((c) => c.action === 'drama.cut.set')
      expect(cutSets.length).toBeGreaterThanOrEqual(3)
    })

    // 5. Reset cut -> drama.cut.reset
    const resetBtn = document.querySelector('[data-drama-cut-reset="true"]') as HTMLButtonElement | null
    expect(resetBtn).not.toBeNull()
    fireEvent.click(resetBtn!)
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'drama.cut.reset')).toBe(true)
    })

    // 6. Switch to Timeline tab and trigger FCPXML & Jianying export
    fireEvent.click(screen.getByRole('tab', { name: 'tabTimeline' }))
    const fcpxmlBtn = await waitFor(() => {
      const el = document.querySelector('[data-drama-export-fcpxml="true"]') as HTMLButtonElement | null
      expect(el).not.toBeNull()
      return el!
    })
    const jianyingBtn = document.querySelector('[data-drama-export-jianying="true"]') as HTMLButtonElement | null
    expect(jianyingBtn).not.toBeNull()

    fireEvent.click(fcpxmlBtn)
    await waitFor(() => {
      const exportFormats = calls.filter((c) => c.action === 'drama.export.manifest').map((c) => c.payload.format)
      expect(exportFormats).toContain('fcpxml_1_10')
      expect(jianyingBtn!.disabled).toBe(false)
    })
    fireEvent.click(jianyingBtn!)
    await waitFor(() => {
      const exportFormats = calls.filter((c) => c.action === 'drama.export.manifest').map((c) => c.payload.format)
      expect(exportFormats).toContain('jianying_draft_v1')
    })
  })

  it('supports Script multi-episode switcher filtering', async () => {
    const ep1Scene = {
      elementId: 'el_sc_ep01',
      domain: 'script',
      kind: 'script.scene_card',
      sourceOwner: 'auctra',
      sourceRef: 'scene:ep01:s01',
      episodeRef: 'episode:01',
      title: '第一集雨夜开场',
      status: 'ready',
      stale: false,
      digest: 'sha256:sc01',
      updatedAt: '2026-11-27T00:00:00Z',
    }
    const ep2Scene = {
      elementId: 'el_sc_ep02',
      domain: 'script',
      kind: 'script.scene_card',
      sourceOwner: 'auctra',
      sourceRef: 'scene:ep02:s01',
      episodeRef: 'episode:02',
      title: '第二集天台反转',
      status: 'ready',
      stale: false,
      digest: 'sha256:sc02',
      updatedAt: '2026-11-27T00:00:00Z',
    }

    const rpc = createMuweaveRpcClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
      if (body.action === 'bundle.elements.list') {
        return Response.json({ ok: true, generation: 1, data: { elements: [ep1Scene, ep2Scene], ownerStates: { auctra: 'ready' } } })
      }
      if (body.action === 'bundle.element.get') {
        const el = body.payload?.elementId === 'el_sc_ep02' ? ep2Scene : ep1Scene
        return Response.json({
          ok: true,
          generation: 1,
          data: { element: { ...el, payload: { sceneRef: el.sourceRef, goal: el.title, obstacle: '雨势渐大', turn: '发现怀表' } } },
        })
      }
      return Response.json({ ok: true, generation: 1, data: {} })
    })

    render(<ScriptMainPage rpc={rpc} t={(k) => k} coreT={createFallbackTranslator('zh')} />)

    await waitFor(() => {
      expect(document.querySelector('[data-script-episode-switcher="true"]')).not.toBeNull()
    })

    fireEvent.click(screen.getByRole('tab', { name: 'tabSceneCards' }))
    const readerBtn = await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'viewLinearRead' })
      expect(btn).toBeTruthy()
      return btn
    })
    fireEvent.click(readerBtn)
    await waitFor(() => {
      expect(document.querySelector('[data-reader-scene="el_sc_ep01"]')).not.toBeNull()
      expect(document.querySelector('[data-reader-scene="el_sc_ep02"]')).not.toBeNull()
    })

    const ep2Btn = document.querySelector('[data-script-episode-switcher="true"] [data-episode-pill="episode:02"]') as HTMLButtonElement | null
    expect(ep2Btn).not.toBeNull()
    fireEvent.click(ep2Btn!)
    await waitFor(() => {
      expect(document.querySelector('[data-reader-scene="el_sc_ep01"]')).toBeNull()
      expect(document.querySelector('[data-reader-scene="el_sc_ep02"]')).not.toBeNull()
    })
  })

  it('manages Kit Custom Engine Bridge: presets, client-side plaintext key guard, save, test, and remove', async () => {
    const calls: RpcCallLog[] = []
    let adapters: Array<Record<string, unknown>> = [
      {
        adapterId: 'existing-comfy',
        title: '已有 ComfyUI',
        protocol: 'comfyui_http',
        kind: 'image',
        stage: 'visual',
        enabled: true,
        endpointUrl: 'http://127.0.0.1:8188',
        model: 'flux-dev',
        envReady: true,
        updatedAt: '2026-11-27T00:00:00Z',
      },
    ]

    const rpc = createMuweaveRpcClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
      calls.push({ action: body.action, payload: body.payload ?? {} })

      if (body.action === 'adapter.custom.list') {
        return Response.json({ ok: true, generation: 1, data: { adapters } })
      }
      if (body.action === 'adapter.custom.save') {
        const saved: Record<string, unknown> = { ...(body.payload ?? {}), envReady: true, updatedAt: '2026-11-27T00:00:00Z' }
        adapters = [...adapters.filter((a) => a.adapterId !== saved.adapterId), saved]
        return Response.json({ ok: true, generation: 2, data: { adapter: saved, adapters } })
      }
      if (body.action === 'adapter.custom.test') {
        return Response.json({ ok: true, generation: 2, data: { ok: true, reachable: true, message: 'HTTP 200 OK' } })
      }
      if (body.action === 'adapter.custom.remove') {
        adapters = adapters.filter((a) => a.adapterId !== body.payload?.adapterId)
        return Response.json({ ok: true, generation: 3, data: { removed: true, adapters } })
      }
      return Response.json({ ok: true, generation: 1, data: {} })
    })

    render(<KitMainPage rpc={rpc} t={(k) => k} coreT={createFallbackTranslator('zh')} />)

    fireEvent.click(screen.getByRole('tab', { name: 'tabCli' }))
    await waitFor(() => {
      expect(document.querySelector('[data-kit-adapters-card="true"]')).not.toBeNull()
      expect(document.querySelector('[data-adapter-row="existing-comfy"]')).not.toBeNull()
    })

    // 1. Click OpenAI Image preset to prefill form
    fireEvent.click(document.querySelector('[data-adapter-preset="openai-image"]')!)
    const idInput = document.querySelector('[data-adapter-field="id"]') as HTMLInputElement
    const authInput = document.querySelector('[data-adapter-field="authEnvVar"]') as HTMLInputElement
    expect(idInput.value).toBe('openai-image')
    expect(authInput.value).toBe('OPENAI_API_KEY')

    // 2. Reject plaintext sk-* key BEFORE sending any adapter.custom.save RPC
    fireEvent.change(authInput, { target: { value: 'sk-1234567890abcdef1234' } })
    fireEvent.click(document.querySelector('[data-adapter-save="true"]')!)
    await waitFor(() => {
      expect(document.querySelector('[data-adapter-secret-warning="true"]')).not.toBeNull()
    })
    expect(calls.some((c) => c.action === 'adapter.custom.save')).toBe(false)

    // 3. Replace with valid env var name OPENAI_API_KEY and save
    fireEvent.change(authInput, { target: { value: 'OPENAI_API_KEY' } })
    await act(async () => {
      fireEvent.click(document.querySelector('[data-adapter-save="true"]')!)
    })
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'adapter.custom.save')).toBe(true)
      expect(document.querySelector('[data-adapter-row="openai-image"]')).not.toBeNull()
    })

    // 4. Test connection via adapter.custom.test
    await act(async () => {
      fireEvent.click(document.querySelector('[data-adapter-test="openai-image"]')!)
    })
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'adapter.custom.test' && c.payload.adapterId === 'openai-image')).toBe(true)
      expect(document.querySelector('[data-adapter-test-result="openai-image"]')?.textContent).toContain('HTTP 200 OK')
    })

    // 5. Remove via adapter.custom.remove
    await act(async () => {
      fireEvent.click(document.querySelector('[data-adapter-remove="openai-image"]')!)
    })
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'adapter.custom.remove' && c.payload.adapterId === 'openai-image')).toBe(true)
      expect(document.querySelector('[data-adapter-row="openai-image"]')).toBeNull()
    })
  })
})
