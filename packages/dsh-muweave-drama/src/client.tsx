import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AnimaticPlayer,
  CompanionList,
  CoverCollage,
  EmptyState,
  IconButton,
  MediaCard,
  Poster,
  RoomHero,
  SHOT_MEDIA_ROLE_LIST,
  SectionHead,
  Segmented,
  ShotGenerateButton,
  ShotMedia,
  StatusTag,
  ToneDot,
  WorkspaceShell,
  publishTheaterRoomBadges,
  registerMuweaveCreatorPlugin,
  shotDescription,
  shotReadinessSummary,
  stageItemToFloatingAgent,
  statusTone,
  useProjectCovers,
  type CutTransitionKind,
  type DshClientContextLike,
  type EpisodeCutOverrideV1,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  type ShotReviewBatchResultV1,
  type ShotReviewRecordV1,
  type ShotReviewSetInputV1,
  type ShotReviewStatus,
  type WorkspaceNotice,
} from '@yeisme/dsh-muweave-core/client'
import { AssetsView } from './assets-view'
import {
  REVIEW_STATUSES,
  ShotInspector,
  formatCell,
  formatDurationSec,
  pad2,
  reviewStatusLabel,
  type AssetRow,
  type EikonaBindableItem,
  type StoryboardRow,
} from './shot-inspector'
import { SideBySideView } from './side-by-side-view'
import { TimelineView } from './timeline-view'

export const name = '@yeisme/dsh-muweave-drama'
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const DRAMA_PANEL_ID = 'muweave-drama'
export const DRAMA_COMPANION_ID = 'muweave-drama/companion'
export const DRAMA_LOCALE_NS = 'muweaveDrama'

const zh = {
  panelTitle: '做剧分镜与生产台 (Scaena)',
  roomTitle: '分镜生产',
  companionTitle: '分镜与资产四轴',
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
  restrictedNote: '受保护字段（仅显示字段名）',
  aspect: '画幅',
  shotCount: '镜',
  clipCount: '片段',
  scriptSide: '剧本场次卡 (Auctra)',
  shotSide: '对应拆解镜头 (Scaena)',
  seconds: '秒',
  heroEyebrow: 'Scaena · 分镜生产',
  heroEmptyTitle: '还没有分镜',
  heroLede: '一镜一格地看本集：时长、要素、6 轨媒体和导演审片是否就绪。',
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
  reviewNotePlaceholder: '记录镜头修改意见或锁定说明…',
  saveReview: '保存审片',
  savingReview: '保存中…',
  reviewSaved: '审片已保存',
  reviewConflictMsg: '审片记录已被更新（版本冲突），请重新读取最新记录后再保存。',
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
  shotSearchPlaceholder: '搜索镜号 / 场次 / 画面 / 批注…',
  filmstripLabel: '镜头快速跳转胶片条',
  copyReviewMarkdown: '复制审片纪要 (Markdown)',
  reviewMdCopied: '已复制审片纪要 (Markdown)',
  mdSummaryTitle: '分镜审片纪要',
  mdMissingRoles: '缺失轨',
  mdAllRolesReady: '全轨齐套',
  allEpisodes: '全部集',
  episodeFilterLabel: '分集切换',
  cutBannerLabel: '已启用无损粗剪覆写',
  cutModifiedItems: '项微调',
  cutResetBtn: '重置回原序',
  cutResetDone: '已重置本集粗剪覆写',
  cutMoveUp: '上移',
  cutMoveDown: '下移',
  cutOmit: '跳过',
  cutRestore: '恢复',
  cutOmittedBadge: '已跳过',
  cutControlsTitle: '粗剪微调',
  cutDurationLabel: '时长 (秒)',
  cutTransitionLabel: '转场',
  transition_cut: '硬切 (Cut)',
  transition_crossfade: '叠化 (Crossfade)',
  transition_dip_to_black: '黑场 (Dip to Black)',
  exportFcpxml: '导出 FCPXML',
  exportJianying: '导出剪映草稿',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: 'Drama Production Desk (Scaena)',
  roomTitle: 'Production',
  companionTitle: 'Storyboard & 4-Axis Assets',
  tabStoryboard: 'Storyboard',
  tabAssets: 'Asset Readiness',
  tabTimeline: 'Edit Timeline',
  tabSideBySide: 'Script ↔ Shots',
  colOrder: '#',
  colShot: 'Shot',
  colScene: 'Scene',
  colDuration: 'Duration',
  colCells: 'Shot Fields',
  colAsset: 'Asset',
  colRole: 'Role',
  colVersion: 'Version',
  colReview: 'Review',
  colMedia: '6-Role Media',
  axisAdmission: 'Admission',
  axisFreeze: 'Freeze',
  axisAcceptance: 'Acceptance',
  axisUsability: 'Usability',
  restrictedNote: 'Restricted fields (names only)',
  aspect: 'Aspect',
  shotCount: 'shots',
  clipCount: 'clips',
  scriptSide: 'Script Scene Cards (Auctra)',
  shotSide: 'Breakdown Shots (Scaena)',
  seconds: 's',
  heroEyebrow: 'Scaena · Production',
  heroEmptyTitle: 'No storyboard yet',
  heroLede: 'The episode shot by shot: duration, fields, 6-role media and director review.',
  statDuration: 's total',
  statReady: 'assets ready',
  statApproved: 'approved',
  inspectorTitle: 'Shot Inspector',
  closeInspector: 'Close Inspector',
  inspectShot: 'Inspect',
  reviewSectionTitle: 'Director Review',
  reviewStatusLabel: 'Review Status',
  reviewStatusDraft: 'Draft',
  reviewStatusInReview: 'In Review',
  reviewStatusNeedsRevision: 'Needs Revision',
  reviewStatusApproved: 'Approved',
  reviewStatusLocked: 'Locked',
  reviewTagsLabel: 'Quick Review Tags',
  tagPacing: 'Pacing',
  tagFraming: 'Framing',
  tagLipsync: 'Lipsync',
  tagLighting: 'Lighting',
  tagVoice: 'Voice',
  tagVfx: 'VFX',
  reviewNoteLabel: 'Director Note',
  reviewNotePlaceholder: 'Add revision notes or approval remarks…',
  saveReview: 'Save Review',
  savingReview: 'Saving…',
  reviewSaved: 'Review saved',
  reviewConflictMsg: 'Review revision conflict: reload the latest record before saving.',
  reviewConflictReload: 'Reload Latest',
  mediaSlotsTitle: '6-Role Media Slots',
  role_keyframe: 'Keyframe',
  role_reference: 'Reference',
  role_video: 'Video',
  role_voice: 'Voice',
  role_music: 'Music',
  role_sfx: 'SFX',
  slotEmpty: 'Empty',
  unlinkMedia: 'Unlink',
  bindEikonaSelect: 'Select Eikona Element',
  bindMedia: 'Bind',
  genVisualForRole: 'Generate Visual',
  genAudioForRole: 'Generate Audio',
  exportEdl: 'Export EDL',
  exportCutManifest: 'Export Cut Manifest JSON',
  exportShotlistCsv: 'Export Shotlist CSV',
  exportDone: 'Exported rough-cut package',
  trackVisual: 'Visual / Video Track',
  trackVoice: 'Voice Track',
  trackSfxMusic: 'SFX / Music Track',
  sceneUncovered: 'Uncovered',
  approvedRatio: 'Approved',
  filterAllScenes: 'All Scenes',
  noShotsForScene: 'No breakdown shots for this scene',
  mediaRolesFilled: 'roles ready',
  assetFilterLabel: 'Asset Readiness Filter',
  assetFilterAll: 'All',
  assetFilterBlocked: 'Blocked',
  assetFilterReady: 'Ready',
  noAssetsForFilter: 'No assets match this filter',
  impactedShots: 'Impacted Shots',
  filterReviewAll: 'All Review States',
  filterMediaAll: 'All Media States',
  filterMissingVisual: 'Missing Visual',
  filterMissingAudio: 'Missing Audio',
  filterMissingVideo: 'Missing Video',
  animaticOpen: 'Open Animatic',
  animaticClose: 'Hide Animatic',
  kbdSwitchShot: 'Switch shot',
  kbdApprove: 'Approve',
  kbdRevision: 'Needs rev',
  kbdClose: 'Close',
  readinessStripTitle: 'Episode Production Readiness',
  mediaCompleteness: '6-Track Media Completeness',
  batchSelected: 'selected',
  batchMarkInReview: 'Mark In Review',
  batchApprove: 'Approve Selected',
  batchStageAgent: 'Stage @ to Agent',
  batchClear: 'Clear Selection',
  batchDone: 'Batch review updated',
  batchPartialConflict: 'Some shots had revision conflicts',
  batchStagedNotice: 'Staged selected shots to Floating Agent',
  selectShot: 'Select shot',
  shotSearchPlaceholder: 'Search shot, scene, field, note…',
  filmstripLabel: 'Shot filmstrip navigation',
  copyReviewMarkdown: 'Copy Review Summary (Markdown)',
  reviewMdCopied: 'Copied review summary (Markdown)',
  mdSummaryTitle: 'Storyboard Review Summary',
  mdMissingRoles: 'Missing',
  mdAllRolesReady: 'All roles ready',
  allEpisodes: 'All Episodes',
  episodeFilterLabel: 'Episode Switcher',
  cutBannerLabel: 'Non-destructive cut overrides active',
  cutModifiedItems: 'overrides',
  cutResetBtn: 'Reset to Original',
  cutResetDone: 'Episode cut overrides reset',
  cutMoveUp: 'Move Up',
  cutMoveDown: 'Move Down',
  cutOmit: 'Omit',
  cutRestore: 'Restore',
  cutOmittedBadge: 'Omitted',
  cutControlsTitle: 'Rough-Cut Trim',
  cutDurationLabel: 'Duration (s)',
  cutTransitionLabel: 'Transition',
  transition_cut: 'Cut',
  transition_crossfade: 'Crossfade',
  transition_dip_to_black: 'Dip to Black',
  exportFcpxml: 'Export FCPXML',
  exportJianying: 'Export Jianying Draft',
}

