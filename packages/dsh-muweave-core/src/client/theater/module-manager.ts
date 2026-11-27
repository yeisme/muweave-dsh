/**
 * Cross-bundle header module layout manager: role presets, pin/unpin, reorder, localStorage cache,
 * and fail-safe `workspace.tabs.get/save/reset` RPC sync.
 */

import { useSyncExternalStore } from 'react'
import type { TheaterRoomGroup, WorkspaceTabPresetId, WorkspaceTabsConfigV1 } from '../../protocol'
import type { MuweaveRpcClient } from '../rpc-client'
import type { TheaterRoom } from './registry'

export const THEATER_TABS_STORAGE_KEY = 'muweave.theater.tabs.v1'

export interface ModulePresetDef {
  id: WorkspaceTabPresetId
  labelZh: string
  labelEn: string
  /** Empty means pin all registered rooms. */
  pinnedRoomIds: readonly string[]
}

export const MODULE_PRESETS: readonly ModulePresetDef[] = [
  {
    id: 'default',
    labelZh: '全部模块',
    labelEn: 'All Modules',
    pinnedRoomIds: [],
  },
  {
    id: 'director',
    labelZh: '导演精简',
    labelEn: 'Director',
    pinnedRoomIds: ['muweave-workbench', 'muweave-script', 'muweave-drama', 'muweave-stage3d', 'muweave-draft'],
  },
  {
    id: 'writer',
    labelZh: '编剧与画布',
    labelEn: 'Writer & Canvas',
    pinnedRoomIds: ['muweave-workbench', 'muweave-script', 'muweave-canvas', 'muweave-drama', 'muweave-draft'],
  },
  {
    id: 'visual_3d',
    labelZh: '美术与 3D',
    labelEn: 'Visual & 3D',
    pinnedRoomIds: ['muweave-workbench', 'muweave-eikona', 'muweave-canvas', 'muweave-stage3d', 'muweave-assets', 'muweave-drama'],
  },
  {
    id: 'full_studio',
    labelZh: '全流程制片',
    labelEn: 'Full Studio',
    pinnedRoomIds: [
      'muweave-workbench',
      'muweave-eikona',
      'muweave-script',
      'muweave-drama',
      'muweave-draft',
      'muweave-canvas',
      'muweave-stage3d',
      'muweave-audio',
      'muweave-assets',
      'muweave-kit',
      'muweave-schedule',
    ],
  },
]

export interface ModuleLayoutState {
  preset: WorkspaceTabPresetId
  /** Empty array = all registered rooms are pinned. */
  pinnedRoomIds: readonly string[]
  orderIds: readonly string[]
  revision?: string
}

interface ModuleLayoutHolder {
  state: ModuleLayoutState
  listeners: Set<() => void>
}

declare global {
  // eslint-disable-next-line no-var
  var __YEISME_MUWEAVE_TABS__: ModuleLayoutHolder | undefined
}

const STUDIO_ROOM_IDS = new Set(['muweave-canvas', 'muweave-stage3d', 'muweave-audio', 'muweave-assets'])
const OPS_ROOM_IDS = new Set(['muweave-kit', 'muweave-schedule'])

export function inferTheaterRoomGroup(roomId: string): TheaterRoomGroup {
  if (STUDIO_ROOM_IDS.has(roomId)) return 'studio'
  if (OPS_ROOM_IDS.has(roomId)) return 'ops'
  return 'core'
}

const DEFAULT_STATE: ModuleLayoutState = {
  preset: 'default',
  pinnedRoomIds: [],
  orderIds: [],
}

