import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CompanionList,
  EmptyState,
  MediaPreview,
  RoomHero,
  SectionHead,
  StatusTag,
  WorkspaceShell,
  registerMuweaveCreatorPlugin,
  stageItemToFloatingAgent,
  type DshClientContextLike,
  type LinkedMediaRef,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
} from '@yeisme/dsh-muweave-core/client'

export const name = '@yeisme/dsh-muweave-assets'
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const ASSETS_PANEL_ID = 'muweave-assets'
export const ASSETS_COMPANION_ID = 'muweave-assets/companion'
export const ASSETS_LOCALE_NS = 'muweaveAssets'

const zh = {
  panelTitle: '幕织中央资产库 (Asset Vault)',
  roomTitle: '资产库',
  companionTitle: '资产引用动态',
  heroEyebrow: 'MuWeave · 资产库',
  heroLede: '跨领域角色、场景、道具、视觉与音频资产总览，双向追踪镜头引用与未挂载资产。',
  tabCatalog: '中央资产库',
  tabUsage: '跨集引用矩阵',
  statTotal: '总资产',
  statLinked: '已引用',
  statUnused: '未引用',
  catAll: '全部',
  catCharacter: '角色',
  catScene: '场景',
  catProp: '道具',
  catVisual: '视觉',
  catAudio: '音频',
  searchPlaceholder: '搜索资产名称、引用或类型…',
  bindShotBtn: '绑定到镜头',
  boundReceipt: '已绑定资产',
  stageAgentBtn: '@ 注入助手',
  shotLinks: '个镜头引用',
  unusedTag: '未引用',
  missingShotTitle: '缺媒体镜头提醒',
  noAssets: '当前筛选条件下暂无资产。',
  noMatrix: '暂无镜头或资产数据，请先同步 .muweave/。',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: 'MuWeave Asset Vault',
  roomTitle: 'Assets',
  companionTitle: 'Asset Usage Pulse',
  heroEyebrow: 'MuWeave · Asset Vault',
  heroLede: 'Unified cross-domain asset catalog with 4-axis readiness and bidirectional shot reference tracking.',
  tabCatalog: 'Asset Catalog',
  tabUsage: 'Usage Matrix',
  statTotal: 'Assets',
  statLinked: 'Referenced',
  statUnused: 'Unreferenced',
  catAll: 'All',
  catCharacter: 'Character',
  catScene: 'Scene',
  catProp: 'Prop',
  catVisual: 'Visual',
  catAudio: 'Audio',
  searchPlaceholder: 'Search asset title, ref, or kind…',
  bindShotBtn: 'Bind to Shot',
  boundReceipt: 'Asset bound',
  stageAgentBtn: '@ Stage',
  shotLinks: 'shot links',
  unusedTag: 'Unused',
  missingShotTitle: 'Shots Missing Media',
  noAssets: 'No assets match the current filter.',
  noMatrix: 'No shots or assets yet; sync .muweave/ first.',
}

export function AssetsIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <rect x="2" y="2.5" width="12" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="8.5" width="5.2" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.8" y="8.5" width="5.2" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

type AssetCategory = 'all' | 'character' | 'scene' | 'prop' | 'visual' | 'audio'

interface VaultAsset {
  id: string
  title: string
  sourceRef: string
  category: Exclude<AssetCategory, 'all'>
  kind: string
  status: string
  sha256?: string
  axes?: { admission?: string; freeze?: string; acceptance?: string; usability?: string }
  referencedByShots: string[]
}

interface ShotRefSummary {
  shotRef: string
  sceneRef: string
  hasVisual: boolean
  hasAudio: boolean
  linkedSha256s: string[]
  linkedElementIds: string[]
}

function classifyCategory(el: MuweaveElementSummaryV1): Exclude<AssetCategory, 'all'> {
  const k = `${el.kind} ${el.sourceRef} ${el.title}`.toLowerCase()
  if (k.includes('character') || k.includes('角色') || k.includes('anchor')) return 'character'
  if (k.includes('scene') || k.includes('location') || k.includes('场景')) return 'scene'
  if (k.includes('prop') || k.includes('道具')) return 'prop'
  if (k.includes('audio') || k.includes('voice') || k.includes('sfx') || k.includes('music')) return 'audio'
  return 'visual'
}

