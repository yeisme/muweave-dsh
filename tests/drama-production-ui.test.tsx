import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  createFallbackTranslator,
  createMuweaveRpcClient,
  type DramaExportFormat,
  type ShotReviewRecordV1,
  type ShotReviewStatus,
} from '@yeisme/dsh-muweave-core/client'
import { DramaMainPage } from '@yeisme/dsh-muweave-drama/client'

afterEach(() => {
  cleanup()
})

const ZH_TEST_DICT: Record<string, string> = {
  panelTitle: '做剧分镜与生产台 (Scaena)',
  roomTitle: '分镜生产',
  tabStoryboard: '分镜表',
  tabAssets: '资产就绪',
  tabTimeline: '剪辑时间线',
  tabSideBySide: '剧本 ↔ 分镜',
  colOrder: '序',
  colShot: '镜头',
  colScene: '场次',
  colDuration: '时长',
  colCells: '镜头要素',
  colAsset: '资产',
  colRole: '角色',
  colVersion: '版本',
  colReview: '审片',
  colMedia: '6 轨媒体',
  axisAdmission: '准入',
  axisFreeze: '冻结',
  axisAcceptance: '验收',
  axisUsability: '可用',
  restrictedNote: '受保护字段',
  aspect: '画幅',
  shotCount: '镜',
  clipCount: '片段',
  scriptSide: '剧本场次卡 (Auctra)',
  shotSide: '对应拆解镜头 (Scaena)',
  seconds: '秒',
  heroEyebrow: 'Scaena · 分镜生产',
  heroEmptyTitle: '还没有分镜',
  heroLede: '一镜一格地看本集',
  statDuration: '秒总时长',
  statReady: '项资产就绪',
  statApproved: '审片通过',
  inspectorTitle: '镜头详情检查器',
  closeInspector: '关闭检查器',
  inspectShot: '检查',
  reviewSectionTitle: '导演审片',
  reviewStatusLabel: '审片状态',
  reviewStatusDraft: '草稿',
  reviewStatusInReview: '待审',
  reviewStatusNeedsRevision: '需修改',
  reviewStatusApproved: '已通过',
  reviewStatusLocked: '已锁定',
  reviewTagsLabel: '快捷批注标签',
  tagPacing: '节奏',
  tagFraming: '构图',
  tagLipsync: '口型',
  tagLighting: '光影',
  tagVoice: '配音',
  tagVfx: '特效',
  reviewNoteLabel: '导演批注',
  reviewNotePlaceholder: '记录镜头修改意见…',
  saveReview: '保存审片',
  savingReview: '保存中…',
  reviewSaved: '审片已保存',
  reviewConflictMsg: '版本冲突',
  reviewConflictReload: '重新读取',
  mediaSlotsTitle: '6 轨媒体槽位',
  role_keyframe: '关键帧 (Keyframe)',
  role_reference: '参考图 (Reference)',
  role_video: '成片视频 (Video)',
  role_voice: '对白配音 (Voice)',
  role_music: '背景音乐 (Music)',
  role_sfx: '环境音效 (SFX)',
  slotEmpty: '未绑定',
  unlinkMedia: '解绑',
  bindEikonaSelect: '选择已有视觉元件',
  bindMedia: '绑定',
  genVisualForRole: '一键生成画面',
  genAudioForRole: '一键生成音效',
  exportEdl: '导出 EDL',
  exportCutManifest: '导出 Cut Manifest JSON',
  exportShotlistCsv: '导出分镜表 CSV',
  exportDone: '已导出粗剪包',
  trackVisual: '画面 / 视频轨',
  trackVoice: '配音轨',
  trackSfxMusic: '音效 / 配乐轨',
  sceneUncovered: '未拆镜',
  approvedRatio: '已通过',
  filterAllScenes: '全部场次',
  noShotsForScene: '该场次暂无拆解镜头',
  mediaRolesFilled: '轨就绪',
  assetFilterLabel: '资产就绪筛选',
  assetFilterAll: '全部',
  assetFilterBlocked: '阻塞中',
  assetFilterReady: '就绪',
  noAssetsForFilter: '当前筛选条件下无资产',
  impactedShots: '受影响镜头',
  filterReviewAll: '全部审片状态',
  filterMediaAll: '全部媒体状态',
  filterMissingVisual: '缺少画面',
  filterMissingAudio: '缺少音频',
  filterMissingVideo: '缺少视频',
  animaticOpen: '展开 Animatic 预演',
  animaticClose: '收起 Animatic 预演',
  kbdSwitchShot: '切镜',
  kbdApprove: '通过',
  kbdRevision: '需修改',
  kbdClose: '关闭',
  readinessStripTitle: '全集生产就绪度',
  mediaCompleteness: '6 轨媒体齐套率',
  batchSelected: '已选镜头',
  batchMarkInReview: '批量标为待审',
  batchApprove: '批量通过',
  batchStageAgent: '打包 @ 送入 Agent',
  batchClear: '清空选择',
  batchDone: '批量审片已更新',
  batchPartialConflict: '部分镜头存在版本冲突',
  batchStagedNotice: '已打包选中镜头送入悬浮 Agent',
  selectShot: '选择镜头',
}

