import { createContext, useSyncExternalStore, type ComponentType, type Context, type ReactNode } from 'react'

/**
 * Cross-bundle theater state. Every MuWeave plugin bundles its own copy of core, so the room
 * list, the active room and the shared-registration seats live on `globalThis`.
 *
 * Seats: a shared registration (the theater entry, the floating agent, the triggers) is made
 * by exactly one plugin ctx at a time. Every live plugin queues a claim closure; when the owner
 * leaves, the next queued plugin claims, so the entry never disappears or doubles while any
 * MuWeave plugin is still running.
 */

export const THEATER_PANEL_ID = 'muweave-theater'
export const THEATER_COMPANION_ID = 'muweave-theater/companion'
export const THEATER_ROOM_STORAGE_KEY = 'muweave.theater.room'

export interface TheaterRoom {
  id: string
  order: number
  /** Short switcher name: 总览 / 视觉 / 剧本 / 分镜生产 / 工具箱. */
  title: () => string
  /** One line under the name in the switcher menu (the old page title). */
  description: () => string
  icon: ComponentType<{ size?: number; active?: boolean }>
  /** Element domains this room owns; used to jump from an @ chip to the right room. */
  domains: readonly string[]
  Main: ComponentType
  Companion: ComponentType
}

export interface TheaterChrome {
  /** Replaces the page `<h1>`: the room switcher. */
  switcher: ReactNode
  /** Appended to the page toolbar: "back to conversation". */
  trailing: ReactNode
}

type SeatClaim = () => (() => void) | void

interface Seat {
  id: number
  claim: SeatClaim
}

interface SeatQueue {
  seats: Seat[]
  ownerId?: number
  release?: () => void
}

export type TheaterRoomBadgeTone = 'info' | 'warn' | 'bad'

export interface TheaterRoomBadge {
  count: number
  tone?: TheaterRoomBadgeTone
}

interface TheaterHolder {
  v: 1
  nextId: number
  rooms: Map<string, TheaterRoom>
  roomsSnapshot: readonly TheaterRoom[]
  activeRoomId: string | null
  badges: Readonly<Record<string, TheaterRoomBadge>>
  queues: Map<string, SeatQueue>
  listeners: Set<() => void>
  chrome: Context<TheaterChrome | null>
}

declare global {
  // eslint-disable-next-line no-var
  var __YEISME_MUWEAVE_THEATER__: TheaterHolder | undefined
}

