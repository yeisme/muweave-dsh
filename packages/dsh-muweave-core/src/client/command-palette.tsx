/**
 * Desk v3 command palette (docs/design/desk-v3.md): ⌘K opens one searchable list of rooms, stage
 * views and shell actions so the toolbar does not have to carry them all. Pure presentation: the
 * shell owns what the commands do, this file owns matching, keyboard movement and focus return.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { MuweaveTranslator } from './i18n'
import { Icon, type MuweaveIconName } from './ui'

const RECENT_COMMANDS_KEY = 'muweave.cmdk.recent.v1'
const RECENT_COMMANDS_LIMIT = 5

export interface CommandPaletteItem {
  id: string
  group: string
  label: string
  hint?: string
  icon?: MuweaveIconName
  current?: boolean
  run: () => void
}

/** Case-insensitive subsequence match so "总览" and "zlan" both reach 总览. */
function matches(label: string, query: string): boolean {
  const haystack = label.toLowerCase()
  const needle = query.toLowerCase()
  if (!needle) return true
  if (haystack.includes(needle)) return true
  let i = 0
  for (const ch of needle) {
    i = haystack.indexOf(ch, i)
    if (i < 0) return false
    i += 1
  }
  return true
}

export function CommandPalette({
  open,
  items,
  t,
  onClose,
}: {
  open: boolean
  items: readonly CommandPaletteItem[]
  t: MuweaveTranslator
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recentIds, setRecentIds] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<{ item: CommandPaletteItem; x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const restoreRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveIndex(0)
      return undefined
    }
    restoreRef.current = typeof document === 'undefined' ? null : document.activeElement
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      cancelAnimationFrame(raf)
      const back = restoreRef.current
      if (back instanceof HTMLElement && back.isConnected) back.focus()
    }
  }, [open])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = JSON.parse(window.localStorage.getItem(RECENT_COMMANDS_KEY) ?? '[]')
      if (Array.isArray(stored)) setRecentIds(stored.filter((id): id is string => typeof id === 'string').slice(0, RECENT_COMMANDS_LIMIT))
    } catch {
      setRecentIds([])
    }
  }, [])

  const actionGroup = t('commandGroupActions')
  const recentGroup = t('commandGroupRecent')
  const actionOnly = query.startsWith('>')
  const matchQuery = actionOnly ? query.slice(1).trimStart() : query
  const filtered = useMemo(() => {
    const candidates = actionOnly ? items.filter((item) => item.group === actionGroup) : items
    const matched = candidates.filter((item) => matches(`${item.label} ${item.hint ?? ''}`, matchQuery))
    if (actionOnly) return matched
    const recent = recentIds
      .map((id) => matched.find((item) => item.id === id))
      .filter((item): item is CommandPaletteItem => Boolean(item))
    const recentSet = new Set(recent.map((item) => item.id))
    return [...recent.map((item) => ({ ...item, group: recentGroup })), ...matched.filter((item) => !recentSet.has(item.id))]
  }, [actionGroup, actionOnly, items, matchQuery, recentGroup, recentIds])

  const grouped = useMemo(() => {
    const groups: Array<{ group: string; rows: Array<{ item: CommandPaletteItem; index: number }> }> = []
    filtered.forEach((item, index) => {
      const last = groups[groups.length - 1]
      if (last && last.group === item.group) last.rows.push({ item, index })
      else groups.push({ group: item.group, rows: [{ item, index }] })
    })
    return groups
  }, [filtered])

  useEffect(() => {
    setActiveIndex((n) => (filtered.length === 0 ? 0 : Math.min(n, filtered.length - 1)))
  }, [filtered.length])

  if (!open) return null
  // Portal out of `.mw-dsh-root`: its `container-type` makes it the containing block for fixed
  // descendants, which would place the palette inside the scrolled canvas instead of the viewport.
  const host = typeof document === 'undefined' ? undefined : document.body

  const run = (item: CommandPaletteItem) => {
    const nextRecent = [item.id, ...recentIds.filter((id) => id !== item.id)].slice(0, RECENT_COMMANDS_LIMIT)
    setRecentIds(nextRecent)
    try {
      window.localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(nextRecent))
    } catch {
      // localStorage can be unavailable in private or embedded contexts.
    }
    onClose()
    item.run()
  }

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      onClose()
      return
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      if (filtered.length === 0) return
      const delta = ev.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((n) => (n + delta + filtered.length) % filtered.length)
      return
    }
    if (ev.key === 'Tab') {
      const item = filtered[activeIndex]
      if (item) {
        ev.preventDefault()
        // Completing must not swallow the `>` action prefix the user typed.
        setQuery(actionOnly ? `>${item.label}` : item.label)
        setActiveIndex(0)
      }
      return
    }
    if (ev.key === 'Enter') {
      ev.preventDefault()
      const item = filtered[activeIndex]
      if (item) run(item)
    }
  }

  const overlay = (
    <div
      className="mw-cmdk"
      role="presentation"
      data-muweave-command-palette="true"
      onClick={() => setContextMenu(null)}
    >
      <div className="mw-cmdk-scrim" role="presentation" onClick={onClose} />
      <div
        ref={panelRef}
        className="mw-cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette')}
        onKeyDown={onKeyDown}
      >
        <div className="mw-cmdk-field">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="mw-cmdk-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="mw-cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={filtered[activeIndex] ? `mw-cmdk-${filtered[activeIndex]!.id}` : undefined}
            placeholder={actionOnly ? t('commandActionHint') : t('commandPlaceholder')}
            value={query}
            onChange={(ev) => {
              setQuery(ev.target.value)
              setActiveIndex(0)
            }}
          />
        </div>
        <ul className="mw-cmdk-list" role="listbox" id="mw-cmdk-list" aria-label={t('commandPalette')}>
          {filtered.length === 0 ? (
            <li className="mw-cmdk-empty">{t('commandEmpty')}</li>
          ) : (
            grouped.map((section) => (
              <li key={section.group} role="presentation">
                <p className="mw-cmdk-group">{section.group}</p>
                <ul role="presentation">
                  {section.rows.map(({ item, index }) => (
                    <li key={item.id} role="presentation">
                      <button
                        type="button"
                        id={`mw-cmdk-${item.id}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        className="mw-cmdk-row"
                        data-active={index === activeIndex ? 'true' : undefined}
                        onMouseMove={() => setActiveIndex(index)}
                        onClick={() => run(item)}
                        onDoubleClick={() => run(item)}
                        onContextMenu={(ev) => {
                          ev.preventDefault()
                          setContextMenu({ item, x: ev.clientX, y: ev.clientY })
                        }}
                      >
                        {item.icon ? <Icon name={item.icon} /> : null}
                        <span className="mw-cmdk-label">{item.label}</span>
                        {item.hint ? <span className="mw-cmdk-hint">{item.hint}</span> : null}
                        {item.current ? (
                          <span className="mw-cmdk-current" aria-hidden="true">
                            <Icon name="check" />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))
          )}
        </ul>
        <p className="mw-cmdk-footer">{t('commandFooter')}</p>
      </div>
      {contextMenu ? (
        <div
          className="mw-cmdk-panel"
          role="menu"
          aria-label={t('langCode') === 'en' ? 'Command actions' : '命令操作'}
          // Position travels as custom properties: the static guard only allows --mw-* inline values.
          style={{ '--mw-menu-x': `${contextMenu.x}px`, '--mw-menu-y': `${contextMenu.y}px` } as CSSProperties}
          onClick={(ev) => ev.stopPropagation()}
        >
          <button
            type="button"
            className="mw-cmdk-row"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard?.writeText(contextMenu.item.id).catch(() => undefined)
              setContextMenu(null)
            }}
          >
            {t('langCode') === 'en' ? 'Copy command name' : '复制命令名'}
          </button>
        </div>
      ) : null}
    </div>
  )
  return host ? createPortal(overlay, host) : null
}
