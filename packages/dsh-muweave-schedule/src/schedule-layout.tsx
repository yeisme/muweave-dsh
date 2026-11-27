/**
 * Presentational pieces of the schedule room (docs/design/desk-v7.md): the read-only project bar,
 * the one-line month toolbar, and the backlog sidebar/drawer state. State and RPC stay in client.tsx.
 */

import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { Icon } from '@yeisme/dsh-muweave-core/client'
import type { ProjectStatus, ScheduleScopeProject } from './project-scope'

export const BACKLOG_STORAGE_KEY = 'muweave.schedule.backlog'
export const BACKLOG_PANEL_ID = 'mw-sched-backlog-panel'
/** Below this layout width the backlog stops being a column and becomes an overlay drawer. */
const NARROW_REM = 52

type Translate = (key: string) => string

const STATUS_KEYS: Record<ProjectStatus, string> = {
  preparing: 'projectStatusPreparing',
  in_production: 'projectStatusInProduction',
  ready_to_publish: 'projectStatusReadyToPublish',
  published: 'projectStatusPublished',
  archived: 'projectStatusArchived',
}

const PROJECT_STATUSES = new Set<string>(Object.keys(STATUS_KEYS))

/**
 * Picks the active project out of a `project.list` answer without trusting its shape: a host or
 * test double may answer ok with no projects array (that once blanked a room).
 */
export function activeProjectFromList(data: unknown): ScheduleScopeProject | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const { projects, activeProjectId } = data as { projects?: unknown; activeProjectId?: unknown }
  if (!Array.isArray(projects) || typeof activeProjectId !== 'string') return undefined
  const raw = projects.find((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && (p as { id?: unknown }).id === activeProjectId)
  if (!raw || typeof raw.title !== 'string') return undefined
  return {
    id: activeProjectId,
    title: raw.title,
    status: typeof raw.status === 'string' && PROJECT_STATUSES.has(raw.status) ? (raw.status as ProjectStatus) : 'preparing',
    workspaceRefs: Array.isArray(raw.workspaceRefs) ? raw.workspaceRefs.filter((w): w is string => typeof w === 'string' && w.length > 0) : [],
  }
}

/** Read-only twin of the workbench project bar: switching projects happens in the overview room. */
export function ScheduleProjectBar({ project, unsupported, t }: { project?: ScheduleScopeProject; unsupported: boolean; t: Translate }) {
  return (
    <div className="mw-project-bar mw-row" data-muweave-project-bar="true" data-muweave-schedule-project={project?.id ?? 'none'} data-gap="sm">
      <span className="mw-eyebrow">{t('projectLabel')}</span>
      {project ? (
        <>
          <span className="mw-sched-project-title mw-truncate">{project.title}</span>
          <span className="mw-chip" data-status={project.status}>{t(STATUS_KEYS[project.status])}</span>
        </>
      ) : (
        <span className="mw-dsh-muted">{unsupported ? t('projectUnsupported') : t('noActiveProject')}</span>
      )}
      {unsupported ? null : <span className="mw-dsh-muted">{t('projectOverviewHint')}</span>}
    </div>
  )
}

export interface ScheduleStat {
  id: string
  label: string
  value: number
  tone?: string
}