type ViewMode = 'cards' | 'table'
type MissingMediaFilter = 'all' | 'missing_visual' | 'missing_audio' | 'missing_video'

function RoleReadinessDots({
  linked,
  t,
}: {
  linked: StoryboardRow['linkedMedia']
  t: (k: string) => string
}) {
  const summary = shotReadinessSummary(linked)
  return (
    <span className="dr-role-dots mw-row" data-gap="xs" data-role-readiness={`${summary.filledCount}/6`}>
      {SHOT_MEDIA_ROLE_LIST.map((role) => {
        const present = summary.rolesPresent.has(role)
        return (
          <span
            key={role}
            className="dr-role-dot"
            data-role-dot={role}
            data-filled={present ? 'true' : 'false'}
            title={`${t(`role_${role}`)}: ${present ? 'OK' : t('slotEmpty')}`}
          >
            <ToneDot tone={present ? 'ok' : 'neutral'} />
          </span>
        )
      })}
    </span>
  )
}

export function DramaIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <rect x="2" y="3" width="12" height="10" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6.2h12M6 3v3.2M10 3v3.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function DramaMainPage({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  const [dramaElements, setDramaElements] = useState<MuweaveElementSummaryV1[]>([])
  const [scriptCards, setScriptCards] = useState<MuweaveElementSummaryV1[]>([])
  const [eikonaElements, setEikonaElements] = useState<MuweaveElementSummaryV1[]>([])
  const [details, setDetails] = useState<Record<string, MuweaveElementV1>>({})
  const [reviewsByShot, setReviewsByShot] = useState<Record<string, ShotReviewRecordV1>>({})
  const [selectedShotRef, setSelectedShotRef] = useState<string | null>(null)
  const [sceneFilter, setSceneFilter] = useState<string>('all')
  const [reviewFilter, setReviewFilter] = useState<'all' | ShotReviewStatus>('all')
  const [mediaFilter, setMediaFilter] = useState<MissingMediaFilter>('all')
  const [shotSearch, setShotSearch] = useState<string>('')
  const [animaticOpen, setAnimaticOpen] = useState(false)
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null)
  const [selectedShotRefs, setSelectedShotRefs] = useState<Set<string>>(() => new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const [selectedEpisode, setSelectedEpisode] = useState<string>('all')
  const [cutOverride, setCutOverride] = useState<EpisodeCutOverrideV1 | null>(null)
  const [cutBusy, setCutBusy] = useState(false)

  const loadReviews = useCallback(async () => {
    const revRes = await rpc.call<{ reviews?: ShotReviewRecordV1[] }>('drama.shot.review.list', {})
    if (revRes.ok && Array.isArray(revRes.data?.reviews)) {
      const next: Record<string, ShotReviewRecordV1> = {}
      for (const rec of revRes.data.reviews) {
        next[rec.shotRef] = rec
      }
      setReviewsByShot(next)
    }
  }, [rpc])

  const loadAll = useCallback(async () => {
    const [dRes, sRes, eRes, revRes] = await Promise.all([
      rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { domain: 'drama' }),
      rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { kind: 'script.scene_card' }),
      rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { domain: 'eikona' }),
      rpc.call<{ reviews?: ShotReviewRecordV1[] }>('drama.shot.review.list', {}),
    ])
    const combined: MuweaveElementSummaryV1[] = []
    if (dRes.ok) {
      setDramaElements(dRes.data.elements)
      combined.push(...dRes.data.elements)
    }
    if (sRes.ok) {
      setScriptCards(sRes.data.elements)
      combined.push(...sRes.data.elements)
    }
    if (eRes.ok) {
      setEikonaElements(eRes.data.elements)
      combined.push(...eRes.data.elements)
    }
    if (revRes.ok && Array.isArray(revRes.data?.reviews)) {
      const next: Record<string, ShotReviewRecordV1> = {}
      for (const rec of revRes.data.reviews) {
        next[rec.shotRef] = rec
      }
      setReviewsByShot(next)
    }
    const entries = await Promise.all(
      combined.map(async (el) => {
        const full = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: el.elementId })
        return full.ok ? ([el.elementId, full.data.element] as const) : undefined
      }),
    )
    const map: Record<string, MuweaveElementV1> = {}
    for (const pair of entries) {
      if (pair) map[pair[0]] = pair[1]
    }
    setDetails(map)
  }, [rpc])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const storyboards = dramaElements.filter((e) => e.kind === 'drama.storyboard_table')
  const assetTables = dramaElements.filter((e) => e.kind === 'drama.asset_readiness')
  const editTimelines = dramaElements.filter((e) => e.kind === 'drama.edit_timeline')
  const lang = coreT('langCode')
  const covers = useProjectCovers(rpc, 3)
  const [view, setView] = useState<ViewMode>('cards')

  const episodeOfBoard = useCallback(
    (sb: MuweaveElementSummaryV1): string => {
      if (sb.episodeRef) return sb.episodeRef
      const pl = (details[sb.elementId]?.payload ?? {}) as { episodeRef?: string }
      if (typeof pl.episodeRef === 'string' && pl.episodeRef) return pl.episodeRef
      return sb.sourceRef || sb.elementId
    },
    [details],
  )

  const episodes = useMemo(() => {
    const set = new Set<string>()
    for (const sb of storyboards) {
      set.add(episodeOfBoard(sb))
    }
    return Array.from(set)
  }, [storyboards, episodeOfBoard])

  const visibleStoryboards = useMemo(
    () =>
      selectedEpisode === 'all'
        ? storyboards
        : storyboards.filter((sb) => episodeOfBoard(sb) === selectedEpisode),
    [storyboards, selectedEpisode, episodeOfBoard],
  )

  const activeCutEpisode = selectedEpisode !== 'all' ? selectedEpisode : episodes[0]

  const loadCutOverride = useCallback(async () => {
    if (!activeCutEpisode) {
      setCutOverride(null)
      return
    }
    const res = await rpc.call<{ cut?: EpisodeCutOverrideV1 | null }>('drama.cut.get', {
      episodeRef: activeCutEpisode,
    })
    if (res.ok) {
      setCutOverride(res.data?.cut ?? null)
    }
  }, [rpc, activeCutEpisode])

  useEffect(() => {
    void loadCutOverride()
  }, [loadCutOverride])

  const applyCutToRows = useCallback(
    (rows: readonly StoryboardRow[]): StoryboardRow[] => {
      if (!cutOverride) return [...rows]
      const byRef = new Map(rows.map((r) => [r.shotRef, r]))
      const ordered: StoryboardRow[] = []
      const seen = new Set<string>()
      for (const ref of cutOverride.shotOrder ?? []) {
        const hit = byRef.get(ref)
        if (hit && !seen.has(ref)) {
          seen.add(ref)
          ordered.push(hit)
        }
      }
      for (const r of rows) {
        if (!seen.has(r.shotRef)) {
          seen.add(r.shotRef)
          ordered.push(r)
        }
      }
      return ordered.map((r) => {
        const durOverride = cutOverride.durationOverridesMicros?.[r.shotRef]
        return typeof durOverride === 'number' ? { ...r, plannedDurationMicros: durOverride } : r
      })
    },
    [cutOverride],
  )

  const omittedShotSet = useMemo(
    () => new Set(cutOverride?.omittedShotRefs ?? []),
    [cutOverride],
  )

  const shotEntries = useMemo(
    () =>
      visibleStoryboards.flatMap((sb) => {
        const rawRows = ((details[sb.elementId]?.payload ?? {}) as { rows?: StoryboardRow[] }).rows ?? []
        const rows = applyCutToRows(rawRows)
        const epRef = episodeOfBoard(sb)
        return rows.map((row) => ({
          row,
          storyboardElementId: sb.elementId,
          episodeRef: epRef,
        }))
      }),
    [visibleStoryboards, details, applyCutToRows, episodeOfBoard],
  )

  const shotRows = useMemo(() => shotEntries.map((e) => e.row), [shotEntries])
  const activeCutRows = useMemo(
    () => shotRows.filter((r) => !omittedShotSet.has(r.shotRef)),
    [shotRows, omittedShotSet],
  )

  const cutOverrideCount = useMemo(() => {
    if (!cutOverride) return 0
    return (
      (cutOverride.shotOrder?.length ? 1 : 0) +
      (cutOverride.omittedShotRefs?.length ?? 0) +
      Object.keys(cutOverride.durationOverridesMicros ?? {}).length +
      Object.keys(cutOverride.transitions ?? {}).length
    )
  }, [cutOverride])

  const saveCutOverride = useCallback(
    async (next: {
      shotOrder: string[]
      omittedShotRefs: string[]
      durationOverridesMicros: Record<string, number>
      transitions: Record<string, CutTransitionKind>
    }) => {
      if (!activeCutEpisode) return
      setCutBusy(true)
      try {
        const res = await rpc.call<{ cut?: EpisodeCutOverrideV1 }>('drama.cut.set', {
          episodeRef: activeCutEpisode,
          shotOrder: next.shotOrder,
          omittedShotRefs: next.omittedShotRefs,
          durationOverridesMicros: next.durationOverridesMicros,
          transitions: next.transitions,
          expectedRevision: cutOverride?.revision ?? 0,
        })
        if (!res.ok) {
          setNotice({ tone: 'bad', text: res.error.message })
          return
        }
        if (res.data?.cut) {
          setCutOverride(res.data.cut)
        } else {
          await loadCutOverride()
        }
      } finally {
        setCutBusy(false)
      }
    },
    [rpc, activeCutEpisode, cutOverride, loadCutOverride],
  )

  const handleMoveShot = useCallback(
    async (shotRef: string, direction: -1 | 1) => {
      const currentOrder = shotRows.map((r) => r.shotRef)
      const idx = currentOrder.indexOf(shotRef)
      const targetIdx = idx + direction
      if (idx < 0 || targetIdx < 0 || targetIdx >= currentOrder.length) return
      const nextOrder = [...currentOrder]
      const [moved] = nextOrder.splice(idx, 1)
      nextOrder.splice(targetIdx, 0, moved!)
      await saveCutOverride({
        shotOrder: nextOrder,
        omittedShotRefs: cutOverride?.omittedShotRefs ?? [],
        durationOverridesMicros: cutOverride?.durationOverridesMicros ?? {},
        transitions: cutOverride?.transitions ?? {},
      })
    },
    [shotRows, cutOverride, saveCutOverride],
  )

  const handleToggleOmitShot = useCallback(
    async (shotRef: string, forceOmitted?: boolean) => {
      const cur = new Set(cutOverride?.omittedShotRefs ?? [])
      const nextOmitted = forceOmitted ?? !cur.has(shotRef)
      if (nextOmitted) cur.add(shotRef)
      else cur.delete(shotRef)
      await saveCutOverride({
        shotOrder: cutOverride?.shotOrder ?? shotRows.map((r) => r.shotRef),
        omittedShotRefs: Array.from(cur),
        durationOverridesMicros: cutOverride?.durationOverridesMicros ?? {},
        transitions: cutOverride?.transitions ?? {},
      })
    },
    [shotRows, cutOverride, saveCutOverride],
  )

  const handleUpdateShotCut = useCallback(
    async (
      shotRef: string,
      patch: { durationMicros?: number; transition?: CutTransitionKind; omitted?: boolean },
    ) => {
      const nextDurations = { ...(cutOverride?.durationOverridesMicros ?? {}) }
      if (typeof patch.durationMicros === 'number') {
        nextDurations[shotRef] = patch.durationMicros
      }
      const nextTransitions = { ...(cutOverride?.transitions ?? {}) }
      if (patch.transition) {
        nextTransitions[shotRef] = patch.transition
      }
      const nextOmittedSet = new Set(cutOverride?.omittedShotRefs ?? [])
      if (typeof patch.omitted === 'boolean') {
        if (patch.omitted) nextOmittedSet.add(shotRef)
        else nextOmittedSet.delete(shotRef)
      }
      await saveCutOverride({
        shotOrder: cutOverride?.shotOrder ?? shotRows.map((r) => r.shotRef),
        omittedShotRefs: Array.from(nextOmittedSet),
        durationOverridesMicros: nextDurations,
        transitions: nextTransitions,
      })
    },
    [shotRows, cutOverride, saveCutOverride],
  )

  const handleResetCut = useCallback(async () => {
    if (!activeCutEpisode) return
    setCutBusy(true)
    try {
      const res = await rpc.call<{ reset?: boolean }>('drama.cut.reset', { episodeRef: activeCutEpisode })
      if (!res.ok) {
        setNotice({ tone: 'bad', text: res.error.message })
        return
      }
      setCutOverride(null)
      setNotice({ tone: 'ok', text: t('cutResetDone') })
    } finally {
      setCutBusy(false)
    }
  }, [rpc, activeCutEpisode, t])

  const episodeMetrics = useMemo(() => {
    const map = new Map<string, { shotCount: number; totalMicros: number; approvedCount: number }>()
    for (const sb of storyboards) {
      const ep = episodeOfBoard(sb)
      const rows = ((details[sb.elementId]?.payload ?? {}) as { rows?: StoryboardRow[] }).rows ?? []
      const prev = map.get(ep) ?? { shotCount: 0, totalMicros: 0, approvedCount: 0 }
      prev.shotCount += rows.length
      for (const r of rows) {
        prev.totalMicros += r.plannedDurationMicros
        const st = reviewsByShot[r.shotRef]?.status
        if (st === 'approved' || st === 'locked') prev.approvedCount += 1
      }
      map.set(ep, prev)
    }
    return map
  }, [storyboards, details, reviewsByShot, episodeOfBoard])
  const totalMicros = shotRows.reduce((sum, r) => sum + r.plannedDurationMicros, 0)
  const assetRows = assetTables.flatMap(
    (at) => ((details[at.elementId]?.payload ?? {}) as { assets?: AssetRow[] }).assets ?? [],
  )
  const readyCount = assetRows.filter((a) => Object.values(a.axes).every((raw) => statusTone(raw) === 'ok')).length
  const approvedShotCount = shotRows.filter((r) => {
    const st = reviewsByShot[r.shotRef]?.status
    return st === 'approved' || st === 'locked'
  }).length
  const firstBoard = storyboards[0]

  const { eikonaBindableItems, masterBindings } = useMemo(() => {
    const bindables: EikonaBindableItem[] = []
    const masters: EikonaBindableItem[] = []
    for (const el of eikonaElements) {
      const payload = (details[el.elementId]?.payload ?? {}) as Record<string, unknown>
      if (el.kind === 'eikona.candidate_group') {
        const cands = Array.isArray(payload.candidates)
          ? (payload.candidates as Array<{ artifactId?: string; handle?: string; sha256?: string }>)
          : []
        for (const c of cands) {
          const id = `${el.elementId}:${c.artifactId ?? c.handle ?? c.sha256 ?? 'cand'}`
          bindables.push({
            id,
            label: `${c.handle ?? c.artifactId ?? el.title}${c.sha256 ? '' : ` (${el.title})`}`,
            sha256: typeof c.sha256 === 'string' && c.sha256 ? c.sha256 : undefined,
            elementId: el.elementId,
            artifactId: c.artifactId,
            handle: c.handle,
            sourceRef: el.sourceRef,
            kind: 'candidate',
          })
        }
      } else if (el.kind === 'eikona.master_binding') {
        const sha = typeof payload.sha256 === 'string' && payload.sha256 ? payload.sha256 : undefined
        const handle = typeof payload.handle === 'string' ? payload.handle : undefined
        const artifactId = typeof payload.artifactId === 'string' ? payload.artifactId : undefined
        const item: EikonaBindableItem = {
          id: el.elementId,
          label: el.title,
          sha256: sha,
          elementId: el.elementId,
          artifactId,
          handle,
          sourceRef: el.sourceRef,
          kind: 'master',
        }
        masters.push(item)
        bindables.push(item)
      }
    }
    return { eikonaBindableItems: bindables, masterBindings: masters }
  }, [eikonaElements, details])

  const uniqueScenes = useMemo(
    () => Array.from(new Set(shotRows.map((r) => r.sceneRef).filter(Boolean))),
    [shotRows],
  )

  const matchesShotFilters = useCallback(
    (row: StoryboardRow): boolean => {
      if (sceneFilter !== 'all' && row.sceneRef !== sceneFilter) return false
      const reviewRecord = reviewsByShot[row.shotRef]
      const reviewStatus = reviewRecord?.status ?? 'draft'
      if (reviewFilter !== 'all' && reviewStatus !== reviewFilter) return false
      if (mediaFilter !== 'all') {
        const summary = shotReadinessSummary(row.linkedMedia)
        if (mediaFilter === 'missing_visual' && summary.hasVisual) return false
        if (mediaFilter === 'missing_audio' && summary.hasAudio) return false
        if (mediaFilter === 'missing_video' && summary.hasVideo) return false
      }
      const q = shotSearch.trim().toLowerCase()
      if (q) {
        const visibleText = Object.entries(row.cells)
          .filter(([k]) => !row.restrictedFields.includes(k))
          .map(([, v]) => formatCell(v))
          .join(' ')
        const hay = `${row.shotRef} ${row.sceneRef} ${visibleText} ${reviewRecord?.note ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    },
    [sceneFilter, reviewFilter, mediaFilter, shotSearch, reviewsByShot],
  )

  const filteredAllShots = useMemo(
    () => shotRows.filter(matchesShotFilters),
    [shotRows, matchesShotFilters],
  )

  const selectedEntry = useMemo(
    () => (selectedShotRef ? shotEntries.find((e) => e.row.shotRef === selectedShotRef) : undefined),
    [selectedShotRef, shotEntries],
  )

  const navShots = filteredAllShots.length > 0 ? filteredAllShots : shotRows
  const selectedNavIndex = selectedShotRef ? navShots.findIndex((r) => r.shotRef === selectedShotRef) : -1
  const hasPrevShot = selectedNavIndex > 0
  const hasNextShot = selectedNavIndex >= 0 && selectedNavIndex < navShots.length - 1

  const handlePrevShot = useCallback(() => {
    if (selectedNavIndex > 0) {
      const prev = navShots[selectedNavIndex - 1]
      if (prev) setSelectedShotRef(prev.shotRef)
    }
  }, [navShots, selectedNavIndex])

  const handleNextShot = useCallback(() => {
    if (selectedNavIndex >= 0 && selectedNavIndex < navShots.length - 1) {
      const next = navShots[selectedNavIndex + 1]
      if (next) setSelectedShotRef(next.shotRef)
    }
  }, [navShots, selectedNavIndex])

  const readinessStats = useMemo(() => {
    const counts: Record<ShotReviewStatus, number> = {
      locked: 0,
      approved: 0,
      in_review: 0,
      needs_revision: 0,
      draft: 0,
    }
    let totalFilledRoles = 0
    for (const row of shotRows) {
      const st = reviewsByShot[row.shotRef]?.status ?? 'draft'
      counts[st] += 1
      totalFilledRoles += shotReadinessSummary(row.linkedMedia).filledCount
    }
    const maxRoles = shotRows.length * 6
    const mediaCompletenessPct = maxRoles > 0 ? Math.round((totalFilledRoles / maxRoles) * 100) : 0
    return { counts, mediaCompletenessPct }
  }, [shotRows, reviewsByShot])

  useEffect(() => {
    publishTheaterRoomBadges({
      'muweave-drama': {
        count: readinessStats.counts.needs_revision,
        tone: 'warn',
      },
    })
  }, [readinessStats.counts.needs_revision])

  const toggleSelectShot = useCallback((shotRef: string) => {
    setSelectedShotRefs((prev) => {
      const next = new Set(prev)
      if (next.has(shotRef)) next.delete(shotRef)
      else next.add(shotRef)
      return next
    })
  }, [])

  const handleBatchReview = useCallback(
    async (targetStatus: ShotReviewStatus) => {
      const refs = Array.from(selectedShotRefs)
      if (refs.length === 0) return
      setBatchBusy(true)
      try {
        const items: ShotReviewSetInputV1[] = refs.map((shotRef) => {
          const entry = shotEntries.find((e) => e.row.shotRef === shotRef)
          const existing = reviewsByShot[shotRef]
          return {
            shotRef,
            ...(entry?.row.sceneRef ? { sceneRef: entry.row.sceneRef } : {}),
            ...(entry?.episodeRef ? { episodeRef: entry.episodeRef } : {}),
            status: targetStatus,
            ...(existing?.note ? { note: existing.note } : {}),
            ...(existing?.tags ? { tags: existing.tags } : {}),
            expectedRevision: existing?.revision ?? 0,
          }
        })
        const res = await rpc.call<ShotReviewBatchResultV1>('drama.shot.review.batch', { items })
        if (!res.ok) {
          setNotice({ tone: 'bad', text: res.error.message })
          return
        }
        setReviewsByShot((prev) => {
          const next = { ...prev }
          for (const item of res.data.results) {
            if (item.ok && item.record) {
              next[item.shotRef] = item.record
            }
          }
          return next
        })
        if (res.data.failedCount > 0) {
          setNotice({
            tone: 'warn',
            text: `${t('batchDone')}: ${res.data.succeededCount}/${refs.length} (${t('batchPartialConflict')}: ${res.data.failedCount})`,
          })
        } else {
          setNotice({
            tone: 'ok',
            text: `${t('batchDone')}: ${res.data.succeededCount}/${refs.length}`,
          })
          setSelectedShotRefs(new Set())
        }
      } finally {
        setBatchBusy(false)
      }
    },
    [rpc, selectedShotRefs, shotEntries, reviewsByShot, t],
  )

  const handleBatchStageAgent = useCallback(() => {
    const refs = Array.from(selectedShotRefs)
    if (refs.length === 0) return
    const lines: string[] = []
    for (const shotRef of refs) {
      const entry = shotEntries.find((e) => e.row.shotRef === shotRef)
      if (!entry) continue
      lines.push(
        `[ScaenaShot breakdown=${entry.episodeRef ?? 'drama'} scene=${entry.row.sceneRef} shot=${entry.row.shotRef}]`,
      )
    }
    stageItemToFloatingAgent({
      kind: 'element',
      ref: `drama:batch:${refs.join(',')}`,
      label: `${refs.length} ${t('shotCount')}`,
      serializedLine: lines.join('\n'),
    })
    setNotice({ tone: 'info', text: `${t('batchStagedNotice')} (${refs.length})` })
  }, [selectedShotRefs, shotEntries, t])

  const viewSwitch = (
    <Segmented<ViewMode>
      label={coreT('viewModeLabel')}
      value={view}
      options={[
        { value: 'cards', label: coreT('viewCards') },
        { value: 'table', label: coreT('viewTable') },
      ]}
      onChange={setView}
    />
  )

  const handleReviewSaved = useCallback((record: ShotReviewRecordV1) => {
    setReviewsByShot((prev) => ({
      ...prev,
      [record.shotRef]: record,
    }))
  }, [])

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      rpc={rpc}
      t={coreT}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      onSyncRequested={async () => {
        await loadAll()
        await loadCutOverride()
      }}
      projectBar={
        episodes.length > 0 ? (
          <div
            className="dr-episode-bar mw-row"
            data-gap="xs"
            data-episode-switcher="true"
            role="group"
            aria-label={t('episodeFilterLabel')}
          >
            <button
              type="button"
              className="dr-episode-pill mw-dsh-btn"
              data-size="sm"
              data-variant="ghost"
              data-episode-pill="all"
              aria-pressed={selectedEpisode === 'all'}
              onClick={() => setSelectedEpisode('all')}
            >
              {t('allEpisodes')}
            </button>
            {episodes.map((ep) => {
              const m = episodeMetrics.get(ep) ?? { shotCount: 0, totalMicros: 0, approvedCount: 0 }
              return (
                <button
                  key={ep}
                  type="button"
                  className="dr-episode-pill mw-dsh-btn"
                  data-size="sm"
                  data-variant="ghost"
                  data-episode-pill={ep}
                  aria-pressed={selectedEpisode === ep}
                  onClick={() => setSelectedEpisode(ep)}
                >
                  {ep} · {m.shotCount}
                  {t('shotCount')} · {formatDurationSec(m.totalMicros)}
                  {t('seconds')} · {m.approvedCount}/{m.shotCount}
                </button>
              )
            })}
          </div>
        ) : undefined
      }
      rightInspector={
        selectedEntry ? (
          <ShotInspector
            rpc={rpc}
            shot={selectedEntry.row}
            storyboardElementId={selectedEntry.storyboardElementId}
            episodeRef={selectedEntry.episodeRef}
            review={reviewsByShot[selectedEntry.row.shotRef]}
            eikonaItems={eikonaBindableItems}
            onClose={() => setSelectedShotRef(null)}
            onPrevShot={hasPrevShot ? handlePrevShot : undefined}
            onNextShot={hasNextShot ? handleNextShot : undefined}
            hasPrev={hasPrevShot}
            hasNext={hasNextShot}
            allShots={navShots}
            allReviews={reviewsByShot}
            onSelectShot={setSelectedShotRef}
            cutDurationMicros={
              cutOverride?.durationOverridesMicros?.[selectedEntry.row.shotRef] ??
              selectedEntry.row.plannedDurationMicros
            }
            cutTransition={cutOverride?.transitions?.[selectedEntry.row.shotRef] ?? 'cut'}
            cutOmitted={omittedShotSet.has(selectedEntry.row.shotRef)}
            onUpdateCut={(patch) => handleUpdateShotCut(selectedEntry.row.shotRef, patch)}
            onReviewSaved={handleReviewSaved}
            onReloadReviews={loadReviews}
            onMediaChanged={loadAll}
            t={t}
            coreT={coreT}
          />
        ) : undefined
      }
      hero={
        <RoomHero
          eyebrow={t('heroEyebrow')}
          title={firstBoard?.title ?? t('heroEmptyTitle')}
          lede={firstBoard?.subtitle ?? t('heroLede')}
          stats={[
            { icon: 'image', value: shotRows.length, label: t('shotCount') },
            { icon: 'play', value: formatDurationSec(totalMicros), label: t('statDuration') },
            { icon: 'check', value: `${readyCount}/${assetRows.length}`, label: t('statReady') },
            { icon: 'star', value: `${approvedShotCount}/${shotRows.length}`, label: t('statApproved') },
          ]}
          cover={<CoverCollage covers={covers} posterTitle={firstBoard?.title ?? t('roomTitle')} posterMeta="Scaena" />}
        />
      }
      stageTabs={[
        {
          id: 'storyboard',
          label: () => t('tabStoryboard'),
          render: () =>
            storyboards.length === 0 ? (
              <EmptyState>{coreT('emptyElements')}</EmptyState>
            ) : (
              <div className="mw-stack" data-gap="lg">
                <div className="dr-readiness-strip mw-stack" data-gap="xs" data-drama-readiness-strip="true">
                  <div className="mw-spread">
                    <span className="mw-eyebrow">{t('readinessStripTitle')}</span>
                    <span className="mw-dsh-muted" data-media-completeness={String(readinessStats.mediaCompletenessPct)}>
                      {t('mediaCompleteness')}: <b>{readinessStats.mediaCompletenessPct}%</b>
                    </span>
                  </div>
                  <div className="mw-row" data-gap="xs" role="group" aria-label={t('readinessStripTitle')}>
                    {(['locked', 'approved', 'in_review', 'needs_revision', 'draft'] as const).map((st) => {
                      const count = readinessStats.counts[st]
                      const active = reviewFilter === st
                      return (
                        <button
                          key={st}
                          type="button"
                          className="mw-dsh-btn"
                          data-size="sm"
                          data-variant="ghost"
                          data-readiness-segment={st}
                          aria-pressed={active}
                          onClick={() => setReviewFilter((prev) => (prev === st ? 'all' : st))}
                        >
                          {reviewStatusLabel(st, t)} · {count}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {selectedShotRefs.size > 0 ? (
                  <div className="dr-batch-bar mw-spread" data-drama-batch-bar="true" role="region" aria-label={t('batchSelected')}>
                    <span className="mw-title">
                      {selectedShotRefs.size} {t('batchSelected')}
                    </span>
                    <div className="mw-row" data-gap="xs">
                      <button
                        type="button"
                        className="mw-dsh-btn"
                        data-size="sm"
                        data-variant="quiet"
                        data-batch-action="in_review"
                        disabled={batchBusy}
                        onClick={() => void handleBatchReview('in_review')}
                      >
                        {t('batchMarkInReview')}
                      </button>
                      <button
                        type="button"
                        className="mw-dsh-btn"
                        data-size="sm"
                        data-variant="primary"
                        data-batch-action="approved"
                        disabled={batchBusy}
                        onClick={() => void handleBatchReview('approved')}
                      >
                        {t('batchApprove')}
                      </button>
                      <button
                        type="button"
                        className="mw-dsh-btn"
                        data-size="sm"
                        data-variant="quiet"
                        data-batch-action="stage-agent"
                        disabled={batchBusy}
                        onClick={handleBatchStageAgent}
                      >
                        {t('batchStageAgent')}
                      </button>
                      <button
                        type="button"
                        className="mw-dsh-btn"
                        data-size="sm"
                        data-variant="ghost"
                        data-batch-action="clear"
                        disabled={batchBusy}
                        onClick={() => setSelectedShotRefs(new Set())}
                      >
                        {t('batchClear')}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="dr-filter-bar mw-spread" data-storyboard-filter-bar="true">
                  <div className="mw-row" data-gap="xs">
                    <input
                      type="search"
                      className="mw-dsh-input"
                      aria-label={t('shotSearchPlaceholder')}
                      placeholder={t('shotSearchPlaceholder')}
                      data-drama-shot-search="true"
                      value={shotSearch}
                      onChange={(ev) => setShotSearch(ev.target.value)}
                    />
                    <select
                      className="mw-dsh-input"
                      aria-label={t('colScene')}
                      data-filter-scene="true"
                      value={sceneFilter}
                      onChange={(ev) => setSceneFilter(ev.target.value)}
                    >
                      <option value="all">{t('filterAllScenes')}</option>
                      {uniqueScenes.map((sc) => (
                        <option key={sc} value={sc}>
                          {sc}
                        </option>
                      ))}
                    </select>
                    <select
                      className="mw-dsh-input"
                      aria-label={t('reviewStatusLabel')}
                      data-filter-review="true"
                      value={reviewFilter}
                      onChange={(ev) => setReviewFilter(ev.target.value as 'all' | ShotReviewStatus)}
                    >
                      <option value="all">{t('filterReviewAll')}</option>
                      {REVIEW_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {reviewStatusLabel(st, t)}
                        </option>
                      ))}
                    </select>
                    <select
                      className="mw-dsh-input"
                      aria-label={t('colMedia')}
                      data-filter-media="true"
                      value={mediaFilter}
                      onChange={(ev) => setMediaFilter(ev.target.value as MissingMediaFilter)}
                    >
                      <option value="all">{t('filterMediaAll')}</option>
                      <option value="missing_visual">{t('filterMissingVisual')}</option>
                      <option value="missing_audio">{t('filterMissingAudio')}</option>
                      <option value="missing_video">{t('filterMissingVideo')}</option>
                    </select>
                  </div>
                  <div className="mw-row" data-gap="xs">
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-size="sm"
                      data-variant="quiet"
                      data-animatic-toggle="true"
                      aria-expanded={animaticOpen}
                      onClick={() => setAnimaticOpen((open) => !open)}
                    >
                      {animaticOpen ? t('animaticClose') : t('animaticOpen')}
                    </button>
                    {viewSwitch}
                  </div>
                </div>

                {cutOverride && cutOverrideCount > 0 ? (
                  <div className="dr-cut-banner mw-spread" data-drama-cut-banner="true" role="status">
                    <span className="mw-dsh-muted">
                      {t('cutBannerLabel')} ({cutOverrideCount} {t('cutModifiedItems')} · v{cutOverride.revision})
                    </span>
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-size="sm"
                      data-variant="ghost"
                      data-drama-cut-reset="true"
                      disabled={cutBusy}
                      onClick={() => void handleResetCut()}
                    >
                      {t('cutResetBtn')}
                    </button>
                  </div>
                ) : null}

                {animaticOpen ? (
                  <AnimaticPlayer
                    rpc={rpc}
                    rows={filteredAllShots.filter((r) => !omittedShotSet.has(r.shotRef))}
                    reviews={reviewsByShot}
                    initialShotRef={selectedShotRef ?? undefined}
                    onSelectShot={(ref) => setSelectedShotRef(ref)}
                    t={coreT}
                  />
                ) : null}

                {visibleStoryboards.map((sb) => {
                  const pl = (details[sb.elementId]?.payload ?? {}) as { rows?: StoryboardRow[] }
                  const rows = applyCutToRows(pl.rows ?? []).filter(matchesShotFilters)
                  const restricted = Array.from(new Set(rows.flatMap((r) => r.restrictedFields)))
                  return (
                    <section key={sb.elementId} className="mw-stack" data-gap="sm">
                      <SectionHead
                        title={sb.title}
                        meta={sb.subtitle}
                        actions={<StatusTag status={sb.status} lang={lang} />}
                      />
                      {view === 'cards' ? (
                        <div className="mw-board" data-drama-shot-board="true">
                          {rows.map((row, rowIdx) => {
                            const fields = Object.entries(row.cells)
                              .filter(([k]) => !row.restrictedFields.includes(k))
                              .map(([, v]) => formatCell(v))
                            const review = reviewsByShot[row.shotRef]
                            const reviewStatus = review?.status ?? 'draft'
                            const isOmitted = omittedShotSet.has(row.shotRef)
                            return (
                              <MediaCard
                                key={row.shotRef}
                                ratio="16 / 10"
                                data-muweave-shot-card={row.shotRef}
                                data-shot-omitted={isOmitted ? 'true' : undefined}
                                data-selected={selectedShotRef === row.shotRef ? 'true' : undefined}
                                media={
                                  <ShotMedia
                                    rpc={rpc}
                                    linked={row.linkedMedia}
                                    alt={`${pad2(row.order)} ${row.shotRef}`}
                                    poster={<Poster title={pad2(row.order)} meta={row.sceneRef} />}
                                  />
                                }
                                title={`${pad2(row.order)} · ${formatDurationSec(row.plannedDurationMicros)} ${t('seconds')}`}
                                meta={<span className="mw-dsh-code">{row.shotRef}</span>}
                                actions={
                                  <div className="mw-row" data-gap="xs">
                                    <input
                                      type="checkbox"
                                      aria-label={`${t('selectShot')} ${row.shotRef}`}
                                      data-shot-select={row.shotRef}
                                      checked={selectedShotRefs.has(row.shotRef)}
                                      onChange={() => toggleSelectShot(row.shotRef)}
                                    />
                                    <IconButton
                                      icon="edit"
                                      size="sm"
                                      label={`${t('inspectShot')} ${row.shotRef}`}
                                      data-inspect-shot={row.shotRef}
                                      onClick={() => setSelectedShotRef(row.shotRef)}
                                    />
                                    <IconButton
                                      icon="at"
                                      size="sm"
                                      label={coreT('insertRefChip')}
                                      onClick={() =>
                                        stageItemToFloatingAgent({
                                          kind: 'element',
                                          ref: `${sb.elementId}:${row.shotRef}`,
                                          label: `${row.sceneRef}/${row.shotRef}`,
                                          serializedLine: `[ScaenaShot breakdown=${sb.sourceRef} scene=${row.sceneRef} shot=${row.shotRef}]`,
                                        })
                                      }
                                    />
                                  </div>
                                }
                              >
                                <div className="mw-spread">
                                  <span data-shot-review-badge={reviewStatus}>
                                    <StatusTag
                                      status={reviewStatus}
                                      lang={lang}
                                      label={reviewStatusLabel(reviewStatus, t)}
                                    />
                                  </span>
                                  <RoleReadinessDots linked={row.linkedMedia} t={t} />
                                </div>
                                {fields.length > 0 ? (
                                  <span className="mw-dsh-muted mw-clamp-2" title={fields.join(' · ')}>
                                    {fields.join(' · ')}
                                  </span>
                                ) : null}
                                <div className="mw-spread">
                                  <ShotGenerateButton
                                    t={coreT}
                                    shotRef={row.shotRef}
                                    prompt={shotDescription(row.cells, row.restrictedFields)}
                                    anchor={{ ...(sb.sourceRef ? { episodeRef: sb.sourceRef } : {}), sceneRef: row.sceneRef }}
                                  />
                                  <button
                                    type="button"
                                    className="mw-dsh-btn"
                                    data-size="sm"
                                    data-variant="ghost"
                                    data-inspect-shot-btn={row.shotRef}
                                    onClick={() => setSelectedShotRef(row.shotRef)}
                                  >
                                    {t('inspectShot')}
                                  </button>
                                </div>
                                <div className={`dr-cut-controls mw-row${isOmitted ? ' dr-shot-omitted' : ''}`} data-gap="xs">
                                  <button
                                    type="button"
                                    className="mw-dsh-btn"
                                    data-size="sm"
                                    data-variant="ghost"
                                    data-cut-move-up={row.shotRef}
                                    disabled={cutBusy || rowIdx === 0}
                                    onClick={() => void handleMoveShot(row.shotRef, -1)}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    className="mw-dsh-btn"
                                    data-size="sm"
                                    data-variant="ghost"
                                    data-cut-move-down={row.shotRef}
                                    disabled={cutBusy || rowIdx === rows.length - 1}
                                    onClick={() => void handleMoveShot(row.shotRef, 1)}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    className="mw-dsh-btn"
                                    data-size="sm"
                                    data-variant="ghost"
                                    data-cut-toggle-omit={row.shotRef}
                                    disabled={cutBusy}
                                    onClick={() => void handleToggleOmitShot(row.shotRef)}
                                  >
                                    {isOmitted ? t('cutRestore') : t('cutOmit')}
                                  </button>
                                  {isOmitted ? <span className="mw-chip">{t('cutOmittedBadge')}</span> : null}
                                </div>
                              </MediaCard>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="mw-table-wrap">
                          <table className="mw-table">
                            <thead>
                              <tr>
                                <th data-num="true">{t('colOrder')}</th>
                                <th>{t('colShot')}</th>
                                <th data-num="true">{t('colDuration')}</th>
                                <th>{t('colReview')}</th>
                                <th>{t('colMedia')}</th>
                                <th>{t('colCells')}</th>
                                <th aria-label={t('inspectShot')} />
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => {
                                const reviewStatus = reviewsByShot[row.shotRef]?.status ?? 'draft'
                                return (
                                  <tr key={row.shotRef}>
                                    <td data-num="true">
                                      <span className="mw-row" data-gap="xs">
                                        <input
                                          type="checkbox"
                                          aria-label={`${t('selectShot')} ${row.shotRef}`}
                                          data-shot-select={row.shotRef}
                                          checked={selectedShotRefs.has(row.shotRef)}
                                          onChange={() => toggleSelectShot(row.shotRef)}
                                        />
                                        {row.order}
                                      </span>
                                    </td>
                                    <td>
                                      <div className="mw-stack" data-gap="xs">
                                        <span className="mw-dsh-code">{row.shotRef}</span>
                                        <span className="mw-dsh-muted">{row.sceneRef}</span>
                                      </div>
                                    </td>
                                    <td data-num="true">{formatDurationSec(row.plannedDurationMicros)}s</td>
                                    <td>
                                      <span data-shot-review-badge={reviewStatus}>
                                        <StatusTag
                                          status={reviewStatus}
                                          lang={lang}
                                          label={reviewStatusLabel(reviewStatus, t)}
                                        />
                                      </span>
                                    </td>
                                    <td>
                                      <RoleReadinessDots linked={row.linkedMedia} t={t} />
                                    </td>
                                    <td>
                                      <div className="mw-row" data-gap="xs">
                                        {Object.entries(row.cells)
                                          .filter(([k]) => !row.restrictedFields.includes(k))
                                          .map(([k, v]) => (
                                            <span key={k} className="mw-chip" title={k}>
                                              {formatCell(v)}
                                            </span>
                                          ))}
                                      </div>
                                    </td>
                                    <td>
                                      <div className="mw-row" data-gap="xs">
                                        <button
                                          type="button"
                                          className="mw-dsh-btn"
                                          data-size="sm"
                                          data-variant="ghost"
                                          data-inspect-shot-btn={row.shotRef}
                                          onClick={() => setSelectedShotRef(row.shotRef)}
                                        >
                                          {t('inspectShot')}
                                        </button>
                                        <IconButton
                                          icon="at"
                                          size="sm"
                                          label={coreT('insertRefChip')}
                                          onClick={() =>
                                            stageItemToFloatingAgent({
                                              kind: 'element',
                                              ref: `${sb.elementId}:${row.shotRef}`,
                                              label: `${row.sceneRef}/${row.shotRef}`,
                                              serializedLine: `[ScaenaShot breakdown=${sb.sourceRef} scene=${row.sceneRef} shot=${row.shotRef}]`,
                                            })
                                          }
                                        />
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {restricted.length > 0 ? (
                        <p className="mw-dsh-muted">
                          {t('restrictedNote')}：{restricted.join(', ')}
                        </p>
                      ) : null}
                    </section>
                  )
                })}
              </div>
            ),
        },
        {
          id: 'assets',
          label: () => t('tabAssets'),
          render: () => (
            <AssetsView
              rpc={rpc}
              assetTables={assetTables}
              details={details}
              shotRows={shotRows}
              masterBindings={masterBindings}
              view={view}
              viewSwitch={viewSwitch}
              onInspectShot={setSelectedShotRef}
              t={t}
              coreT={coreT}
            />
          ),
        },
        {
          id: 'timeline',
          label: () => t('tabTimeline'),
          render: () => (
            <TimelineView
              rpc={rpc}
              editTimelines={editTimelines}
              details={details}
              shotRows={activeCutRows}
              reviewsByShot={reviewsByShot}
              episodeRef={selectedEpisode !== 'all' ? selectedEpisode : activeCutEpisode}
              onInspectShot={setSelectedShotRef}
              onNotice={setNotice}
              t={t}
              coreT={coreT}
            />
          ),
        },
        {
          id: 'side-by-side',
          label: () => t('tabSideBySide'),
          render: () => (
            <SideBySideView
              scriptCards={scriptCards}
              shotRows={shotRows}
              reviewsByShot={reviewsByShot}
              storyboards={storyboards}
              onInspectShot={setSelectedShotRef}
              lang={lang}
              t={t}
              coreT={coreT}
            />
          ),
        },
      ]}
    />
  )
}

export function DramaCompanionPane({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  return <CompanionList rpc={rpc} coreT={coreT} title={t('companionTitle')} domain="drama" companionId="drama" />
}

export function apply(ctx: DshClientContextLike): void {
  const tFn = () => ctx.locale.bind(DRAMA_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: DRAMA_LOCALE_NS,
    dictionaries: { zh, en },
    pane: {
      pluginId: 'muweave-drama',
      panelId: DRAMA_PANEL_ID,
      order: 44,
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: ['drama'],
      companionId: DRAMA_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: DramaIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    },
    MainComponent: DramaMainPage,
    CompanionComponent: DramaCompanionPane,
    sessionView: { id: 'muweave-drama', order: 20 },
  })
}
