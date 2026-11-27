import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  CompanionList,
  CoverCollage,
  EmptyState,
  Icon,
  IconButton,
  Masonry,
  MediaCard,
  MediaPreview,
  PillButton,
  RoomHero,
  SectionHead,
  Segmented,
  StatusTag,
  WorkspaceShell,
  navigateToTheaterRoom,
  type WorkspaceNotice,
  registerMuweaveCreatorPlugin,
  stageItemToFloatingAgent,
  type DshClientContextLike,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  useProjectCovers,
} from '@yeisme/dsh-muweave-core/client'

export const name = '@yeisme/dsh-muweave-eikona'
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const EIKONA_PANEL_ID = 'muweave-eikona'
export const EIKONA_COMPANION_ID = 'muweave-eikona/companion'
export const EIKONA_LOCALE_NS = 'muweaveEikona'

const zh = {
  panelTitle: 'Eikona 视觉元件台',
  roomTitle: '视觉',
  companionTitle: '视觉候选与母版',
  tabGallery: '候选画廊',
  tabMasters: '母版',
  tabScores: '评估分卡',
  tabSpecGuard: '规格预检',
  gridLabel: '每行张数',
  compare2Up: '2 张并排',
  compare4Up: '4 宫格',
  zoomIn: '放大检视',
  zoomReset: '标准尺寸',
  acceptCandidate: '采纳',
  rejectCandidate: '淘汰',
  bindMaster: '绑定为角色母版',
  handoffAsset: '交接并回刷 .muweave/',
  specValidMsg: '规格通过：已锁定 openai/gpt-image-2.5-sunburst 像素尺寸与高质档位',
  specTitle: 'Sunburst 付费默认规格校验',
  specHint: '出图前核对模型、像素尺寸与质量档位；简写尺寸（如 2k）会被拒绝。',
  specModel: '模型',
  specSize: '像素尺寸',
  specQuality: '质量档位',
  candidateCount: '张候选',
  overallScore: '综合分',
  noPreview: '仅元数据',
  previewPending: '预览载入中',
  decisionDone: '已回执并同步 .muweave/',
  handoffDone: '已完成并写入 .muweave/',
  heroEyebrow: 'Eikona · 视觉候选',
  heroLede: '挑出能进片的那一张：采纳、绑定母版，再交接给分镜。',
  heroEmptyTitle: '还没有视觉候选',
  statGroups: '组',
  statMasters: '母版',
  statScores: '分卡',
  referGroup: '引用整组',
  bindToShot: '绑定到分镜',
  bindShotSelect: '目标镜头',
  bindRoleSelect: '媒体角色',
  roleKeyframe: '关键帧',
  roleReference: '参考图',
  boundToShotDone: '已绑定到镜头',
  openInDrama: '去分镜台查看',
  gallerySearchPlaceholder: '搜索候选 ID / 提示词 / 角色…',
  galleryFilterAll: '全部状态',
  galleryNoMatch: '当前筛选条件下无视觉候选',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: 'Eikona Visual Studio',
  roomTitle: 'Visual',
  companionTitle: 'Visual Candidates',
  tabGallery: 'Gallery',
  tabMasters: 'Masters',
  tabScores: 'Scorecards',
  tabSpecGuard: 'Spec Preflight',
  gridLabel: 'Per Row',
  compare2Up: '2-up',
  compare4Up: '4-up',
  zoomIn: 'Zoom In',
  zoomReset: 'Fit',
  acceptCandidate: 'Accept',
  rejectCandidate: 'Reject',
  bindMaster: 'Bind as Master',
  handoffAsset: 'Handoff & Refresh .muweave/',
  specValidMsg: 'Spec valid: locked to pixel WxH and high quality',
  specTitle: 'Sunburst Paid-Default Spec Check',
  specHint: 'Check model, pixel size and quality before generating; shorthand sizes such as 2k are rejected.',
  specModel: 'Model',
  specSize: 'Pixel Size',
  specQuality: 'Quality',
  candidateCount: 'candidates',
  overallScore: 'Overall',
  noPreview: 'Metadata only',
  previewPending: 'Loading preview',
  decisionDone: 'receipt recorded and .muweave/ synced',
  handoffDone: 'done and written to .muweave/',
  heroEyebrow: 'Eikona · Visual candidates',
  heroLede: 'Pick the frame that makes the cut: accept it, bind a master, hand it to the storyboard.',
  heroEmptyTitle: 'No visual candidates yet',
  statGroups: 'groups',
  statMasters: 'masters',
  statScores: 'scorecards',
  referGroup: 'Refer group',
  bindToShot: 'Bind to Shot',
  bindShotSelect: 'Target Shot',
  bindRoleSelect: 'Media Role',
  roleKeyframe: 'Keyframe',
  roleReference: 'Reference',
  boundToShotDone: 'Bound to shot',
  openInDrama: 'View in Production',
  gallerySearchPlaceholder: 'Search artifact, prompt, handle…',
  galleryFilterAll: 'All Statuses',
  galleryNoMatch: 'No candidates match this filter',
}

