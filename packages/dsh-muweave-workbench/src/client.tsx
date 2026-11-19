import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  CompanionList,
  CoverCollage,
  EmptyState,
  IconButton,
  Masonry,
  MediaCard,
  NoteCard,
  PillButton,
  Poster,
  RoomHero,
  SectionHead,
  ShotGenerateButton,
  ShotMedia,
  StatusTag,
  WorkspaceShell,
  keyframeDigest,
  openGeneration,
  useGenerationStore,
  shotDescription,
  statusTone,
  useProjectCovers,
  type LinkedMediaRef,
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
  const lang = coreT('langCode')
  const covers = useProjectCovers(rpc, 3)

  const loadList = useCallback(async () => {
    const res = await rpc.call<{
      elements: MuweaveElementSummaryV1[]
      ownerStates: Record<string, OwnerReadinessState>
    }>('bundle.elements.list', { ...(domainFilter === 'all' ? {} : { domain: domainFilter }), ...(activeProject ? { projectId: activeProject.id } : {}) })
    // A freshly created project usually has no elements tagged with its id yet. Blanking the room
    // there reads as data loss, so fall back to the workspace projection and flag it as unclaimed.
    if (activeProject && res.ok && res.data.elements.length === 0) {
      const fallback = await rpc.call<{
        elements: MuweaveElementSummaryV1[]
        ownerStates?: Record<string, OwnerReadinessState>
      }>('bundle.elements.list', { ...(domainFilter === 'all' ? {} : { domain: domainFilter }) })
      if (fallback.ok && fallback.data.elements.length > 0) {
        setElements(fallback.data.elements)
        setProjectUnclaimed(true)
        setOwnerStates(fallback.data.ownerStates ?? {})
        publishKnownElementsForTriggers(fallback.data.elements)
        return
      }
    }
    setProjectUnclaimed(false)
    if (res.ok) {
      setElements(res.data.elements)
      setOwnerStates(res.data.ownerStates ?? {})
      publishKnownElementsForTriggers(res.data.elements)
    }
  }, [rpc, domainFilter, activeProject])

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
  }, [loadList])

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

  const renderElementCards = (
    items: readonly MuweaveElementSummaryV1[],
    onPinCompare: (node: ReactNode) => void,
    lead?: ReactNode,
  ) => {
    if (items.length === 0) {
      return <EmptyState>{coreT('emptyElements')}</EmptyState>
    }
    return (
      <Masonry min="16rem">
        {lead}
        {items.map((el) => {
          const selected = selectedId === el.elementId
          return (
            <article
              key={el.elementId}
              className="mw-dsh-card"
              data-interactive="true"
              data-selected={selected ? 'true' : 'false'}
              onClick={() => setSelectedId(el.elementId)}
            >
              <div className="mw-spread">
                <button
                  type="button"
                  className="mw-card-hit mw-title"
                  aria-pressed={selected}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    setSelectedId(el.elementId)
                  }}
                >
                  {el.title}
                </button>
                <StatusTag status={el.stale ? 'stale' : el.status} lang={lang} />
              </div>
              {el.subtitle ? <span className="mw-dsh-muted mw-clamp-2">{el.subtitle}</span> : null}
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
                  onClick={() =>
                    onPinCompare(
                      <div className="mw-stack" data-gap="xs">
                        <span className="mw-title">{el.title}</span>
                        <span className="mw-dsh-muted">
                          {el.sourceOwner} · {el.kind} · {el.sourceRef}
                        </span>
                        <code className="mw-dsh-code">{el.digest}</code>
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
                      ref: el.elementId,
                      label: el.title,
                      serializedLine: `[MuWeaveElement id=${el.elementId} owner=${el.sourceOwner} ref=${el.sourceRef} digest=${el.digest.slice(0, 19)}]`,
                    })
                  }
                />
              </div>
            </article>
          )
        })}
      </Masonry>
    )
  }

  const piItems = elements.filter((e) => e.sourceOwner === 'pi')
  const dshItems = elements.filter((e) => e.sourceOwner === 'dsh')
  const staleCount = elements.filter((e) => e.stale).length
  const pendingItems = elements.filter((e) => e.stale || statusTone(e.status) !== 'ok')
  const nextItem = pendingItems[0]
  const [ledeBefore, ledeAfter] = t('heroLede')
    .replace('{total}', String(elements.length))
    .replace('{stale}', String(staleCount))
    .replace('{pending}', String(pendingItems.length))
    .split('{thumb}')
  const firstCover = covers?.[0]
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
            onClick={() => setDomainFilter(f.id)}
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
  ) : undefined

  const projectNotice: WorkspaceNotice | null =
    projectUnclaimed && activeProject
      ? {
          tone: 'neutral',
          text: `项目「${activeProject.title}」还没有自己的元件，当前展示整个工作区；在项目条里绑定 owner 引用后会按项目过滤。`,
        }
      : null

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      rpc={rpc}
      t={coreT}
      rightInspector={rightInspector}
      onSyncRequested={loadList}
      notice={notice ?? projectNotice}
      onDismissNotice={() => setNotice(null)}
      leftTree={leftTree}
      projectBar={
        <ProjectPanel rpc={rpc} t={coreT} activeProjectId={activeProject?.id} onActivate={setActiveProject} />
      }
      hero={
        <RoomHero
          eyebrow={t('heroEyebrow')}
          title={t('heroTitle')}
          lede={
            <>
              {ledeBefore}
              {firstCover ? <img className="mw-inline-thumb" src={firstCover.url} alt="" /> : null}
              {ledeAfter}
            </>
          }
          stats={[
            { icon: 'inbox', value: elements.length, label: t('metricTotal') },
            { icon: 'spark', value: piItems.length, label: t('tabPiArtifacts') },
            { icon: 'panelLeft', value: dshItems.length, label: t('tabDshArtifacts') },
            { icon: 'warn', value: staleCount, label: t('metricStale') },
          ]}
          cover={<CoverCollage covers={covers} posterTitle={t('heroTitle')} posterMeta="MuWeave" />}
        />
      }
      stageTabs={[
        {
          id: 'overview',
          label: () => t('tabOverview'),
          render: ({ onPinCompare }) => renderElementCards(elements, onPinCompare, nextStepCard),
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
