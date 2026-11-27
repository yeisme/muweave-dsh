import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Callout,
  CompanionList,
  EmptyState,
  IconButton,
  RoomHero,
  SectionHead,
  Segmented,
  StatusTag,
  WorkspaceShell,
  type WorkspaceNotice,
  registerMuweaveCreatorPlugin,
  stageItemToFloatingAgent,
  type DshClientContextLike,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
} from '@yeisme/dsh-muweave-core/client'

export const name = '@yeisme/dsh-muweave-script'
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const SCRIPT_PANEL_ID = 'muweave-script'
export const SCRIPT_COMPANION_ID = 'muweave-script/companion'
export const SCRIPT_LOCALE_NS = 'muweaveScript'

const zh = {
  panelTitle: '剧本编剧室 (Auctra)',
  roomTitle: '剧本',
  companionTitle: '剧本场次与审阅',
  subtitle: 'AI 与面板改动均为草稿/候选，须经 Auctra 审阅后才更新正式剧本',
  tabTimeline: '双时间轴',
  tabSceneCards: '场次卡',
  tabGraph: '情境图谱',
  tabDiff: '候选改写',
  trackNarrative: '叙事顺序',
  trackStory: '故事时间',
  goal: '目标',
  obstacle: '阻碍',
  turn: '反转',
  goalPlaceholder: '本场主动目标',
  obstaclePlaceholder: '核心阻碍',
  turnPlaceholder: '本场戏剧转折',
  editCard: '编辑草稿',
  cancelEdit: '取消',
  saveDraft: '保存草稿',
  submitReview: '提交审阅',
  savedReceipt: '草稿已保存（基线 v{rev}）',
  submittedReceipt: '已生成不可变候选并送入 Auctra 审阅队列',
  nodes: '节点',
  edges: '关系',
  canonical: '正式稿',
  candidate: '候选提案',
  adoptCandidate: '采纳候选提案',
  adoptBlocked: '（基线过期，已禁用）',
  staleBlockedWarning: '基线已过期：正式稿版本已前进，禁止直接覆盖，请先在 Auctra 执行重对齐。',
  heroEyebrow: 'Auctra · 剧本',
  heroEmptyTitle: '还没有剧本场次',
  readingTitle: '剧本',
  statScenes: '场',
  statCandidates: '个候选改写',
  statStale: '处基线过期',
  viewCardsEdit: '卡片编辑',
  viewLinearRead: '线性阅读',
  sceneViewModeLabel: '场次查看模式',
  estDurationSec: '约 {sec} 秒',
  estEpisodeTotal: '全集估算时长',
  seconds: '秒',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: 'Screenplay Room (Auctra)',
  roomTitle: 'Script',
  companionTitle: 'Script Scenes & Diffs',
  subtitle: 'AI and panel edits stay drafts/candidates until Auctra review accepts them',
  tabTimeline: 'Dual Timeline',
  tabSceneCards: 'Scene Cards',
  tabGraph: 'Context Graph',
  tabDiff: 'Candidate Diff',
  trackNarrative: 'Narrative Order',
  trackStory: 'Story Time',
  goal: 'Goal',
  obstacle: 'Obstacle',
  turn: 'Turn',
  goalPlaceholder: 'Active goal of the scene',
  obstaclePlaceholder: 'Core obstacle',
  turnPlaceholder: 'Dramatic turn',
  editCard: 'Edit Draft',
  cancelEdit: 'Cancel',
  saveDraft: 'Save Draft',
  submitReview: 'Submit for Review',
  savedReceipt: 'Draft saved (baseline v{rev})',
  submittedReceipt: 'Immutable candidate queued for Auctra review',
  nodes: 'Nodes',
  edges: 'Relations',
  canonical: 'Canonical',
  candidate: 'Candidate',
  adoptCandidate: 'Adopt Candidate',
  adoptBlocked: '(blocked: stale baseline)',
  staleBlockedWarning: 'Stale baseline: canonical manuscript advanced; direct adoption blocked until rebased.',
  heroEyebrow: 'Auctra · Script',
  heroEmptyTitle: 'No script scenes yet',
  readingTitle: 'Screenplay',
  statScenes: 'scenes',
  statCandidates: 'candidate rewrites',
  statStale: 'stale baselines',
  viewCardsEdit: 'Card Edit',
  viewLinearRead: 'Linear Reader',
  sceneViewModeLabel: 'Scene view mode',
  estDurationSec: '~{sec}s',
  estEpisodeTotal: 'Est. Episode Duration',
  seconds: 's',
}

