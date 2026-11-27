import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  BUILTIN_CREATOR_TEMPLATES,
  closeGeneration,
  createFallbackTranslator,
  getActiveTheaterRoomId,
  getGenerationSnapshot,
  setActiveTheaterRoom,
  unavailableReasonLabel,
  type MuweaveRpcClient,
  type TemplateCatalogEntryV1,
} from '@yeisme/dsh-muweave-core/client'
import { registerTheaterRoom } from '../packages/dsh-muweave-core/src/client/theater/registry'
import { EikonaMainPage } from '@yeisme/dsh-muweave-eikona/client'
import { KitMainPage } from '@yeisme/dsh-muweave-kit/client'
import { ScheduleMainPage } from '@yeisme/dsh-muweave-schedule/client'
import { ScriptMainPage } from '@yeisme/dsh-muweave-script/client'
import { WorkbenchDraftPage } from '@yeisme/dsh-muweave-workbench/client'

afterEach(() => {
  cleanup()
  closeGeneration()
})

const KIT_ZH: Record<string, string> = {
  panelTitle: '创作工具箱',
  roomTitle: '工具箱',
  subtitle: 'CLI / Skills / 预设提示词',
  tabTemplates: '预设提示词',
  tabSkills: '创作技能',
  tabCli: 'CLI 操作卡',
  stageTemplateBtn: '组装并推入助手',
  copyPromptBtn: '复制提示词',
  copiedPromptReceipt: '已复制提示词',
  generateDirectBtn: '直接去生成',
  catAll: '全部',
  catEikona: '视觉',
  catScript: '剧本',
  catDrama: '分镜',
  catFilterLabel: '按分类筛选模板',
  runCliBtn: '执行只读诊断',
  selectPlaceholder: '请选择',
  slotCount: '{n} 个插槽',
  required: '必填',
  preview: '组装结果',
  skillsHint: '技能提示',
  stageSkill: '推入悬浮助手',
  copyCommand: '复制命令',
  cliHint: '诊断提示',
  output: '输出',
  doctor: '原件体检',
}

const SCHED_ZH: Record<string, string> = {
  panelTitle: '幕织排期板',
  roomTitle: '排期',
  heroEyebrow: '幕织 · 发布档期',
  heroTitle: '这周怎么排',
  heroLede: '排期说明',
  statMonth: '本月已排',
  statBacklog: '待排',
  statOverdue: '已过期',
  today: '今天',
  prevMonth: '上个月',
  nextMonth: '下个月',
  backlogTitle: '待排池',
  backlogHint: '点选排期',
  backlogEmpty: '没有待排内容',
  monthEmpty: '这个月还没有任何排期。',
  boardTitle: '发布日历',
  selected: '已选中',
  clearSelection: '取消选择',
  unschedule: '取消排期',
  planned: '已排期',
  noteLabel: '备注',
  notePlaceholder: '备注',
  savedNotice: '已排到 {date}',
  clearedNotice: '已取消 {ref} 的排期',
  failedNotice: '排期失败：{code}',
  weekdayMon: '一',
  weekdayTue: '二',
  weekdayWed: '三',
  weekdayThu: '四',
  weekdayFri: '五',
  weekdaySat: '六',
  weekdaySun: '日',
  kindScene: '场次',
  kindShot: '镜头',
  kindDraft: '成稿',
  kindVisual: '视觉',
  kindArtifact: '工件',
  kindElement: '元件',
  legendHint: '提示',
  undoNotice: '可撤销 {date}',
  undoAction: '撤销',
  dayNavHint: '导航',
  syncEmptyAction: '同步',
  projectLabel: '项目',
  projectUnsupported: '不支持',
  noActiveProject: '未选项目',
  projectOverviewHint: '在总览切换',
  backlogCollapse: '收起',
  backlogExpand: '展开',
  monthNavLabel: '切换月份',
  unknownGroupTitle: '归属未知',
  othersGroupTitle: '其它项目',
  unknownChipSuffix: '归属未知',
  othersChipSuffix: '其它项目',
  unknownOwnershipHint: '未知归属',
  inferredOwnershipHint: '推断归属',
  inferredChipMark: '推',
  inferredChipSuffix: '推断',
  legacyEntriesHint: '旧排期 {count}',
  showOtherProjectEntries: '显示其它项目',
  hideOtherProjectEntries: '隐藏其它项目',
  projectStatusPreparing: '筹备中',
  projectStatusInProduction: '制作中',
  projectStatusReadyToPublish: '待发布',
  projectStatusPublished: '已发布',
  projectStatusArchived: '已归档',
  calPrevShort: '< 上月',
  calNextShort: '下月 >',
  calBackToToday: '回到今天',
  calPlannedCount: '本月已排 {n} 项',
  backlogSearchPlaceholder: '搜索待排条目…',
  backlogFilterAll: '全部',
  backlogFilterVisual: '视觉',
  backlogFilterScript: '剧本',
  backlogFilterDrama: '分镜',
  backlogFilterEmpty: '没有匹配的待排条目。',
}