const BIBLE_GET = 'project.bible.get' as string as Parameters<MuweaveRpcClient['call']>[0]

export function AssetsMainPage({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  const [elements, setElements] = useState<MuweaveElementSummaryV1[]>([])
  const [shots, setShots] = useState<ShotRefSummary[]>([])
  const [bibleAnchors, setBibleAnchors] = useState<Array<{ name: string; wardrobe: string; immutableTraits: string }>>([])
  const [category, setCategory] = useState<AssetCategory>('all')
  const [query, setQuery] = useState<string>('')
  const [selectedShotByAsset, setSelectedShotByAsset] = useState<Record<string, string>>({})
  const [receipt, setReceipt] = useState<string>('')
  const lang = coreT('langCode')

  const loadAll = useCallback(async () => {
    const [elRes, bibleRes] = await Promise.all([
      rpc.call<{ elements?: MuweaveElementSummaryV1[] }>('bundle.elements.list', {}),
      rpc.call<{ bible?: { characterAnchors?: Array<{ name?: string; wardrobe?: string; immutableTraits?: string }> } }>(BIBLE_GET, {}).catch(() => ({ ok: false as const })),
    ])

    const allEls = elRes.ok && Array.isArray(elRes.data?.elements) ? elRes.data.elements : []
    setElements(allEls)

    if (bibleRes.ok && Array.isArray(bibleRes.data?.bible?.characterAnchors)) {
      setBibleAnchors(
        bibleRes.data.bible.characterAnchors.map((a) => ({
          name: String(a.name ?? ''),
          wardrobe: String(a.wardrobe ?? ''),
          immutableTraits: String(a.immutableTraits ?? ''),
        })),
      )
    }

    const boards = allEls.filter((e) => e.kind === 'drama.storyboard_table').slice(0, 6)
    const shotSummaries: ShotRefSummary[] = []
    const boardDetails = await Promise.all(
      boards.map(async (b) => {
        const d = await rpc.call<{ element?: MuweaveElementV1 }>('bundle.element.get', { elementId: b.elementId })
        return d.ok ? d.data?.element : undefined
      }),
    )
    for (const detail of boardDetails) {
      if (!detail) continue
      const rows = ((detail.payload ?? {}) as { rows?: Array<Record<string, unknown>> }).rows ?? []
      for (const r of rows) {
        const linked = Array.isArray(r.linkedMedia) ? (r.linkedMedia as LinkedMediaRef[]) : []
        shotSummaries.push({
          shotRef: String(r.shotRef ?? ''),
          sceneRef: String(r.sceneRef ?? ''),
          hasVisual: linked.some((m) => m.role === 'keyframe' || m.role === 'video' || m.role === 'reference'),
          hasAudio: linked.some((m) => m.role === 'voice' || m.role === 'music' || m.role === 'sfx'),
          linkedSha256s: linked.map((m) => m.sha256).filter((s): s is string => typeof s === 'string'),
          linkedElementIds: linked.map((m) => m.elementId).filter((s): s is string => typeof s === 'string'),
        })
      }
    }
    setShots(shotSummaries)
  }, [rpc])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const vaultAssets = useMemo<VaultAsset[]>(() => {
    const list: VaultAsset[] = []
    for (const el of elements) {
      if (el.kind === 'drama.storyboard_table') continue
      const mediaSha = (el as { mediaRefs?: Array<{ sha256?: string }> }).mediaRefs?.[0]?.sha256
      const refs = shots
        .filter(
          (s) =>
            s.linkedElementIds.includes(el.elementId) ||
            (mediaSha && s.linkedSha256s.includes(mediaSha)) ||
            (el.sceneRef && s.sceneRef === el.sceneRef),
        )
        .map((s) => s.shotRef)
      list.push({
        id: el.elementId,
        title: el.title,
        sourceRef: el.sourceRef,
        category: classifyCategory(el),
        kind: el.kind,
        status: el.stale ? 'stale' : el.status,
        sha256: mediaSha,
        referencedByShots: refs,
      })
    }
    for (const anchor of bibleAnchors) {
      if (!anchor.name) continue
      list.push({
        id: `bible:anchor:${anchor.name}`,
        title: anchor.name,
        sourceRef: anchor.wardrobe || anchor.immutableTraits || 'continuity-bible',
        category: 'character',
        kind: 'bible.character_anchor',
        status: 'ready',
        referencedByShots: [],
      })
    }
    return list
  }, [elements, shots, bibleAnchors])

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vaultAssets.filter((a) => {
      if (category !== 'all' && a.category !== category) return false
      if (!q) return true
      return `${a.title} ${a.sourceRef} ${a.kind}`.toLowerCase().includes(q)
    })
  }, [vaultAssets, category, query])

  const linkedCount = useMemo(() => vaultAssets.filter((a) => a.referencedByShots.length > 0).length, [vaultAssets])
  const unusedCount = vaultAssets.length - linkedCount
  const missingMediaShots = useMemo(() => shots.filter((s) => !s.hasVisual || !s.hasAudio), [shots])

  const handleBindAsset = async (asset: VaultAsset) => {
    const targetShot = selectedShotByAsset[asset.id] ?? shots[0]?.shotRef ?? ''
    if (!targetShot) return
    const res = await rpc.call('eikona.asset.bind', {
      assetRef: asset.sourceRef,
      targetRef: targetShot,
      elementId: asset.id,
    })
    if (res?.ok) {
      setReceipt(`${t('boundReceipt')}: ${asset.title} → ${targetShot}`)
    }
  }

  const categories: ReadonlyArray<{ id: AssetCategory; labelKey: string }> = [
    { id: 'all', labelKey: 'catAll' },
    { id: 'character', labelKey: 'catCharacter' },
    { id: 'scene', labelKey: 'catScene' },
    { id: 'prop', labelKey: 'catProp' },
    { id: 'visual', labelKey: 'catVisual' },
    { id: 'audio', labelKey: 'catAudio' },
  ]

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      rpc={rpc}
      t={coreT}
      onSyncRequested={loadAll}
      hero={
        <RoomHero
          eyebrow={t('heroEyebrow')}
          title={t('panelTitle')}
          lede={t('heroLede')}
          stats={[
            { icon: 'inbox', value: vaultAssets.length, label: t('statTotal') },
            { icon: 'check', value: linkedCount, label: t('statLinked') },
            { icon: 'warn', value: unusedCount, label: t('statUnused') },
          ]}
        />
      }
      stageTabs={[
        {
          id: 'catalog',
          label: () => t('tabCatalog'),
          render: () => (
            <div className="mw-ast-shell mw-stack" data-gap="md" data-assets-catalog="true">
              <div className="mw-ast-filter mw-spread">
                <div className="mw-row" data-gap="xs" role="group">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className="mw-dsh-btn"
                      data-size="sm"
                      data-variant={category === cat.id ? 'primary' : 'quiet'}
                      aria-pressed={category === cat.id}
                      data-assets-cat={cat.id}
                      onClick={() => setCategory(cat.id)}
                    >
                      {t(cat.labelKey)}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  className="mw-input"
                  placeholder={t('searchPlaceholder')}
                  data-assets-search="true"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {receipt ? (
                <span className="mw-status" role="status" data-tone="ok" data-assets-receipt="true">
                  <span className="mw-dot" />
                  {receipt}
                </span>
              ) : null}

              {filteredAssets.length === 0 ? (
                <EmptyState>{t('noAssets')}</EmptyState>
              ) : (
                <div className="mw-ast-grid">
                  {filteredAssets.map((asset) => (
                    <article key={asset.id} className="mw-ast-card mw-dsh-card mw-stack" data-flat="true" data-gap="xs" data-asset-card={asset.id}>
                      {asset.sha256 ? (
                        <MediaPreview
                          rpc={rpc}
                          sha256={asset.sha256}
                          alt={asset.title}
                          pendingLabel="..."
                          emptyLabel={asset.kind}
                        />
                      ) : null}
                      <div className="mw-spread">
                        <span className="mw-title">{asset.title}</span>
                        <StatusTag status={asset.status} lang={lang} />
                      </div>
                      <div className="mw-row" data-gap="xs">
                        <span className="mw-chip">{asset.category}</span>
                        <span className="mw-chip" data-mono="true">
                          {asset.kind}
                        </span>
                        <span className="mw-chip" data-asset-usage-count={asset.referencedByShots.length}>
                          {asset.referencedByShots.length > 0
                            ? `${asset.referencedByShots.length} ${t('shotLinks')}`
                            : t('unusedTag')}
                        </span>
                      </div>
                      <div className="mw-row" data-gap="xs">
                        {shots.length > 0 ? (
                          <>
                            <select
                              className="mw-input"
                              aria-label={t('bindShotBtn')}
                              value={selectedShotByAsset[asset.id] ?? shots[0]?.shotRef ?? ''}
                              onChange={(e) =>
                                setSelectedShotByAsset((prev) => ({ ...prev, [asset.id]: e.target.value }))
                              }
                            >
                              {shots.map((s) => (
                                <option key={s.shotRef} value={s.shotRef}>
                                  {s.shotRef}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="mw-dsh-btn"
                              data-variant="quiet"
                              data-size="sm"
                              data-asset-bind-btn={asset.id}
                              onClick={() => void handleBindAsset(asset)}
                            >
                              {t('bindShotBtn')}
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="mw-dsh-btn"
                          data-variant="ghost"
                          data-size="sm"
                          data-asset-stage-btn={asset.id}
                          onClick={() =>
                            stageItemToFloatingAgent({
                              kind: 'element',
                              ref: asset.id,
                              label: asset.title,
                              serializedLine: `[MuWeaveAsset id=${asset.id} category=${asset.category} ref=${asset.sourceRef}]`,
                            })
                          }
                        >
                          {t('stageAgentBtn')}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ),
        },
        {
          id: 'usage',
          label: () => t('tabUsage'),
          render: () => (
            <div className="mw-ast-matrix mw-stack" data-gap="md" data-assets-usage="true">
              {vaultAssets.length === 0 && shots.length === 0 ? (
                <EmptyState>{t('noMatrix')}</EmptyState>
              ) : (
                <>
                  <ul className="mw-stack" data-gap="xs">
                    {vaultAssets.map((asset) => {
                      const unused = asset.referencedByShots.length === 0
                      return (
                        <li
                          key={asset.id}
                          className="mw-ast-matrix-row mw-dsh-card mw-spread"
                          data-flat="true"
                          data-asset-unused={unused ? 'true' : 'false'}
                        >
                          <div className="mw-row" data-gap="xs">
                            <span className="mw-title">{asset.title}</span>
                            <span className="mw-chip">{asset.category}</span>
                          </div>
                          <div className="mw-row" data-gap="xs">
                            {unused ? (
                              <span className="mw-ast-orphan-badge mw-status" data-tone="warn">
                                <span className="mw-dot" />
                                {t('unusedTag')}
                              </span>
                            ) : (
                              asset.referencedByShots.map((sr) => (
                                <span key={sr} className="mw-chip" data-mono="true">
                                  {sr}
                                </span>
                              ))
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  {missingMediaShots.length > 0 ? (
                    <section className="mw-dsh-card mw-stack" data-flat="true" data-gap="xs">
                      <SectionHead title={t('missingShotTitle')} meta={`${missingMediaShots.length}`} />
                      <div className="mw-row" data-gap="xs">
                        {missingMediaShots.map((s) => (
                          <span key={s.shotRef} className="mw-chip" data-mono="true" data-shot-missing="true">
                            {s.shotRef}
                          </span>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </>
              )}
            </div>
          ),
        },
      ]}
    />
  )
}

export function AssetsCompanionPane({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  return <CompanionList rpc={rpc} coreT={coreT} title={t('companionTitle')} companionId="assets" />
}

export function apply(ctx: DshClientContextLike): void {
  const tFn = () => ctx.locale.bind(ASSETS_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: ASSETS_LOCALE_NS,
    dictionaries: { zh, en },
    pane: {
      pluginId: 'muweave-assets',
      panelId: ASSETS_PANEL_ID,
      order: 44.9,
      group: 'studio',
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: ['eikona', 'drama'],
      companionId: ASSETS_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: AssetsIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    } as Parameters<typeof registerMuweaveCreatorPlugin>[1]['pane'],
    MainComponent: AssetsMainPage,
    CompanionComponent: AssetsCompanionPane,
  })
}
