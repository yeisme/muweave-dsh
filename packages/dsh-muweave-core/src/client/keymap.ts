import { useCallback, useEffect, useRef } from 'react'

export type KeymapScope = 'global' | 'calendar' | 'palette' | 'stage'

export interface KeyBinding {
  id: string
  keys: string[]
  scope: KeymapScope
  labelZh: string
  labelEn: string
  run?: never
}

export const MUWEAVE_KEYMAP: readonly KeyBinding[] = [
  { id: 'command-palette', keys: ['mod+k'], scope: 'global', labelZh: '打开命令面板', labelEn: 'Open command palette' },
  { id: 'keymap-help', keys: ['shift+?'], scope: 'global', labelZh: '打开快捷键帮助', labelEn: 'Open keyboard shortcut help' },
  { id: 'agent-input', keys: ['/'], scope: 'global', labelZh: '聚焦幕织助手', labelEn: 'Focus creator agent' },
  { id: 'room-1', keys: ['alt+1'], scope: 'global', labelZh: '跳到房间 1', labelEn: 'Jump to room 1' },
  { id: 'room-2', keys: ['alt+2'], scope: 'global', labelZh: '跳到房间 2', labelEn: 'Jump to room 2' },
  { id: 'room-3', keys: ['alt+3'], scope: 'global', labelZh: '跳到房间 3', labelEn: 'Jump to room 3' },
  { id: 'room-4', keys: ['alt+4'], scope: 'global', labelZh: '跳到房间 4', labelEn: 'Jump to room 4' },
  { id: 'room-5', keys: ['alt+5'], scope: 'global', labelZh: '跳到房间 5', labelEn: 'Jump to room 5' },
  { id: 'room-6', keys: ['alt+6'], scope: 'global', labelZh: '跳到房间 6', labelEn: 'Jump to room 6' },
  { id: 'room-7', keys: ['alt+7'], scope: 'global', labelZh: '跳到房间 7', labelEn: 'Jump to room 7' },
  { id: 'room-8', keys: ['alt+8'], scope: 'global', labelZh: '跳到房间 8', labelEn: 'Jump to room 8' },
  { id: 'room-9', keys: ['alt+9'], scope: 'global', labelZh: '跳到房间 9', labelEn: 'Jump to room 9' },
  { id: 'calendar-go', keys: ['g', 'd'], scope: 'calendar', labelZh: '跳到排期', labelEn: 'Go to schedule' },
  { id: 'palette-down', keys: ['ArrowDown'], scope: 'palette', labelZh: '选择下一项', labelEn: 'Move selection down' },
  { id: 'palette-up', keys: ['ArrowUp'], scope: 'palette', labelZh: '选择上一项', labelEn: 'Move selection up' },
  { id: 'palette-complete', keys: ['Tab'], scope: 'palette', labelZh: '补全当前命令', labelEn: 'Complete current command' },
  { id: 'palette-run', keys: ['Enter'], scope: 'palette', labelZh: '执行当前命令', labelEn: 'Run current command' },
  { id: 'close-overlay', keys: ['Escape'], scope: 'palette', labelZh: '关闭覆盖层', labelEn: 'Close overlay' },
  // Desk v8 P2: Overview stage accelerators. Each one mirrors a visible button or row (NN/g accelerators).
  { id: 'stage-next', keys: ['j'], scope: 'stage', labelZh: '下一阶段', labelEn: 'Next stage' },
  { id: 'stage-prev', keys: ['k'], scope: 'stage', labelZh: '上一阶段', labelEn: 'Previous stage' },
  { id: 'stage-jump', keys: ['g', '1-5'], scope: 'stage', labelZh: '跳到第 N 阶段', labelEn: 'Jump to stage N' },
  { id: 'stage-compare', keys: ['c'], scope: 'stage', labelZh: '对比基线', labelEn: 'Compare baseline' },
  { id: 'stage-region-next', keys: ['Tab'], scope: 'stage', labelZh: '下一区块', labelEn: 'Next region' },
  { id: 'stage-region-prev', keys: ['shift+Tab'], scope: 'stage', labelZh: '上一区块', labelEn: 'Previous region' },
  { id: 'stage-dismiss', keys: ['Escape'], scope: 'stage', labelZh: '退出对比 / 关闭详情', labelEn: 'Close compare / inspector' },
] as const

