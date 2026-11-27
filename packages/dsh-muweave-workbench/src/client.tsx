import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CompanionList,
  EmptyAction,
  EmptyState,
  IconButton,
  Masonry,
  MediaCard,
  NoteCard,
  PillButton,
  Poster,
  RoomHero,
  SectionHead,
  Segmented,
  ShotGenerateButton,
  ShotMedia,
  StatusTag,
  WorkspaceShell,
  useMediaUrl,
  keyframeDigest,
  openGeneration,
  useGenerationStore,
  shotDescription,
  statusLabel,
  statusTone,
  type LinkedMediaRef,
  type JobRecordV1,
  type WorkspaceNotice,
  publishKnownElementsForTriggers,
  registerMuweaveCreatorPlugin,
  stageItemToFloatingAgent,
  type DshClientContextLike,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  type OwnerReadinessState,
} from '@yeisme/dsh-muweave-core/client'
import { ProjectPanel, type ProjectRow } from './project-panel'
import { StageSpine, useStageSpineJobs } from './stage-axis'
import { VerdictPanel } from './verdict-panel'
import { StageWorkbench } from './stage-workbench'
import { ComparePaneSlot } from './compare-pane'
import {
  UNLABELED_GROUP,
  coverDigest,
  defaultSpineStage,
  elementSubject,
  groupBySpineStage,
  groupElements,
  pickPrimary,
  stageLabel,
  versionLabel,
  type CompareSubject,
  type ElementGroupBy,
  type SpineStageId,
} from './stage-map'
import { toolCatalogIntent, useToolCatalog, type ToolCatalogEntry } from '@yeisme/dsh-muweave-core/client'

export const name = '@yeisme/dsh-muweave-workbench'
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const WORKBENCH_PANEL_ID = 'muweave-workbench'
export const WORKBENCH_COMPANION_ID = 'muweave-workbench/companion'
export const WORKBENCH_LOCALE_NS = 'muweaveWorkbench'

const zh = {
  panelTitle: '幕织原件总览',
  roomTitle: '总览',
  companionTitle: '原件与 Pi 动态',
  tabOverview: '原件总览',
  tabPiArtifacts: 'Pi 工件',
  tabDshArtifacts: 'DSH 工件',
  tabBindWizard: '绑定引用',
  filterTitle: '按领域筛选',
  metricTotal: '元件总数',
  metricStale: '基线过期',
  bindRefLabel: '安全引用',
  bindHint: '只接受不透明引用，绑定后自动同步 .muweave/。',
  boundReceipt: '已绑定 {target} 并刷新 .muweave/',
  syncFailed: '同步没有完成，请稍后重试。',
  closeInspector: '关闭详情',
  fieldId: '元件 ID',
  fieldOwner: '来源',
  fieldKind: '类型',
  fieldRef: '引用',
  fieldDigest: '摘要',
  payload: '载荷',
  domainAll: '全部元件',
  domainEikona: 'Eikona 视觉元件',
  domainScript: 'Auctra 剧本元件',
  domainDrama: 'Scaena 做剧元件',
  domainHarness: 'Pi & DSH 工件',
  bindTargetLabel: '绑定目标类型',
  bindRefPlaceholder: '粘贴安全引用 (如 run_001 / breakdown:ep01 / scene:01)',
  bindSubmit: '绑定并同步至 .muweave/',
  inspectorTitle: '元件结构化详情',
  selectHint: '选择任意元件以检视摘要、SHA-256 校验值与载荷内容。',
  ownerReadinessTitle: '上游工具连接状态',
  heroEyebrow: '幕织 · 片场总览',
  heroTitle: '今天的片场',
  heroLede: '{total} 个原件{thumb}里，{stale} 个基线过期，{pending} 个还在等你处理。',
  nextStep: '下一步',
  nextStepAllClear: '所有原件都已就绪，可以继续推进下一场。',
  openElement: '查看详情',
  draftRoomTitle: '成稿',
  draftPanelTitle: '成稿：剧本与分镜出图',
  draftEyebrow: '幕织 · 成稿',
  draftEmptyTitle: '还没有分镜表',
  draftLede: '左边读剧本，右边逐镜出图；每次生成都要你批准。',
  draftScenes: '场次',
  draftShots: '镜头',
  draftImaged: '已出图',
  draftReading: '剧本阅读',
  draftBoard: '本集分镜',
  draftNoScenes: '还没有场次卡',
  draftNoShots: '这一集还没有分镜',
  draftGoal: '目标',
  draftObstacle: '阻碍',
  draftTurn: '转折',
  draftSeconds: '秒',
  viewLabel: '总览视图',
  viewByStage: '按阶段',
  viewAll: '全部',
  groupLabel: '元件分组',
  groupNone: '不分组',
  groupScene: '场次',
  groupCharacter: '角色',
  groupStatus: '状态',
  groupMedia: '素材',
  groupUnlabeled: '未标注',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: 'MuWeave Bundle Hub',
  roomTitle: 'Overview',
  companionTitle: 'Bundle & Pi Pulse',
  tabOverview: 'Overview',
  tabPiArtifacts: 'Pi Artifacts',
  tabDshArtifacts: 'DSH Artifacts',
  tabBindWizard: 'Bind Ref',
  filterTitle: 'Filter by Domain',
  metricTotal: 'Elements',
  metricStale: 'Stale',
  bindRefLabel: 'Opaque Ref',
  bindHint: 'Only opaque refs are accepted; .muweave/ syncs after binding.',
  boundReceipt: 'Bound {target} and refreshed .muweave/',
  syncFailed: 'Sync did not finish; try again shortly.',
  closeInspector: 'Close Inspector',
  fieldId: 'Element ID',
  fieldOwner: 'Owner',
  fieldKind: 'Kind',
  fieldRef: 'Ref',
  fieldDigest: 'Digest',
  payload: 'Payload',
  domainAll: 'All Elements',
  domainEikona: 'Eikona Visuals',
  domainScript: 'Auctra Script',
  domainDrama: 'Scaena Drama',
  domainHarness: 'Pi & DSH Harness',
  bindTargetLabel: 'Binding Target Kind',
  bindRefPlaceholder: 'Paste opaque ref (e.g. run_001 / breakdown:ep01 / scene:01)',
  bindSubmit: 'Bind & Sync .muweave/',
  inspectorTitle: 'Element Inspector',
  selectHint: 'Select any element to inspect its metadata, SHA-256 digest, and payload.',
  ownerReadinessTitle: 'Upstream Owner Readiness',
  heroEyebrow: 'MuWeave · On set',
  heroTitle: 'The set today',
  heroLede: 'Of {total} elements{thumb}, {stale} have a stale baseline and {pending} still wait for you.',
  nextStep: 'Next step',
  nextStepAllClear: 'Every element is ready; move on to the next scene.',
  openElement: 'Inspect',
  draftRoomTitle: 'Draft',
  draftPanelTitle: 'Draft: script and shot images',
  draftEyebrow: 'MuWeave · Draft',
  draftEmptyTitle: 'No storyboard yet',
  draftLede: 'Read the script on the left, generate shot by shot on the right; every generation needs your approval.',
  draftScenes: 'Scenes',
  draftShots: 'Shots',
  draftImaged: 'With image',
  draftReading: 'Script reading',
  draftBoard: 'Episode storyboard',
  draftNoScenes: 'No scene cards yet',
  draftNoShots: 'No shots in this episode yet',
  draftGoal: 'Goal',
  draftObstacle: 'Obstacle',
  draftTurn: 'Turn',
  draftSeconds: 's',
  viewLabel: 'Overview view',
  viewByStage: 'By stage',
  viewAll: 'All',
  groupLabel: 'Group elements',
  groupNone: 'None',
  groupScene: 'Scene',
  groupCharacter: 'Character',
  groupStatus: 'Status',
  groupMedia: 'Media',
  groupUnlabeled: 'Unlabeled',
}