function readStoredLayout(): ModuleLayoutState {
  try {
    const raw = globalThis.localStorage?.getItem(THEATER_TABS_STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<ModuleLayoutState>
    return {
      preset: typeof parsed.preset === 'string' ? (parsed.preset as WorkspaceTabPresetId) : 'default',
      pinnedRoomIds: Array.isArray(parsed.pinnedRoomIds)
        ? parsed.pinnedRoomIds.filter((x): x is string => typeof x === 'string')
        : [],
      orderIds: Array.isArray(parsed.orderIds)
        ? parsed.orderIds.filter((x): x is string => typeof x === 'string')
        : [],
      ...(typeof parsed.revision === 'string' ? { revision: parsed.revision } : {}),
    }
  } catch {
    return DEFAULT_STATE
  }
}

function writeStoredLayout(state: ModuleLayoutState): void {
  try {
    globalThis.localStorage?.setItem(THEATER_TABS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore storage errors in private mode
  }
}

function getHolder(): ModuleLayoutHolder {
  if (!globalThis.__YEISME_MUWEAVE_TABS__) {
    globalThis.__YEISME_MUWEAVE_TABS__ = {
      state: readStoredLayout(),
      listeners: new Set(),
    }
  }
  return globalThis.__YEISME_MUWEAVE_TABS__
}

function setLayoutState(next: ModuleLayoutState): void {
  const h = getHolder()
  h.state = next
  writeStoredLayout(next)
  for (const fn of h.listeners) fn()
}

export function subscribeModuleLayout(listener: () => void): () => void {
  const h = getHolder()
  h.listeners.add(listener)
  return () => {
    h.listeners.delete(listener)
  }
}

export function getModuleLayoutState(): ModuleLayoutState {
  return getHolder().state
}

export function useModuleLayoutState(): ModuleLayoutState {
  return useSyncExternalStore(subscribeModuleLayout, getModuleLayoutState, getModuleLayoutState)
}

function applyRpcConfig(cfg: WorkspaceTabsConfigV1): void {
  setLayoutState({
    preset: cfg.presetId ?? 'default',
    pinnedRoomIds: Array.isArray(cfg.pinnedRoomIds) ? cfg.pinnedRoomIds : [],
    orderIds: Array.isArray(cfg.roomOrder) ? cfg.roomOrder : [],
    revision: cfg.revision,
  })
}

export async function syncModuleLayoutFromRpc(rpc: MuweaveRpcClient): Promise<void> {
  try {
    const res = await rpc.call<{ config?: WorkspaceTabsConfigV1 }>('workspace.tabs.get', {})
    if (res.ok && res.data?.config) {
      applyRpcConfig(res.data.config)
    }
  } catch {
    // fail-safe when offline or mocked
  }
}

async function persistLayoutToRpc(state: ModuleLayoutState, rpc?: MuweaveRpcClient): Promise<void> {
  if (!rpc) return
  try {
    const res = await rpc.call<{ config?: WorkspaceTabsConfigV1 }>('workspace.tabs.save', {
      presetId: state.preset,
      pinnedRoomIds: [...state.pinnedRoomIds],
      roomOrder: [...state.orderIds],
      ...(state.revision ? { expectedRevision: state.revision } : {}),
    })
    if (res.ok && res.data?.config) {
      applyRpcConfig(res.data.config)
    }
  } catch {
    // keep local state even if host is unreachable
  }
}

export function applyModulePreset(
  presetId: WorkspaceTabPresetId,
  rooms: readonly TheaterRoom[],
  rpc?: MuweaveRpcClient,
): void {
  const def = MODULE_PRESETS.find((p) => p.id === presetId) ?? MODULE_PRESETS[0]!
  const registered = new Set(rooms.map((r) => r.id))
  const pinned =
    def.pinnedRoomIds.length === 0
      ? []
      : def.pinnedRoomIds.filter((id) => registered.has(id))
  const cur = getModuleLayoutState()
  const next: ModuleLayoutState = {
    preset: def.id,
    pinnedRoomIds: pinned,
    orderIds: cur.orderIds,
    ...(cur.revision ? { revision: cur.revision } : {}),
  }
  setLayoutState(next)
  void persistLayoutToRpc(next, rpc)
}

export function togglePinModule(
  roomId: string,
  rooms: readonly TheaterRoom[],
  rpc?: MuweaveRpcClient,
): void {
  const cur = getModuleLayoutState()
  const basePinned =
    cur.pinnedRoomIds.length === 0 ? rooms.map((r) => r.id) : [...cur.pinnedRoomIds]
  const exists = basePinned.includes(roomId)
  const nextPinned = exists ? basePinned.filter((id) => id !== roomId) : [...basePinned, roomId]
  // Never allow unpinning the very last visible room.
  if (nextPinned.length === 0) return
  const next: ModuleLayoutState = {
    preset: 'custom',
    pinnedRoomIds: nextPinned,
    orderIds: cur.orderIds,
    ...(cur.revision ? { revision: cur.revision } : {}),
  }
  setLayoutState(next)
  void persistLayoutToRpc(next, rpc)
}

export function moveModuleOrder(
  roomId: string,
  delta: -1 | 1,
  rooms: readonly TheaterRoom[],
  rpc?: MuweaveRpcClient,
): void {
  const cur = getModuleLayoutState()
  const ordered = orderRooms(rooms, cur.orderIds).map((r) => r.id)
  const idx = ordered.indexOf(roomId)
  const target = idx + delta
  if (idx < 0 || target < 0 || target >= ordered.length) return
  const nextOrder = [...ordered]
  const [moved] = nextOrder.splice(idx, 1)
  nextOrder.splice(target, 0, moved!)
  const next: ModuleLayoutState = {
    preset: 'custom',
    pinnedRoomIds: cur.pinnedRoomIds,
    orderIds: nextOrder,
    ...(cur.revision ? { revision: cur.revision } : {}),
  }
  setLayoutState(next)
  void persistLayoutToRpc(next, rpc)
}

export function resetModuleLayout(rpc?: MuweaveRpcClient): void {
  setLayoutState(DEFAULT_STATE)
  if (!rpc) return
  void rpc
    .call<{ config?: WorkspaceTabsConfigV1 }>('workspace.tabs.reset', {})
    .then((res) => {
      if (res.ok && res.data?.config) applyRpcConfig(res.data.config)
    })
    .catch(() => undefined)
}

function orderRooms(rooms: readonly TheaterRoom[], orderIds: readonly string[]): TheaterRoom[] {
  if (orderIds.length === 0) return [...rooms]
  const rank = new Map(orderIds.map((id, idx) => [id, idx]))
  return [...rooms].sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.order - b.order
  })
}

