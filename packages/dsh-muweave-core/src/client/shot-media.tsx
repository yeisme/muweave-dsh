/** Storyboard shot helpers shared by the 成稿 room and the drama grid (docs/design/creator-platform-v1.md). */

import type { ReactNode } from 'react'
import type { CapabilityStage, ProductionAnchorV1 } from '../protocol'
import type { MuweaveTranslator } from './i18n'
import { openGeneration } from './generation-store'
import { tr } from './generation-jobs'
import { useMediaUrl } from './media'
import type { MuweaveRpcClient } from './rpc-client'

/** Canonical 6 media roles bound to a storyboard shot. */
export const SHOT_MEDIA_ROLE_LIST = ['keyframe', 'reference', 'video', 'voice', 'music', 'sfx'] as const

export type ShotMediaRole = (typeof SHOT_MEDIA_ROLE_LIST)[number]

/** One `shotMedia` link carried on a `drama.storyboard_table` row (keyframe first). */
export interface LinkedMediaRef {
  sha256?: string
  elementId?: string
  artifactId?: string
  role: string
  mime?: string
}

/** Return all linked media items matching a given role. */
export function mediaForRole(linked: readonly LinkedMediaRef[] | undefined, role: ShotMediaRole | string): LinkedMediaRef[] {
  if (!linked || linked.length === 0) return []
  return linked.filter((m) => m.role === role)
}

export interface ShotReadinessSummary {
  hasVisual: boolean
  hasVideo: boolean
  hasAudio: boolean
  rolesPresent: Set<string>
  filledCount: number
}

/** Summarize 6-role media readiness for a storyboard shot. */
export function shotReadinessSummary(linked: readonly LinkedMediaRef[] | undefined): ShotReadinessSummary {
  const rolesPresent = new Set<string>()
  for (const item of linked ?? []) {
    if (item.role) rolesPresent.add(item.role)
  }
  const hasVideo = rolesPresent.has('video')
  const hasVisual = rolesPresent.has('keyframe') || rolesPresent.has('reference') || hasVideo
  const hasAudio = rolesPresent.has('voice') || rolesPresent.has('music') || rolesPresent.has('sfx')
  const filledCount = SHOT_MEDIA_ROLE_LIST.filter((role) => rolesPresent.has(role)).length
  return { hasVisual, hasVideo, hasAudio, rolesPresent, filledCount }
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
  capabilityId = 'eikona.image.generate',
  label,
  stage = ['visual', 'storyboard', 'sound'],
}: {
  t: MuweaveTranslator
  shotRef: string
  prompt: string
  anchor: ProductionAnchorV1
  capabilityId?: string
  label?: string
  stage?: CapabilityStage[]
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
            capabilityId,
            input: { prompt },
            anchor: { ...anchor, shotRef },
            stage,
          },
          ev.currentTarget,
        )
      }
    >
      {label ?? tr(t, 'genForShot')}
    </button>
  )
}
