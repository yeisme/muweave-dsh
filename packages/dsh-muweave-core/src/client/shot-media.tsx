/** Storyboard shot helpers shared by the 成稿 room and the drama grid (docs/design/creator-platform-v1.md). */

import type { ReactNode } from 'react'
import type { ProductionAnchorV1 } from '../protocol'
import type { MuweaveTranslator } from './i18n'
import { openGeneration } from './generation-store'
import { tr } from './generation-jobs'
import { useMediaUrl } from './media'
import type { MuweaveRpcClient } from './rpc-client'

/** One `shotMedia` link carried on a `drama.storyboard_table` row (keyframe first). */
export interface LinkedMediaRef {
  sha256?: string
  elementId?: string
  artifactId?: string
  role: string
  mime?: string
}

/** The keyframe digest to show: the first image link that carries bytes. */
export function keyframeDigest(linked: readonly LinkedMediaRef[] | undefined): string | undefined {
  return linked?.find((m) => m.sha256 && (!m.mime || m.mime.startsWith('image/')) && (m.role === 'keyframe' || m.role === 'reference'))?.sha256
}

/** Linked keyframe image when present, else the typographic poster the caller passes. */
export function ShotMedia({
  rpc,
  linked,
  alt,
  poster,
}: {
  rpc: MuweaveRpcClient
  linked: readonly LinkedMediaRef[] | undefined
  alt: string
  poster: ReactNode
}) {
  const url = useMediaUrl(rpc, keyframeDigest(linked))
  return url ? <img className="mw-shot-img" src={url} alt={alt} loading="lazy" data-muweave-shot-image="true" /> : <>{poster}</>
}

const DESC_KEY = /desc|画面|内容|visual|action|summary|scene|镜头/i

/** Short shot description for a prompt prefill, from the row's visible (non-restricted) cells. */
export function shotDescription(cells: Record<string, unknown>, restricted: readonly string[] = []): string {
  const visible = Object.entries(cells).filter(([k, v]) => !restricted.includes(k) && typeof v === 'string' && v.trim())
  const best = visible.find(([k]) => DESC_KEY.test(k)) ?? visible[0]
  return best ? String(best[1]) : ''
}

export function ShotGenerateButton({
  t,
  shotRef,
  prompt,
  anchor,
}: {
  t: MuweaveTranslator
  shotRef: string
  prompt: string
  anchor: ProductionAnchorV1
}) {
  return (
    <button
      type="button"
      className="mw-dsh-btn"
      data-variant="quiet"
      data-size="sm"
      data-muweave-shot-generate={shotRef}
      onClick={(ev) =>
        openGeneration(
          {
            capabilityId: 'eikona.image.generate',
            input: { prompt },
            anchor: { ...anchor, shotRef },
            stage: ['visual', 'storyboard', 'sound'],
          },
          ev.currentTarget,
        )
      }
    >
      {tr(t, 'genForShot')}
    </button>
  )
}
