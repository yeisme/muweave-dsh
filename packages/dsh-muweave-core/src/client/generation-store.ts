/**
 * Generation desk state shared by every bundled copy of core: one drawer, opened by the toolbar
 * pill or by a room button ("为此镜出图"). Lives on globalThis like the theater registry.
 */

import { useSyncExternalStore } from 'react'
import type { CapabilityStage, ProductionAnchorV1 } from '../protocol'

export interface GenerationOpenRequest {
  capabilityId?: string
  /** Prefill for the form; prompts stay in memory only, never in storage. */
  input?: Record<string, string | number | string[]>
  anchor?: ProductionAnchorV1
  stage?: CapabilityStage | readonly CapabilityStage[]
  slots?: number
}

export interface GenerationSnapshot {
  open: boolean
  /** Bumped on every openGeneration so the form re-applies a prefill. */
  nonce: number
  request?: GenerationOpenRequest
  /** Element that opened the drawer; focus returns here on close when still connected. */
  opener?: HTMLElement | null
  /** Bumped when a review links media to a shot, so rooms showing shots re-sync and reload. */
  mediaRevision?: number
}

interface Holder {
  snap: GenerationSnapshot
  listeners: Set<() => void>
}

declare global {
  // eslint-disable-next-line no-var
  var __YEISME_MUWEAVE_GENERATION__: Holder | undefined
}

function holder(): Holder {
  if (!globalThis.__YEISME_MUWEAVE_GENERATION__) {
    globalThis.__YEISME_MUWEAVE_GENERATION__ = { snap: { open: false, nonce: 0 }, listeners: new Set() }
  }
  return globalThis.__YEISME_MUWEAVE_GENERATION__
}

function set(snap: GenerationSnapshot): void {
  const h = holder()
  h.snap = snap
  for (const fn of h.listeners) fn()
}

/** Open the generation drawer, optionally prefilled; callable from any room. */
export function openGeneration(request?: GenerationOpenRequest, opener?: HTMLElement | null): void {
  const cur = holder().snap
  const active = typeof document === 'undefined' ? null : document.activeElement
  const from = opener ?? (active instanceof HTMLElement && active !== document.body ? active : null)
  set({ open: true, nonce: cur.nonce + 1, opener: from, ...(request ? { request } : {}) })
}

export function closeGeneration(): void {
  const cur = holder().snap
  if (cur.open) set({ ...cur, open: false })
}

/** A shot gained or lost linked media; rooms watching `mediaRevision` reload. */
export function notifyShotMediaChanged(): void {
  const cur = holder().snap
  set({ ...cur, mediaRevision: (cur.mediaRevision ?? 0) + 1 })
}

export function getGenerationSnapshot(): GenerationSnapshot {
  return holder().snap
}

export function useGenerationStore(): GenerationSnapshot {
  return useSyncExternalStore(
    (fn) => {
      const h = holder()
      h.listeners.add(fn)
      return () => {
        h.listeners.delete(fn)
      }
    },
    getGenerationSnapshot,
    getGenerationSnapshot,
  )
}
