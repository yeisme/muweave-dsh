import { describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { createFallbackTranslator, createMuweaveRpcClient } from '@yeisme/dsh-muweave-core/client'
import { WorkbenchMainPage } from '@yeisme/dsh-muweave-workbench/client'
import { EikonaMainPage } from '@yeisme/dsh-muweave-eikona/client'
import { ScriptMainPage } from '@yeisme/dsh-muweave-script/client'
import { DramaMainPage } from '@yeisme/dsh-muweave-drama/client'

const DSH_BROWSER_SEED_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-layout',
]

function createMockPluginRpc() {
  const elements = [
    {
      elementId: 'eikona-candidates-run_01',
      domain: 'eikona',
      kind: 'eikona.candidate_group',
      title: '视觉候选组 · run_01',
      subtitle: '2 张候选 · waiting_review',
      sourceOwner: 'eikona',
      sourceRef: 'eikona://runs/run_01',
      status: 'waiting_review',
      digest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      updatedAt: '2026-11-12T00:00:00Z',
    },
    {
      elementId: 'script-scenecard-scene_01',
      domain: 'script',
      kind: 'script.scene_card',
      title: '场次卡 · 外景 雨夜街口',
      subtitle: '目标：夺回怀表 · 修订 v2',
      sourceOwner: 'auctra',
      sourceRef: 'scene:01',
      sourceRevision: '2',
      sceneRef: 'scene:01',
      status: 'draft',
      digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      updatedAt: '2026-11-12T00:00:00Z',
    },
    {
      elementId: 'script-diff-cand_stale',
      domain: 'script',
      kind: 'script.candidate_diff',
      title: '候选改写对比 · cand_stale',
      subtitle: '基线 v2 落后正式版 v3',
      sourceOwner: 'auctra',
      sourceRef: 'owner:auctra:candidate:cand_stale',
      stale: true,
      status: 'stale',
      digest: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      updatedAt: '2026-11-12T00:00:00Z',
    },
    {
      elementId: 'drama-storyboard-bd_01',
      domain: 'drama',
      kind: 'drama.storyboard_table',
      title: '分镜摘要表 · breakdown:ep01',
      subtitle: 'episode:01 · 共 1 镜',
      sourceOwner: 'scaena',
      sourceRef: 'breakdown:ep01',
      status: 'ready',
      digest: 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
      updatedAt: '2026-11-12T00:00:00Z',
    },
    {
      elementId: 'drama-assets-readiness',
      domain: 'drama',
      kind: 'drama.asset_readiness',
      title: '生产资产四轴就绪台账',
      subtitle: '已登记 1 项生产资产',
      sourceOwner: 'scaena',
      sourceRef: 'owner:scaena:assets',
      status: 'ready',
      digest: 'sha256:5555555555555555555555555555555555555555555555555555555555555555',
      updatedAt: '2026-11-12T00:00:00Z',
    },
    {
      elementId: 'pi-goal-g1',
      domain: 'harness',
      kind: 'harness.pi_goal',
      title: 'Pi Goal · 第一集分镜闭环',
      subtitle: '2 个里程碑条目',
      sourceOwner: 'pi',
      sourceRef: 'pi://goals/active_goal_01.md',
      status: 'active',
      digest: 'sha256:6666666666666666666666666666666666666666666666666666666666666666',
      updatedAt: '2026-11-12T00:00:00Z',
    },
  ]

  let gen = 1
  return createMuweaveRpcClient(async (_url, init) => {
    gen += 1
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload: Record<string, unknown> }
    if (body.action === 'bundle.elements.list') {
      const dom = body.payload.domain
      const kind = body.payload.kind
      const filtered = elements.filter((e) => (!dom || e.domain === dom) && (!kind || e.kind === kind))
      return new Response(
        JSON.stringify({
          ok: true,
          generation: gen,
          data: {
            projectId: 'proj_test',
            title: 'Test',
            revision: 3,
            ownerStates: { eikona: 'ready', auctra: 'ready', scaena: 'ready', pi: 'ready', dsh: 'empty' },
            elements: filtered,
          },
        }),
        { status: 200 },
      )
    }
    if (body.action === 'bundle.element.get') {
      const id = String(body.payload.elementId)
      const base = elements.find((e) => e.elementId === id)!
      let payload: Record<string, unknown> = {}
      if (id === 'eikona-candidates-run_01') {
        payload = {
          runId: 'run_01',
          candidates: [
            {
              artifactId: 'art_a',
              handle: 'hero-a',
              uri: 'eikona://artifact/hero-a',
              role: 'primary',
              promptExcerpt: '雨夜霓虹特写',
              modelRef: 'openai/gpt-image-2.5-sunburst',
            },
          ],
        }
      } else if (id === 'script-scenecard-scene_01') {
        payload = { sceneRef: 'scene:01', revision: '2', goal: '夺回怀表', obstacle: '追兵', turn: '亮出底牌' }
      } else if (id === 'script-diff-cand_stale') {
        payload = { stale: true, baseRevision: 2, canonicalRevision: 3, canonicalExcerpt: '旧台词', candidateExcerpt: '新台词' }
      } else if (id === 'drama-storyboard-bd_01') {
        payload = {
          rows: [
            {
              sceneRef: 'scene:01',
              shotRef: 'shot:01',
              order: 1,
              plannedDurationMicros: 3200000,
              cells: { camera: '近景推镜', prompt_raw: '[restricted:prompt_raw]' },
              restrictedFields: ['prompt_raw'],
            },
          ],
        }
      } else if (id === 'drama-assets-readiness') {
        payload = {
          assets: [
            {
              assetRef: 'asset:linwu',
              role: 'character',
              parsedVersion: 2,
              axes: {
                scaenaAdmission: 'admitted',
                subjectFreeze: 'frozen',
                productionAcceptance: 'accepted',
                currentUsability: 'ready',
              },
            },
          ],
        }
      }
      return new Response(
        JSON.stringify({ ok: true, generation: gen, data: { element: { ...base, schemaVersion: 'muweave.element.v1', payload } } }),
        { status: 200 },
      )
    }
    if (body.action === 'eikona.spec.validate') {
      const size = String(body.payload.size ?? '')
      if (size === '2k') {
        return new Response(
          JSON.stringify({ ok: false, generation: gen, error: { code: 'eikona/shorthand_size_forbidden', message: 'No 2k allowed' } }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          ok: true,
          generation: gen,
          data: { valid: true, normalized: { model: 'openai/gpt-image-2.5-sunburst', size, quality: 'high', channel: 'noemi' } },
        }),
        { status: 200 },
      )
    }
    if (body.action === 'timing.projection') {
      return new Response(
        JSON.stringify({ ok: true, generation: gen, data: { capturedAt: '2026-11-12T00:00:00Z', activeCount: 0, waitingHumanCount: 0, reconcileRequiredCount: 0, spans: [] } }),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify({ ok: true, generation: gen, data: {} }), { status: 200 })
  })
}

