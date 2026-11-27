import { useState, type ReactNode } from 'react'
import {
  EmptyState,
  MediaPreview,
  NoteCard,
  SectionHead,
  Segmented,
  ToneDot,
  statusTone,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
} from '@yeisme/dsh-muweave-core/client'
import type { AssetRow, EikonaBindableItem, StoryboardRow } from './shot-inspector'

type AssetFilterMode = 'all' | 'blocked' | 'ready'

function isAssetReady(asset: AssetRow): boolean {
  return Object.values(asset.axes).every((raw) => statusTone(raw) === 'ok')
}

function assetMatchToken(assetRef: string): string {
  const idx = assetRef.lastIndexOf(':')
  return (idx >= 0 ? assetRef.slice(idx + 1) : assetRef).toLowerCase()
}

function findMasterForAsset(
  asset: AssetRow,
  masterBindings: readonly EikonaBindableItem[],
): EikonaBindableItem | undefined {
  const refLower = asset.assetRef.toLowerCase()
  const token = assetMatchToken(asset.assetRef)
  return masterBindings.find((m) => {
    const hay = `${m.sourceRef ?? ''} ${m.handle ?? ''} ${m.label} ${m.elementId}`.toLowerCase()
    return hay.includes(refLower) || (token.length >= 2 && hay.includes(token))
  })
}

function findImpactedShots(asset: AssetRow, shotRows: readonly StoryboardRow[]): StoryboardRow[] {
  const refLower = asset.assetRef.toLowerCase()
  const token = assetMatchToken(asset.assetRef)
  return shotRows.filter((row) => {
    const visibleValues = Object.entries(row.cells)
      .filter(([k]) => !row.restrictedFields.includes(k))
      .map(([, v]) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')))
      .join(' ')
    const mediaRefs = (row.linkedMedia ?? [])
      .map((m) => `${m.elementId ?? ''} ${m.artifactId ?? ''}`)
      .join(' ')
    const hay = `${row.sceneRef} ${row.shotRef} ${visibleValues} ${mediaRefs}`.toLowerCase()
    return hay.includes(refLower) || (token.length >= 2 && hay.includes(token))
  })
}

export interface AssetsViewProps {
  rpc: MuweaveRpcClient
  assetTables: readonly MuweaveElementSummaryV1[]
  details: Record<string, MuweaveElementV1>
  shotRows: readonly StoryboardRow[]
  masterBindings: readonly EikonaBindableItem[]
  view: 'cards' | 'table'
  viewSwitch: ReactNode
  onInspectShot: (shotRef: string) => void
  t: (k: string) => string
  coreT: MuweaveTranslator
}

export function AssetsView({
  rpc,
  assetTables,
  details,
  shotRows,
  masterBindings,
  view,
  viewSwitch,
  onInspectShot,
  t,
  coreT,
}: AssetsViewProps) {
  const [filterMode, setFilterMode] = useState<AssetFilterMode>('all')

  if (assetTables.length === 0) {
    return <EmptyState>{coreT('emptyElements')}</EmptyState>
  }

  const axisCols = [
    ['scaenaAdmission', t('axisAdmission')],
    ['subjectFreeze', t('axisFreeze')],
    ['productionAcceptance', t('axisAcceptance')],
    ['currentUsability', t('axisUsability')],
  ] as const

  return (
    <div className="mw-stack" data-gap="lg" data-drama-assets-view="true">
      <div className="dr-filter-bar mw-spread" data-asset-filter-bar="true">
        <Segmented<AssetFilterMode>
          label={t('assetFilterLabel')}
          value={filterMode}
          options={[
            { value: 'all', label: t('assetFilterAll') },
            { value: 'blocked', label: t('assetFilterBlocked') },
            { value: 'ready', label: t('assetFilterReady') },
          ]}
          onChange={setFilterMode}
        />
        {viewSwitch}
      </div>

      {assetTables.map((at) => {
        const pl = (details[at.elementId]?.payload ?? {}) as { assets?: AssetRow[] }
        const allAssets = pl.assets ?? []
        const filteredAssets = allAssets.filter((asset) => {
          const ready = isAssetReady(asset)
          if (filterMode === 'ready') return ready
          if (filterMode === 'blocked') return !ready
          return true
        })

        return (
          <section key={at.elementId} className="mw-stack" data-gap="sm">
            <SectionHead
              title={at.title}
              meta={`${filteredAssets.length}/${allAssets.length}${at.subtitle ? ` · ${at.subtitle}` : ''}`}
            />

            {filteredAssets.length === 0 ? (
              <EmptyState>{t('noAssetsForFilter')}</EmptyState>
            ) : view === 'cards' ? (
              <div className="mw-board" data-drama-asset-board="true">
                {filteredAssets.map((asset) => {
                  const master = findMasterForAsset(asset, masterBindings)
                  const impacted = findImpactedShots(asset, shotRows)
                  return (
                    <NoteCard
                      key={asset.assetRef}
                      eyebrow={`${asset.role} · v${asset.parsedVersion}`}
                      title={<span className="mw-dsh-code">{asset.assetRef}</span>}
                      data-asset-card={asset.assetRef}
                      data-asset-ready={isAssetReady(asset) ? 'true' : 'false'}
                    >
                      {master?.sha256 ? (
                        <MediaPreview
                          rpc={rpc}
                          sha256={master.sha256}
                          alt={master.label}
                          pendingLabel={coreT('loading')}
                          emptyLabel={asset.assetRef}
                        />
                      ) : null}

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

                      {impacted.length > 0 ? (
                        <div className="dr-asset-impacts mw-stack" data-gap="xs" data-asset-impacts={asset.assetRef}>
                          <span className="mw-eyebrow">
                            {t('impactedShots')} ({impacted.length})
                          </span>
                          <div className="mw-row" data-gap="xs">
                            {impacted.map((shot) => (
                              <button
                                key={shot.shotRef}
                                type="button"
                                className="dr-asset-impact-chip mw-dsh-btn"
                                data-size="sm"
                                data-variant="ghost"
                                data-impacted-shot={shot.shotRef}
                                onClick={() => onInspectShot(shot.shotRef)}
                              >
                                {shot.shotRef}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </NoteCard>
                  )
                })}
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
                      <th>{t('impactedShots')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.map((asset) => {
                      const impacted = findImpactedShots(asset, shotRows)
                      return (
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
                          <td>
                            <div className="mw-row" data-gap="xs">
                              {impacted.map((shot) => (
                                <button
                                  key={shot.shotRef}
                                  type="button"
                                  className="mw-dsh-btn"
                                  data-size="sm"
                                  data-variant="ghost"
                                  data-impacted-shot={shot.shotRef}
                                  onClick={() => onInspectShot(shot.shotRef)}
                                >
                                  {shot.shotRef}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
