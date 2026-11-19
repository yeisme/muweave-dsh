/**
 * Compact drama building blocks shared by the theater's production room and the session's
 * 做剧 view: a digest loader over `.muweave/` drama + script elements, and four small
 * presentational pieces (ShotStrip, ReadinessDots, SceneMini, ProgressLine).
 */

import { useCallback, useEffect, useState } from 'react'
import type { MuweaveElementSummaryV1, MuweaveElementV1 } from '../protocol'
import { statusTone, type MuweaveTranslator } from './i18n'
import type { MuweaveRpcClient } from './rpc-client'
import { StatusTag, ToneDot } from './ui'

export interface DigestShot {
  storyboardId: string
  sceneRef: string
  shotRef: string
  order: number
  durationSec: number
}

export interface DigestAssetAxis {
  key: 'scaenaAdmission' | 'subjectFreeze' | 'productionAcceptance' | 'currentUsability'
  raw: string
}

export interface DigestAsset {
  assetRef: string
  role: string
  version: number
  axes: readonly DigestAssetAxis[]
}

export interface DramaDigest {
  scenes: MuweaveElementSummaryV1[]
  storyboards: MuweaveElementSummaryV1[]
  shots: DigestShot[]
  assets: DigestAsset[]
  clipCount: number
}

const EMPTY_DIGEST: DramaDigest = { scenes: [], storyboards: [], shots: [], assets: [], clipCount: 0 }
const AXIS_KEYS: readonly DigestAssetAxis['key'][] = ['scaenaAdmission', 'subjectFreeze', 'productionAcceptance', 'currentUsability']

export async function loadDramaDigest(rpc: MuweaveRpcClient): Promise<DramaDigest> {
  const [dRes, sRes] = await Promise.all([
    rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { domain: 'drama' }),
    rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { kind: 'script.scene_card' }),
  ])
  const drama = dRes.ok ? dRes.data.elements : []
  const scenes = sRes.ok ? sRes.data.elements : []
  const wanted = drama.filter((e) =>
    ['drama.storyboard_table', 'drama.asset_readiness', 'drama.edit_timeline'].includes(e.kind),
  )
  const details = await Promise.all(
    wanted.map(async (el) => {
      const res = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: el.elementId })
      return res.ok ? { el, payload: (res.data.element.payload ?? {}) as Record<string, unknown> } : undefined
    }),
  )
  const digest: DramaDigest = { scenes, storyboards: [], shots: [], assets: [], clipCount: 0 }
  for (const d of details) {
    if (!d) continue
    if (d.el.kind === 'drama.storyboard_table') {
      digest.storyboards.push(d.el)
      const rows = Array.isArray(d.payload.rows) ? (d.payload.rows as Array<Record<string, unknown>>) : []
      for (const r of rows) {
        digest.shots.push({
          storyboardId: d.el.elementId,
          sceneRef: String(r.sceneRef ?? ''),
          shotRef: String(r.shotRef ?? ''),
          order: Number(r.order ?? 0),
          durationSec: Number(r.plannedDurationMicros ?? 0) / 1_000_000,
        })
      }
    } else if (d.el.kind === 'drama.asset_readiness') {
      const assets = Array.isArray(d.payload.assets) ? (d.payload.assets as Array<Record<string, unknown>>) : []
      for (const a of assets) {
        const axes = (a.axes ?? {}) as Record<string, unknown>
        digest.assets.push({
          assetRef: String(a.assetRef ?? ''),
          role: String(a.role ?? ''),
          version: Number(a.parsedVersion ?? 0),
          axes: AXIS_KEYS.map((key) => ({ key, raw: String(axes[key] ?? '') })),
        })
      }
    } else if (Array.isArray(d.payload.clips)) {
      digest.clipCount += d.payload.clips.length
    }
  }
  return digest
}

export function useDramaDigest(rpc: MuweaveRpcClient): { digest: DramaDigest; loading: boolean; reload: () => void } {
  const [digest, setDigest] = useState<DramaDigest>(EMPTY_DIGEST)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadDramaDigest(rpc)
      .then((d) => {
        if (!cancelled) setDigest(d)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [rpc, tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { digest, loading, reload }
}

export function assetIsReady(asset: DigestAsset): boolean {
  return asset.axes.every((a) => statusTone(a.raw) === 'ok')
}

/** Shot tiles: order number on a frame placeholder, shot ref and planned duration. */
export function ShotStrip({ shots, label }: { shots: readonly DigestShot[]; label: string }) {
  return (
    <ol className="mw-shot-strip" aria-label={label}>
      {shots.map((s) => (
        <li key={`${s.storyboardId}:${s.shotRef}`} className="mw-shot" title={`${s.sceneRef} / ${s.shotRef}`}>
          <span className="mw-shot-frame" aria-hidden="true">
            {s.order}
          </span>
          <span className="mw-shot-ref">{s.shotRef}</span>
          <span className="mw-shot-dur">{s.durationSec.toFixed(1)}s</span>
        </li>
      ))}
    </ol>
  )
}

/** Four readiness axes as dots, each labelled for assistive tech, plus an n/4 count. */
export function ReadinessDots({ axes, labels }: { axes: readonly DigestAssetAxis[]; labels: Record<DigestAssetAxis['key'], string> }) {
  const ready = axes.filter((a) => statusTone(a.raw) === 'ok').length
  return (
    <span className="mw-readiness">
      {axes.map((a) => (
        <ToneDot key={a.key} tone={statusTone(a.raw)} title={`${labels[a.key]}: ${a.raw || '—'}`} />
      ))}
      <span className="mw-readiness-count">
        {ready}/{axes.length}
      </span>
    </span>
  )
}

/** One script scene card in a compact row: title, subtitle and status. */
export function SceneMini({ scene, lang }: { scene: MuweaveElementSummaryV1; lang: string }) {
  return (
    <article className="mw-scene-mini">
      <div className="mw-spread">
        <span className="mw-title">{scene.title}</span>
        <StatusTag status={scene.status} lang={lang} />
      </div>
      {scene.subtitle ? <span className="mw-dsh-muted">{scene.subtitle}</span> : null}
    </article>
  )
}

/** One line of production counts: scenes · shots · assets ready · clips. */
export function ProgressLine({ digest, t }: { digest: DramaDigest; t: MuweaveTranslator }) {
  const ready = digest.assets.filter(assetIsReady).length
  const items: Array<[string, string]> = [
    [t('sessionScript'), String(digest.scenes.length)],
    [t('sessionShots'), String(digest.shots.length)],
    [t('sessionAssets'), `${ready}/${digest.assets.length} ${t('readinessReady')}`],
  ]
  return (
    <div role="group" aria-label={t('progressLabel')} className="mw-progress-line">
      <dl>
        {items.map(([k, v]) => (
          <div key={k} className="mw-progress-item">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
