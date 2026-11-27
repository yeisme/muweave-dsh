import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AnimaticPlayer,
  createFallbackTranslator,
  createMuweaveRpcClient,
  removeStagedItemFromFloatingAgent,
  type MuweaveRpcClient,
} from '@yeisme/dsh-muweave-core/client'
import { getFloatingAgentSnapshot } from '../packages/dsh-muweave-core/src/client/floating-agent'
import { DramaMainPage } from '@yeisme/dsh-muweave-drama/client'
import { EikonaMainPage } from '@yeisme/dsh-muweave-eikona/client'

afterEach(() => {
  cleanup()
  removeStagedItemFromFloatingAgent('project.continuity_bible:project:continuity-bible')
})

interface RpcLog {
  action: string
  payload: Record<string, unknown>
}

describe('MuWeave DSH v8 QC Gate, Safe-Zone Overlay, Review Deck Import & Continuity Bible UI', () => {
  it('toggles 9:16 Safe-Zone Overlay on AnimaticPlayer', async () => {
    const rpc = createMuweaveRpcClient(async () => Response.json({ ok: true, generation: 1, data: {} }))
    render(
      <AnimaticPlayer
        rpc={rpc}
        t={createFallbackTranslator('zh')}
        rows={[
          {
            shotRef: 'shot:ep01:s01:01',
            sceneRef: 'scene:ep01:s01',
            order: 1,
            plannedDurationMicros: 3_000_000,
            cells: { visual: '雨夜怀表特写' },
          },
        ]}
      />,
    )

    const toggle = document.querySelector('[data-animatic-safezone-toggle="true"]') as HTMLButtonElement | null
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('[data-safe-zone-overlay="true"]')).toBeNull()

    fireEvent.click(toggle!)
    await waitFor(() => {
      expect(toggle?.getAttribute('aria-pressed')).toBe('true')
      expect(document.querySelector('[data-safe-zone-overlay="true"]')).not.toBeNull()
    })

    fireEvent.click(toggle!)
    await waitFor(() => {
      expect(toggle?.getAttribute('aria-pressed')).toBe('false')
      expect(document.querySelector('[data-safe-zone-overlay="true"]')).toBeNull()
    })
  })

  it('renders Drama QC strip, jumps to ShotInspector on finding click, exports SRT/VTT/Review Deck HTML, and imports feedback JSON', async () => {
    const calls: RpcLog[] = []
    const boardSummary = {
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
    const boardDetail = {
      ...boardSummary,
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
            linkedMedia: [],
          },
          {
            sceneRef: 'scene:ep01:s01',
            shotRef: 'shot:ep01:s01:02',
            order: 2,
            plannedDurationMicros: 4_000_000,
            cells: { visual: '主角回头看雨巷' },
            restrictedFields: [],
            linkedMedia: [{ role: 'keyframe', sha256: 'b'.repeat(64) }],
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
        const elements = domain === 'drama' || kind === 'drama.storyboard_table' || (!domain && !kind) ? [boardSummary] : []
        return Response.json({ ok: true, generation: 1, data: { elements, ownerStates: { scaena: 'ready' } } })
      }
      if (body.action === 'bundle.element.get') {
        return Response.json({ ok: true, generation: 1, data: { element: boardDetail } })
      }
      if (body.action === 'drama.shot.review.list') {
        return Response.json({ ok: true, generation: 1, data: { reviews: [] } })
      }
      if (body.action === 'drama.cut.get') {
        return Response.json({ ok: true, generation: 1, data: { cut: null } })
      }
      if (body.action === 'drama.qc.report') {
        return Response.json({
          ok: true,
          generation: 1,
          data: {
            report: {
              schema: 'muweave.episode-qc.v1',
              episodeRef: 'episode:01',
              score: 70,
              readyForDelivery: false,
              counts: { blocker: 1, warning: 1, pass: 2 },
              shotCount: 2,
              totalDurationMs: 7000,
              findings: [
                {
                  code: 'qc_shot_missing_visual',
                  severity: 'blocker',
                  shotRef: 'shot:ep01:s01:01',
                  message: '镜头缺少关键帧或视频',
                  suggestion: '先生成关键帧',
                },
                {
                  code: 'qc_missing_compliance_disclosure',
                  severity: 'warning',
                  message: '未配置 AI 合规披露声明',
                },
              ],
              generatedAt: '2026-11-27T00:00:00Z',
            },
          },
        })
      }
      if (body.action === 'drama.export.manifest') {
        const format = String(body.payload?.format ?? 'srt_subtitles')
        return Response.json({
          ok: true,
          generation: 1,
          data: {
            schema: 'muweave.drama-export.v1',
            format,
            filename:
              format === 'srt_subtitles'
                ? 'episode-01.srt'
                : format === 'webvtt_subtitles'
                  ? 'episode-01.vtt'
                  : 'review-deck.html',
            mimeType:
              format === 'srt_subtitles'
                ? 'application/x-subrip'
                : format === 'webvtt_subtitles'
                  ? 'text/vtt'
                  : 'text/html',
            shotCount: 2,
            totalDurationMs: 7000,
            fps: 24,
            aspectRatio: '9:16',
            content: 'exported-content',
            generatedAt: '2026-11-27T00:00:00Z',
          },
        })
      }
      if (body.action === 'drama.shot.review.import') {
        return Response.json({
          ok: true,
          generation: 2,
          data: {
            importedCount: 1,
            skippedLockedCount: 1,
            invalidCount: 0,
            results: [
              { shotRef: 'shot:ep01:s01:01', action: 'imported', status: 'approved' },
              { shotRef: 'shot:ep01:s01:02', action: 'skipped_locked', reason: 'locked' },
            ],
          },
        })
      }
      return Response.json({ ok: true, generation: 1, data: {} })
    })

    render(<DramaMainPage rpc={rpc} t={(k) => k} coreT={createFallbackTranslator('zh')} />)

    // 1. QC strip renders and clicking a shot finding opens ShotInspector for that shot
    await waitFor(() => {
      expect(document.querySelector('[data-drama-qc-strip="true"]')).not.toBeNull()
    })
    let findingBtn = document.querySelector('[data-qc-finding-shot="shot:ep01:s01:01"]') as HTMLButtonElement | null
    if (!findingBtn) {
      const expandBtn = document.querySelector('[data-drama-qc-strip="true"] button[aria-expanded]') as HTMLButtonElement | null
      if (expandBtn) fireEvent.click(expandBtn)
      await waitFor(() => {
        findingBtn = document.querySelector('[data-qc-finding-shot="shot:ep01:s01:01"]') as HTMLButtonElement | null
        expect(findingBtn).not.toBeNull()
      })
    }
    fireEvent.click(findingBtn!)
    await waitFor(() => {
      expect(document.querySelector('[data-inspector-filmstrip="true"]')).not.toBeNull()
      expect(
        document.querySelector('[data-filmstrip-shot="shot:ep01:s01:01"]')?.getAttribute('aria-current'),
      ).toBe('true')
    })

    // 2. Timeline tab: SRT, VTT, Review Deck HTML exports
    fireEvent.click(screen.getByRole('tab', { name: 'tabTimeline' }))
    const srtBtn = await waitFor(() => {
      const btn = document.querySelector('[data-drama-export-srt="true"]') as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      return btn!
    })
    const vttBtn = document.querySelector('[data-drama-export-vtt="true"]') as HTMLButtonElement | null
    const htmlBtn = document.querySelector('[data-drama-export-review-html="true"]') as HTMLButtonElement | null
    expect(vttBtn).not.toBeNull()
    expect(htmlBtn).not.toBeNull()

    fireEvent.click(srtBtn)
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'drama.export.manifest' && c.payload.format === 'srt_subtitles')).toBe(true)
      expect(vttBtn!.disabled).toBe(false)
    })
    fireEvent.click(vttBtn!)
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'drama.export.manifest' && c.payload.format === 'webvtt_subtitles')).toBe(true)
      expect(htmlBtn!.disabled).toBe(false)
    })
    fireEvent.click(htmlBtn!)
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'drama.export.manifest' && c.payload.format === 'review_deck_html')).toBe(true)
    })

    // 3. Upload review-feedback.json -> drama.shot.review.import + receipt with skippedLockedCount
    const fileInput = document.querySelector('[data-drama-import-feedback-input="true"]') as HTMLInputElement | null
    expect(fileInput).not.toBeNull()
    const feedbackPayload = JSON.stringify({
      items: [
        { shotRef: 'shot:ep01:s01:01', status: 'approved', note: '通过' },
        { shotRef: 'shot:ep01:s01:02', status: 'needs_revision', note: '锁定的镜头应跳过' },
      ],
    })
    const file = new File([feedbackPayload], 'review-feedback.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => feedbackPayload })

    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [file] } })
    })
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'drama.shot.review.import')).toBe(true)
      const receipt = document.querySelector('[data-drama-import-receipt="true"]')
      expect(receipt).not.toBeNull()
      expect(receipt?.textContent).toContain('1')
    })
  })

  it('loads, saves with expectedRevision, and stages Continuity Bible in Eikona masters tab', async () => {
    const calls: RpcLog[] = []
    let currentBible = {
      schema: 'muweave.continuity-bible.v1',
      workspaceId: 'ws_demo',
      visualGrammar: {
        aspectRatio: '9:16',
        lensStyle: '35mm anamorphic',
        lightingRule: 'rainy neon noir',
        styleDirective: 'cinematic manga realism',
      },
      colorPalette: [],
      characterAnchors: [
        { name: '林雾', wardrobe: '深蓝风衣', immutableTraits: '左耳银色耳钉' },
      ],
      negativeGuardrails: ['no extra fingers'],
      complianceDisclosure: '本短剧由 AI 辅助生成',
      revision: '1',
      updatedAt: '2026-11-27T00:00:00Z',
    }

    const rpc: MuweaveRpcClient = createMuweaveRpcClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
      calls.push({ action: body.action, payload: body.payload ?? {} })

      if (body.action === 'bundle.elements.list') {
        return Response.json({ ok: true, generation: 1, data: { elements: [] } })
      }
      if (body.action === 'project.bible.get') {
        return Response.json({ ok: true, generation: 1, data: { bible: currentBible } })
      }
      if (body.action === 'project.bible.set') {
        currentBible = {
          ...currentBible,
          visualGrammar: {
            ...currentBible.visualGrammar,
            ...((body.payload?.visualGrammar as Record<string, string>) ?? {}),
          },
          revision: '2',
        }
        return Response.json({ ok: true, generation: 2, data: { bible: currentBible } })
      }
      return Response.json({ ok: true, generation: 1, data: {} })
    })

    render(<EikonaMainPage rpc={rpc} t={(k) => k} coreT={createFallbackTranslator('zh')} />)

    fireEvent.click(screen.getByRole('tab', { name: 'tabMasters' }))
    await waitFor(() => {
      expect(document.querySelector('[data-continuity-bible-card="true"]')).not.toBeNull()
      const lensInput = document.querySelector('[data-bible-field="lensStyle"]') as HTMLInputElement | null
      expect(lensInput?.value).toBe('35mm anamorphic')
    })

    // Edit lensStyle and save -> project.bible.set with expectedRevision: '1'
    const lensInput = document.querySelector('[data-bible-field="lensStyle"]') as HTMLInputElement
    fireEvent.change(lensInput, { target: { value: '50mm portrait prime' } })
    await act(async () => {
      fireEvent.click(document.querySelector('[data-bible-save="true"]')!)
    })
    await waitFor(() => {
      const saveCall = calls.find((c) => c.action === 'project.bible.set')
      expect(saveCall).toBeDefined()
      expect(saveCall?.payload.expectedRevision).toBe('1')
      expect(document.querySelector('[data-bible-receipt="true"]')).not.toBeNull()
      expect(document.querySelector('[data-bible-revision="2"]')).not.toBeNull()
    })

    // Stage Continuity Bible chip to FloatingAgent
    fireEvent.click(document.querySelector('[data-bible-stage-agent="true"]')!)
    const snap = getFloatingAgentSnapshot()
    expect(snap.staged.some((item) => String(item.kind) === 'project.continuity_bible')).toBe(true)
  })
})
