import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  CompanionList,
  EmptyAction,
  IconButton,
  MediaCard,
  NoteCard,
  SceneMini,
  SectionHead,
  Segmented,
  ShotGenerateButton,
  StatusTag,
  ToneDot,
  WorkspaceShell,
  keyframeImage,
  shotGenerationAction,
  statusTone,
  shotDescription,
  registerMuweaveCreatorPlugin,
  stageItemToFloatingAgent,
  type DshClientContextLike,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type LinkedMediaRef,
  type MuweaveTranslator,
  useGenerationStore,
} from '@yeisme/dsh-muweave-core/client'

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
}

interface StoryboardRow {
  sceneRef: string
  shotRef: string
  order: number
  plannedDurationMicros: number
  cells: Record<string, unknown>
  restrictedFields: string[]
  /** Keyframe first; written by the host from `shotMedia` links. */
  linkedMedia?: LinkedMediaRef[]
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

type ViewMode = 'cards' | 'table'

interface AssetRow {
  assetRef: string
  role: string
  parsedVersion: number
  axes: {
    scaenaAdmission: string
    subjectFreeze: string
    productionAcceptance: string
    currentUsability: string
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function seconds(micros: number): string {
  return (micros / 1_000_000).toFixed(1)
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
  const [details, setDetails] = useState<Record<string, MuweaveElementV1>>({})
  const [selectedShot, setSelectedShot] = useState<string>()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string>()
  const { mediaRevision } = useGenerationStore()

  const loadAll = useCallback(async () => {
    const [dRes, sRes] = await Promise.all([
      rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { domain: 'drama' }),
      rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { kind: 'script.scene_card' }),
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
  }, [loadAll, mediaRevision])

  const sync = async () => {
    setSyncing(true)
    setSyncError(undefined)
    try {
      const result = await rpc.call('bundle.sync', {})
      if (result.ok) await loadAll()
      else setSyncError(result.error.message)
    } finally {
      setSyncing(false)
    }
  }
  const syncAction = { label: '同步分镜', disabled: syncing, onAction: () => void sync() }

  const storyboards = dramaElements.filter((e) => e.kind === 'drama.storyboard_table')
  const assetTables = dramaElements.filter((e) => e.kind === 'drama.asset_readiness')
  const editTimelines = dramaElements.filter((e) => e.kind === 'drama.edit_timeline')
  const lang = coreT('langCode')
  const [view, setView] = useState<ViewMode>('cards')
  const firstBoard = storyboards[0]

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

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      rpc={rpc}
      t={coreT}
      compact
      breadcrumbs={<>{firstBoard?.episodeRef ? <span>{firstBoard.episodeRef} / </span> : null}<span>{t('roomTitle')}</span></>}
      onSyncRequested={loadAll}
      notice={syncError ? { tone: 'bad', text: syncError } : undefined}
      onDismissNotice={() => setSyncError(undefined)}
      stageTabs={[
        {
          id: 'storyboard',
          label: () => t('tabStoryboard'),
          render: () =>
            storyboards.length === 0 ? (
              <EmptyAction {...syncAction} />
            ) : (
              <div className="mw-stack" data-gap="lg">
                {storyboards.map((sb) => {
                  const pl = (details[sb.elementId]?.payload ?? {}) as { rows?: StoryboardRow[] }
                  const rows = pl.rows ?? []
                  const restricted = Array.from(new Set(rows.flatMap((r) => r.restrictedFields)))
                  return (
                    <section key={sb.elementId} className="mw-stack" data-gap="sm">
                      <SectionHead
                        title={sb.title}
                        meta={sb.subtitle}
                        actions={
                          <div className="mw-row" data-gap="sm">
                            <StatusTag status={sb.status} lang={lang} />
                            {viewSwitch}
                          </div>
                        }
                      />
                      {rows.length === 0 ? (
                        <EmptyAction {...syncAction} />
                      ) : view === 'cards' ? (
                        <div className="mw-board" data-drama-shot-board="true">
                          {rows.map((row) => {
                            const shotKey = `${sb.elementId}:${row.shotRef}`
                            const image = keyframeImage(row.linkedMedia)
                            const generation = {
                              t: coreT,
                              shotRef: row.shotRef,
                              prompt: shotDescription(row.cells, row.restrictedFields),
                              anchor: { episodeRef: sb.episodeRef ?? sb.sourceRef, sceneRef: row.sceneRef },
                            }
                            const fields = Object.entries(row.cells)
                              .filter(([k]) => !row.restrictedFields.includes(k))
                              .map(([, v]) => formatCell(v))
                            return (
                              <MediaCard
                                key={row.shotRef}
                                ratio="16 / 10"
                                data-muweave-shot-card={row.shotRef}
                                image={{
                                  rpc,
                                  sha256: image?.sha256,
                                  mimeType: image?.mime,
                                  alt: `第 ${row.order} 镜`,
                                  'data-muweave-shot-image': 'true',
                                  fallback: shotGenerationAction(generation),
                                }}
                                lang={lang}
                                version={sb.sourceRevision}
                                review={sb.status}
                                shotCount={row.linkedMedia?.length ? 1 : 0}
                                stale={sb.stale}
                                selected={selectedShot === shotKey}
                                title={
                                  <button type="button" className="mw-card-hit" aria-pressed={selectedShot === shotKey} onClick={() => setSelectedShot(shotKey)}>
                                    {`${pad2(row.order)} · ${seconds(row.plannedDurationMicros)} ${t('seconds')}`}
                                  </button>
                                }
                                meta={<span className="mw-dsh-code">{row.shotRef}</span>}
                                actions={
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
                                }
                              >
                                {fields.length > 0 ? (
                                  <span className="mw-dsh-muted mw-clamp-2" title={fields.join(' · ')}>
                                    {fields.join(' · ')}
                                  </span>
                                ) : null}
                                <div className="mw-media-ready-action"><ShotGenerateButton {...generation} /></div>
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
                              <th>{t('colCells')}</th>
                              <th aria-label={coreT('insertRefChip')} />
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr key={row.shotRef}>
                                <td data-num="true">{row.order}</td>
                                <td>
                                  <div className="mw-stack" data-gap="xs">
                                    <span className="mw-dsh-code">{row.shotRef}</span>
                                    <span className="mw-dsh-muted">{row.sceneRef}</span>
                                  </div>
                                </td>
                                <td data-num="true">{(row.plannedDurationMicros / 1_000_000).toFixed(1)}s</td>
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
                                </td>
                              </tr>
                            ))}
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
          render: () =>
            assetTables.length === 0 ? (
              <EmptyAction {...syncAction} />
            ) : (
              <div className="mw-stack" data-gap="lg">
                {assetTables.map((at) => {
                  const pl = (details[at.elementId]?.payload ?? {}) as { assets?: AssetRow[] }
                  const axisCols = [
                    ['scaenaAdmission', t('axisAdmission')],
                    ['subjectFreeze', t('axisFreeze')],
                    ['productionAcceptance', t('axisAcceptance')],
                    ['currentUsability', t('axisUsability')],
                  ] as const
                  return (
                    <section key={at.elementId} className="mw-stack" data-gap="sm">
                      <SectionHead title={at.title} meta={at.subtitle} actions={viewSwitch} />
                      {view === 'cards' ? (
                        <div className="mw-board" data-drama-asset-board="true">
                          {(pl.assets ?? []).map((asset) => (
                            <NoteCard
                              key={asset.assetRef}
                              eyebrow={`${asset.role} · v${asset.parsedVersion}`}
                              title={<span className="mw-dsh-code">{asset.assetRef}</span>}
                            >
                              <ul className="mw-stack dr-axes" data-gap="xs">
                                {axisCols.map(([key, label]) => {
                                  const raw = asset.axes[key]
                                  return (
                                    <li key={key} className="mw-row" data-gap="xs" title={`${label}: ${raw}`}>
                                      <ToneDot tone={statusTone(raw)} />
                                      <span>{`${label}: ${raw}`}</span>
                                    </li>
                                  )
                                })}
                              </ul>
                            </NoteCard>
                          ))}
                        </div>
                      ) : (
                      <div className="mw-table-wrap">
                        <table className="mw-table">
                          <thead>
                            <tr>
                              <th>{t('colAsset')}</th>
                              <th>{t('colRole')}</th>
                              <th data-num="true">{t('colVersion')}</th>
                              {axisCols.map(([key, label]) => (
                                <th key={key}>{label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(pl.assets ?? []).map((asset) => (
                              <tr key={asset.assetRef}>
                                <td className="mw-dsh-code">{asset.assetRef}</td>
                                <td>{asset.role}</td>
                                <td data-num="true">v{asset.parsedVersion}</td>
                                {axisCols.map(([key, label]) => {
                                  const raw = asset.axes[key]
                                  return (
                                    <td key={key}>
                                      <span className="mw-row" data-gap="xs" title={`${label}: ${raw}`}>
                                        <ToneDot tone={statusTone(raw)} />
                                        <span>{`${label}: ${raw}`}</span>
                                      </span>
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      )}
                    </section>
                  )
                })}
              </div>
            ),
        },
        {
          id: 'timeline',
          label: () => t('tabTimeline'),
          render: () =>
            editTimelines.length === 0 ? (
              <EmptyAction {...syncAction} />
            ) : (
              <div className="mw-stack" data-gap="lg">
                {editTimelines.map((et) => {
                  const pl = (details[et.elementId]?.payload ?? {}) as {
                    aspectRatio?: string
                    fps?: number
                    clips?: Array<{ clip_ref?: string; in_ms?: number; out_ms?: number }>
                  }
                  const clips = pl.clips ?? []
                  const total = Math.max(1, ...clips.map((c) => c.out_ms ?? 0))
                  return (
                    <section key={et.elementId} className="mw-stack" data-gap="sm">
                      <SectionHead
                        title={et.title}
                        meta={`${t('aspect')} ${pl.aspectRatio ?? '9:16'} · ${pl.fps ?? 24} fps · ${et.subtitle ?? ''}`}
                      />
                      {clips.length === 0 ? null : (
                        <div className="dr-track" role="list">
                          {clips.map((clip, idx) => {
                            const inMs = clip.in_ms ?? 0
                            const outMs = clip.out_ms ?? inMs
                            const label = clip.clip_ref ?? `clip_${idx + 1}`
                            return (
                              <span
                                key={clip.clip_ref ?? idx}
                                role="listitem"
                                className="dr-clip"
                                title={`${label} · ${inMs}ms → ${outMs}ms`}
                                style={
                                  {
                                    '--dr-start': `${(inMs / total) * 100}%`,
                                    '--dr-len': `${Math.max(1, ((outMs - inMs) / total) * 100)}%`,
                                  } as CSSProperties
                                }
                              >
                                {label}
                              </span>
                            )
                          })}
                        </div>
                      )}
                      <div className="mw-table-wrap">
                        <table className="mw-table">
                          <thead>
                            <tr>
                              <th>{t('clipCount')}</th>
                              <th data-num="true">in</th>
                              <th data-num="true">out</th>
                            </tr>
                          </thead>
                          <tbody>
                            {clips.map((clip, idx) => (
                              <tr key={clip.clip_ref ?? idx}>
                                <td className="mw-dsh-code">{clip.clip_ref ?? `clip_${idx + 1}`}</td>
                                <td data-num="true">{clip.in_ms ?? 0}ms</td>
                                <td data-num="true">{clip.out_ms ?? 0}ms</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )
                })}
              </div>
            ),
        },
        {
          id: 'side-by-side',
          label: () => t('tabSideBySide'),
          render: () => {
            const allRows = storyboards.flatMap((sb) => {
              const pl = (details[sb.elementId]?.payload ?? {}) as {
                rows?: Array<{ sceneRef: string; shotRef: string; order: number }>
              }
              return pl.rows ?? []
            })
            if (scriptCards.length === 0 && allRows.length === 0) {
              return <EmptyAction {...syncAction} />
            }
            return (
              <div className="mw-split-2" data-drama-script-sidebyside="true">
                <section className="mw-stack" data-gap="sm">
                  <SectionHead title={t('scriptSide')} meta={String(scriptCards.length)} />
                  {scriptCards.map((sc) => (
                    <SceneMini key={sc.elementId} scene={sc} lang={lang} />
                  ))}
                </section>
                <section className="mw-stack" data-gap="sm">
                  <SectionHead title={t('shotSide')} meta={`${allRows.length} ${t('shotCount')}`} />
                  {allRows.map((r) => (
                    <article key={r.shotRef} className="mw-dsh-card" data-flat="true">
                      <div className="mw-spread">
                        <span className="mw-row" data-gap="sm">
                          <b className="mw-num">{pad2(r.order)}</b>
                          <span className="mw-dsh-code">{r.shotRef}</span>
                        </span>
                        <span className="mw-chip">{r.sceneRef}</span>
                      </div>
                    </article>
                  ))}
                </section>
              </div>
            )
          },
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