export function WorkbenchIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <rect x="2" y="2" width="5.2" height="5.2" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.8" y="2" width="5.2" height="5.2" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="8.8" width="5.2" height="5.2" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

const BIND_TARGETS = [
  { value: 'eikona-run', label: 'Eikona Run ID (eikona-run)' },
  { value: 'eikona-handle', label: 'Eikona Asset Handle (eikona-handle)' },
  { value: 'eikona-collection', label: 'Eikona Collection URI (eikona-collection)' },
  { value: 'auctra-project', label: 'Auctra Project Ref (auctra-project)' },
  { value: 'auctra-scene', label: 'Auctra Scene Ref (auctra-scene)' },
  { value: 'scaena-breakdown', label: 'Scaena Breakdown Ref (scaena-breakdown)' },
  { value: 'scaena-edit-session', label: 'Scaena Edit Session Ref (scaena-edit-session)' },
] as const

function SoundArtifact({ rpc, sha256, mime }: { rpc: MuweaveRpcClient; sha256?: string; mime?: string }) {
  const url = useMediaUrl(rpc, sha256, mime)
  return url ? <audio controls preload="metadata" src={url} aria-label="试听产物" /> : null
}

function SoundStage({ rpc, jobs }: { rpc: MuweaveRpcClient; jobs: readonly JobRecordV1[] | undefined }) {
  const outputs = jobs?.filter((job) => job.owner === 'sonora' && ['voice', 'music', 'sfx'].includes(job.kind))
    .flatMap((job) => job.slots.filter((slot) => slot.status === 'done').map((slot) => ({ job, slot }))) ?? []
  return (
    <section className="mw-stage-work" data-stage-workbench="true" data-stage="sound" data-stage-region="L1">
      <header className="mw-stage-work-head"><h2>声音</h2></header>
      {outputs.length ? <div className="mw-stack" data-gap="sm">
        {outputs.map(({ job, slot }) => (
          <MediaCard key={job.jobId + '/' + slot.slotId} title={slot.label || job.title} review={slot.review} shotCount={job.anchor?.shotRef ? 1 : 0}>
            <SoundArtifact rpc={rpc} sha256={slot.sha256} mime={slot.mime} />
          </MediaCard>
        ))}
      </div> : <EmptyAction label="打开声音生成" onAction={(trigger) => openGeneration({ stage: 'sound' }, trigger)} />}
    </section>
  )
}