export const keymap = MUWEAVE_KEYMAP

/** Looks a binding up by id; the stage surfaces read their keys from here instead of redeclaring them. */
export function keyBinding(id: string): KeyBinding | undefined {
  return MUWEAVE_KEYMAP.find((binding) => binding.id === id)
}

/** True for fields that own their keystrokes: single-letter accelerators must not fire while typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function defaultKeyHintPlatform(): 'mac' | 'other' {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? 'mac' : 'other'
}

/** Formats the portable key names used by the keymap for the current platform. */
export function formatKeyHint(keys: string, platform: 'mac' | 'other' = defaultKeyHintPlatform()): string {
  return keys
    .split('+')
    .map((part, index, all) => {
      const token = normalizeKey(part)
      if (token === 'mod') return platform === 'mac' ? '⌘' : 'Ctrl+'
      if (token === 'shift') return platform === 'mac' ? '⇧' : 'Shift+'
      if (token === 'alt') return platform === 'mac' ? '⌥' : 'Alt+'
      if (token === 'ctrl') return 'Ctrl+'
      if (token === 'meta') return '⌘'
      if (token === 'escape') return 'Esc'
      if (token === 'space') return 'Space'
      if (index < all.length - 1) return `${part}+`
      return token.length === 1 ? token.toUpperCase() : part
    })
    .join('')
    .replace(/\+$/, '')
}

function normalizeKey(key: string): string {
  const value = key.trim().toLowerCase()
  if (value === 'esc') return 'escape'
  if (value === ' ') return 'space'
  return value
}

function tokenMatches(event: KeyboardEvent, token: string): boolean {
  const parts = token.split('+').map(normalizeKey)
  const key = parts[parts.length - 1] ?? ''
  const modifiers = new Set(parts.slice(0, -1))
  const mod = event.metaKey || event.ctrlKey
  if (modifiers.has('mod') ? !mod : false) return false
  if (modifiers.has('shift') ? !event.shiftKey : event.shiftKey) return false
  if (modifiers.has('alt') ? !event.altKey : event.altKey) return false
  if (modifiers.has('ctrl') ? !event.ctrlKey : modifiers.has('mod') ? false : event.ctrlKey) return false
  if (modifiers.has('meta') ? !event.metaKey : modifiers.has('mod') ? false : event.metaKey) return false
  return normalizeKey(event.key) === key
}

/** Matches a single keyboard event against a binding. Sequence bindings are consumed by useKeySequence. */
export function matchKey(event: KeyboardEvent, binding: KeyBinding): boolean {
  return tokenMatches(event, binding.keys[0] ?? '')
}

export function groupBindings(bindings: readonly KeyBinding[]): Record<KeymapScope, KeyBinding[]> {
  const grouped: Record<KeymapScope, KeyBinding[]> = { global: [], calendar: [], palette: [], stage: [] }
  for (const binding of bindings) grouped[binding.scope].push(binding)
  return grouped
}

/** Returns a handler for two-part sequences without reading document, making it SSR safe. */
export function useKeySequence(handler: (sequence: string[]) => void, timeoutMs = 300): (event: KeyboardEvent) => boolean {
  const pendingRef = useRef<string[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clear = useCallback(() => {
    pendingRef.current = []
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    timerRef.current = undefined
  }, [])
  useEffect(() => clear, [clear])
  return useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false
    const key = normalizeKey(event.key)
    if (pendingRef.current.length === 0) {
      if (key !== 'g') return false
      pendingRef.current = ['g']
      timerRef.current = setTimeout(clear, timeoutMs)
      return true
    }
    const sequence = [...pendingRef.current, key]
    clear()
    handler(sequence)
    return true
  }, [clear, handler, timeoutMs])
}