function makeRpc(handlers: Record<string, (payload: Record<string, unknown>) => unknown>): MuweaveRpcClient {
  return {
    async call<T = unknown>(action: string, payload?: Record<string, unknown>) {
      const fn = handlers[action]
      const data = (fn ? fn(payload ?? {}) : {}) as T
      return { ok: true as const, generation: 1, data }
    },
    async resolveMediaUrl() {
      return undefined
    },
    generation() {
      return 1
    },
  }
}

describe('product polish v4', () => {
  it('maps unavailable reason codes to localized zh and en labels', () => {
    expect(unavailableReasonLabel('NO_COST_CAP', 'zh')).toBe('未接费用封顶')
    expect(unavailableReasonLabel('OWNER_NOT_INSTALLED', 'zh')).toBe('未安装引擎')
    expect(unavailableReasonLabel('NO_SUBMIT_COMMAND', 'en')).toBe('No submit command')
    expect(unavailableReasonLabel('ADAPTER_PENDING', 'en')).toBe('Adapter pending')
    expect(unavailableReasonLabel('MARKER_MISSING', 'zh')).toBe('缺少工作区标记')
    expect(unavailableReasonLabel('PAID_DISABLED_BY_HOST', 'zh')).toBe('宿主已关闭付费')
    expect(unavailableReasonLabel('CUSTOM_UNKNOWN_CODE', 'zh')).toBe('CUSTOM_UNKNOWN_CODE')
  })

  it('Kit filters templates by category, copies rendered prompt, and opens GenerationDrawer', async () => {
    const audioTpl: TemplateCatalogEntryV1 = {
      templateRef: 'promptrepo://official/audio/drama-ambient-sfx-v1@1.0.0?locale=zh',
      releaseId: 'rel_audio_1',
      title: '声景音效配方',
      category: 'drama',
      version: '1.0.0',
      digest: 'sha256:audio',
      summary: '环境氛围与动作音效',
      slots: [{ name: 'scene', label: '场景', inputType: 'text', required: true }],
    }
    const templates: TemplateCatalogEntryV1[] = [...BUILTIN_CREATOR_TEMPLATES, audioTpl]
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const rpc = makeRpc({
      'templates.list': () => ({ templates }),
      'cli.catalog': () => ({ operations: [] }),
      'templates.render_preview': (p) => ({
        templateRef: String(p.templateRef),
        structuredInstruction: `RENDERED:${String(p.templateRef)}`,
      }),
    })

    render(
      <KitMainPage
        rpc={rpc}
        t={(k) => KIT_ZH[k] ?? k}
        coreT={createFallbackTranslator('zh')}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('声景音效配方')).toBeTruthy()
    })

    // Filter to drama category
    const dramaPill = document.querySelector('[data-kit-cat-bar="true"] button[data-category="drama"]') as HTMLButtonElement
    expect(dramaPill).toBeTruthy()
    fireEvent.click(dramaPill)
    expect(document.querySelectorAll('.kt-tpl[data-category="eikona"]').length).toBe(0)
    expect(document.querySelectorAll('.kt-tpl[data-category="drama"]').length).toBeGreaterThan(0)

    // Select audio template and test Copy Prompt + Generate Now
    fireEvent.click(screen.getByText('声景音效配方'))
    const copyBtn = document.querySelector('[data-kit-copy-prompt="true"]') as HTMLButtonElement
    fireEvent.click(copyBtn)
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`RENDERED:${audioTpl.templateRef}`)
      expect(document.querySelector('[data-kit-copied-receipt="true"]')).toBeTruthy()
    })

    const genBtn = document.querySelector('[data-kit-generate-direct="true"]') as HTMLButtonElement
    fireEvent.click(genBtn)
    await waitFor(() => {
      const snap = getGenerationSnapshot()
      expect(snap.open).toBe(true)
      expect(snap.request?.capabilityId).toBe('sonora.sfx.generate')
      expect(snap.request?.input?.prompt).toBe(`RENDERED:${audioTpl.templateRef}`)
    })
  })

  it('Schedule renders calendar navigation header and filters backlog by keyword and domain', async () => {
    const rpc = makeRpc({
      'schedule.list': () => ({ entries: [] }),
      'project.list': () => ({ projects: [], activeProjectId: undefined }),
      'bundle.elements.list': () => ({
        elements: [
          { elementId: 'el_vis_1', title: '女主定妆照', kind: 'eikona.candidate_group', status: 'ready', domain: 'eikona' },
          { elementId: 'el_sc_1', title: '第一场天台对峙', kind: 'auctra.scene_card', status: 'draft', domain: 'script' },
          { elementId: 'el_sh_1', title: '镜头01俯拍推镜', kind: 'drama.shot', status: 'ready', domain: 'drama' },
        ],
      }),
    })

    render(
      <ScheduleMainPage
        rpc={rpc}
        t={(k) => SCHED_ZH[k] ?? k}
        coreT={createFallbackTranslator('zh')}
      />,
    )

    const calHeader = document.querySelector('[data-schedule-cal-header="true"]')
    expect(calHeader).toBeTruthy()
    const titleEl = document.querySelector('[data-sched-cal-title="true"]') as HTMLElement
    const initialMonth = titleEl.textContent

    fireEvent.click(document.querySelector('[data-sched-cal-next="true"]') as HTMLButtonElement)
    expect(titleEl.textContent).not.toBe(initialMonth)

    fireEvent.click(document.querySelector('[data-sched-cal-today="true"]') as HTMLButtonElement)
    expect(titleEl.textContent).toBe(initialMonth)

    await waitFor(() => {
      expect(screen.getByText('女主定妆照')).toBeTruthy()
      expect(screen.getByText('第一场天台对峙')).toBeTruthy()
      expect(screen.getByText('镜头01俯拍推镜')).toBeTruthy()
    })

    // Filter by domain = script
    const scriptPill = document.querySelector('[data-schedule-backlog-filter="true"] button[data-domain="script"]') as HTMLButtonElement
    fireEvent.click(scriptPill)
    expect(screen.getByText('第一场天台对峙')).toBeTruthy()
    expect(screen.queryByText('女主定妆照')).toBeNull()
    expect(screen.queryByText('镜头01俯拍推镜')).toBeNull()

    // Reset to all and search by keyword
    const allPill = document.querySelector('[data-schedule-backlog-filter="true"] button[data-domain="all"]') as HTMLButtonElement
    fireEvent.click(allPill)
    const searchInput = document.querySelector('[data-schedule-backlog-filter="true"] input[type="search"]') as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: '俯拍' } })
    expect(screen.getByText('镜头01俯拍推镜')).toBeTruthy()
    expect(screen.queryByText('女主定妆照')).toBeNull()
  })

  it('Eikona binds a candidate directly to a storyboard shot and links to Drama room', async () => {
    const linkCalls: Array<Record<string, unknown>> = []
    const disposeDrama = registerTheaterRoom({
      id: 'muweave-drama',
      order: 40,
      title: () => '分镜生产',
      description: () => '分镜生产',
      domains: ['drama'],
      icon: () => null,
      Main: () => null,
      Companion: () => null,
    })
    const disposeEikona = registerTheaterRoom({
      id: 'muweave-eikona',
      order: 20,
      title: () => '视觉',
      description: () => '视觉',
      domains: ['eikona'],
      icon: () => null,
      Main: () => null,
      Companion: () => null,
    })
    setActiveTheaterRoom('muweave-eikona')
    try {

    const rpc = makeRpc({
      'bundle.elements.list': (p) => {
        if (p.domain === 'eikona') {
          return {
            elements: [
              {
                elementId: 'ek_group_1',
                title: '女主雨夜特写',
                kind: 'eikona.candidate_group',
                status: 'waiting_review',
                domain: 'eikona',
                sourceRef: 'group_rain',
              },
            ],
          }
        }
        if (p.kind === 'drama.storyboard_table') {
          return {
            elements: [
              {
                elementId: 'dr_board_1',
                title: 'EP01 分镜表',
                kind: 'drama.storyboard_table',
                status: 'ready',
                domain: 'drama',
                sourceRef: 'ep01',
              },
            ],
          }
        }
        return { elements: [] }
      },
      'bundle.element.get': (p) => {
        if (p.elementId === 'ek_group_1') {
          return {
            element: {
              elementId: 'ek_group_1',
              payload: {
                groupId: 'group_rain',
                candidates: [
                  {
                    artifactId: 'art_rain_01',
                    modelRef: 'openai/gpt-image-2.5-sunburst',
                    status: 'waiting_review',
                    blobDigest: `sha256:${'a'.repeat(64)}`,
                    mime: 'image/png',
                    promptSummary: '雨夜特写',
                  },
                ],
              },
            },
          }
        }
        if (p.elementId === 'dr_board_1') {
          return {
            element: {
              elementId: 'dr_board_1',
              payload: {
                rows: [
                  { order: 1, shotRef: 'shot_01', sceneRef: 'sc_01', plannedDurationMicros: 3_000_000 },
                ],
              },
            },
          }
        }
        return { element: { elementId: String(p.elementId), payload: {} } }
      },
      'shot.media.link': (p) => {
        linkCalls.push(p)
        return { linked: true }
      },
    })

    render(
      <EikonaMainPage
        rpc={rpc}
        t={(k) => k}
        coreT={createFallbackTranslator('zh')}
      />,
    )

    await waitFor(() => {
      expect(document.querySelector('[data-eikona-bind-shot="art_rain_01"]')).toBeTruthy()
    })

    const bindSubmit = document.querySelector('[data-eikona-bind-shot="art_rain_01"] [data-bind-shot-submit]') as HTMLButtonElement
    fireEvent.click(bindSubmit)

    await waitFor(() => {
      expect(linkCalls.length).toBe(1)
      expect(linkCalls[0]?.shotRef).toBe('shot_01')
      expect(linkCalls[0]?.role).toBe('keyframe')
      expect(document.querySelector('[data-eikona-bind-receipt="true"]')).toBeTruthy()
    })

    const gotoDrama = document.querySelector('[data-eikona-goto-drama="true"]') as HTMLButtonElement
    expect(gotoDrama).toBeTruthy()
    fireEvent.click(gotoDrama)
    expect(getActiveTheaterRoomId()).toBe('muweave-drama')
    } finally {
      disposeDrama()
      disposeEikona()
    }
  })

  it('Script upgrades dual-timeline cards and supports linear reader mode with total duration', async () => {
    const rpc = makeRpc({
      'bundle.elements.list': () => ({
        elements: [
          {
            elementId: 'sc_timeline_1',
            title: 'EP01 双时间轴',
            kind: 'script.timeline',
            status: 'ready',
            domain: 'script',
            sourceRef: 'ep01',
          },
          {
            elementId: 'sc_card_1',
            title: '第一场 雨夜天台',
            kind: 'script.scene_card',
            status: 'approved',
            domain: 'script',
            sourceRef: 'sc_01',
            sceneRef: 'sc_01',
          },
        ],
      }),
      'bundle.element.get': (p) => {
        if (p.elementId === 'sc_timeline_1') {
          return {
            element: {
              elementId: 'sc_timeline_1',
              payload: {
                scenes: [{ scene_ref: 'sc_01', order: 1, title: '第一场 雨夜天台' }],
                storyTimeAnchors: [{ scene_ref: 'sc_01', label: '00:00' }],
              },
            },
          }
        }
        if (p.elementId === 'sc_card_1') {
          return {
            element: {
              elementId: 'sc_card_1',
              payload: {
                sceneId: 'sc_01',
                goal: '女主质问男主隐藏的真相并要求立刻交出钥匙',
                obstacle: '暴雨倾盆且保安正在上楼搜查',
                turn: '男主反手把钥匙丢下天台边缘',
                revision: 2,
              },
            },
          }
        }
        return { element: { elementId: String(p.elementId), payload: {} } }
      },
    })

    render(
      <ScriptMainPage
        rpc={rpc}
        t={(k) => k}
        coreT={createFallbackTranslator('zh')}
      />,
    )

    await waitFor(() => {
      const card = document.querySelector('[data-script-timeline-card="sc_01"]')
      expect(card).toBeTruthy()
      expect(Number(card?.getAttribute('data-est-duration'))).toBeGreaterThanOrEqual(3)
    })

    // Click timeline card to jump to scene-cards tab
    fireEvent.click(document.querySelector('[data-script-timeline-card="sc_01"]') as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('viewLinearRead')).toBeTruthy()
    })

    // Switch to linear reader mode
    fireEvent.click(screen.getByText('viewLinearRead'))

    await waitFor(() => {
      expect(document.querySelector('[data-script-reader="true"]')).toBeTruthy()
      expect(document.querySelector('[data-script-total-duration]')).toBeTruthy()
    })
  })

  it('Draft room renders director review badges, 6-track readiness dots, and navigates to Drama room', async () => {
    const disposeDrama = registerTheaterRoom({
      id: 'muweave-drama',
      order: 40,
      title: () => '分镜生产',
      description: () => '分镜生产',
      domains: ['drama'],
      icon: () => null,
      Main: () => null,
      Companion: () => null,
    })
    const disposeDraft = registerTheaterRoom({
      id: 'muweave-draft',
      order: 42,
      title: () => '成稿',
      description: () => '成稿',
      domains: ['drama'],
      icon: () => null,
      Main: () => null,
      Companion: () => null,
    })
    setActiveTheaterRoom('muweave-draft')
    try {

    const rpc = makeRpc({
      'bundle.elements.list': (p) => {
        if (p.kind === 'drama.storyboard_table') {
          return {
            elements: [
              {
                elementId: 'dr_board_1',
                title: 'EP01 分镜表',
                kind: 'drama.storyboard_table',
                status: 'ready',
                domain: 'drama',
                sourceRef: 'ep01',
              },
            ],
          }
        }
        return { elements: [] }
      },
      'bundle.element.get': () => ({
        element: {
          elementId: 'dr_board_1',
          payload: {
            rows: [
              {
                order: 1,
                shotRef: 'shot_01',
                sceneRef: 'sc_01',
                plannedDurationMicros: 4_000_000,
                cells: { visual: '雨夜俯拍推镜' },
                restrictedKeys: [],
                linkedMedia: [
                  { role: 'keyframe', sha256: 'b'.repeat(64), mime: 'image/png' },
                  { role: 'voice', sha256: 'c'.repeat(64), mime: 'audio/mpeg' },
                ],
              },
            ],
          },
        },
      }),
      'drama.shot.review.list': () => ({
        reviews: [
          {
            workspaceId: 'ws_1',
            shotRef: 'shot_01',
            status: 'approved',
            tags: ['节奏'],
            revision: 3,
            updatedAt: '2026-11-27T10:00:00Z',
          },
        ],
      }),
    })

    render(
      <WorkbenchDraftPage
        rpc={rpc}
        t={(k) => k}
        coreT={createFallbackTranslator('zh')}
      />,
    )

    await waitFor(() => {
      const badge = document.querySelector('[data-draft-review-status="approved"]')
      expect(badge).toBeTruthy()
      const readiness = document.querySelector('[data-draft-readiness]')
      expect(readiness).toBeTruthy()
      expect(readiness?.querySelectorAll('.dr-role-dot[data-filled="true"]').length).toBe(2)
    })

    const gotoDrama = document.querySelector('[data-draft-open-drama="true"]') as HTMLButtonElement
    expect(gotoDrama).toBeTruthy()
    fireEvent.click(gotoDrama)
    expect(getActiveTheaterRoomId()).toBe('muweave-drama')
    } finally {
      disposeDrama()
      disposeDraft()
    }
  })
})