export function EikonaIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.8" cy="6.2" r="1.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 12l3.4-3.2 2.4 2.1 4.2-4.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

interface CandidateItem {
  artifactId: string
  handle: string
  uri: string
  role: string
  promptExcerpt: string
  modelRef: string
  sha256?: string
  overallScore?: number
  width?: number
  height?: number
}

/** Owner scores arrive as 0–1, 0–10 or 0–100; normalise to a percentage for the meter. */
function scorePercent(value: number): number {
  const pct = value <= 1 ? value * 100 : value <= 10 ? value * 10 : value
  return Math.max(0, Math.min(100, pct))
}

function scoreTone(pct: number): 'ok' | 'warn' | 'bad' {
  return pct >= 75 ? 'ok' : pct >= 50 ? 'warn' : 'bad'
}

function ScoreMeter({ label, value }: { label: string; value: number }) {
  const pct = scorePercent(value)
  return (
    <div className="mw-stack" data-gap="xs">
      <div className="mw-spread">
        <span className="mw-dsh-muted">{label}</span>
        <span className="mw-dsh-code">{Number.isInteger(value) ? value : value.toFixed(2)}</span>
      </div>
      <div
        className="mw-meter"
        data-tone={scoreTone(pct)}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        style={{ '--mw-bar': `${pct}%` } as CSSProperties}
      />
    </div>
  )
}

function CandidateMediaPreview({
  rpc,
  sha256,
  alt,
  t,
}: {
  rpc: MuweaveRpcClient
  sha256?: string
  alt: string
  t: (k: string) => string
}) {
  return <MediaPreview rpc={rpc} sha256={sha256} alt={alt} pendingLabel={t('previewPending')} emptyLabel={t('noPreview')} />
}

interface ShotOption {
  shotRef: string
  sceneRef: string
  order: number
  episodeRef?: string
}