function readStoredRoom(): string | null {
  try {
    return globalThis.localStorage?.getItem(THEATER_ROOM_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function holder(): TheaterHolder {
  if (!globalThis.__YEISME_MUWEAVE_THEATER__) {
    globalThis.__YEISME_MUWEAVE_THEATER__ = {
      v: 1,
      nextId: 1,
      rooms: new Map(),
      roomsSnapshot: [],
      activeRoomId: readStoredRoom(),
      badges: {},
      queues: new Map(),
      listeners: new Set(),
      chrome: createContext<TheaterChrome | null>(null),
    }
  }
  return globalThis.__YEISME_MUWEAVE_THEATER__
}

function notify(): void {
  for (const fn of holder().listeners) fn()
}

/** React context shared by every bundled copy of WorkspaceShell. */
export function theaterChromeContext(): Context<TheaterChrome | null> {
  return holder().chrome
}

export function subscribeTheater(listener: () => void): () => void {
  const h = holder()
  h.listeners.add(listener)
  return () => {
    h.listeners.delete(listener)
  }
}

export function getTheaterRooms(): readonly TheaterRoom[] {
  return holder().roomsSnapshot
}

export function registerTheaterRoom(room: TheaterRoom): () => void {
  const h = holder()
  h.rooms.set(room.id, room)
  h.roomsSnapshot = [...h.rooms.values()].sort((a, b) => a.order - b.order)
  notify()
  return () => {
    const cur = holder()
    if (cur.rooms.get(room.id) !== room) return
    cur.rooms.delete(room.id)
    cur.roomsSnapshot = [...cur.rooms.values()].sort((a, b) => a.order - b.order)
    notify()
  }
}

/** The room to show: the chosen one if it is still registered, else the first room. */
export function getActiveTheaterRoomId(): string | null {
  const h = holder()
  if (h.activeRoomId && h.rooms.has(h.activeRoomId)) return h.activeRoomId
  return h.roomsSnapshot[0]?.id ?? null
}

export function setActiveTheaterRoom(roomId: string): void {
  const h = holder()
  if (h.activeRoomId === roomId) return
  h.activeRoomId = roomId
  try {
    globalThis.localStorage?.setItem(THEATER_ROOM_STORAGE_KEY, roomId)
  } catch {
    // Storage may be unavailable (private mode); the choice still holds for this page.
  }
  notify()
}

/** Navigate to a theater room by id (wraps `setActiveTheaterRoom`). */
export function navigateToTheaterRoom(roomId: string): void {
  if (!roomId) return
  setActiveTheaterRoom(roomId)
}

export function getTheaterRoomBadges(): Readonly<Record<string, TheaterRoomBadge>> {
  const h = holder()
  if (!h.badges) h.badges = {}
  return h.badges
}

/** Publish partial room badge counts (e.g. needs_revision shots) for theater navigation pills. */
export function publishTheaterRoomBadges(
  partial: Partial<Record<string, TheaterRoomBadge | undefined>>,
): void {
  const h = holder()
  const prev = h.badges ?? {}
  let changed = false
  const next: Record<string, TheaterRoomBadge> = { ...prev }
  for (const [roomId, badge] of Object.entries(partial)) {
    if (!badge || badge.count <= 0) {
      if (roomId in next) {
        delete next[roomId]
        changed = true
      }
    } else {
      const existing = next[roomId]
      if (!existing || existing.count !== badge.count || existing.tone !== badge.tone) {
        next[roomId] = { count: badge.count, ...(badge.tone ? { tone: badge.tone } : {}) }
        changed = true
      }
    }
  }
  if (!changed) return
  h.badges = next
  notify()
}

export function useTheaterRoomBadges(): Readonly<Record<string, TheaterRoomBadge>> {
  return useSyncExternalStore(subscribeTheater, getTheaterRoomBadges, getTheaterRoomBadges)
}

export function roomIdForDomain(domain: string | undefined): string | undefined {
  if (!domain) return undefined
  return holder().roomsSnapshot.find((r) => r.domains.includes(domain))?.id
}

function claimNext(queue: SeatQueue): void {
  queue.ownerId = undefined
  queue.release = undefined
  for (const seat of queue.seats) {
    try {
      const release = seat.claim()
      queue.ownerId = seat.id
      queue.release = typeof release === 'function' ? release : undefined
      return
    } catch {
      // This plugin could not register (its ctx is already tearing down); try the next one.
    }
  }
}

/**
 * Queue a claim for the shared registration `key`. Returns the leave function: if this seat
 * owns the registration it is released and handed to the next queued seat.
 */
export function joinTheaterSeat(key: string, claim: SeatClaim): () => void {
  const h = holder()
  let queue = h.queues.get(key)
  if (!queue) {
    queue = { seats: [] }
    h.queues.set(key, queue)
  }
  const seat: Seat = { id: h.nextId++, claim }
  queue.seats.push(seat)
  if (queue.ownerId === undefined) claimNext(queue)

  return () => {
    const q = holder().queues.get(key)
    if (!q) return
    q.seats = q.seats.filter((s) => s.id !== seat.id)
    if (q.ownerId !== seat.id) return
    const release = q.release
    q.ownerId = undefined
    q.release = undefined
    try {
      release?.()
    } finally {
      claimNext(q)
    }
  }
}

/** Test helper: which seat id owns `key` (undefined when nobody does). */
export function theaterSeatOwner(key: string): number | undefined {
  return holder().queues.get(key)?.ownerId
}