export function ScriptIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <path d="M3.5 2.5h9v11h-9z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

type SceneViewMode = 'cards' | 'reader'

function estimateReadingSeconds(payload: Record<string, unknown> | undefined, title?: string): number {
  const parts = [
    payload?.goal,
    payload?.obstacle,
    payload?.turn,
    payload?.summary,
    payload?.dialogue,
    payload?.body,
    title,
  ]
  const text = parts
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('')
    .replace(/\s+/g, '')
  return Math.max(3, Math.round(text.length / 4))
}

export function ScriptMainPage({
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
  const [editingSceneId, setEditingSceneId] = useState<string | undefined>(undefined)
  const [focusedSceneId, setFocusedSceneId] = useState<string | undefined>(undefined)
  const [sceneViewMode, setSceneViewMode] = useState<SceneViewMode>('cards')
  const [goalInput, setGoalInput] = useState('')
  const [obstacleInput, setObstacleInput] = useState('')
  const [turnInput, setTurnInput] = useState('')
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null)

  const loadScript = useCallback(async () => {
    const res = await rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { domain: 'script' })
    if (!res.ok) return
    setElements(res.data.elements)
    const entries = await Promise.all(
      res.data.elements.map(async (el) => {
        const d = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: el.elementId })
        return d.ok ? ([el.elementId, d.data.element] as const) : undefined
      }),
    )
    const map: Record<string, MuweaveElementV1> = {}
    for (const e of entries) {
      if (e) map[e[0]] = e[1]
    }
    setDetails(map)
  }, [rpc])

  useEffect(() => {
    void loadScript()
  }, [loadScript])

  const selectCardForEdit = (elId: string) => {
    setEditingSceneId(elId)
    const pl = (details[elId]?.payload ?? {}) as Record<string, unknown>
    setGoalInput(String(pl.goal ?? ''))
    setObstacleInput(String(pl.obstacle ?? ''))
    setTurnInput(String(pl.turn ?? ''))
  }

  const handleSaveCard = async (sceneRef: string, revision: string) => {
    const res = await rpc.call('auctra.scene_card.save', {
      sceneRef,
      expectedRevision: revision,
      idempotencyKey: `save-${sceneRef}-rev${revision}-${goalInput.slice(0, 8)}`,
      card: {
        scene_ref: sceneRef,
        goal: goalInput,
        obstacle: obstacleInput,
        turn: turnInput,
      },
    })
    setNotice(
      res.ok
        ? { tone: 'ok', text: t('savedReceipt').replace('{rev}', revision) }
        : { tone: 'bad', text: `[${res.error.code}] ${res.error.message}` },
    )
    await loadScript()
  }

  const handleSubmitCard = async (sceneRef: string, revision: string) => {
    const res = await rpc.call('auctra.scene_card.submit', {
      sceneRef,
      expectedRevision: revision,
      idempotencyKey: `submit-${sceneRef}-rev${revision}`,
    })
    setNotice(
      res.ok ? { tone: 'ok', text: t('submittedReceipt') } : { tone: 'bad', text: `[${res.error.code}] ${res.error.message}` },
    )
    await loadScript()
  }

  const timelines = elements.filter((e) => e.kind === 'script.timeline')
  const sceneCards = elements.filter((e) => e.kind === 'script.scene_card')
  const graphs = elements.filter((e) => e.kind === 'script.context_graph')
  const diffs = elements.filter((e) => e.kind === 'script.candidate_diff')

  const lang = coreT('langCode')
  const staleCount = elements.filter((e) => e.stale).length

  const sceneCardByRef = useMemo(() => {
    const map = new Map<string, MuweaveElementSummaryV1>()
    for (const sc of sceneCards) {
      const pl = (details[sc.elementId]?.payload ?? {}) as Record<string, unknown>
      const ref = typeof pl.sceneRef === 'string' && pl.sceneRef ? pl.sceneRef : sc.sceneRef || sc.sourceRef
      if (ref) map.set(ref, sc)
      map.set(sc.elementId, sc)
    }
    return map
  }, [sceneCards, details])

  const totalEstimatedSec = useMemo(
    () =>
      sceneCards.reduce((sum, sc) => {
        const pl = (details[sc.elementId]?.payload ?? {}) as Record<string, unknown>
        return sum + estimateReadingSeconds(pl, sc.title)
      }, 0),
    [sceneCards, details],
  )

  const jumpToSceneCard = (sceneElementId: string | undefined) => {
    if (sceneElementId) {
      setFocusedSceneId(sceneElementId)
      selectCardForEdit(sceneElementId)
    }
    setSceneViewMode('cards')
    if (typeof document !== 'undefined') {
      const tabBtn = document.getElementById('mw-tab-scene-cards')
      if (tabBtn instanceof HTMLButtonElement) tabBtn.click()
    }
  }

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      subtitle={t('subtitle')}
      rpc={rpc}
      t={coreT}
      onSyncRequested={loadScript}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      hero={
        <RoomHero
          eyebrow={t('heroEyebrow')}
          title={timelines[0]?.title ?? sceneCards[0]?.title ?? t('heroEmptyTitle')}
          lede={t('subtitle')}
          stats={[
            { icon: 'edit', value: sceneCards.length, label: t('statScenes') },
            { icon: 'splitH', value: diffs.length, label: t('statCandidates') },
            ...(staleCount > 0 ? [{ icon: 'warn' as const, value: staleCount, label: t('statStale') }] : []),
          ]}
        />
      }
      stageTabs={[
        {
          id: 'dual-timeline',
          label: () => t('tabTimeline'),
          render: () =>
            timelines.length === 0 ? (
              <EmptyState>{coreT('emptyElements')}</EmptyState>
            ) : (
              <div className="mw-stack" data-gap="lg">
                {timelines.map((tl) => {
                  const pl = (details[tl.elementId]?.payload ?? {}) as {
                    scenes?: Array<{ scene_ref?: string; order?: number; title?: string }>
                    storyTimeAnchors?: Array<{ scene_ref?: string; label?: string }>
                  }
                  return (
                    <section key={tl.elementId} className="mw-stack" data-gap="sm">
                      <SectionHead title={tl.title} meta={tl.subtitle} />
                      <div className="sc-track">
                        <span className="mw-eyebrow">{t('trackNarrative')}</span>
                        <ol className="sc-lane">
                          {(pl.scenes ?? []).map((s, idx) => {
                            const matchedCard = s.scene_ref ? sceneCardByRef.get(s.scene_ref) : undefined
                            const cardPayload = matchedCard
                              ? ((details[matchedCard.elementId]?.payload ?? {}) as Record<string, unknown>)
                              : undefined
                            const snippet = [cardPayload?.goal, cardPayload?.turn]
                              .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                              .join(' · ')
                            const estSec = estimateReadingSeconds(cardPayload, s.title ?? matchedCard?.title)
                            return (
                              <li key={s.scene_ref ?? idx} className="sc-block" title={s.scene_ref}>
                                <button
                                  type="button"
                                  className="sc-timeline-card mw-stack"
                                  data-gap="xs"
                                  data-script-timeline-card={s.scene_ref ?? String(idx)}
                                  data-est-duration={String(estSec)}
                                  onClick={() => jumpToSceneCard(matchedCard?.elementId)}
                                >
                                  <span className="mw-spread">
                                    <span className="mw-row" data-gap="xs">
                                      <span className="mw-kbd">#{s.order ?? idx + 1}</span>
                                      <span className="mw-title">{s.title ?? s.scene_ref}</span>
                                    </span>
                                    <span className="mw-row" data-gap="xs">
                                      <span className="mw-chip">{t('estDurationSec').replace('{sec}', String(estSec))}</span>
                                      {matchedCard ? (
                                        <StatusTag status={matchedCard.stale ? 'stale' : matchedCard.status} lang={lang} />
                                      ) : null}
                                    </span>
                                  </span>
                                  {snippet ? (
                                    <span className="mw-dsh-muted mw-clamp-2">{snippet}</span>
                                  ) : null}
                                </button>
                              </li>
                            )
                          })}
                        </ol>
                      </div>
                      <div className="sc-track">
                        <span className="mw-eyebrow">{t('trackStory')}</span>
                        <ol className="sc-lane">
                          {(pl.storyTimeAnchors ?? []).map((a, idx) => (
                            <li key={a.scene_ref ?? idx} className="sc-block" title={a.scene_ref}>
                              <span>{a.label ?? '—'}</span>
                              <span className="mw-dsh-muted mw-dsh-code">{a.scene_ref}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </section>
                  )
                })}
              </div>
            ),
        },
        {
          id: 'scene-cards',
          label: () => t('tabSceneCards'),
          render: ({ onPinCompare }) =>
            sceneCards.length === 0 ? (
              <EmptyState>{coreT('emptyElements')}</EmptyState>
            ) : (
              <div className="mw-stack" data-gap="md">
                <div className="mw-spread" data-script-scene-toolbar="true">
                  <Segmented<SceneViewMode>
                    label={t('sceneViewModeLabel')}
                    value={sceneViewMode}
                    options={[
                      { value: 'cards', label: t('viewCardsEdit') },
                      { value: 'reader', label: t('viewLinearRead') },
                    ]}
                    onChange={setSceneViewMode}
                  />
                  <span className="mw-dsh-muted" data-script-total-duration={String(totalEstimatedSec)}>
                    {t('estEpisodeTotal')}: <b>{totalEstimatedSec} {t('seconds')}</b>
                  </span>
                </div>

                {sceneViewMode === 'reader' ? (
                  <article className="sc-reader mw-dsh-card mw-read mw-stack" data-gap="md" data-script-reader="true" aria-label={t('readingTitle')}>
                    <div className="mw-spread">
                      <p className="mw-eyebrow">{t('readingTitle')}</p>
                      <span className="mw-chip">
                        {t('estEpisodeTotal')} · {totalEstimatedSec} {t('seconds')}
                      </span>
                    </div>
                    {sceneCards.map((sc) => {
                      const pl = (details[sc.elementId]?.payload ?? {}) as Record<string, unknown>
                      const estSec = estimateReadingSeconds(pl, sc.title)
                      const beats = [
                        [t('goal'), pl.goal],
                        [t('obstacle'), pl.obstacle],
                        [t('turn'), pl.turn],
                      ] as const
                      return (
                        <section key={sc.elementId} className="mw-stack" data-gap="xs" data-reader-scene={sc.elementId}>
                          <div className="mw-spread">
                            <h4>{sc.title}</h4>
                            <span className="mw-row" data-gap="xs">
                              <span className="mw-chip">{t('estDurationSec').replace('{sec}', String(estSec))}</span>
                              <StatusTag status={sc.stale ? 'stale' : sc.status} lang={lang} />
                            </span>
                          </div>
                          {beats
                            .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
                            .map(([label, v]) => (
                              <p key={label}>
                                <span className="mw-read-beat">{label}</span> {String(v)}
                              </p>
                            ))}
                        </section>
                      )
                    })}
                  </article>
                ) : (
                  <div className="mw-split-2" data-script-reading="true">
                    <article className="mw-dsh-card mw-read" aria-label={t('readingTitle')}>
                      <p className="mw-eyebrow">{t('readingTitle')}</p>
                      {sceneCards.map((sc) => {
                        const pl = (details[sc.elementId]?.payload ?? {}) as Record<string, unknown>
                        const beats = [
                          [t('goal'), pl.goal],
                          [t('obstacle'), pl.obstacle],
                          [t('turn'), pl.turn],
                        ] as const
                        return (
                          <section key={sc.elementId}>
                            <h4>{sc.title}</h4>
                            {beats
                              .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
                              .map(([label, v]) => (
                                <p key={label}>
                                  <span className="mw-read-beat">{label}</span> {String(v)}
                                </p>
                              ))}
                          </section>
                        )
                      })}
                    </article>
                    <div className="mw-stack">
                      {sceneCards.map((sc) => {
                        const pl = (details[sc.elementId]?.payload ?? {}) as Record<string, unknown>
                        const sceneRef = String(pl.sceneRef ?? sc.sourceRef)
                        const rev = String(pl.revision ?? sc.sourceRevision ?? '1')
                        const isEditing = editingSceneId === sc.elementId
                        const isFocused = focusedSceneId === sc.elementId
                        const estSec = estimateReadingSeconds(pl, sc.title)
                        return (
                          <article
                            key={sc.elementId}
                            className="mw-dsh-card"
                            data-scene-card-item={sceneRef}
                            data-selected={isEditing || isFocused ? 'true' : undefined}
                          >
                            <div className="mw-spread">
                              <span className="mw-title">{sc.title}</span>
                              <span className="mw-row" data-gap="xs">
                                <span className="mw-chip">{t('estDurationSec').replace('{sec}', String(estSec))}</span>
                                <span className="mw-kbd">v{rev}</span>
                                <StatusTag status={sc.stale ? 'stale' : sc.status} lang={lang} />
                              </span>
                            </div>
                      {isEditing ? (
                        <form
                          className="mw-stack"
                          data-gap="sm"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void handleSaveCard(sceneRef, rev)
                          }}
                        >
                          <label className="mw-field">
                            <span>{t('goal')}</span>
                            <input
                              className="mw-input"
                              type="text"
                              aria-label="Scene Goal"
                              value={goalInput}
                              onChange={(e) => setGoalInput(e.target.value)}
                              placeholder={t('goalPlaceholder')}
                            />
                          </label>
                          <label className="mw-field">
                            <span>{t('obstacle')}</span>
                            <input
                              className="mw-input"
                              type="text"
                              aria-label="Scene Obstacle"
                              value={obstacleInput}
                              onChange={(e) => setObstacleInput(e.target.value)}
                              placeholder={t('obstaclePlaceholder')}
                            />
                          </label>
                          <label className="mw-field">
                            <span>{t('turn')}</span>
                            <input
                              className="mw-input"
                              type="text"
                              aria-label="Scene Turn"
                              value={turnInput}
                              onChange={(e) => setTurnInput(e.target.value)}
                              placeholder={t('turnPlaceholder')}
                            />
                          </label>
                          <div className="mw-row">
                            <button type="submit" className="mw-dsh-btn" disabled={Boolean(sc.stale)}>
                              {t('saveDraft')}
                            </button>
                            <button
                              type="button"
                              className="mw-dsh-btn"
                              data-variant="primary"
                              disabled={Boolean(sc.stale)}
                              onClick={() => void handleSubmitCard(sceneRef, rev)}
                            >
                              {t('submitReview')}
                            </button>
                            <span className="mw-spacer" />
                            <button
                              type="button"
                              className="mw-dsh-btn"
                              data-variant="ghost"
                              onClick={() => setEditingSceneId(undefined)}
                            >
                              {t('cancelEdit')}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <dl className="mw-dl">
                            <dt>{t('goal')}</dt>
                            <dd>{String(pl.goal ?? '—')}</dd>
                            <dt>{t('obstacle')}</dt>
                            <dd>{String(pl.obstacle ?? '—')}</dd>
                            <dt>{t('turn')}</dt>
                            <dd>{String(pl.turn ?? '—')}</dd>
                          </dl>
                          <div className="mw-row">
                            <button
                              type="button"
                              className="mw-dsh-btn"
                              data-size="sm"
                              onClick={() => selectCardForEdit(sc.elementId)}
                            >
                              {t('editCard')}
                            </button>
                            <span className="mw-spacer" />
                            <IconButton
                              icon="pin"
                              size="sm"
                              label={coreT('openCompareB')}
                              onClick={() =>
                                onPinCompare(
                                  <div className="mw-stack" data-gap="xs">
                                    <span className="mw-title">{sc.title}</span>
                                    <p>{String(pl.goal ?? '')}</p>
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
                                  ref: sc.elementId,
                                  label: sc.title,
                                  serializedLine: `[AuctraSceneCard ref=${sceneRef} rev=${rev}]`,
                                })
                              }
                            />
                          </div>
                        </>
                      )}
                    </article>
                      )
                    })}
                  </div>
                </div>
                )}
              </div>
            ),
        },
        {
          id: 'context-graph',
          label: () => t('tabGraph'),
          render: () =>
            graphs.length === 0 ? (
              <EmptyState>{coreT('emptyElements')}</EmptyState>
            ) : (
              <div className="mw-stack" data-gap="lg">
                {graphs.map((g) => {
                  const pl = (details[g.elementId]?.payload ?? {}) as {
                    nodes?: Array<{ id: string; label?: string; kind?: string }>
                    edges?: Array<{ from: string; to: string; relation?: string }>
                  }
                  const nodeLabel = new Map((pl.nodes ?? []).map((n) => [n.id, n.label ?? n.id]))
                  return (
                    <section key={g.elementId} className="mw-stack" data-gap="sm">
                      <SectionHead title={g.title} meta={g.subtitle} />
                      <span className="mw-eyebrow">{t('nodes')}</span>
                      <div className="mw-row" data-gap="xs">
                        {(pl.nodes ?? []).map((n) => (
                          <span key={n.id} className="mw-chip" title={n.id}>
                            {n.label ?? n.id}
                            <span className="mw-dsh-muted">{n.kind ?? 'entity'}</span>
                          </span>
                        ))}
                      </div>
                      {(pl.edges ?? []).length > 0 ? (
                        <>
                          <span className="mw-eyebrow">{t('edges')}</span>
                          <ul className="mw-stack" data-gap="xs">
                            {(pl.edges ?? []).map((edge, idx) => (
                              <li key={idx} className="mw-row" data-gap="xs">
                                <span>{nodeLabel.get(edge.from) ?? edge.from}</span>
                                <span className="mw-chip" data-mono="true">
                                  {edge.relation ?? 'relates'}
                                </span>
                                <span>{nodeLabel.get(edge.to) ?? edge.to}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </section>
                  )
                })}
              </div>
            ),
        },
        {
          id: 'candidate-diff',
          label: () => t('tabDiff'),
          render: () =>
            diffs.length === 0 ? (
              <EmptyState>{coreT('emptyElements')}</EmptyState>
            ) : (
              <div className="mw-stack" data-gap="lg">
                {diffs.map((d) => {
                  const pl = (details[d.elementId]?.payload ?? {}) as {
                    stale?: boolean
                    baseRevision?: number
                    canonicalRevision?: number
                    canonicalExcerpt?: string
                    candidateExcerpt?: string
                  }
                  const isStale = Boolean(d.stale || pl.stale)
                  return (
                    <section key={d.elementId} className="mw-stack" data-gap="sm" data-diff-stale={isStale ? 'true' : 'false'}>
                      <SectionHead
                        title={d.title}
                        meta={`base v${pl.baseRevision ?? 1} / canon v${pl.canonicalRevision ?? 1}`}
                        actions={isStale ? <StatusTag status="stale" lang={lang} /> : undefined}
                      />
                      {isStale ? (
                        <Callout tone="warn" role="alert">
                          {t('staleBlockedWarning')}
                        </Callout>
                      ) : null}
                      <div className="mw-split-2">
                        <div className="mw-dsh-card" data-flat="true" data-diff-side="canonical">
                          <span className="mw-eyebrow">{t('canonical')}</span>
                          <p>{pl.canonicalExcerpt ?? '—'}</p>
                        </div>
                        <div className="mw-dsh-card" data-diff-side="candidate">
                          <span className="mw-eyebrow">{t('candidate')}</span>
                          <p>{pl.candidateExcerpt ?? '—'}</p>
                        </div>
                      </div>
                      <div className="mw-row">
                        <button type="button" className="mw-dsh-btn" data-variant="primary" disabled={isStale}>
                          {t('adoptCandidate')} {isStale ? t('adoptBlocked') : ''}
                        </button>
                      </div>
                    </section>
                  )
                })}
              </div>
            ),
        },
      ]}
    />
  )
}

export function ScriptCompanionPane({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  return <CompanionList rpc={rpc} coreT={coreT} title={t('companionTitle')} domain="script" companionId="script" />
}

export function apply(ctx: DshClientContextLike): void {
  const tFn = () => ctx.locale.bind(SCRIPT_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: SCRIPT_LOCALE_NS,
    dictionaries: { zh, en },
    pane: {
      pluginId: 'muweave-script',
      panelId: SCRIPT_PANEL_ID,
      order: 43,
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: ['script'],
      companionId: SCRIPT_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: ScriptIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    },
    MainComponent: ScriptMainPage,
    CompanionComponent: ScriptCompanionPane,
  })
}