const t = (k: string) => ZH_TEST_DICT[k] ?? k

interface RpcCallLog {
  action: string
  payload: Record<string, unknown>
}

function createDramaStudioRpc(options?: { failReviewConflict?: boolean }) {
  const calls: RpcCallLog[] = []
  let gen = 1
  const sha1 = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
  const shaVoice = 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
  const shaSfx = 'sha256:3333333333333333333333333333333333333333333333333333333333333333'
  const shaMaster = 'sha256:4444444444444444444444444444444444444444444444444444444444444444'

  const reviews: Record<string, ShotReviewRecordV1> = {
    'shot:01': {
      workspaceId: 'ws_1',
      shotRef: 'shot:01',
      sceneRef: 'scene:01',
      status: 'approved',
      note: '构图稳',
      tags: ['构图'],
      revision: 1,
      updatedAt: '2026-11-27T00:00:00Z',
    },
  }

  let shot01Media: Array<{ sha256?: string; elementId?: string; artifactId?: string; role: string; mime?: string }> = [
    { sha256: sha1, artifactId: 'art_kf_01', role: 'keyframe', mime: 'image/png' },
    { sha256: shaVoice, artifactId: 'art_vo_01', role: 'voice', mime: 'audio/mpeg' },
  ]
  const shot02Media: Array<{ sha256?: string; elementId?: string; artifactId?: string; role: string; mime?: string }> = [
    { sha256: shaSfx, artifactId: 'art_sfx_02', role: 'sfx', mime: 'audio/mpeg' },
  ]

  const elements = [
    {
      elementId: 'eikona-candidates-run_01',
      domain: 'eikona',
      kind: 'eikona.candidate_group',
      title: '视觉候选组 · run_01',
      subtitle: '1 张候选',
      sourceOwner: 'eikona',
      sourceRef: 'eikona://runs/run_01',
      status: 'ready',
      digest: sha1,
      updatedAt: '2026-11-27T00:00:00Z',
    },
    {
      elementId: 'eikona-master-linwu',
      domain: 'eikona',
      kind: 'eikona.master_binding',
      title: '角色母版 · linwu',
      subtitle: '林雾主视觉',
      sourceOwner: 'eikona',
      sourceRef: 'asset:linwu',
      status: 'ready',
      digest: shaMaster,
      updatedAt: '2026-11-27T00:00:00Z',
    },
    {
      elementId: 'script-scene-01',
      domain: 'script',
      kind: 'script.scene_card',
      title: '场次 01 · 雨夜街口',
      subtitle: '夺回怀表',
      sourceOwner: 'auctra',
      sourceRef: 'scene:01',
      sceneRef: 'scene:01',
      status: 'ready',
      digest: sha1,
      updatedAt: '2026-11-27T00:00:00Z',
    },
    {
      elementId: 'script-scene-02',
      domain: 'script',
      kind: 'script.scene_card',
      title: '场次 02 · 天台对峙',
      subtitle: '尚未拆镜',
      sourceOwner: 'auctra',
      sourceRef: 'scene:02',
      sceneRef: 'scene:02',
      status: 'draft',
      digest: sha1,
      updatedAt: '2026-11-27T00:00:00Z',
    },
    {
      elementId: 'drama-sb-ep01',
      domain: 'drama',
      kind: 'drama.storyboard_table',
      title: '分镜摘要表 · ep01',
      subtitle: '共 2 镜',
      sourceOwner: 'scaena',
      sourceRef: 'breakdown:ep01',
      status: 'ready',
      digest: sha1,
      updatedAt: '2026-11-27T00:00:00Z',
    },
    {
      elementId: 'drama-assets-01',
      domain: 'drama',
      kind: 'drama.asset_readiness',
      title: '生产资产四轴就绪台账',
      subtitle: '2 项资产',
      sourceOwner: 'scaena',
      sourceRef: 'owner:scaena:assets',
      status: 'ready',
      digest: sha1,
      updatedAt: '2026-11-27T00:00:00Z',
    },
    {
      elementId: 'drama-timeline-01',
      domain: 'drama',
      kind: 'drama.edit_timeline',
      title: '粗剪时间线 · ep01',
      subtitle: '2 clips',
      sourceOwner: 'scaena',
      sourceRef: 'timeline:ep01',
      status: 'ready',
      digest: sha1,
      updatedAt: '2026-11-27T00:00:00Z',
    },
  ]

  let conflictOnce = Boolean(options?.failReviewConflict)

  const rpc = createMuweaveRpcClient(async (_url, init) => {
    gen += 1
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload: Record<string, unknown> }
    calls.push(body)

    if (body.action === 'bundle.elements.list') {
      const dom = body.payload.domain
      const kind = body.payload.kind
      const filtered = elements.filter((e) => (!dom || e.domain === dom) && (!kind || e.kind === kind))
      return new Response(
        JSON.stringify({
          ok: true,
          generation: gen,
          data: { projectId: 'proj_drama', title: 'Rainy Night', revision: 1, ownerStates: {}, elements: filtered },
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
          candidates: [{ artifactId: 'art_cand_1', handle: 'linwu-rain', sha256: sha1 }],
        }
      } else if (id === 'eikona-master-linwu') {
        payload = { handle: 'linwu', sha256: shaMaster }
      } else if (id === 'drama-sb-ep01') {
        payload = {
          rows: [
            {
              sceneRef: 'scene:01',
              shotRef: 'shot:01',
              order: 1,
              plannedDurationMicros: 3000000,
              cells: { camera: '近景推镜', subject: 'asset:linwu 雨中回眸' },
              restrictedFields: [],
              linkedMedia: shot01Media,
            },
            {
              sceneRef: 'scene:01',
              shotRef: 'shot:02',
              order: 2,
              plannedDurationMicros: 2500000,
              cells: { camera: '特写', prop: 'asset:watch 怀表落地' },
              restrictedFields: [],
              linkedMedia: shot02Media,
            },
          ],
        }
      } else if (id === 'drama-assets-01') {
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
            {
              assetRef: 'asset:watch',
              role: 'prop',
              parsedVersion: 1,
              axes: {
                scaenaAdmission: 'admitted',
                subjectFreeze: 'unfrozen',
                productionAcceptance: 'not_accepted',
                currentUsability: 'blocked',
              },
            },
          ],
        }
      } else if (id === 'drama-timeline-01') {
        payload = {
          aspectRatio: '9:16',
          fps: 24,
          clips: [
            { clip_ref: 'shot:01', in_ms: 0, out_ms: 3000 },
            { clip_ref: 'shot:02', in_ms: 3000, out_ms: 5500 },
          ],
        }
      }
      return new Response(
        JSON.stringify({ ok: true, generation: gen, data: { element: { ...base, schemaVersion: 'muweave.element.v1', payload } } }),
        { status: 200 },
      )
    }

    if (body.action === 'drama.shot.review.list') {
      return new Response(JSON.stringify({ ok: true, generation: gen, data: { reviews: Object.values(reviews) } }), { status: 200 })
    }

    if (body.action === 'drama.shot.review.set') {
      const shotRef = String(body.payload.shotRef)
      if (conflictOnce) {
        conflictOnce = false
        return new Response(
          JSON.stringify({
            ok: false,
            generation: gen,
            error: {
              code: 'muweave/review_revision_conflict',
              message: 'Revision mismatch',
              details: { currentRevision: 5 },
            },
          }),
          { status: 200 },
        )
      }
      const prev = reviews[shotRef]
      const updated: ShotReviewRecordV1 = {
        workspaceId: 'ws_1',
        shotRef,
        sceneRef: typeof body.payload.sceneRef === 'string' ? body.payload.sceneRef : undefined,
        status: body.payload.status as ShotReviewStatus,
        note: typeof body.payload.note === 'string' ? body.payload.note : undefined,
        tags: Array.isArray(body.payload.tags) ? (body.payload.tags as string[]) : [],
        revision: (prev?.revision ?? 0) + 1,
        updatedAt: '2026-11-27T01:00:00Z',
      }
      reviews[shotRef] = updated
      return new Response(JSON.stringify({ ok: true, generation: gen, data: { review: updated } }), { status: 200 })
    }

    if (body.action === 'drama.shot.review.batch') {
      const items = Array.isArray(body.payload.items) ? (body.payload.items as Array<Record<string, unknown>>) : []
      const results = items.map((item) => {
        const shotRef = String(item.shotRef)
        const prev = reviews[shotRef]
        const updated: ShotReviewRecordV1 = {
          workspaceId: 'ws_1',
          shotRef,
          sceneRef: typeof item.sceneRef === 'string' ? item.sceneRef : undefined,
          status: item.status as ShotReviewStatus,
          note: typeof item.note === 'string' ? item.note : undefined,
          tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
          revision: (prev?.revision ?? 0) + 1,
          updatedAt: '2026-11-27T01:05:00Z',
        }
        reviews[shotRef] = updated
        return { shotRef, ok: true, record: updated }
      })
      return new Response(
        JSON.stringify({
          ok: true,
          generation: gen,
          data: { results, succeededCount: results.length, failedCount: 0 },
        }),
        { status: 200 },
      )
    }

    if (body.action === 'shot.media.link') {
      const role = String(body.payload.role)
      shot01Media = [
        ...shot01Media,
        {
          sha256: typeof body.payload.sha256 === 'string' ? body.payload.sha256 : undefined,
          elementId: typeof body.payload.elementId === 'string' ? body.payload.elementId : undefined,
          artifactId: typeof body.payload.artifactId === 'string' ? body.payload.artifactId : undefined,
          role,
          mime: 'image/png',
        },
      ]
      return new Response(JSON.stringify({ ok: true, generation: gen, data: { ok: true } }), { status: 200 })
    }

    if (body.action === 'shot.media.unlink') {
      const role = String(body.payload.role)
      shot01Media = shot01Media.filter((m) => m.role !== role)
      return new Response(JSON.stringify({ ok: true, generation: gen, data: { ok: true } }), { status: 200 })
    }

    if (body.action === 'drama.export.manifest') {
      const format = String(body.payload.format ?? 'cmx3600_edl') as DramaExportFormat
      const ext = format === 'cmx3600_edl' ? 'edl' : format === 'shotlist_csv' ? 'csv' : 'json'
      const mimeType = format === 'cmx3600_edl' ? 'text/plain' : format === 'shotlist_csv' ? 'text/csv' : 'application/json'
      return new Response(
        JSON.stringify({
          ok: true,
          generation: gen,
          data: {
            export: {
              schema: 'muweave.drama-export.v1',
              format,
              filename: `drama-cut.${ext}`,
              mimeType,
              shotCount: 2,
              totalDurationMs: 5500,
              fps: 24,
              aspectRatio: '9:16',
              content: format === 'cmx3600_edl' ? 'TITLE: Rainy Night\nFCM: NON-DROP FRAME\n' : '{}',
              generatedAt: '2026-11-27T01:00:00Z',
            },
          },
        }),
        { status: 200 },
      )
    }

    if (body.action === 'media.token.issue') {
      return new Response(
        JSON.stringify({
          ok: true,
          generation: gen,
          data: { token: 'tok_test', url: '/api/muweave-dsh/media?token=tok_test', expiresInMs: 60000 },
        }),
        { status: 200 },
      )
    }

    if (body.action === 'timing.projection') {
      return new Response(
        JSON.stringify({
          ok: true,
          generation: gen,
          data: { capturedAt: '2026-11-27T00:00:00Z', activeCount: 0, waitingHumanCount: 0, reconcileRequiredCount: 0, spans: [] },
        }),
        { status: 200 },
      )
    }

    return new Response(JSON.stringify({ ok: true, generation: gen, data: {} }), { status: 200 })
  })

  return { rpc, calls }
}

