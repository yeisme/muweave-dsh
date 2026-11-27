import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  CompanionList,
  EmptyAction,
  Icon,
  IconButton,
  Masonry,
  MediaCard,
  MediaThumbnail,
  PillButton,
  SectionHead,
  Segmented,
  StatusTag,
  WorkspaceShell,
  openGeneration,
  type WorkspaceNotice,
  registerMuweaveCreatorPlugin,
  stageItemToFloatingAgent,
  type DshClientContextLike,
  type JobRecordV1,
  type LinkedMediaRef,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  useGenerationStore,
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
  decisionDone: '已回执并同步 .muweave/',
  handoffDone: '已完成并写入 .muweave/',
  referGroup: '引用整组',
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
  decisionDone: 'receipt recorded and .muweave/ synced',
  handoffDone: 'done and written to .muweave/',
  referGroup: 'Refer group',
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

interface ShotMediaRow {
  shotRef: string
  linkedMedia?: LinkedMediaRef[]
}

function isGenerating(job: JobRecordV1): boolean {
  return job.owner === 'eikona' && job.kind === 'image' && (job.status === 'queued' || job.status === 'running')
}

function progressFor(job: JobRecordV1): number | undefined {
  if (job.slots.length === 0) return undefined
  return (100 * job.slots.filter((slot) => slot.status === 'done' || slot.status === 'failed' || slot.status === 'skipped').length) / job.slots.length
}

