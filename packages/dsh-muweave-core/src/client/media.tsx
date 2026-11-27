/**
 * Real project imagery. Eikona candidates are the only owner that ships pixels today; every
 * room's hero borrows the first few through the short-TTL media route instead of faking art.
 */

import { useEffect, useState } from 'react'
import type { MuweaveElementSummaryV1, MuweaveElementV1 } from '../protocol'
import type { MuweaveRpcClient } from './rpc-client'
import { Icon } from './ui'

/** Image preview for one blob digest; resolves a media token and falls back to a quiet tile. */
export function MediaPreview({
  rpc,
  sha256,
  alt,
  pendingLabel,
  emptyLabel,
}: {
  rpc: MuweaveRpcClient
  sha256?: string
  alt: string
  pendingLabel: string
  emptyLabel: string
}) {
  const url = useMediaUrl(rpc, sha256)
  if (!sha256 || !url) {
    return (
      <div className="ek-thumb" data-empty="true">
        <Icon name="image" />
        <span>{sha256 ? pendingLabel : emptyLabel}</span>
      </div>
    )
  }
  return (
    <div className="ek-thumb">
      <img src={url} alt={alt} loading="lazy" />
    </div>
  )
}

export function useMediaUrl(rpc: MuweaveRpcClient, sha256: string | undefined, mimeType = 'image/png'): string | undefined {
  const [resolved, setResolved] = useState<{ rpc: MuweaveRpcClient; sha256: string; mimeType: string; url: string }>()
  useEffect(() => {
    setResolved(undefined)
    if (!sha256) return
    let cancelled = false
    void rpc.resolveMediaUrl(sha256, mimeType)
      .then((url) => {
        if (!cancelled && url) setResolved({ rpc, sha256, mimeType, url })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [rpc, sha256, mimeType])
  return resolved?.rpc === rpc && resolved.sha256 === sha256 && resolved.mimeType === mimeType ? resolved.url : undefined
}

export interface ProjectCoverRef {
  sha256: string
  alt: string
}

export interface ProjectCover extends ProjectCoverRef {
  url: string
}

// Digests only: media URLs expire, so each mount re-resolves through the rpc client's own cache.
const coverRefCache = new WeakMap<MuweaveRpcClient, Promise<ProjectCoverRef[]>>()

async function loadCoverRefs(rpc: MuweaveRpcClient): Promise<ProjectCoverRef[]> {
  const list = await rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { kind: 'eikona.candidate_group' })
  if (!list.ok) return []
  const refs: ProjectCoverRef[] = []
  for (const group of list.data.elements.slice(0, 4)) {
    const full = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: group.elementId })
    if (!full.ok) continue
    const cands = ((full.data.element.payload ?? {}) as { candidates?: Array<{ artifactId?: string; sha256?: string }> }).candidates ?? []
    for (const c of cands) {
      if (typeof c.sha256 === 'string' && c.sha256 && !refs.some((r) => r.sha256 === c.sha256)) {
        refs.push({ sha256: c.sha256, alt: c.artifactId ?? group.title })
      }
    }
  }
  return refs
}

/** Test seam: forget cached cover digests (a sync can bring new candidates). */
export function forgetProjectCovers(rpc: MuweaveRpcClient): void {
  coverRefCache.delete(rpc)
}

/**
 * First `count` resolved candidate images of the project. `undefined` while loading, `[]` when the
 * project has no pixels yet; callers then show a typographic poster rather than placeholder art.
 */
export function useProjectCovers(rpc: MuweaveRpcClient, count = 3): ProjectCover[] | undefined {
  const [covers, setCovers] = useState<ProjectCover[] | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    let pending = coverRefCache.get(rpc)
    if (!pending) {
      pending = loadCoverRefs(rpc).catch(() => [])
      coverRefCache.set(rpc, pending)
    }
    void pending.then(async (refs) => {
      const resolved: ProjectCover[] = []
      for (const ref of refs) {
        if (resolved.length >= count) break
        const url = await rpc.resolveMediaUrl(ref.sha256, 'image/png')
        if (url) resolved.push({ ...ref, url })
      }
      if (!cancelled) setCovers(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [rpc, count])
  return covers
}