describe('MuWeave 5 DSH Plugins UI & Lazy-CJS Bundle Purity', () => {
  it('renders Workbench (.muweave/ overview + Pi Goal tree) and Eikona (2/4-up compare + Sunburst guard)', async () => {
    cleanup()
    const rpc = createMockPluginRpc()
    const coreT = createFallbackTranslator('zh')

    const { unmount } = render(<WorkbenchMainPage rpc={rpc} t={(k) => k} coreT={coreT} />)
    await waitFor(() => {
      expect(screen.getByText('Pi Goal · 第一集分镜闭环')).toBeTruthy()
    })
    unmount()

    render(<EikonaMainPage rpc={rpc} t={(k) => k} coreT={coreT} />)
    await waitFor(() => {
      expect(screen.getByText('art_a')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('tabSpecGuard'))
    fireEvent.change(screen.getByLabelText('Eikona Pixel Size'), { target: { value: '2k' } })
    fireEvent.click(screen.getByText('校验出图参数规格'))
    await waitFor(() => {
      const el = screen.getByText(/eikona\/shorthand_size_forbidden/)
      expect(el.getAttribute('data-spec-verdict')).toBe('fail')
    })
    cleanup()
  })

  it('renders Script (stale candidate Diff blocks adoption) and Drama (4-axis readiness + Script-Shot side-by-side)', async () => {
    cleanup()
    const rpc = createMockPluginRpc()
    const coreT = createFallbackTranslator('zh')

    const { unmount } = render(<ScriptMainPage rpc={rpc} t={(k) => k} coreT={coreT} />)
    await waitFor(() => {
      expect(screen.getByText('tabDiff')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('tabDiff'))
    await waitFor(() => {
      expect(screen.getByText('候选改写对比 · cand_stale')).toBeTruthy()
    })
    const adoptBtn = screen.getByText(/adoptCandidate/) as HTMLButtonElement
    expect(adoptBtn.disabled).toBe(true)
    unmount()

    render(<DramaMainPage rpc={rpc} t={(k) => k} coreT={coreT} />)
    await waitFor(() => {
      expect(screen.getByText(/shot:01/)).toBeTruthy()
    })
    fireEvent.click(screen.getByText('tabAssets'))
    expect(screen.getByText('axisFreeze: frozen')).toBeTruthy()
    fireEvent.click(screen.getByText('tabSideBySide'))
    expect(screen.getByText('scriptSide')).toBeTruthy()
    expect(screen.getByText('shotSide')).toBeTruthy()
    cleanup()
  })

  it('verifies all 5 compiled lib/client.js bundles load in a clean VM and require ONLY allowed DSH seed modules (no duplicate React or Node built-ins)', async () => {
    const rootDir = path.resolve(import.meta.dirname, '..')
    const pluginDirs = [
      'dsh-muweave-workbench',
      'dsh-muweave-eikona',
      'dsh-muweave-script',
      'dsh-muweave-drama',
      'dsh-muweave-kit',
    ]
    const allowedSet = new Set(DSH_BROWSER_SEED_EXTERNALS)

    for (const dir of pluginDirs) {
      const code = await readFile(path.join(rootDir, 'packages', dir, 'lib/client.js'), 'utf8')
      let capturedEntry: { id: string; factory: (req: (spec: string) => unknown) => Record<string, unknown> } | undefined
      const sandbox = {
        window: {
          __ModuleLoader__: {
            load(entry: { id: string; factory: (req: (spec: string) => unknown) => Record<string, unknown> }) {
              capturedEntry = entry
            },
          },
        },
      }
      vm.runInNewContext(code, sandbox)
      expect(capturedEntry).toBeDefined()
      expect(capturedEntry!.id).toBe(`@yeisme/${dir}`)

      const requestedModules: string[] = []
      const exportsObj = capturedEntry!.factory((spec: string) => {
        requestedModules.push(spec)
        if (spec === 'react') {
          return {
            useState: () => [undefined, () => undefined],
            useEffect: () => undefined,
            useCallback: (fn: unknown) => fn,
            useRef: () => ({ current: null }),
            useSyncExternalStore: () => ({}),
            createElement: () => ({}),
          }
        }
        if (spec === 'react/jsx-runtime') {
          return { jsx: () => ({}), jsxs: () => ({}), Fragment: 'Fragment' }
        }
        return {}
      })

      for (const req of requestedModules) {
        expect(allowedSet.has(req), `Plugin ${dir} requested non-seed module "${req}"`).toBe(true)
      }
      expect(typeof exportsObj.apply).toBe('function')
      expect(Array.isArray(exportsObj.inject)).toBe(true)
    }
  })
})