async function loadShotMedia(rpc: MuweaveRpcClient): Promise<ShotMediaRow[] | undefined> {
  const list = await rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { kind: 'drama.storyboard_table' })
  if (!list.ok || !Array.isArray(list.data.elements)) return undefined
  const boards = await Promise.all(list.data.elements.map((board) =>
    rpc.call<{ element: MuweaveElementV1<{ rows?: ShotMediaRow[] }> }>('bundle.element.get', { elementId: board.elementId }),
  ))
  if (boards.some((board) => !board.ok)) return undefined
  return boards.flatMap((board) => board.ok ? board.data.element.payload.rows ?? [] : [])
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
  const [gridCols, setGridCols] = useState<2 | 4>(4)
  const [zoomed, setZoomed] = useState(false)
  const [selectedArtifact, setSelectedArtifact] = useState<string>()
  const [shots, setShots] = useState<ShotMediaRow[]>()
  const [jobs, setJobs] = useState<JobRecordV1[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [decisions, setDecisions] = useState<Record<string, 'accepted' | 'rejected'>>({})
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null)
  const [specModel, setSpecModel] = useState('openai/gpt-image-2.5-sunburst')
  const [specSize, setSpecSize] = useState('1152x2048')
  const [specQuality, setSpecQuality] = useState('high')
  const [specResult, setSpecResult] = useState<string>('')
  const lang = coreT('langCode')
  const { mediaRevision, open: generationOpen } = useGenerationStore()

  const loadEikona = useCallback(async () => {
    const res = await rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { domain: 'eikona' })
    if (!res.ok) return
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
  }, [rpc])

  const refreshVisual = useCallback(async () => {
    const [shotRows, jobResult] = await Promise.all([
      loadShotMedia(rpc),
      rpc.call<{ jobs?: JobRecordV1[] }>('job.list', {}),
      loadEikona(),
    ])
    setShots(shotRows)
    if (jobResult.ok) setJobs(jobResult.data.jobs ?? [])
    setPreviewRevision((revision) => revision + 1)
  }, [rpc, loadEikona])

  useEffect(() => {
    void refreshVisual()
  }, [refreshVisual, mediaRevision])

  const hasActiveImageJob = jobs.some(isGenerating)
  useEffect(() => {
    if (!hasActiveImageJob && !generationOpen) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const result = await rpc.call<{ jobs?: JobRecordV1[] }>('job.list', {})
      if (cancelled) return
      if (result.ok) setJobs(result.data.jobs ?? [])
      timer = setTimeout(() => void poll(), generationOpen ? 2000 : 5000)
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [rpc, generationOpen, hasActiveImageJob])

  const refreshPreview = async () => {
    setRefreshing(true)
    try {
      const result = await rpc.call('bundle.sync', {})
      if (!result.ok) {
        setNotice({ tone: 'bad', text: result.error.message })
        return
      }
      await refreshVisual()
    } finally {
      setRefreshing(false)
    }
  }

  const generate = (trigger: HTMLButtonElement) => openGeneration({ capabilityId: 'eikona.image.generate', stage: 'visual' }, trigger)

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
    if (res.ok) setDecisions((previous) => ({ ...previous, [`${runId}:${artifactId}`]: decision === 'accept' ? 'accepted' : 'rejected' }))
    await refreshVisual()
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
    await refreshVisual()
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

  const candidateGroups = elements.filter((e) => e.kind === 'eikona.candidate_group')
  const masterBindings = elements.filter((e) => e.kind === 'eikona.master_binding' || e.kind === 'eikona.handoff')
  const scoreCards = elements.filter((e) => e.kind === 'eikona.assessment_card')
  // Card minimum width drives the column count; zoom widens cards instead of scaling the grid.
  const cardMin = `${(gridCols === 2 ? 18 : 11) * (zoomed ? 1.5 : 1)}rem`
  const firstGroup = candidateGroups[0]
  const inFlight = jobs.find(isGenerating)
  const refreshAction = { label: '刷新预览', disabled: refreshing, onAction: () => void refreshPreview() }
  const generateAction = { label: '生成视觉候选', onAction: generate }

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      rpc={rpc}
      t={coreT}
      compact
      breadcrumbs={<>{firstGroup?.episodeRef ? <span>{firstGroup.episodeRef} / </span> : null}<span>{t('roomTitle')}</span></>}
      onSyncRequested={refreshVisual}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      stageActions={
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
            if (candidateGroups.length === 0) return inFlight ? <EmptyAction progress={progressFor(inFlight)} /> : <EmptyAction {...generateAction} />
            return (
              <div className="mw-stack" data-gap="lg">
                {candidateGroups.map((group) => {
                  const full = details[group.elementId]
                  const payload = (full?.payload ?? {}) as { runId?: string; candidates?: CandidateItem[] }
                  const runId = payload.runId ?? group.elementId
                  const cands = payload.candidates ?? []
                  const job = jobs.find((row) => row.owner === 'eikona' && row.ownerJobRef === runId)
                  return (
                    <section key={group.elementId} className="mw-stack">
                      <SectionHead
                        title={group.title}
                        meta={`${cands.length} ${t('candidateCount')}`}
                        actions={
                          <PillButton
                            icon="at"
                            onClick={() => stageItemToFloatingAgent({
                              kind: 'element',
                              ref: group.elementId,
                              label: group.title,
                              serializedLine: `[EikonaRun ref=${group.sourceRef}]`,
                            })}
                          >
                            {t('referGroup')}
                          </PillButton>
                        }
                      />
                      {cands.length === 0 ? (
                        job && isGenerating(job) ? <EmptyAction progress={progressFor(job)} /> : <EmptyAction {...(full ? generateAction : refreshAction)} />
                      ) : (
                        <Masonry min={cardMin} data-eikona-compare-grid={String(gridCols)}>
                          {cands.map((cand) => {
                            const key = `${group.elementId}:${cand.artifactId}`
                            const slot = job?.slots.find((item) => item.ownerRef === cand.artifactId)
                            const blob = group.mediaBlobs?.find((item) => item.mimeType.startsWith('image/') && (item.blobDigest === cand.sha256 || item.label === cand.artifactId))
                            const sha256 = blob?.blobDigest ?? slot?.sha256 ?? cand.sha256
                            const image = {
                              rpc, sha256, mimeType: blob?.mimeType ?? slot?.mime, alt: cand.artifactId,
                              fallback: job && isGenerating(job) ? { progress: progressFor(job) } : refreshAction,
                            }
                            const boundShots = shots && new Set(shots.filter((row) => row.shotRef && row.linkedMedia?.some((link) =>
                              (Boolean(sha256) && link.sha256 === sha256) || (link.elementId === group.elementId && link.artifactId === cand.artifactId),
                            )).map((row) => row.shotRef))
                            return (
                              <MediaCard
                                key={`${key}:${previewRevision}`}
                                ratio={cand.width && cand.height ? `${cand.width} / ${cand.height}` : '3 / 4'}
                                image={image}
                                lang={lang}
                                version={group.sourceRevision}
                                review={decisions[`${runId}:${cand.artifactId}`] ?? slot?.review ?? group.status}
                                shotCount={boundShots?.size}
                                stale={group.stale}
                                selected={selectedArtifact === key}
                                title={<button type="button" className="mw-card-hit" aria-pressed={selectedArtifact === key} onClick={() => setSelectedArtifact(key)}>{cand.artifactId}</button>}
                                meta={[cand.modelRef?.split('/').pop(), cand.width && cand.height ? `${cand.width}×${cand.height}` : '', cand.role]
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
                                      onClick={() => {
                                        setSelectedArtifact(key)
                                        onPinCompare(
                                          <div className="mw-stack" data-gap="sm" data-eikona-review-compare="true">
                                            <MediaThumbnail {...image} />
                                            <strong className="mw-dsh-code">{cand.artifactId}</strong>
                                            <p className="mw-dsh-muted">{cand.promptExcerpt}</p>
                                            <span className="mw-dsh-code">{cand.uri}</span>
                                          </div>,
                                        )
                                      }}
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
                                    icon="check"
                                    onClick={() => void runControlledDecision(runId, cand.artifactId, 'accept')}
                                  >
                                    {t('acceptCandidate')}
                                  </PillButton>
                                  <PillButton onClick={() => void runControlledDecision(runId, cand.artifactId, 'reject')}>
                                    {t('rejectCandidate')}
                                  </PillButton>
                                </div>
                              </MediaCard>
                            )
                          })}
                        </Masonry>
                      )}
                    </section>
                  )
                })}
              </div>
            )
          },
        },
        {
          id: 'masters',
          label: () => t('tabMasters'),
          render: () =>
            masterBindings.length === 0 ? (
              <EmptyAction {...refreshAction} />
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
              <EmptyAction {...refreshAction} />
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
                        <EmptyAction {...refreshAction} />
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
                    <option value="high">高（Sunburst 必需）</option>
                    <option value="low">低</option>
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