export function WorkbenchMainPage({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  const [elements, setElements] = useState<MuweaveElementSummaryV1[]>([])
  const [bundleAvailable, setBundleAvailable] = useState(false)
  const [ownerStates, setOwnerStates] = useState<Record<string, OwnerReadinessState>>({})
  const [domainFilter, setDomainFilter] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [selectedDetail, setSelectedDetail] = useState<MuweaveElementV1 | undefined>(undefined)
  const [bindTarget, setBindTarget] = useState<string>('eikona-run')
  const [bindRef, setBindRef] = useState<string>('')
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null)
  const [activeProject, setActiveProject] = useState<ProjectRow | undefined>(undefined)
  /** True when the selected project has no elements of its own yet (showing the workspace fallback). */
  const [projectUnclaimed, setProjectUnclaimed] = useState(false)
  /** F2: bumping the nonce opens the project popover straight on the claim wizard. */
  const [claimRequest, setClaimRequest] = useState<{ nonce: number; workspaceId?: string } | undefined>(undefined)
  /** Desk v8: the Overview tab leads with the stage axis; the masonry stays one toggle away as 「全部」. */
  const [overviewMode, setOverviewMode] = useState<'stage' | 'all'>('stage')
  /** Undefined until the user picks one, so the default follows the data as it loads. */
  const [pickedStage, setPickedStage] = useState<SpineStageId | undefined>(undefined)
  /** F1: a view-only projection of the elements in hand; switching it never calls the host. */
  const [groupBy, setGroupBy] = useState<'none' | ElementGroupBy>('none')
  const lang = coreT('langCode')
  const { mediaRevision } = useGenerationStore()
  /** Desk v8 P1: the pinned compare side as data; the shell slot only holds a bound <ComparePaneSlot />. */
  const [compareTarget, setCompareTarget] = useState<CompareSubject | null>(null)
  /** True while the compare pane is on screen: the inspector steps aside so both columns are equal. */
  const [compareShown, setCompareShown] = useState(false)
  /** Where focus returns when the compare pane closes. */
  const compareTriggerRef = useRef<HTMLElement | null>(null)

  const loadList = useCallback(async () => {
    const res = await rpc.call<{
      elements: MuweaveElementSummaryV1[]
      ownerStates: Record<string, OwnerReadinessState>
    }>('bundle.elements.list', activeProject ? { projectId: activeProject.id } : {})
    setBundleAvailable(res.ok && Array.isArray(res.data?.elements))
    // A freshly created project usually has no elements tagged with its id yet. Blanking the room
    // there reads as data loss, so fall back to the workspace projection and flag it as unclaimed.
    if (activeProject && res.ok && (res.data?.elements ?? []).length === 0) {
      const fallback = await rpc.call<{
        elements: MuweaveElementSummaryV1[]
        ownerStates?: Record<string, OwnerReadinessState>
      }>('bundle.elements.list', {})
      if (fallback.ok && (fallback.data?.elements ?? []).length > 0) {
        setBundleAvailable(true)
        setElements(fallback.data.elements)
        setProjectUnclaimed(true)
        setOwnerStates(fallback.data?.ownerStates ?? {})
        publishKnownElementsForTriggers(fallback.data.elements)
        return
      }
    }
    setProjectUnclaimed(false)
    if (res.ok) {
      const list = res.data?.elements ?? []
      setElements(list)
      setOwnerStates(res.data?.ownerStates ?? {})
      publishKnownElementsForTriggers(list)
    }
  }, [rpc, activeProject])

  useEffect(() => {
    let cancelled = false
    void rpc
      .call<{ projects?: ProjectRow[]; activeProjectId?: string }>('project.list', {})
      .then((res) => {
        if (cancelled || !res.ok) return
        // Hosts (or test doubles) without project support may answer without a projects array:
        // degrade to "no active project" instead of throwing and blanking the whole room.
        const projects = res.data?.projects ?? []
        const activeId = res.data?.activeProjectId
        setActiveProject(projects.find((project) => project.id === activeId))
      })
      .catch(() => {
        if (!cancelled) setActiveProject(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [rpc])

  useEffect(() => {
    void loadList()
  }, [loadList, mediaRevision])

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(undefined)
      return
    }
    let cancelled = false
    void rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: selectedId }).then((res) => {
      if (!cancelled && res.ok) setSelectedDetail(res.data.element)
    })
    return () => {
      cancelled = true
    }
  }, [rpc, selectedId])

  const handleBindSubmit = async () => {
    if (!bindRef.trim()) return
    const bindRes = await rpc.call('bundle.bind', { target: bindTarget, ref: bindRef.trim() })
    if (!bindRes.ok) {
      setNotice({ tone: 'bad', text: bindRes.error.message })
      return
    }
    await rpc.call('bundle.sync', {})
    setBindRef('')
    setNotice({ tone: 'ok', text: t('boundReceipt').replace('{target}', bindTarget) })
    await loadList()
  }

  /** The empty stage's 「去同步」: the same bundle.sync the toolbar runs, with failures surfaced, not thrown. */
  const syncStage = async () => {
    try {
      const res = await rpc.call('bundle.sync', {})
      if (!res?.ok) {
        setNotice({ tone: 'bad', text: res?.error?.message ?? t('syncFailed') })
        return
      }
      await loadList()
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Builds the compare pane's props from the current stage selection plus one pinned subject. */
  const comparePaneProps = (pinned: CompareSubject | null) => {
    const el = elements.find((e) => e.elementId === selectedId) ?? pickPrimary(stageGroups[currentStage], selectedId)
    return {
      rpc,
      lang,
      current: el ? elementSubject(el, pinned?.kind === 'variant' ? 'media' : 'element') : undefined,
      compare: pinned ?? undefined,
      onClose: closeCompare,
      onMountedChange: setCompareShown,
    }
  }

  /**
   * Pins a compare side. The shell's onPinCompare already opens the horizontal split; hiding the
   * inspector while the pane is shown completes the 「对比」 preset without touching the shell.
   */
  const pinCompare = (shellPin: (node: ReactNode) => void, subject: CompareSubject, trigger?: HTMLElement | null) => {
    compareTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setCompareTarget(subject)
    shellPin(<ComparePaneSlot {...comparePaneProps(subject)} />)
  }
  const closeCompare = useCallback(() => {
    setCompareTarget(null)
    const trigger = compareTriggerRef.current
    compareTriggerRef.current = null
    if (trigger?.isConnected) trigger.focus()
  }, [])

  const renderElementCards = (
    items: readonly MuweaveElementSummaryV1[],
    onPinCompare: (node: ReactNode) => void,
    lead?: ReactNode,
  ) => {
    if (items.length === 0) {
      return <EmptyAction label="同步产物" onAction={() => void syncStage()} />
    }
    return (
      <Masonry min="16rem">
        {lead}
        {items.map((el) => {
          const selected = selectedId === el.elementId
          return (
            <MediaCard
              key={el.elementId}
              selected={selected}
              version={versionLabel(el)}
              review={el.status}
              shotCount={new Set(el.shotRefs ?? []).size}
              stale={el.stale}
              title={<button type="button" className="mw-card-hit" aria-pressed={selected} onClick={() => setSelectedId(el.elementId)}>{el.title}</button>}
              meta={el.subtitle}
              image={coverDigest(el) ? { rpc, sha256: coverDigest(el), alt: el.title, fallback: { label: '查看产物', onAction: () => setSelectedId(el.elementId) } } : undefined}
              lang={lang}
            >
              <div className="mw-row" data-gap="xs">
                <span className="mw-chip">{el.sourceOwner}</span>
                <span className="mw-chip" data-mono="true">
                  {el.kind}
                </span>
                <span className="mw-spacer" />
                <IconButton
                  icon="pin"
                  size="sm"
                  label={coreT('openCompareB')}
                  onClick={() => pinCompare(onPinCompare, elementSubject(el))}
                />
                <IconButton
                  icon="at"
                  size="sm"
                  label={coreT('insertRefChip')}
                  onClick={() =>
                    stageItemToFloatingAgent({
                      kind: 'element',
                      ref: el.elementId,
                      label: el.title,
                      serializedLine: `[MuWeaveElement id=${el.elementId} owner=${el.sourceOwner} ref=${el.sourceRef} digest=${el.digest.slice(0, 19)}]`,
                    })
                  }
                />
              </div>
            </MediaCard>
          )
        })}
      </Masonry>
    )
  }

  const stageGroups = useMemo(() => groupBySpineStage(elements), [elements])
  const stageJobs = useStageSpineJobs(rpc, undefined, elements)
  const visibleElements = domainFilter === 'all' ? elements : elements.filter((row) => row.domain === domainFilter)
  const currentStage = pickedStage ?? defaultSpineStage(stageGroups)
  const selectStage = (stage: SpineStageId) => {
    setPickedStage(stage)
    setSelectedId(undefined)
  }
  const overviewToggle = (
    <Segmented<'stage' | 'all'>
      label={t('viewLabel')}
      value={overviewMode}
      onChange={setOverviewMode}
      options={[
        { value: 'stage', label: t('viewByStage') },
        { value: 'all', label: t('viewAll') },
      ]}
    />
  )
  const groupToggle = (
    <Segmented<'none' | ElementGroupBy>
      label={t('groupLabel')}
      value={groupBy}
      onChange={setGroupBy}
      options={[
        { value: 'none', label: t('groupNone') },
        { value: 'scene', label: t('groupScene') },
        { value: 'character', label: t('groupCharacter') },
        { value: 'status', label: t('groupStatus') },
        { value: 'media', label: t('groupMedia') },
      ]}
    />
  )
  const groupTitle = (key: string, label: string) =>
    key === UNLABELED_GROUP ? t('groupUnlabeled') : groupBy === 'status' ? statusLabel(key, lang) : label
  const renderOverview = (onPinCompare: (node: ReactNode) => void) =>
    overviewMode === 'stage' ? (
      <div className="mw-stage-overview" data-muweave-overview-mode="stage">
        <div className="mw-stage-layout">
          <StageSpine rpc={rpc} groups={stageGroups} current={currentStage} onSelect={selectStage} lang={lang} projectId={activeProject?.id} jobs={stageJobs} refreshKey={elements} bundleAvailable={bundleAvailable} />
          {currentStage === 'sound' ? <SoundStage rpc={rpc} jobs={stageJobs} /> : <StageWorkbench
            rpc={rpc}
            stage={currentStage}
            rows={stageGroups[currentStage]}
            lang={lang}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPinCompare={(subject, trigger) => pinCompare(onPinCompare, subject, trigger)}
            onPinVariant={(subject, trigger) => pinCompare(onPinCompare, subject, trigger)}
            onDismiss={() => setSelectedId(undefined)}
            onSync={() => void syncStage()}
          />}
        </div>
      </div>
    ) : (
      <div className="mw-stage-overview" data-muweave-overview-mode="all">
        <div className="mw-group-bar" data-element-group-bar="true">{groupToggle}</div>
        {groupBy === 'none' || elements.length === 0 ? (
          renderElementCards(visibleElements, onPinCompare, nextStepCard)
        ) : (
          // Re-keyed per dimension so the regrouped list fades in once.
          <div key={groupBy} className="mw-group-list" data-element-group-by={groupBy}>
            {groupElements(visibleElements, groupBy).map((group) => (
              <section key={group.key} className="mw-group" data-element-group={group.key}>
                <header className="mw-group-head">
                  <span className="mw-eyebrow">{groupTitle(group.key, group.label)}</span>
                  <span className="mw-group-count">{group.rows.length}</span>
                </header>
                {renderElementCards(group.rows, onPinCompare)}
              </section>
            ))}
          </div>
        )}
      </div>
    )

  const piItems = elements.filter((e) => e.sourceOwner === 'pi')
  const dshItems = elements.filter((e) => e.sourceOwner === 'dsh')
  const pendingItems = elements.filter((e) => e.stale || statusTone(e.status) !== 'ok')
  const nextItem = pendingItems[0]
  const nextStepCard = (
    <NoteCard ink eyebrow={t('nextStep')} title={nextItem?.title} data-muweave-next-step="true">
      {nextItem ? (
        <>
          {nextItem.subtitle ? <p className="mw-dsh-muted mw-clamp-2">{nextItem.subtitle}</p> : null}
          <div className="mw-row" data-gap="sm">
            <StatusTag status={nextItem.stale ? 'stale' : nextItem.status} lang={lang} />
            <span className="mw-spacer" />
            <PillButton onClick={() => setSelectedId(nextItem.elementId)}>{t('openElement')}</PillButton>
          </div>
        </>
      ) : (
        <p className="mw-dsh-muted">{t('nextStepAllClear')}</p>
      )}
    </NoteCard>
  )

  const leftTree = (
    <div className="mw-stack">
      <span className="mw-eyebrow">{t('filterTitle')}</span>
      <nav className="mw-nav" aria-label={t('filterTitle')}>
        {[
          { id: 'all', label: t('domainAll') },
          { id: 'eikona', label: t('domainEikona') },
          { id: 'script', label: t('domainScript') },
          { id: 'drama', label: t('domainDrama') },
          { id: 'harness', label: t('domainHarness') },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            className="mw-nav-item"
            aria-pressed={domainFilter === f.id}
            onClick={() => { setDomainFilter(f.id); setOverviewMode('all') }}
          >
            {f.label}
          </button>
        ))}
      </nav>
      <hr className="mw-divider" />
      <span className="mw-eyebrow">{t('ownerReadinessTitle')}</span>
      <ul className="mw-stack" data-gap="xs">
        {(['eikona', 'auctra', 'scaena', 'pi', 'dsh'] as const).map((owner) => (
          <li key={owner} className="mw-spread">
            <span>{owner}</span>
            <StatusTag status={ownerStates[owner] ?? 'empty'} lang={lang} />
          </li>
        ))}
      </ul>
    </div>
  )

  const toolCatalog = useToolCatalog(rpc)
  const runTool = (entry: ToolCatalogEntry) => {
    const intent = toolCatalogIntent(entry)
    if (intent.kind === 'blocked') return
    openGeneration({ capabilityId: entry.id })
  }
  const toolRow = (entry: ToolCatalogEntry) => {
    const intent = toolCatalogIntent(entry)
    return (
      <li key={entry.id} className="mw-sv-tool" data-tool-id={entry.id} data-availability={entry.availability}>
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="ghost"
          data-size="sm"
          data-tool-action={intent.kind}
          disabled={intent.kind === 'blocked'}
          title={intent.kind === 'blocked' ? intent.reason : entry.labelZh}
          onClick={() => runTool(entry)}
        >
          <span>{lang === 'en' ? entry.labelEn : entry.labelZh}</span>
        </button>
        <span className="mw-dsh-muted">{entry.owner}</span>
        {intent.kind === 'blocked' ? <span className="mw-dsh-muted">{intent.reason}</span> : null}
      </li>
    )
  }
  const toolGroups = toolCatalog.groups
  const toolCatalogPanel = (
    <div className="mw-stack" data-muweave-tool-catalog="true" data-gap="sm">
      <span className="mw-eyebrow">{coreT('catalogTitle')}</span>
      <p className="mw-dsh-muted">
        {coreT('catalogSummary')
          .replace('{ready}', String(toolGroups.ready.length))
          .replace('{approval}', String(toolGroups.needsApproval.length))
          .replace('{blocked}', String(toolGroups.blocked.length))}
      </p>
      {(
        [
          ['ready', toolGroups.ready],
          ['needsApproval', toolGroups.needsApproval],
          ['blocked', toolGroups.blocked],
        ] as const
      ).map(([group, rows]) =>
        rows.length === 0 ? (
          group === 'ready' ? (
            // An empty "ready" group is normal when every installed owner capability is paid:
            // say so, otherwise the panel reads as broken.
            <section key={group} className="mw-stack" data-gap="xs" data-tool-group={group}>
              <h4 className="mw-eyebrow">{coreT('catalogReady')}</h4>
              <p className="mw-dsh-muted" data-tool-empty-hint="ready">
                {lang === 'en'
                  ? 'Every installed owner capability needs approval; start from the approval group.'
                  : '当前安装的 owner 能力都需要审批；先在「需要你批准」里选一项。'}
              </p>
            </section>
          ) : null
        ) : (
          <section key={group} className="mw-stack" data-gap="xs" data-tool-group={group}>
            <h4 className="mw-eyebrow">
              {coreT(group === 'ready' ? 'catalogReady' : group === 'needsApproval' ? 'catalogNeedsApproval' : 'catalogBlocked')}
            </h4>
            <ul className="mw-stack" data-gap="xs">
              {rows.map(toolRow)}
            </ul>
          </section>
        ),
      )}
    </div>
  )

  const rightInspector = selectedDetail ? (
    <div className="mw-stack">
      <SectionHead
        title={t('inspectorTitle')}
        actions={<IconButton icon="close" size="sm" label={t('closeInspector')} onClick={() => setSelectedId(undefined)} />}
      />
      <span className="mw-title">{selectedDetail.title}</span>
      <dl className="mw-dl">
        <dt>{t('fieldId')}</dt>
        <dd className="mw-dsh-code">{selectedDetail.elementId}</dd>
        <dt>{t('fieldOwner')}</dt>
        <dd>{selectedDetail.sourceOwner}</dd>
        <dt>{t('fieldKind')}</dt>
        <dd className="mw-dsh-code">{selectedDetail.kind}</dd>
        <dt>{t('fieldRef')}</dt>
        <dd className="mw-dsh-code">{selectedDetail.sourceRef}</dd>
        <dt>{t('fieldDigest')}</dt>
        <dd className="mw-dsh-code" title={selectedDetail.digest}>
          {selectedDetail.digest.slice(0, 24)}…
        </dd>
      </dl>
      <span className="mw-eyebrow">{t('payload')}</span>
      <pre className="mw-pre">{JSON.stringify(selectedDetail.payload, null, 2)}</pre>
    </div>
  ) : (
    toolCatalogPanel
  )

  // The shell's notice is text-only, so the fallback notice sits under the project bar where it can
  // carry the F2 「认领此 bundle」 action. Same notice styling; a distinct data hook from F2's states.
  const projectNotice =
    projectUnclaimed && activeProject ? (
      <div className="mw-dsh-notice mw-claim-notice" data-tone="neutral" role="status" data-project-unclaimed="true">
        <span className="mw-dot" />
        <p>{`项目「${activeProject.title}」还没有自己的元件，当前展示整个工作区；在项目条里绑定 owner 引用，或认领这个 bundle 后会按项目过滤。`}</p>
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="quiet"
          data-size="sm"
          data-claim-open="true"
          onClick={() => setClaimRequest((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, workspaceId: activeProject.workspaceRefs?.[0] }))}
        >
          认领此 bundle
        </button>
      </div>
    ) : null

  // The live current side: the selected element, else this stage's L1 primary. Against a variant the
  // comparable digest is the cover image, so the media basis is used (slot sha256 is image bytes).
  const currentElement = elements.find((e) => e.elementId === selectedId) ?? pickPrimary(stageGroups[currentStage], selectedId)
  const compareValue = {
    rpc,
    lang,
    current: currentElement ? elementSubject(currentElement, compareTarget?.kind === 'variant' ? 'media' : 'element') : undefined,
    compare: compareTarget ?? undefined,
    onClose: closeCompare,
    onMountedChange: setCompareShown,
  }

  return (
    <WorkspaceShell
        title={t('panelTitle')}
        rpc={rpc}
        t={coreT}
        rightInspector={compareShown ? undefined : (
          <VerdictPanel key={currentElement?.elementId ?? currentStage} rpc={rpc} artifact={currentElement} elements={elements} jobs={stageJobs} onChanged={loadList}>
            {rightInspector}
          </VerdictPanel>
        )}
        onSyncRequested={loadList}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        leftTree={leftTree}
        compact
        breadcrumbs={
          <>
            <ProjectPanel rpc={rpc} t={coreT} activeProjectId={activeProject?.id} onActivate={setActiveProject} claimRequest={claimRequest} variant="breadcrumb" />
            {currentElement?.episodeRef ? <span className="mw-breadcrumb-episode" title={currentElement.episodeRef}>{currentElement.episodeRef}</span> : null}
            <span className="mw-breadcrumb-stage">{stageLabel(currentStage, lang)}</span>
          </>
        }
        projectBar={projectNotice}
        stageActions={overviewToggle}
        stageTabs={[
          {
            id: 'overview',
            label: () => t('tabOverview'),
            render: ({ onPinCompare }) => renderOverview(onPinCompare),
          },
          {
            id: 'pi-artifacts',
            label: () => t('tabPiArtifacts'),
            render: ({ onPinCompare }) => renderElementCards(piItems, onPinCompare),
          },
          {
            id: 'dsh-artifacts',
            label: () => t('tabDshArtifacts'),
            render: ({ onPinCompare }) => renderElementCards(dshItems, onPinCompare),
          },
          {
            id: 'bind-wizard',
            label: () => t('tabBindWizard'),
            render: () => (
              <form
                className="mw-dsh-card mw-stack"
                data-flat="true"
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleBindSubmit()
                }}
              >
                <SectionHead title={t('tabBindWizard')} meta={t('bindHint')} />
                <div className="mw-form-grid">
                  <label className="mw-field">
                    <span>{t('bindTargetLabel')}</span>
                    <select className="mw-input" value={bindTarget} onChange={(e) => setBindTarget(e.target.value)}>
                      {BIND_TARGETS.map((bt) => (
                        <option key={bt.value} value={bt.value}>
                          {bt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mw-field">
                    <span>{t('bindRefLabel')}</span>
                    <input
                      className="mw-input"
                      type="text"
                      placeholder={t('bindRefPlaceholder')}
                      value={bindRef}
                      onChange={(e) => setBindRef(e.target.value)}
                    />
                  </label>
                </div>
                <div className="mw-row">
                  <button type="submit" className="mw-dsh-btn" data-variant="primary" disabled={!bindRef.trim()}>
                    {t('bindSubmit')}
                  </button>
                </div>
              </form>
            ),
          },
        ]}
      />
    
  )
}

export const DRAFT_PANEL_ID = 'muweave-draft'

interface DraftShotRow {
  sceneRef: string
  shotRef: string
  order: number
  plannedDurationMicros: number
  cells: Record<string, unknown>
  restrictedFields: string[]
  linkedMedia?: LinkedMediaRef[]
}

interface DraftScene {
  el: MuweaveElementSummaryV1
  sceneRef: string
  goal: string
  obstacle: string
  turn: string
}

interface DraftBoard {
  el: MuweaveElementSummaryV1
  rows: DraftShotRow[]
}

interface DraftData {
  scenes: DraftScene[]
  boards: DraftBoard[]
  timelineTitle?: string
}

const DRAFT_STAGES = ['visual', 'storyboard', 'sound'] as const

async function loadDraft(rpc: MuweaveRpcClient): Promise<DraftData> {
  const list = async (kind: string) => {
    const res = await rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { kind })
    return res.ok ? res.data.elements : []
  }
  const payload = async (el: MuweaveElementSummaryV1) => {
    const res = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: el.elementId })
    return (res.ok ? res.data.element.payload : {}) as Record<string, unknown>
  }
  const [cards, tables, timelines] = await Promise.all([list('script.scene_card'), list('drama.storyboard_table'), list('script.timeline')])
  const scenes = await Promise.all(
    cards.map(async (el): Promise<DraftScene> => {
      const pl = await payload(el)
      return { el, sceneRef: el.sceneRef ?? el.sourceRef, goal: String(pl.goal ?? ''), obstacle: String(pl.obstacle ?? ''), turn: String(pl.turn ?? '') }
    }),
  )
  scenes.sort((a, b) => a.sceneRef.localeCompare(b.sceneRef, undefined, { numeric: true }))
  const boards = await Promise.all(
    tables.map(async (el): Promise<DraftBoard> => ({ el, rows: ((await payload(el)).rows as DraftShotRow[] | undefined) ?? [] })),
  )
  return { scenes, boards, timelineTitle: timelines[0]?.title }
}

