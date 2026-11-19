/**
 * The session's 「做剧」 conversation view. It shows only this session's perspective — the
 * elements it mentioned or received — plus compact read-only digests; the full pages stay in
 * the theater.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  ProgressLine,
  ReadinessDots,
  SceneMini,
  ShotStrip,
  assetIsReady,
  useDramaDigest,
  type DigestAssetAxis,
} from './drama-components'
import { getFloatingAgentSnapshot, subscribeFloatingAgent } from './floating-agent'
import type { MuweaveTranslator } from './i18n'
import type { MuweaveRpcClient } from './rpc-client'
import { elementIdFromRef, readSessionLog, subscribeSessionLog, type SessionLogEntry } from './session-log'
import { EmptyState, Icon, Segmented, StatusTag } from './ui'

type Section = 'session' | 'shots' | 'script' | 'assets' | 'tools'

const SHOT_LIMIT = 12
const SCENE_LIMIT = 6
const ASSET_LIMIT = 8

export interface DramaSessionViewProps {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  sessionId: string | undefined
  onOpenTheater: (target?: { roomId?: string; ref?: string }) => void
}

function useSessionLog(sessionId: string | undefined): readonly SessionLogEntry[] {
  const read = () => readSessionLog(sessionId)
  return useSyncExternalStore(subscribeSessionLog, read, read)
}

function SeeAll({ t, shown, total, onOpen }: { t: MuweaveTranslator; shown: number; total: number; onOpen: () => void }) {
  if (total <= shown) return null
  return (
    <button type="button" className="mw-dsh-btn" data-variant="ghost" data-size="sm" onClick={onOpen}>
      <span>
        {t('sessionSeeAll')} · {total}
      </span>
      <Icon name="external" />
    </button>
  )
}

function LogRow({
  entry,
  t,
  lang,
  onLocate,
}: {
  entry: SessionLogEntry
  t: MuweaveTranslator
  lang: string
  onLocate: () => void
}) {
  const known = useSyncExternalStore(subscribeFloatingAgent, getFloatingAgentSnapshot, getFloatingAgentSnapshot).knownElements
  const element = known.find((e) => e.elementId === elementIdFromRef(entry.ref))
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(id)
  }, [copied])
  const kindLabel =
    entry.kind === 'mentioned' ? t('sessionLogMentioned') : entry.kind === 'staged' ? t('sessionLogStaged') : t('sessionLogHandoff')
  const time = new Date(entry.at).toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })
  return (
    <li className="mw-sv-log-row">
      <div className="mw-sv-log-main">
        <span className="mw-title">{entry.label}</span>
        <span className="mw-dsh-muted">
          {kindLabel} · {time}
          {element ? ` · ${element.domain}` : ''}
        </span>
      </div>
      {element ? <StatusTag status={element.status} lang={lang} /> : null}
      <div className="mw-row" data-gap="xs">
        <button type="button" className="mw-dsh-btn" data-variant="ghost" data-size="sm" onClick={onLocate}>
          {t('sessionLocate')}
        </button>
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={() => {
            void globalThis.navigator?.clipboard
              ?.writeText(`@[${entry.label}](${entry.ref})`)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} />
          <span>{copied ? t('sessionCopied') : t('sessionCopyRef')}</span>
        </button>
      </div>
    </li>
  )
}
import { toolCatalogIntent, useToolCatalog, type ToolCatalogEntry } from './tool-catalog'
import { openGeneration } from './generation-store'


export function DramaSessionView({ rpc, t, sessionId, onOpenTheater }: DramaSessionViewProps) {
  const log = useSessionLog(sessionId)
  const [section, setSection] = useState<Section>('session')
  const catalog = useToolCatalog(rpc)
  const { digest, loading } = useDramaDigest(rpc)
  const lang = t('langCode')
  const axisLabels: Record<DigestAssetAxis['key'], string> = {
    scaenaAdmission: t('axisAdmission'),
    subjectFreeze: t('axisFreeze'),
    productionAcceptance: t('axisAcceptance'),
    currentUsability: t('axisUsability'),
  }
  const productionRoom = { roomId: 'muweave-drama' }

  let body
  if (section === 'session') {
    body =
      log.length === 0 ? (
        <div className="mw-sv-empty">
          <EmptyState icon="theater">{t('sessionEmpty')}</EmptyState>
          <p className="mw-dsh-muted">{t('sessionEmptyHint')}</p>
          <button type="button" className="mw-dsh-btn" data-variant="primary" onClick={() => onOpenTheater()}>
            <Icon name="theater" />
            <span>{t('theaterEnter')}</span>
          </button>
        </div>
      ) : (
        <ul className="mw-sv-log" aria-label={t('sessionThis')}>
          {log.map((entry) => (
            <LogRow
              key={`${entry.kind}:${entry.ref}`}
              entry={entry}
              t={t}
              lang={lang}
              onLocate={() => onOpenTheater({ ref: entry.ref })}
            />
          ))}
        </ul>
      )
  } else if (loading) {
    body = <p className="mw-dsh-muted">{t('loading')}</p>
  } else if (section === 'shots') {
    body =
      digest.shots.length === 0 ? (
        <EmptyState>{t('emptyElements')}</EmptyState>
      ) : (
        <>
          <ShotStrip shots={digest.shots.slice(0, SHOT_LIMIT)} label={t('sessionShots')} />
          <SeeAll t={t} shown={SHOT_LIMIT} total={digest.shots.length} onOpen={() => onOpenTheater(productionRoom)} />
        </>
      )
  } else if (section === 'script') {
    body =
      digest.scenes.length === 0 ? (
        <EmptyState>{t('emptyElements')}</EmptyState>
      ) : (
        <>
          <div className="mw-stack" data-gap="xs">
            {digest.scenes.slice(0, SCENE_LIMIT).map((scene) => (
              <SceneMini key={scene.elementId} scene={scene} lang={lang} />
            ))}
          </div>
          <SeeAll t={t} shown={SCENE_LIMIT} total={digest.scenes.length} onOpen={() => onOpenTheater({ roomId: 'muweave-script' })} />
        </>
      )
  } else {
    body =
      digest.assets.length === 0 ? (
        <EmptyState>{t('emptyElements')}</EmptyState>
      ) : (
        <>
          <ul className="mw-sv-assets" aria-label={t('sessionAssets')}>
            {digest.assets.slice(0, ASSET_LIMIT).map((asset) => (
              <li key={asset.assetRef} className="mw-sv-asset" data-ready={assetIsReady(asset) ? 'true' : undefined}>
                <span className="mw-dsh-code">{asset.assetRef}</span>
                <span className="mw-dsh-muted">
                  {asset.role} · v{asset.version}
                </span>
                <ReadinessDots axes={asset.axes} labels={axisLabels} />
              </li>
            ))}
          </ul>
          <SeeAll t={t} shown={ASSET_LIMIT} total={digest.assets.length} onOpen={() => onOpenTheater(productionRoom)} />
        </>
      )
  }

  const runTool = (entry: ToolCatalogEntry) => {
    const intent = toolCatalogIntent(entry)
    if (intent.kind === 'blocked') return
    // Both ready and paid capabilities go through the desk: paid ones still need the user's approval
    // there, and this view never submits on its own.
    openGeneration({ capabilityId: entry.id })
  }

  const toolRow = (entry: ToolCatalogEntry) => {
    const intent = toolCatalogIntent(entry)
    const label = t('langCode') === 'en' ? entry.labelEn : entry.labelZh
    return (
      <li key={entry.id} className="mw-sv-tool" data-tool-id={entry.id} data-availability={entry.availability}>
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="ghost"
          data-size="sm"
          data-tool-action={intent.kind}
          disabled={intent.kind === 'blocked'}
          title={intent.kind === 'blocked' ? intent.reason : label}
          onClick={() => runTool(entry)}
        >
          <span>{label}</span>
        </button>
        <span className="mw-dsh-muted">{entry.owner}</span>
        {intent.kind === 'blocked' ? <span className="mw-dsh-muted">{intent.reason}</span> : null}
      </li>
    )
  }

  if (section === 'tools') {
    body = (
      <div className="mw-stack" data-muweave-tool-catalog="true" data-gap="sm">
        <p className="mw-dsh-muted">
          {t('catalogSummary')
            .replace('{ready}', String(catalog.groups.ready.length))
            .replace('{approval}', String(catalog.groups.needsApproval.length))
            .replace('{blocked}', String(catalog.groups.blocked.length))}
        </p>
        {(
          [
            ['ready', catalog.groups.ready],
            ['needsApproval', catalog.groups.needsApproval],
            ['blocked', catalog.groups.blocked],
          ] as const
        ).map(([group, rows]) =>
          rows.length === 0 ? null : (
            <section key={group} className="mw-stack" data-gap="xs" data-tool-group={group}>
              <h4 className="mw-eyebrow">{t(group === 'ready' ? 'catalogReady' : group === 'needsApproval' ? 'catalogNeedsApproval' : 'catalogBlocked')}</h4>
              <ul className="mw-stack" data-gap="xs">{rows.map(toolRow)}</ul>
            </section>
          ),
        )}
      </div>
    )
  }

  return (
    <div className="mw-session-view" data-muweave-session-view="true">
      <header className="mw-sv-head">
        <ProgressLine digest={digest} t={t} />
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="ghost"
          data-size="sm"
          data-muweave-theater-open="session-view"
          onClick={() => onOpenTheater(section === 'script' ? { roomId: 'muweave-script' } : productionRoom)}
        >
          <Icon name="theater" />
          <span>{t('theaterOpen')}</span>
        </button>
      </header>
      <Segmented<Section>
        label={t('sessionViewSections')}
        value={section}
        onChange={setSection}
        options={[
          { value: 'session', label: log.length > 0 ? `${t('sessionThis')} ${log.length}` : t('sessionThis') },
          { value: 'shots', label: t('sessionShots') },
          { value: 'script', label: t('sessionScript') },
          { value: 'assets', label: t('sessionAssets') },
          { value: 'tools', label: t('catalogTitle') },
        ]}
      />
      <div className="mw-sv-body">{body}</div>
    </div>
  )
}