export function EikonaMainPage({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  const [elements, setElements] = useState<MuweaveElementSummaryV1[]>([])
  const [details, setDetails] = useState<Record<string, MuweaveElementV1>>({})
  const [shotOptions, setShotOptions] = useState<ShotOption[]>([])
  const [gridCols, setGridCols] = useState<2 | 4>(4)
  const [zoomed, setZoomed] = useState(false)
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null)
  const [specModel, setSpecModel] = useState('openai/gpt-image-2.5-sunburst')
  const [specSize, setSpecSize] = useState('1152x2048')
  const [specQuality, setSpecQuality] = useState('high')
  const [specResult, setSpecResult] = useState<string>('')
  const [galleryQuery, setGalleryQuery] = useState('')
  const [galleryStatus, setGalleryStatus] = useState<string>('all')
  const [bindTargetByCand, setBindTargetByCand] = useState<Record<string, { shotRef: string; role: 'keyframe' | 'reference' }>>({})
  const [bindingCandId, setBindingCandId] = useState<string | null>(null)
  const [lastBoundShot, setLastBoundShot] = useState<{ shotRef: string; artifactId: string; role: string } | null>(null)
  const lang = coreT('langCode')
  const covers = useProjectCovers(rpc, 3)

  const loadEikona = useCallback(async () => {
    const [res, sbRes] = await Promise.all([
      rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { domain: 'eikona' }),
      rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { kind: 'drama.storyboard_table' }),
    ])
    if (res.ok) {
      setElements(res.data.elements)
      const detailEntries = await Promise.all(
        res.data.elements.slice(0, 12).map(async (el) => {
          const d = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: el.elementId })
          return d.ok ? ([el.elementId, d.data.element] as const) : undefined
        }),
      )
      const map: Record<string, MuweaveElementV1> = {}
      for (const pair of detailEntries) {
        if (pair) map[pair[0]] = pair[1]
      }
      setDetails(map)
    }
    if (sbRes.ok && Array.isArray(sbRes.data?.elements)) {
      const sbDetails = await Promise.all(
        sbRes.data.elements.slice(0, 4).map(async (sb) => {
          const d = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: sb.elementId })
          return d.ok ? { sb, element: d.data.element } : undefined
        }),
      )
      const opts: ShotOption[] = []
      const seen = new Set<string>()
      for (const item of sbDetails) {
        if (!item) continue
        const rows = ((item.element.payload ?? {}) as { rows?: Array<{ shotRef?: string; sceneRef?: string; order?: number }> }).rows ?? []
        for (const row of rows) {
          if (typeof row.shotRef === 'string' && row.shotRef && !seen.has(row.shotRef)) {
            seen.add(row.shotRef)
            opts.push({
              shotRef: row.shotRef,
              sceneRef: typeof row.sceneRef === 'string' ? row.sceneRef : '',
              order: typeof row.order === 'number' ? row.order : opts.length + 1,
              episodeRef: item.sb.sourceRef,
            })
          }
        }
      }
      setShotOptions(opts)
    }
  }, [rpc])

  useEffect(() => {
    void loadEikona()
  }, [loadEikona])

  const runControlledDecision = async (runId: string, artifactId: string, decision: 'accept' | 'reject') => {
    const idem = `eikona-${decision}-${runId}-${artifactId}`
    const res = await rpc.call('eikona.feedback.decide', {
      runId,
      artifactId,
      decision,
      reason: decision === 'accept' ? 'composition' : 'artifact_quality',
      idempotencyKey: idem,
    })
    const verb = decision === 'accept' ? t('acceptCandidate') : t('rejectCandidate')
    setNotice(
      res.ok
        ? { tone: 'ok', text: `${artifactId} · ${verb} · ${t('decisionDone')}` }
        : { tone: 'bad', text: `${res.error.code}: ${res.error.message}` },
    )
    await loadEikona()
  }

  const runControlledHandoff = async (handle: string, kind: 'bind' | 'handoff') => {
    const action = kind === 'bind' ? 'eikona.asset.bind' : 'eikona.asset.handoff'
    const res = await rpc.call(action, {
      handle,
      role: 'character',
      idempotencyKey: `eikona-${kind}-${handle}`,
    })
    const verb = kind === 'bind' ? t('bindMaster') : t('handoffAsset')
    setNotice(
      res.ok
        ? { tone: 'ok', text: `${handle} · ${verb} · ${t('handoffDone')}` }
        : { tone: 'bad', text: `${res.error.code}: ${res.error.message}` },
    )
    await loadEikona()
  }

  const handleSpecCheck = async () => {
    const res = await rpc.call<{ normalized: { model: string; size: string; quality: string; channel: string } }>(
      'eikona.spec.validate',
      { model: specModel, size: specSize, quality: specQuality, aspect: '9:16', channel: 'noemi' },
    )
    if (res.ok) {
      const n = res.data.normalized
      setSpecResult(
        `✓ ${t('specValidMsg')} → eikona generate --use-channel ${n.channel} --model ${n.model} --size ${n.size} --aspect 9:16 --quality ${n.quality} --agent`,
      )
    } else {
      setSpecResult(`✕ [${res.error.code}] ${res.error.message}`)
    }
  }

  const handleBindToShot = async (group: MuweaveElementSummaryV1, cand: CandidateItem) => {
    const target = bindTargetByCand[cand.artifactId] ?? {
      shotRef: shotOptions[0]?.shotRef ?? '',
      role: 'keyframe' as const,
    }
    if (!target.shotRef) return
    const opt = shotOptions.find((s) => s.shotRef === target.shotRef)
    setBindingCandId(cand.artifactId)
    try {
      const res = await rpc.call<{ ok: true }>('shot.media.link', {
        shotRef: target.shotRef,
        ...(opt?.sceneRef ? { sceneRef: opt.sceneRef } : {}),
        ...(opt?.episodeRef ? { episodeRef: opt.episodeRef } : {}),
        role: target.role,
        ...(cand.sha256 ? { sha256: cand.sha256 } : { elementId: group.elementId }),
        artifactId: cand.artifactId,
      })
      if (!res.ok) {
        setNotice({ tone: 'bad', text: `${res.error.code}: ${res.error.message}` })
        return
      }
      setLastBoundShot({ shotRef: target.shotRef, artifactId: cand.artifactId, role: target.role })
      setNotice({
        tone: 'ok',
        text: `${cand.artifactId} → ${target.shotRef} (${target.role}) · ${t('boundToShotDone')}`,
      })
    } finally {
      setBindingCandId(null)
    }
  }

  const candidateGroups = elements.filter((e) => e.kind === 'eikona.candidate_group')
  const masterBindings = elements.filter((e) => e.kind === 'eikona.master_binding' || e.kind === 'eikona.handoff')
  const scoreCards = elements.filter((e) => e.kind === 'eikona.assessment_card')
  const groupStatuses = useMemo(
    () => Array.from(new Set(candidateGroups.map((g) => g.status).filter((s): s is string => Boolean(s)))),
    [candidateGroups],
  )
  // Card minimum width drives the column count; zoom widens cards instead of scaling the grid.
  const cardMin = `${(gridCols === 2 ? 18 : 11) * (zoomed ? 1.5 : 1)}rem`
  const firstGroup = candidateGroups[0]
  const candidateTotal = candidateGroups.reduce((sum, g) => {
    const pl = (details[g.elementId]?.payload ?? {}) as { candidates?: CandidateItem[] }
    return sum + (pl.candidates?.length ?? 0)
  }, 0)

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      rpc={rpc}
      t={coreT}
      onSyncRequested={loadEikona}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      hero={
        <RoomHero
          eyebrow={t('heroEyebrow')}
          title={firstGroup?.title ?? t('heroEmptyTitle')}
          lede={t('heroLede')}
          stats={[
            { icon: 'image', value: candidateTotal, label: t('candidateCount') },
            { icon: 'inbox', value: candidateGroups.length, label: t('statGroups') },
            { icon: 'star', value: masterBindings.length, label: t('statMasters') },
            { icon: 'sliders', value: scoreCards.length, label: t('statScores') },
          ]}
          actions={
            firstGroup ? (
              <PillButton
                icon="at"
                onClick={() =>
                  stageItemToFloatingAgent({
                    kind: 'element',
                    ref: firstGroup.elementId,
                    label: firstGroup.title,
                    serializedLine: `[EikonaRun ref=${firstGroup.sourceRef}]`,
                  })
                }
              >
                {t('referGroup')}
              </PillButton>
            ) : null
          }
          cover={<CoverCollage covers={covers} posterTitle={t('roomTitle')} posterMeta="Eikona" />}
        />
      }
      headerActions={
        <>
          <Segmented<'2' | '4'>
            label={t('gridLabel')}
            value={String(gridCols) as '2' | '4'}
            onChange={(v) => setGridCols(v === '2' ? 2 : 4)}
            options={[
              { value: '2', label: t('compare2Up') },
              { value: '4', label: t('compare4Up') },
            ]}
          />
          <IconButton
            icon={zoomed ? 'zoomOut' : 'zoomIn'}
            label={zoomed ? t('zoomReset') : t('zoomIn')}
            pressed={zoomed}
            onClick={() => setZoomed((z) => !z)}
          />
        </>
      }
      stageTabs={[
        {
          id: 'gallery',
          label: () => t('tabGallery'),
          render: ({ onPinCompare }) => {
            if (candidateGroups.length === 0) return <EmptyState icon="image">{coreT('emptyElements')}</EmptyState>
            const q = galleryQuery.trim().toLowerCase()
            const filteredGroups = candidateGroups
              .filter((g) => galleryStatus === 'all' || g.status === galleryStatus)
              .map((group) => {
                const full = details[group.elementId]
                const payload = (full?.payload ?? {}) as { runId?: string; candidates?: CandidateItem[] }
                const runId = payload.runId ?? group.elementId
                const allCands = payload.candidates ?? []
                const cands = q
                  ? allCands.filter((c) =>
                      `${group.title} ${c.artifactId} ${c.handle} ${c.promptExcerpt} ${c.role}`
                        .toLowerCase()
                        .includes(q),
                    )
                  : allCands
                return { group, runId, cands }
              })
              .filter((entry) => !q || entry.cands.length > 0)

            return (
              <div className="mw-stack" data-gap="lg">
                <div className="dr-filter-bar mw-spread" data-eikona-gallery-filter="true">
                  <div className="mw-row" data-gap="xs">
                    <input
                      type="search"
                      className="mw-input"
                      aria-label={t('gallerySearchPlaceholder')}
                      placeholder={t('gallerySearchPlaceholder')}
                      data-eikona-search="true"
                      value={galleryQuery}
                      onChange={(ev) => setGalleryQuery(ev.target.value)}
                    />
                    <select
                      className="mw-input"
                      aria-label={t('galleryFilterAll')}
                      data-eikona-status-filter="true"
                      value={galleryStatus}
                      onChange={(ev) => setGalleryStatus(ev.target.value)}
                    >
                      <option value="all">{t('galleryFilterAll')}</option>
                      {groupStatuses.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {lastBoundShot ? (
                  <div className="mw-dsh-card mw-spread" data-flat="true" data-eikona-bind-receipt="true" role="status">
                    <span className="mw-dsh-muted">
                      {lastBoundShot.artifactId} → <code className="mw-dsh-code">{lastBoundShot.shotRef}</code> (
                      {lastBoundShot.role}) · {t('boundToShotDone')}
                    </span>
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-size="sm"
                      data-variant="primary"
                      data-eikona-goto-drama="true"
                      onClick={() => navigateToTheaterRoom('muweave-drama')}
                    >
                      {t('openInDrama')}
                    </button>
                  </div>
                ) : null}

                {filteredGroups.length === 0 ? (
                  <EmptyState icon="image">{t('galleryNoMatch')}</EmptyState>
                ) : (
                  filteredGroups.map(({ group, runId, cands }) => (
                    <section key={group.elementId} className="mw-stack">
                      <SectionHead
                        title={group.title}
                        meta={`${cands.length} ${t('candidateCount')}`}
                        actions={<StatusTag status={group.status} lang={lang} />}
                      />
                      <Masonry min={cardMin} data-eikona-compare-grid={String(gridCols)}>
                        {cands.map((cand) => {
                          const bindChoice = bindTargetByCand[cand.artifactId] ?? {
                            shotRef: shotOptions[0]?.shotRef ?? '',
                            role: 'keyframe' as const,
                          }
                          return (
                            <MediaCard
                              key={cand.artifactId}
                              ratio={cand.width && cand.height ? `${cand.width} / ${cand.height}` : '3 / 4'}
                              media={<CandidateMediaPreview rpc={rpc} sha256={cand.sha256} alt={cand.artifactId} t={t} />}
                              title={cand.artifactId}
                              meta={[cand.modelRef.split('/').pop(), cand.width && cand.height ? `${cand.width}×${cand.height}` : '', cand.role]
                                .filter(Boolean)
                                .join(' · ')}
                              actions={
                                <>
                                  {cand.handle ? (
                                    <>
                                      <IconButton
                                        icon="star"
                                        size="sm"
                                        label={t('bindMaster')}
                                        onClick={() => void runControlledHandoff(cand.handle, 'bind')}
                                      />
                                      <IconButton
                                        icon="handoff"
                                        size="sm"
                                        label={t('handoffAsset')}
                                        onClick={() => void runControlledHandoff(cand.handle, 'handoff')}
                                      />
                                    </>
                                  ) : null}
                                  <IconButton
                                    icon="pin"
                                    size="sm"
                                    label={coreT('openCompareB')}
                                    onClick={() =>
                                      onPinCompare(
                                        <div className="mw-stack" data-gap="sm">
                                          <CandidateMediaPreview rpc={rpc} sha256={cand.sha256} alt={cand.artifactId} t={t} />
                                          <strong className="mw-dsh-code">{cand.artifactId}</strong>
                                          <p className="mw-dsh-muted">{cand.promptExcerpt}</p>
                                          <span className="mw-dsh-code">{cand.uri}</span>
                                        </div>,
                                      )
                                    }
                                  />
                                  <IconButton
                                    icon="at"
                                    size="sm"
                                    label={coreT('insertRefChip')}
                                    onClick={() =>
                                      stageItemToFloatingAgent({
                                        kind: 'element',
                                        ref: `${group.elementId}:${cand.artifactId}`,
                                        label: `${group.title}/${cand.artifactId}`,
                                        serializedLine: `[EikonaArtifact run=${runId} artifact=${cand.artifactId} uri=${cand.uri}]`,
                                      })
                                    }
                                  />
                                </>
                              }
                            >
                              {cand.promptExcerpt ? (
                                <span className="mw-dsh-muted mw-clamp-2" title={cand.promptExcerpt}>
                                  {cand.promptExcerpt}
                                </span>
                              ) : null}
                              {typeof cand.overallScore === 'number' ? (
                                <ScoreMeter label={t('overallScore')} value={cand.overallScore} />
                              ) : null}
                              <div className="ek-cand-actions">
                                <PillButton
                                  variant="primary"
                                  icon="check"
                                  onClick={() => void runControlledDecision(runId, cand.artifactId, 'accept')}
                                >
                                  {t('acceptCandidate')}
                                </PillButton>
                                <PillButton onClick={() => void runControlledDecision(runId, cand.artifactId, 'reject')}>
                                  {t('rejectCandidate')}
                                </PillButton>
                              </div>
                              {shotOptions.length > 0 ? (
                                <div className="ek-bind-shot" data-eikona-bind-shot={cand.artifactId}>
                                  <select
                                    className="mw-input"
                                    aria-label={`${t('bindShotSelect')} (${cand.artifactId})`}
                                    data-bind-shot-select={cand.artifactId}
                                    value={bindChoice.shotRef}
                                    onChange={(ev) =>
                                      setBindTargetByCand((prev) => ({
                                        ...prev,
                                        [cand.artifactId]: { ...bindChoice, shotRef: ev.target.value },
                                      }))
                                    }
                                  >
                                    {shotOptions.map((opt) => (
                                      <option key={opt.shotRef} value={opt.shotRef}>
                                        {opt.shotRef}
                                        {opt.sceneRef ? ` · ${opt.sceneRef}` : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    className="mw-input"
                                    aria-label={`${t('bindRoleSelect')} (${cand.artifactId})`}
                                    data-bind-role-select={cand.artifactId}
                                    value={bindChoice.role}
                                    onChange={(ev) =>
                                      setBindTargetByCand((prev) => ({
                                        ...prev,
                                        [cand.artifactId]: {
                                          ...bindChoice,
                                          role: ev.target.value === 'reference' ? 'reference' : 'keyframe',
                                        },
                                      }))
                                    }
                                  >
                                    <option value="keyframe">{t('roleKeyframe')}</option>
                                    <option value="reference">{t('roleReference')}</option>
                                  </select>
                                  <button
                                    type="button"
                                    className="mw-dsh-btn"
                                    data-size="sm"
                                    data-variant="quiet"
                                    data-bind-shot-submit={cand.artifactId}
                                    disabled={bindingCandId === cand.artifactId || !bindChoice.shotRef}
                                    onClick={() => void handleBindToShot(group, cand)}
                                  >
                                    {t('bindToShot')}
                                  </button>
                                </div>
                              ) : null}
                            </MediaCard>
                          )
                        })}
                      </Masonry>
                    </section>
                  ))
                )}
              </div>
            )
          },
        },
        {
          id: 'masters',
          label: () => t('tabMasters'),
          render: () =>
            masterBindings.length === 0 ? (
              <EmptyState icon="star">{coreT('emptyElements')}</EmptyState>
            ) : (
              <div className="mw-grid-auto" style={{ '--mw-card-min': '16rem' } as CSSProperties}>
                {masterBindings.map((m) => (
                  <article key={m.elementId} className="mw-dsh-card">
                    <div className="mw-spread">
                      <span className="mw-title">{m.title}</span>
                      <StatusTag status={m.status} lang={lang} />
                    </div>
                    {m.subtitle ? <span className="mw-dsh-muted">{m.subtitle}</span> : null}
                    <code className="mw-dsh-code mw-dsh-muted">{m.sourceRef}</code>
                  </article>
                ))}
              </div>
            ),
        },
        {
          id: 'scores',
          label: () => t('tabScores'),
          render: () =>
            scoreCards.length === 0 ? (
              <EmptyState>{coreT('emptyElements')}</EmptyState>
            ) : (
              <div className="mw-stack" data-gap="lg">
                {scoreCards.map((sc) => {
                  const pl = (details[sc.elementId]?.payload ?? {}) as {
                    criteriaId?: string
                    modelRef?: string
                    scores?: Array<Record<string, unknown>>
                  }
                  const rows = Array.isArray(pl.scores) ? pl.scores : []
                  return (
                    <section key={sc.elementId} className="mw-stack" data-gap="sm">
                      <SectionHead title={sc.title} meta={sc.subtitle} />
                      {rows.length === 0 ? (
                        <pre className="mw-pre">{JSON.stringify(pl, null, 2)}</pre>
                      ) : (
                        <div className="mw-grid-auto" style={{ '--mw-card-min': '15rem' } as CSSProperties}>
                          {rows.map((row, idx) => {
                            const id = String(row.artifact_id ?? row.artifactId ?? row.handle ?? `#${idx + 1}`)
                            const numeric = Object.entries(row).filter(
                              (entry): entry is [string, number] => typeof entry[1] === 'number',
                            )
                            const overall = numeric.find(([k]) => k === 'overall_score' || k === 'overallScore')
                            const rest = numeric.filter(([k]) => k !== 'overall_score' && k !== 'overallScore')
                            const notes = typeof row.summary === 'string' ? row.summary : typeof row.notes === 'string' ? row.notes : ''
                            return (
                              <article key={id} className="mw-dsh-card">
                                <span className="mw-title mw-dsh-code">{id}</span>
                                {overall ? <ScoreMeter label={t('overallScore')} value={overall[1]} /> : null}
                                {rest.map(([k, v]) => (
                                  <ScoreMeter key={k} label={k} value={v} />
                                ))}
                                {notes ? <span className="mw-dsh-muted mw-clamp-2">{notes}</span> : null}
                              </article>
                            )
                          })}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            ),
        },
        {
          id: 'spec-guard',
          label: () => t('tabSpecGuard'),
          render: () => (
            <section className="mw-dsh-card mw-stack">
              <SectionHead title={t('specTitle')} />
              <p className="mw-dsh-muted">{t('specHint')}</p>
              <div className="mw-form-grid">
                <label className="mw-field">
                  <span>{t('specModel')}</span>
                  <input
                    type="text"
                    className="mw-input"
                    aria-label="Eikona Model"
                    value={specModel}
                    onChange={(e) => setSpecModel(e.target.value)}
                  />
                </label>
                <label className="mw-field">
                  <span>{t('specSize')}</span>
                  <input
                    type="text"
                    className="mw-input"
                    aria-label="Eikona Pixel Size"
                    value={specSize}
                    onChange={(e) => setSpecSize(e.target.value)}
                  />
                </label>
                <label className="mw-field">
                  <span>{t('specQuality')}</span>
                  <select
                    className="mw-input"
                    aria-label="Eikona Quality"
                    value={specQuality}
                    onChange={(e) => setSpecQuality(e.target.value)}
                  >
                    <option value="high">high (Sunburst 必需)</option>
                    <option value="low">low</option>
                  </select>
                </label>
              </div>
              <div>
                <button type="button" className="mw-dsh-btn" data-variant="primary" onClick={() => void handleSpecCheck()}>
                  校验出图参数规格
                </button>
              </div>
              {specResult ? (
                <p
                  role="status"
                  className="mw-callout mw-dsh-code"
                  data-tone={specResult.startsWith('✓') ? 'ok' : 'bad'}
                  data-spec-verdict={specResult.startsWith('✓') ? 'pass' : 'fail'}
                >
                  {specResult}
                </p>
              ) : null}
            </section>
          ),
        },
      ]}
    />
  )
}

export function EikonaCompanionPane({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  return <CompanionList rpc={rpc} coreT={coreT} title={t('companionTitle')} domain="eikona" companionId="eikona" />
}

export function apply(ctx: DshClientContextLike): void {
  const tFn = () => ctx.locale.bind(EIKONA_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: EIKONA_LOCALE_NS,
    dictionaries: { zh, en },
    pane: {
      pluginId: 'muweave-eikona',
      panelId: EIKONA_PANEL_ID,
      order: 42,
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: ['eikona'],
      companionId: EIKONA_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: EikonaIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    },
    MainComponent: EikonaMainPage,
    CompanionComponent: EikonaCompanionPane,
  })
}
