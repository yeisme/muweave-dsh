import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { MuweaveTranslator } from '../i18n'
import { EmptyState, Icon } from '../ui'
import {
  getActiveTheaterRoomId,
  getTheaterRooms,
  setActiveTheaterRoom,
  subscribeTheater,
  theaterChromeContext,
  type TheaterRoom,
} from './registry'

const holdSwitcherFocus = { pending: false }

export function useTheaterRooms(): readonly TheaterRoom[] {
  return useSyncExternalStore(subscribeTheater, getTheaterRooms, getTheaterRooms)
}

export function useActiveTheaterRoomId(): string | null {
  return useSyncExternalStore(subscribeTheater, getActiveTheaterRoomId, getActiveTheaterRoomId)
}

/**
 * Codex/Claude-style workspace switcher: the current room's icon and name with a chevron; the
 * menu lists every room with a one-line description and its Alt+N shortcut.
 */
export function RoomSwitcher({
  t,
  rooms,
  activeId,
  onSelect,
}: {
  t: MuweaveTranslator
  rooms: readonly TheaterRoom[]
  activeId: string | null
  onSelect: (roomId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const active = rooms.find((r) => r.id === activeId)

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }, [])

  // Picking another room remounts the room page and this switcher with it; the new
  // switcher takes focus on mount when the pick came from the menu.
  useEffect(() => {
    if (!holdSwitcherFocus.pending) return
    holdSwitcherFocus.pending = false
    buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    ;(checked ?? items?.[0])?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const move = (i: number) => {
      e.preventDefault()
      items[(i + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') move(at + 1)
    else if (e.key === 'ArrowUp') move(at - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(items.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'Tab') setOpen(false)
  }

  const ActiveIcon = active?.icon
  return (
    <div className="mw-room-switch" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="mw-room-switch-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t('theaterSwitchRoom')}: ${active?.title() ?? t('theaterTitle')}`}
        data-muweave-room-switcher="true"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="mw-room-icon" aria-hidden="true">
          {ActiveIcon ? <ActiveIcon size={16} active /> : <Icon name="theater" />}
        </span>
        <span className="mw-room-switch-text">
          <span className="mw-room-switch-eyebrow">{t('theaterTitle')}</span>
          <span className="mw-room-switch-name">{active?.title() ?? t('theaterTitle')}</span>
        </span>
        <Icon name="chevronDown" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="mw-room-menu"
          role="menu"
          aria-label={t('theaterRoomsMenu')}
          onKeyDown={onMenuKeyDown}
        >
          {rooms.map((room, i) => {
            const RoomIcon = room.icon
            const checked = room.id === activeId
            return (
              <button
                key={room.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                className="mw-room-item"
                data-room-id={room.id}
                onClick={() => {
                  if (room.id !== activeId) holdSwitcherFocus.pending = true
                  onSelect(room.id)
                  close(true)
                }}
              >
                <span className="mw-room-icon" aria-hidden="true">
                  <RoomIcon size={16} active={checked} />
                </span>
                <span className="mw-room-item-text">
                  <span className="mw-room-item-name">{room.title()}</span>
                  <span className="mw-room-item-desc">{room.description()}</span>
                </span>
                {i < 9 ? (
                  <kbd className="mw-kbd" aria-hidden="true">
                    Alt+{i + 1}
                  </kbd>
                ) : null}
                <span className="mw-room-check" aria-hidden="true">
                  {checked ? <Icon name="check" /> : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Glass pill navigation: every room is one pill, the current room is ink-filled. Shown on wide
 * stages; a container query hides it on narrow ones, where the menu switcher remains.
 */
export function RoomNav({
  t,
  rooms,
  activeId,
  onSelect,
}: {
  t: MuweaveTranslator
  rooms: readonly TheaterRoom[]
  activeId: string | null
  onSelect: (roomId: string) => void
}) {
  return (
    <nav className="mw-room-nav" aria-label={t('theaterRoomsNav')} data-muweave-room-nav="true">
      {rooms.map((room, i) => {
        const current = room.id === activeId
        return (
          <button
            key={room.id}
            type="button"
            className="mw-room-nav-btn"
            data-room-id={room.id}
            aria-current={current ? 'page' : undefined}
            title={i < 9 ? `${room.description()} · Alt+${i + 1}` : room.description()}
            onClick={() => onSelect(room.id)}
          >
            {room.title()}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * The single global page behind the "做剧剧场" sidebar entry. The room body is the plugin's own
 * page; WorkspaceShell reads the shared chrome context and swaps its title for the switcher.
 */
export function TheaterPage({ t, onBackToChat }: { t: MuweaveTranslator; onBackToChat: () => void }) {
  const rooms = useTheaterRooms()
  const activeId = useActiveTheaterRoomId()
  const Chrome = theaterChromeContext()

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const m = /^Digit([1-9])$/.exec(e.code)
      if (!m) return
      const room = getTheaterRooms()[Number(m[1]) - 1]
      if (!room) return
      e.preventDefault()
      setActiveTheaterRoom(room.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const active = rooms.find((r) => r.id === activeId)
  if (!active) {
    return (
      <div className="mw-dsh-root" data-muweave-theater="empty">
        <EmptyState icon="theater">{t('theaterNoRooms')}</EmptyState>
      </div>
    )
  }

  const switcher = (
    <>
      <RoomSwitcher t={t} rooms={rooms} activeId={active.id} onSelect={setActiveTheaterRoom} />
      <RoomNav t={t} rooms={rooms} activeId={active.id} onSelect={setActiveTheaterRoom} />
    </>
  )
  const trailing = (
    <button
      type="button"
      className="mw-dsh-btn"
      data-variant="quiet"
      data-muweave-theater-back="true"
      onClick={onBackToChat}
    >
      <Icon name="back" />
      <span>{t('theaterBackToChat')}</span>
    </button>
  )
  const Main = active.Main
  return (
    <Chrome.Provider value={{ switcher, trailing }}>
      <div className="mw-theater" data-muweave-theater={active.id}>
        <Main key={active.id} />
      </div>
    </Chrome.Provider>
  )
}

/** One right-sidebar tab for the whole theater; the room filter defaults to the theater's room. */
export function TheaterCompanion({ t }: { t: MuweaveTranslator }) {
  const rooms = useTheaterRooms()
  const activeId = useActiveTheaterRoomId()
  const [picked, setPicked] = useState<string | null>(null)
  const roomId = picked && rooms.some((r) => r.id === picked) ? picked : activeId
  const room = rooms.find((r) => r.id === roomId)
  if (!room) return <EmptyState icon="theater">{t('theaterNoRooms')}</EmptyState>
  const Companion = room.Companion
  return (
    <div className="mw-theater-companion">
      <div className="mw-theater-companion-rooms" role="group" aria-label={t('theaterCompanionRoom')}>
        {rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            className="mw-dsh-btn"
            data-size="sm"
            aria-pressed={r.id === room.id}
            onClick={() => setPicked(r.id)}
          >
            {r.title()}
          </button>
        ))}
      </div>
      <Companion key={room.id} />
    </div>
  )
}

/** Session header action next to the title: the one-click way into the theater from a chat. */
export function TheaterHeaderAction({ t, onOpen }: { t: MuweaveTranslator; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="mw-dsh-btn mw-theater-header-action"
      data-variant="ghost"
      data-size="sm"
      data-muweave-theater-open="header"
      title={t('theaterEnter')}
      aria-label={t('theaterEnter')}
      onClick={onOpen}
    >
      <Icon name="theater" />
      <span>{t('theaterHeaderAction')}</span>
    </button>
  )
}