export function WorkbenchDraftPage({ rpc, t, coreT }: { rpc: MuweaveRpcClient; t: (k: string) => string; coreT: MuweaveTranslator }) {
  const [data, setData] = useState<DraftData>({ scenes: [], boards: [] })
  const load = useCallback(async () => setData(await loadDraft(rpc)), [rpc])
  const mediaRevision = useGenerationStore().mediaRevision ?? 0
  useEffect(() => {
    void load()
  }, [load])
  // A review linked media to a shot: re-collect so storyboard rows carry linkedMedia, then reload.
  useEffect(() => {
    if (mediaRevision === 0) return
    let live = true
    void rpc.call('bundle.sync', {}).then(async () => {
      if (live) setData(await loadDraft(rpc))
    })
    return () => {
      live = false
    }
  }, [mediaRevision, rpc])

  const first = data.boards[0]
  const allRows = data.boards.flatMap((b) => b.rows)
  const imaged = allRows.filter((r) => keyframeDigest(r.linkedMedia)).length
  const episodeRef = first?.el.sourceRef

  const reading = (
    <div className="mw-stack" data-gap="sm" data-muweave-draft-reading="true">
      <SectionHead title={t('draftReading')} />
      {data.scenes.length === 0 ? (
        <EmptyState>{t('draftNoScenes')}</EmptyState>
      ) : (
        data.scenes.map((sc) => (
          <NoteCard key={sc.el.elementId} eyebrow={sc.sceneRef} title={sc.el.title} data-muweave-scene-card={sc.sceneRef}>
            <div className="mw-script-scene">
              {([['draftGoal', sc.goal], ['draftObstacle', sc.obstacle], ['draftTurn', sc.turn]] as const).map(([k, v]) =>
                v ? (
                  <p key={k}>
                    <b>{t(k)}</b> {v}
                  </p>
                ) : null,
              )}
              <div className="mw-row">
                <button
                  type="button"
                  className="mw-dsh-btn"
                  data-variant="quiet"
                  data-size="sm"
                  data-muweave-scene-voice={sc.sceneRef}
                  onClick={() =>
                    openGeneration({
                      capabilityId: 'sonora.voice.tts',
                      input: { text: sc.goal },
                      anchor: { ...(episodeRef ? { episodeRef } : {}), sceneRef: sc.sceneRef },
                      stage: DRAFT_STAGES,
                    })
                  }
                >
                  {coreT('genVoiceScene')}
                </button>
              </div>
            </div>
          </NoteCard>
        ))
      )}
    </div>
  )

  const board = (
    <div className="mw-stack" data-gap="lg" data-muweave-draft-board="true">
      {data.boards.length === 0 || allRows.length === 0 ? <EmptyState>{t('draftNoShots')}</EmptyState> : null}
      {data.boards.map((b) => (
        <section key={b.el.elementId} className="mw-stack" data-gap="sm">
          <SectionHead title={b.el.title || t('draftBoard')} meta={b.el.subtitle} />
          <div className="mw-board">
            {b.rows.map((row) => {
              const n = String(row.order).padStart(2, '0')
              return (
                <MediaCard
                  key={row.shotRef}
                  ratio="16 / 10"
                  data-muweave-shot-card={row.shotRef}
                  media={
                    <ShotMedia rpc={rpc} linked={row.linkedMedia} alt={`${n} ${row.shotRef}`} poster={<Poster title={n} meta={row.sceneRef} />} />
                  }
                  title={`${n} · ${(row.plannedDurationMicros / 1_000_000).toFixed(1)} ${t('draftSeconds')}`}
                  meta={<span className="mw-dsh-code">{row.shotRef}</span>}
                >
                  <ShotGenerateButton
                    t={coreT}
                    shotRef={row.shotRef}
                    prompt={shotDescription(row.cells, row.restrictedFields)}
                    anchor={{ ...(b.el.sourceRef ? { episodeRef: b.el.sourceRef } : {}), sceneRef: row.sceneRef }}
                  />
                </MediaCard>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )

  return (
    <WorkspaceShell
      title={t('draftPanelTitle')}
      rpc={rpc}
      t={coreT}
      stage={DRAFT_STAGES}
      onSyncRequested={load}
      hero={
        <RoomHero
          eyebrow={t('draftEyebrow')}
          title={first?.el.title ?? data.timelineTitle ?? t('draftEmptyTitle')}
          lede={t('draftLede')}
          stats={[
            { icon: 'edit', value: data.scenes.length, label: t('draftScenes') },
            { icon: 'image', value: allRows.length, label: t('draftShots') },
            { icon: 'check', value: imaged, label: t('draftImaged') },
          ]}
        />
      }
      stageTabs={[
        {
          id: 'draft',
          label: () => t('draftRoomTitle'),
          render: () => (
            <div className="mw-draft-layout" data-muweave-draft="true">
              {reading}
              {board}
            </div>
          ),
        },
      ]}
    />
  )
}

export function WorkbenchCompanionPane({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  return <CompanionList rpc={rpc} coreT={coreT} title={t('companionTitle')} companionId="workbench" />
}

export function apply(ctx: DshClientContextLike): void {
  const tFn = () => ctx.locale.bind(WORKBENCH_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: WORKBENCH_LOCALE_NS,
    dictionaries: { zh, en },
    pane: {
      pluginId: 'muweave-workbench',
      panelId: WORKBENCH_PANEL_ID,
      order: 41,
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: [],
      companionId: WORKBENCH_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: WorkbenchIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    },
    MainComponent: WorkbenchMainPage,
    CompanionComponent: WorkbenchCompanionPane,
    extraRooms: [
      {
        panelId: DRAFT_PANEL_ID,
        order: 44.5,
        title: () => tFn()('draftPanelTitle'),
        roomTitle: () => tFn()('draftRoomTitle'),
        domains: [],
        icon: WorkbenchIcon,
        MainComponent: WorkbenchDraftPage,
      },
    ],
  })
}