describe('Drama Production Room v2 UI', () => {
  it('filters storyboard shots, inspects a shot, saves director review, and binds/unlinks 6-role media', async () => {
    const { rpc, calls } = createDramaStudioRpc()
    const coreT = createFallbackTranslator('zh')

    const { container } = render(<DramaMainPage rpc={rpc} t={t} coreT={coreT} />)
    await waitFor(() => {
      expect(container.querySelector('[data-muweave-shot-card="shot:01"]')).toBeTruthy()
      expect(container.querySelector('[data-muweave-shot-card="shot:02"]')).toBeTruthy()
    })

    // RoomHero includes 审片通过 stat (1/2)
    const approvedStatLabel = screen.getByText('审片通过')
    expect(approvedStatLabel.closest('li')?.textContent).toContain('1/2')

    // Filter by missing visual -> hides shot:01 (has keyframe), keeps shot:02
    const mediaFilter = container.querySelector('[data-filter-media="true"]') as HTMLSelectElement
    fireEvent.change(mediaFilter, { target: { value: 'missing_visual' } })
    expect(container.querySelector('[data-muweave-shot-card="shot:01"]')).toBeNull()
    expect(container.querySelector('[data-muweave-shot-card="shot:02"]')).toBeTruthy()
    fireEvent.change(mediaFilter, { target: { value: 'all' } })

    // Open ShotInspector for shot:01
    const inspectBtn = container.querySelector('[data-inspect-shot-btn="shot:01"]') as HTMLButtonElement
    fireEvent.click(inspectBtn)
    await waitFor(() => {
      expect(container.querySelector('[data-muweave-shot-inspector="shot:01"]')).toBeTruthy()
    })

    // Change review status to locked, add a note, and save
    fireEvent.click(container.querySelector('[data-review-status-option="locked"]') as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('导演批注'), { target: { value: '定版锁定' } })
    fireEvent.click(container.querySelector('[data-review-save="true"]') as HTMLButtonElement)

    await waitFor(() => {
      const saveCall = calls.find((c) => c.action === 'drama.shot.review.set')
      expect(saveCall).toBeDefined()
      expect(saveCall?.payload.status).toBe('locked')
      expect(saveCall?.payload.expectedRevision).toBe(1)
    })

    // Bind Eikona visual to reference role
    fireEvent.click(container.querySelector('[data-shot-media-bind="reference"]') as HTMLButtonElement)
    await waitFor(() => {
      const linkCall = calls.find((c) => c.action === 'shot.media.link')
      expect(linkCall).toBeDefined()
      expect(linkCall?.payload.role).toBe('reference')
      expect(Boolean(linkCall?.payload.sha256) !== Boolean(linkCall?.payload.elementId)).toBe(true)
    })

    // Unlink voice media
    fireEvent.click(container.querySelector('[data-shot-media-unlink="voice"]') as HTMLButtonElement)
    await waitFor(() => {
      const unlinkCall = calls.find((c) => c.action === 'shot.media.unlink')
      expect(unlinkCall).toBeDefined()
      expect(unlinkCall?.payload.role).toBe('voice')
    })
  })

  it('surfaces optimistic lock conflict in ShotInspector and allows reloading reviews', async () => {
    const { rpc, calls } = createDramaStudioRpc({ failReviewConflict: true })
    const coreT = createFallbackTranslator('zh')

    const { container } = render(<DramaMainPage rpc={rpc} t={t} coreT={coreT} />)
    await waitFor(() => {
      expect(container.querySelector('[data-inspect-shot-btn="shot:01"]')).toBeTruthy()
    })

    fireEvent.click(container.querySelector('[data-inspect-shot-btn="shot:01"]') as HTMLButtonElement)
    await waitFor(() => {
      expect(container.querySelector('[data-review-save="true"]')).toBeTruthy()
    })

    fireEvent.click(container.querySelector('[data-review-save="true"]') as HTMLButtonElement)
    await waitFor(() => {
      expect(container.querySelector('[data-review-conflict="true"]')).toBeTruthy()
    })

    const beforeCount = calls.filter((c) => c.action === 'drama.shot.review.list').length
    fireEvent.click(container.querySelector('[data-review-conflict-reload="true"]') as HTMLButtonElement)
    await waitFor(() => {
      expect(calls.filter((c) => c.action === 'drama.shot.review.list').length).toBeGreaterThan(beforeCount)
    })
  })

  it('toggles collapsible AnimaticPlayer, exports rough-cut packages on multi-track timeline, and links side-by-side + assets', async () => {
    const { rpc, calls } = createDramaStudioRpc()
    const coreT = createFallbackTranslator('zh')

    const { container } = render(<DramaMainPage rpc={rpc} t={t} coreT={coreT} />)
    await waitFor(() => {
      expect(container.querySelector('[data-animatic-toggle="true"]')).toBeTruthy()
    })

    // Expand AnimaticPlayer
    fireEvent.click(container.querySelector('[data-animatic-toggle="true"]') as HTMLButtonElement)
    await waitFor(() => {
      expect(container.querySelector('.dr-animatic')).toBeTruthy()
    })

    // Switch to Timeline tab (preserves exact tab ID)
    fireEvent.click(screen.getByRole('tab', { name: '剪辑时间线' }))
    await waitFor(() => {
      expect(container.querySelector('[data-multitrack="true"]')).toBeTruthy()
      expect(container.querySelector('[data-track-lane="visual"]')).toBeTruthy()
      expect(container.querySelector('[data-track-lane="voice"]')).toBeTruthy()
      expect(container.querySelector('[data-track-lane="sfx"]')).toBeTruthy()
    })

    // Export EDL
    fireEvent.click(container.querySelector('[data-export-format="cmx3600_edl"]') as HTMLButtonElement)
    await waitFor(() => {
      const expCall = calls.find((c) => c.action === 'drama.export.manifest')
      expect(expCall?.payload.format).toBe('cmx3600_edl')
      expect(container.querySelector('[data-export-receipt="true"]')).toBeTruthy()
    })

    // Click clip opens ShotInspector
    fireEvent.click(container.querySelector('[data-timeline-clip="shot:02"]') as HTMLButtonElement)
    await waitFor(() => {
      expect(container.querySelector('[data-muweave-shot-inspector="shot:02"]')).toBeTruthy()
    })

    // Switch to Side-by-Side tab: scene:02 shows 未拆镜 badge, clicking scene:01 filters shots
    fireEvent.click(screen.getByRole('tab', { name: '剧本 ↔ 分镜' }))
    await waitFor(() => {
      expect(container.querySelector('[data-scene-uncovered="true"]')).toBeTruthy()
    })
    const scene02Btn = container.querySelector('[data-scene-card="scene:02"] button') as HTMLButtonElement
    fireEvent.click(scene02Btn)
    await waitFor(() => {
      expect(screen.getByText('该场次暂无拆解镜头')).toBeTruthy()
    })
    fireEvent.click(container.querySelector('[data-clear-scene-filter="true"]') as HTMLButtonElement)
    await waitFor(() => {
      expect(container.querySelector('[data-sidebyside-shot="shot:01"]')).toBeTruthy()
    })

    // Switch to Assets tab: filter blocked assets and click impacted shot chip
    fireEvent.click(screen.getByRole('tab', { name: '资产就绪' }))
    await waitFor(() => {
      expect(container.querySelector('[data-asset-card="asset:linwu"]')).toBeTruthy()
      expect(container.querySelector('[data-asset-card="asset:watch"]')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '阻塞中' }))
    await waitFor(() => {
      expect(container.querySelector('[data-asset-card="asset:linwu"]')).toBeNull()
      expect(container.querySelector('[data-asset-card="asset:watch"]')).toBeTruthy()
    })
    const impactedShotChip = container.querySelector('[data-asset-impacts="asset:watch"] [data-impacted-shot="shot:02"]') as HTMLButtonElement
    expect(impactedShotChip).toBeTruthy()
    fireEvent.click(impactedShotChip)
    await waitFor(() => {
      expect(container.querySelector('[data-muweave-shot-inspector="shot:02"]')).toBeTruthy()
    })
  })

  it('supports Episode Readiness Strip filtering, Batch Review + @ staging, and ShotInspector keyboard accelerators', async () => {
    const { rpc, calls } = createDramaStudioRpc()
    const coreT = createFallbackTranslator('zh')

    const { container } = render(<DramaMainPage rpc={rpc} t={t} coreT={coreT} />)
    await waitFor(() => {
      expect(container.querySelector('[data-drama-readiness-strip="true"]')).toBeTruthy()
    })

    // 6-track media completeness: shot:01 (2/6) + shot:02 (1/6) = 3/12 = 25%
    const completeness = container.querySelector('[data-media-completeness="25"]')
    expect(completeness).toBeTruthy()

    // Click 'approved' segment in Readiness Strip -> filters to shot:01 only
    fireEvent.click(container.querySelector('[data-readiness-segment="approved"]') as HTMLButtonElement)
    expect(container.querySelector('[data-muweave-shot-card="shot:01"]')).toBeTruthy()
    expect(container.querySelector('[data-muweave-shot-card="shot:02"]')).toBeNull()
    // Click again to clear filter
    fireEvent.click(container.querySelector('[data-readiness-segment="approved"]') as HTMLButtonElement)
    expect(container.querySelector('[data-muweave-shot-card="shot:02"]')).toBeTruthy()

    // Multi-select checkboxes + Batch Action Bar
    fireEvent.click(container.querySelector('[data-shot-select="shot:01"]') as HTMLInputElement)
    fireEvent.click(container.querySelector('[data-shot-select="shot:02"]') as HTMLInputElement)
    await waitFor(() => {
      expect(container.querySelector('[data-drama-batch-bar="true"]')).toBeTruthy()
    })

    // Stage @ to Agent
    fireEvent.click(container.querySelector('[data-batch-action="stage-agent"]') as HTMLButtonElement)
    await waitFor(() => {
      expect(screen.getByText(/已打包选中镜头送入悬浮 Agent/)).toBeTruthy()
    })

    // Batch approve via drama.shot.review.batch
    fireEvent.click(container.querySelector('[data-batch-action="approved"]') as HTMLButtonElement)
    await waitFor(() => {
      const batchCall = calls.find((c) => c.action === 'drama.shot.review.batch')
      expect(batchCall).toBeDefined()
      expect(Array.isArray(batchCall?.payload.items)).toBe(true)
      expect((batchCall?.payload.items as unknown[]).length).toBe(2)
      expect(container.querySelector('[data-drama-batch-bar="true"]')).toBeNull()
    })

    // ShotInspector keyboard accelerators
    fireEvent.click(container.querySelector('[data-inspect-shot-btn="shot:01"]') as HTMLButtonElement)
    await waitFor(() => {
      expect(container.querySelector('[data-muweave-shot-inspector="shot:01"]')).toBeTruthy()
      expect(container.querySelector('[data-inspector-kbd-hints="true"]')).toBeTruthy()
    })

    // ArrowRight navigates to shot:02
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => {
      expect(container.querySelector('[data-muweave-shot-inspector="shot:02"]')).toBeTruthy()
    })

    // 'k' navigates back to shot:01
    fireEvent.keyDown(window, { key: 'k' })
    await waitFor(() => {
      expect(container.querySelector('[data-muweave-shot-inspector="shot:01"]')).toBeTruthy()
    })

    // Key inside textarea must NOT trigger review save accelerator
    const reviewCallsBefore = calls.filter((c) => c.action === 'drama.shot.review.set').length
    const noteArea = screen.getByLabelText('导演批注') as HTMLTextAreaElement
    fireEvent.keyDown(noteArea, { key: 'r' })
    expect(calls.filter((c) => c.action === 'drama.shot.review.set').length).toBe(reviewCallsBefore)

    // 'r' outside inputs quick-sets needs_revision
    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() => {
      const revCalls = calls.filter((c) => c.action === 'drama.shot.review.set')
      expect(revCalls.length).toBeGreaterThan(reviewCallsBefore)
      expect(revCalls[revCalls.length - 1]?.payload.status).toBe('needs_revision')
    })

    // 'a' outside inputs quick-sets approved
    const reviewCallsBeforeA = calls.filter((c) => c.action === 'drama.shot.review.set').length
    fireEvent.keyDown(window, { key: 'a' })
    await waitFor(() => {
      const revCalls = calls.filter((c) => c.action === 'drama.shot.review.set')
      expect(revCalls.length).toBeGreaterThan(reviewCallsBeforeA)
      expect(revCalls[revCalls.length - 1]?.payload.status).toBe('approved')
    })

    // Escape closes inspector
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(container.querySelector('[data-muweave-shot-inspector]')).toBeNull()
    })
  })
})