/** Month title, navigation and the three counters on one line; wraps on narrow stages. */
export function ScheduleToolbar({
  monthLabel,
  stats,
  backlogOpen,
  backlogCount,
  onToggleBacklog,
  onPrev,
  onToday,
  onNext,
  trailing,
  t,
}: {
  monthLabel: string
  stats: readonly ScheduleStat[]
  backlogOpen: boolean
  backlogCount: number
  onToggleBacklog: () => void
  onPrev: () => void
  onToday: () => void
  onNext: () => void
  trailing?: ReactNode
  t: Translate
}) {
  return (
    <div className="mw-sched-toolbar" data-muweave-schedule-toolbar="true">
      <div className="mw-sched-toolbar-nav">
        <button
          type="button"
          className="mw-dsh-btn mw-sched-backlog-toggle"
          data-variant="ghost"
          data-size="sm"
          aria-expanded={backlogOpen}
          aria-controls={BACKLOG_PANEL_ID}
          title={backlogOpen ? t('backlogCollapse') : t('backlogExpand')}
          onClick={onToggleBacklog}
        >
          <Icon name="panelLeft" />
          <span>{t('backlogTitle')}</span>
          <span className="mw-sched-count">{backlogCount}</span>
        </button>
        <h3 className="mw-sched-month" aria-live="polite">{monthLabel}</h3>
        <div className="mw-sched-monthnav" role="group" aria-label={t('monthNavLabel')}>
          <button type="button" className="mw-dsh-btn" data-icon="true" data-variant="ghost" data-size="sm" aria-label={t('prevMonth')} title={t('prevMonth')} onClick={onPrev}>
            <Icon name="back" />
          </button>
          <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={onToday}>
            {t('today')}
          </button>
          <button type="button" className="mw-dsh-btn mw-sched-next" data-icon="true" data-variant="ghost" data-size="sm" aria-label={t('nextMonth')} title={t('nextMonth')} onClick={onNext}>
            <Icon name="back" />
          </button>
        </div>
      </div>
      <dl className="mw-sched-stats">
        {stats.map((stat) => (
          <div key={stat.id} className="mw-sched-stat" data-tone={stat.tone} data-stat={stat.id}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
      {trailing}
    </div>
  )
}

/** Crisp navigation header directly above the month calendar grid. */
export function ScheduleCalendarHeader({
  monthTitle,
  plannedCountLabel,
  onPrev,
  onToday,
  onNext,
  t,
}: {
  monthTitle: string
  plannedCountLabel: string
  onPrev: () => void
  onToday: () => void
  onNext: () => void
  t: Translate
}) {
  return (
    <div className="sched-cal-header" data-schedule-cal-header="true">
      <div className="mw-row" data-gap="xs">
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="quiet"
          data-size="sm"
          data-sched-cal-prev="true"
          onClick={onPrev}
        >
          {t('calPrevShort')}
        </button>
        <strong className="mw-sched-cal-title" aria-live="polite" data-sched-cal-title="true">
          {monthTitle}
        </strong>
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="quiet"
          data-size="sm"
          data-sched-cal-next="true"
          onClick={onNext}
        >
          {t('calNextShort')}
        </button>
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="ghost"
          data-size="sm"
          data-sched-cal-today="true"
          onClick={onToday}
        >
          {t('calBackToToday')}
        </button>
      </div>
      <span className="mw-chip" data-sched-cal-count="true">
        {plannedCountLabel}
      </span>
    </div>
  )
}

function readBacklogPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(BACKLOG_STORAGE_KEY) !== 'collapsed'
  } catch {
    return true
  }
}

/** Wide layouts remember the sidebar choice; the narrow drawer is transient and starts closed. */
export function useBacklogPanel(layoutRef: RefObject<HTMLElement | null>) {
  const [sidebarOpen, setSidebarOpen] = useState(readBacklogPreference)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const narrow = useNarrowLayout(layoutRef)

  const toggle = () => {
    if (narrow) {
      setDrawerOpen((v) => !v)
      return
    }
    setSidebarOpen((v) => {
      const next = !v
      try {
        globalThis.localStorage?.setItem(BACKLOG_STORAGE_KEY, next ? 'expanded' : 'collapsed')
      } catch {
        // Storage can be disabled (private mode); the choice then lasts for this session only.
      }
      return next
    })
  }

  // A narrow drawer must also close on an outside pointer press, not only on Escape.
  useEffect(() => {
    if (!narrow || !drawerOpen) return undefined
    const onPointer = (event: PointerEvent) => {
      const el = layoutRef.current
      const target = event.target
      if (!el || !(target instanceof Node)) return
      // The drawer lives inside the layout root; a press outside that subtree closes it.
      if (!el.contains(target)) setDrawerOpen(false)
    }
    document.addEventListener('pointerdown', onPointer, true)
    return () => document.removeEventListener('pointerdown', onPointer, true)
  }, [drawerOpen, layoutRef, narrow])

  return {
    narrow,
    open: narrow ? drawerOpen : sidebarOpen,
    toggle,
    closeDrawer: () => setDrawerOpen(false),
  }
}

function useNarrowLayout(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width <= 0) return
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setNarrow(width < NARROW_REM * rem)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [ref])
  return narrow
}

/** Calls back whenever the element scrolls into view, e.g. when the theater switches to this room. */
export function useOnBecomeVisible(ref: RefObject<HTMLElement | null>, onVisible: () => void): void {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    let wasVisible = true
    const io = new IntersectionObserver((records) => {
      const visible = records.some((r) => r.isIntersecting)
      if (visible && !wasVisible) onVisible()
      wasVisible = visible
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, onVisible])
}