/** Resolve visible header rooms in customized order, keeping an active unpinned room temporarily visible. */
export function resolveVisibleHeaderRooms(
  rooms: readonly TheaterRoom[],
  state: ModuleLayoutState,
  activeId: string | null,
): TheaterRoom[] {
  const ordered = orderRooms(rooms, state.orderIds)
  if (state.pinnedRoomIds.length === 0) return ordered
  const pinnedSet = new Set(state.pinnedRoomIds)
  const visible = ordered.filter((r) => pinnedSet.has(r.id))
  if (activeId && !pinnedSet.has(activeId)) {
    const activeRoom = ordered.find((r) => r.id === activeId)
    if (activeRoom) visible.push(activeRoom)
  }
  return visible.length > 0 ? visible : ordered
}

const GROUP_ORDER: readonly TheaterRoomGroup[] = ['core', 'studio', 'ops']

export function groupHeaderRooms(
  visibleRooms: readonly TheaterRoom[],
): Array<{ group: TheaterRoomGroup; rooms: TheaterRoom[] }> {
  const buckets = new Map<TheaterRoomGroup, TheaterRoom[]>()
  for (const g of GROUP_ORDER) buckets.set(g, [])
  for (const room of visibleRooms) {
    const g = room.group ?? inferTheaterRoomGroup(room.id)
    const list = buckets.get(g) ?? buckets.get('core')!
    list.push(room)
  }
  return GROUP_ORDER.map((group) => ({ group, rooms: buckets.get(group) ?? [] })).filter(
    (entry) => entry.rooms.length > 0,
  )
}
