/**
 * MuWeave 排期房间 (docs/design/desk-v4.md): a month board over `.muweave/` references.
 * Everything is a *plan* — the bundle stays the element truth, this room only answers
 * "which day do I publish this". Drag a backlog row onto a day, or select then tap a day.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CompanionList,
  EmptyState,
  NoteCard,
  PillButton,
  RoomHero,
  WorkspaceShell,
  registerMuweaveCreatorPlugin,
  statusLabel,
  statusTone,
  type DshClientContextLike,
  type MuweaveElementSummaryV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  type WorkspaceNotice,
} from '@yeisme/dsh-muweave-core/client'
import type { ScheduleBoardV1, ScheduleEntryV1 } from '@yeisme/dsh-muweave-core/protocol'
import { addMonths, moveDayFocus, popUndo, pushUndo, type ScheduleUndoEntry } from './interactions'
import {
  PROJECT_SCOPE_DICT_EN,
  PROJECT_SCOPE_DICT_ZH,
  entryProjectId,
  isLegacyEntry,
  scopeBacklogRows,
  scopeScheduleEntries,
  type OwnershipBasis,
  type ScheduleEntryOwnership,
  type ScheduleScopeProject,
} from './project-scope'
import {
  BACKLOG_PANEL_ID,
  ScheduleCalendarHeader,
  ScheduleProjectBar,
  ScheduleToolbar,
  activeProjectFromList,
  useBacklogPanel,
  useOnBecomeVisible,
} from './schedule-layout'

export const name = '@yeisme/dsh-muweave-schedule'
// Same UI services the other rooms declare: without them `ctx.locale`/`ctx.slots` are absent and
// the room never registers (the plugin still "loads", so nothing else complains).
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const SCHEDULE_PANEL_ID = 'muweave-schedule'
export const SCHEDULE_COMPANION_ID = 'muweave-schedule/companion'
export const SCHEDULE_LOCALE_NS = 'muweaveSchedule'

const zh = {
  panelTitle: '幕织排期板',
  roomTitle: '排期',
  companionTitle: '档期与就绪度',
  heroEyebrow: '幕织 · 发布档期',
  heroTitle: '这周怎么排',
  heroLede: '把场次和成稿拖到日历上，一格一天；空档和过密都看得见。',
  statMonth: '本月已排',
  statBacklog: '待排',
  statOverdue: '已过期',
  today: '今天',
  prevMonth: '上个月',
  nextMonth: '下个月',
  backlogTitle: '待排池',
  backlogHint: '从左边选一项，再点日历上的某一天；也可以直接拖过去。',
  backlogEmpty: '没有待排内容：先在总览同步 .muweave/，或等上游产出新元件。',
  monthEmpty: '这个月还没有任何排期。',
  boardTitle: '发布日历',
  selected: '已选中',
  clearSelection: '取消选择',
  unschedule: '取消排期',
  planned: '已排期',
  noteLabel: '备注',
  notePlaceholder: '可留一句：这天的重点是什么',
  savedNotice: '已排到 {date}',
  clearedNotice: '已取消 {ref} 的排期',
  failedNotice: '排期失败：{code}',
  weekdayMon: '一',
  weekdayTue: '二',
  weekdayWed: '三',
  weekdayThu: '四',
  weekdayFri: '五',
  weekdaySat: '六',
  weekdaySun: '日',
  kindScene: '场次',
  kindShot: '镜头',
  kindDraft: '成稿',
  kindVisual: '视觉',
  kindArtifact: '工件',
  kindElement: '元件',
  legendHint: '点已排的条目可以取消；跨月拖动会排到目标月的同一天。',
  undoNotice: '上一步：已排到 {date}，可撤销',
  undoAction: '撤销 (Ctrl+Z)',
  dayNavHint: '方向键移动 · Enter 排入 · Delete 取消 · [ ] 换月',
  syncEmptyAction: '去总览同步 .muweave/',
  ...PROJECT_SCOPE_DICT_ZH,
  projectLabel: '项目',
  projectUnsupported: '该宿主未启用项目管理',
  backlogCollapse: '收起待排池',
  backlogExpand: '展开待排池',
  monthNavLabel: '切换月份',
  unknownGroupTitle: '归属未知',
  othersGroupTitle: '其它项目',
  unknownChipSuffix: '归属未知',
  othersChipSuffix: '其它项目',
  calPrevShort: '< 上月',
  calNextShort: '下月 >',
  calBackToToday: '回到今天',
  calPlannedCount: '本月已排 {n} 项',
  backlogSearchPlaceholder: '搜索待排条目…',
  backlogFilterAll: '全部',
  backlogFilterVisual: '视觉',
  backlogFilterScript: '剧本',
  backlogFilterDrama: '分镜',
  backlogFilterEmpty: '没有匹配的待排条目。',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: 'MuWeave Schedule',
  roomTitle: 'Schedule',
  companionTitle: 'Slots & readiness',
  heroEyebrow: 'MuWeave · Publishing slots',
  heroTitle: 'How does this week land',
  heroLede: 'Drag scenes and cuts onto the calendar, one cell per day; gaps and pileups stay visible.',
  statMonth: 'Planned this month',
  statBacklog: 'Backlog',
  statOverdue: 'Overdue',
  today: 'Today',
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  backlogTitle: 'Backlog',
  backlogHint: 'Pick a row on the left, then click a day; dragging works too.',
  backlogEmpty: 'Nothing waiting: sync .muweave/ from the overview, or wait for new upstream elements.',
  monthEmpty: 'No slots in this month yet.',
  boardTitle: 'Publishing calendar',
  selected: 'Selected',
  clearSelection: 'Clear selection',
  unschedule: 'Unschedule',
  planned: 'Planned',
  noteLabel: 'Note',
  notePlaceholder: 'One line: what matters that day',
  savedNotice: 'Planned for {date}',
  clearedNotice: 'Cleared the slot for {ref}',
  failedNotice: 'Scheduling failed: {code}',
  weekdayMon: 'Mon',
  weekdayTue: 'Tue',
  weekdayWed: 'Wed',
  weekdayThu: 'Thu',
  weekdayFri: 'Fri',
  weekdaySat: 'Sat',
  weekdaySun: 'Sun',
  kindScene: 'Scene',
  kindShot: 'Shot',
  kindDraft: 'Draft',
  kindVisual: 'Visual',
  kindArtifact: 'Artifact',
  kindElement: 'Element',
  legendHint: 'Click a planned chip to clear it; dropping across months lands on the same day number.',
  undoNotice: 'Last step: planned for {date} — undoable',
  undoAction: 'Undo (Ctrl+Z)',
  dayNavHint: 'Arrow keys move · Enter plan · Delete clear · [ ] change month',
  syncEmptyAction: 'Sync .muweave/ from the overview',
  ...PROJECT_SCOPE_DICT_EN,
  projectLabel: 'Project',
  projectUnsupported: 'This host has no project management',
  backlogCollapse: 'Collapse backlog',
  backlogExpand: 'Expand backlog',
  monthNavLabel: 'Change month',
  unknownGroupTitle: 'Unknown ownership',
  othersGroupTitle: 'Other projects',
  unknownChipSuffix: 'unknown ownership',
  othersChipSuffix: 'other project',
  calPrevShort: '< Prev',
  calNextShort: 'Next >',
  calBackToToday: 'Today',
  calPlannedCount: '{n} planned this month',
  backlogSearchPlaceholder: 'Search backlog…',
  backlogFilterAll: 'All',
  backlogFilterVisual: 'Visual',
  backlogFilterScript: 'Script',
  backlogFilterDrama: 'Storyboard',
  backlogFilterEmpty: 'No matching backlog items.',
}

export function ScheduleIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <rect x="2" y="3.5" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6.5h12M5.5 2.2v2.4M10.5 2.2v2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5.4 9.2h1.8M9 9.2h1.8M5.4 11.4h1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/* ---------- date helpers (local calendar days, no timezone math on the wire) ---------- */

export function toDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function monthMatrix(year: number, month0: number): string[][] {
  const first = new Date(year, month0, 1)
  // Monday-first: JS Sunday is 0, so shift it to 6.
  const offset = (first.getDay() + 6) % 7
  const start = new Date(year, month0, 1 - offset)
  const weeks: string[][] = []
  for (let w = 0; w < 6; w += 1) {
    const row: string[] = []
    for (let d = 0; d < 7; d += 1) {
      const cell = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d)
      row.push(toDayKey(cell))
    }
    weeks.push(row)
  }
  return weeks
}

/** Kinds that are worth scheduling, in backlog order. */
const BACKLOG_KINDS: Record<string, number> = {
  'auctra.scene_card': 0,
  'drama.storyboard_table': 1,
  'drama.shot': 1,
  'auctra.screenplay.room': 2,
  'eikona.candidate_group': 3,
}

function kindRank(kind: string): number {
  return BACKLOG_KINDS[kind] ?? 9
}

interface BacklogRow {
  ref: string
  label: string
  kind: string
  status: string
  date?: string
  workspaceId?: string
}

/** Rows per backlog group; the pool is a picker, not an inventory. */
const BACKLOG_LIMIT = 40

/**
 * Board entries as the host sends them. `projectId`/`legacy` are schedule v2 fields read
 * defensively; rows without a string ref and day are dropped instead of breaking the grid.
 */
type BoardEntry = ScheduleEntryV1 & { projectId?: unknown; legacy?: unknown }

function boardEntries(data: unknown): BoardEntry[] | undefined {
  const raw = (data as { entries?: unknown } | null | undefined)?.entries
  if (!Array.isArray(raw)) return undefined
  return raw.filter(
    (e): e is BoardEntry => typeof e === 'object' && e !== null && typeof (e as BoardEntry).ref === 'string' && typeof (e as BoardEntry).date === 'string',
  )
}

/** Chip tint by ownership, from status tones only: overdue warns, the current project is info. */
function chipTone(ownership: ScheduleEntryOwnership | undefined, overdue: boolean): string {
  if (overdue) return 'warn'
  return ownership === 'mine' ? 'info' : 'neutral'
}

type BacklogDomainFilter = 'all' | 'eikona' | 'script' | 'drama'

const BACKLOG_DOMAIN_FILTERS: ReadonlyArray<{ id: BacklogDomainFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'backlogFilterAll' },
  { id: 'eikona', labelKey: 'backlogFilterVisual' },
  { id: 'script', labelKey: 'backlogFilterScript' },
  { id: 'drama', labelKey: 'backlogFilterDrama' },
]

function matchesBacklogDomain(kind: string, domain: BacklogDomainFilter): boolean {
  if (domain === 'all') return true
  if (domain === 'eikona') return kind.startsWith('eikona.')
  if (domain === 'script') return kind.startsWith('auctra.') || kind.startsWith('script.') || kind === 'scene'
  return kind.startsWith('drama.') || kind === 'shot'
}

/* ---------------------------------- main page ---------------------------------- */

export function ScheduleMainPage({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string, vars?: Record<string, string>) => string
  coreT: MuweaveTranslator
}) {
  const lang = coreT('langCode')
  // DSH's t() only takes a key; this room needs `{date}`/`{ref}` slots, so fill them here.
  const tf = (key: string, vars: Record<string, string>) => {
    let out = t(key)
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v)
    return out
  }
  const today = toDayKey(new Date())
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month0: now.getMonth() }
  })
  const [entries, setEntries] = useState<BoardEntry[]>([])
  const [elements, setElements] = useState<MuweaveElementSummaryV1[]>([])
  const [project, setProject] = useState<ScheduleScopeProject | undefined>(undefined)
  const [projectsUnsupported, setProjectsUnsupported] = useState(false)
  /** Elements read from the active project's own workspaces, tagged with where they came from. */
  const [projectElements, setProjectElements] = useState<{ workspaceId: string; element: MuweaveElementSummaryV1 }[]>([])
  const [showOthers, setShowOthers] = useState(false)
  const [backlogQuery, setBacklogQuery] = useState('')
  const [backlogDomain, setBacklogDomain] = useState<BacklogDomainFilter>('all')
  const [selectedRef, setSelectedRef] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null)
  const [note, setNote] = useState('')
  const dragRef = useRef<string | undefined>(undefined)
  const calendarRef = useRef<HTMLDivElement | null>(null)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const backlogPanel = useBacklogPanel(layoutRef)
  const [focusedDay, setFocusedDay] = useState(today)
  const [dropActiveDate, setDropActiveDate] = useState<string | undefined>(undefined)
  const [draggingRef, setDraggingRef] = useState<string | undefined>(undefined)
  const [undoStack, setUndoStack] = useState<ScheduleUndoEntry[]>([])

  const loadBoard = useCallback(async () => {
    const res = await rpc.call<ScheduleBoardV1>('schedule.list', {})
    const next = res.ok ? boardEntries(res.data) : undefined
    if (next) setEntries(next)
  }, [rpc])

  /** projectId of entries cleared this session, so undoing a clear restores the same ownership. */
  const clearedProjectRef = useRef(new Map<string, string | undefined>())

  /**
   * Per-workspace element cache keyed by rpc client. Switching projects (or re-entering the room)
   * reuses what was already read instead of firing one `bundle.elements.list` per workspace again.
   */
  const workspaceCacheRef = useRef<{ rpc?: unknown; byWorkspace: Map<string, MuweaveElementSummaryV1[]> }>({
    rpc: undefined,
    byWorkspace: new Map(),
  })

  const loadElements = useCallback(async () => {
    const res = await rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', {})
    if (res.ok) setElements(Array.isArray(res.data?.elements) ? res.data.elements : [])
  }, [rpc])

  // The active project is chosen in the overview room; this room only reads it. Any failure or odd
  // shape leaves `project` undefined, which is the same full, unfiltered board as before projects.
  const loadProject = useCallback(async () => {
    try {
      const res = await rpc.call<{ projects?: unknown[]; activeProjectId?: string }>('project.list', {})
      setProjectsUnsupported(!res.ok)
      setProject(res.ok ? activeProjectFromList(res.data) : undefined)
    } catch {
      setProject(undefined)
    }
  }, [rpc])

  useEffect(() => {
    void loadBoard()
    void loadElements()
    void loadProject()
  }, [loadBoard, loadElements, loadProject])

  // Rooms stay mounted in the theater: re-read the active project each time this room comes back.
  useOnBecomeVisible(layoutRef, loadProject)

  const projectId = project?.id
  const projectWorkspaces = project?.workspaceRefs.join('\n') ?? ''
  useEffect(() => {
    let cancelled = false
    const workspaceIds = projectWorkspaces ? projectWorkspaces.split('\n') : []
    if (workspaceIds.length === 0) {
      setProjectElements([])
      return undefined
    }
    if (workspaceCacheRef.current.rpc !== rpc) {
      workspaceCacheRef.current = { rpc, byWorkspace: new Map() }
    }
    const cache = workspaceCacheRef.current.byWorkspace
    const missing = workspaceIds.filter((id) => !cache.has(id))
    void Promise.all(
      missing.map(async (workspaceId) => {
        const res = await rpc.call<{ elements: MuweaveElementSummaryV1[] }>('bundle.elements.list', { workspaceId })
        const list = res.ok && Array.isArray(res.data?.elements) ? res.data.elements : []
        cache.set(workspaceId, list)
      }),
    )
      .catch(() => {
        // A failed workspace stays uncached; the next visit retries it.
      })
      .then(() => {
        if (cancelled) return
        setProjectElements(
          workspaceIds.flatMap((workspaceId) =>
            (cache.get(workspaceId) ?? []).map((element) => ({ workspaceId, element })),
          ),
        )
      })
    return () => {
      cancelled = true
    }
  }, [rpc, projectId, projectWorkspaces])

  /** Where a ref was read from; only known for refs found in one of the project's workspaces. */
  const refWorkspace = useMemo(() => {
    const map = new Map<string, string>()
    for (const { workspaceId, element } of projectElements) if (!map.has(element.elementId)) map.set(element.elementId, workspaceId)
    return map
  }, [projectElements])

  const scopedEntries = useMemo(() => scopeScheduleEntries(entries, project), [entries, project])
  const scopeByRef = useMemo(() => {
    const map = new Map<string, { ownership: ScheduleEntryOwnership; basis: OwnershipBasis }>()
    for (const group of ['mine', 'unknown', 'others'] as const) {
      for (const { entry, ownership, basis } of scopedEntries[group]) map.set(entry.ref, { ownership, basis })
    }
    return map
  }, [scopedEntries])
  const visibleEntries = useMemo(
    () => [...scopedEntries.mine, ...scopedEntries.unknown, ...(showOthers ? scopedEntries.others : [])].map((s) => s.entry),
    [scopedEntries, showOthers],
  )
  const legacyCount = useMemo(() => entries.filter(isLegacyEntry).length, [entries])

  const byDate = useMemo(() => {
    const map = new Map<string, BoardEntry[]>()
    for (const e of visibleEntries) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return map
  }, [visibleEntries])

  const plannedRefs = useMemo(() => new Set(entries.map((e) => e.ref)), [entries])

  const backlogGroups = useMemo(() => {
    const seen = new Set<string>()
    const rows: BacklogRow[] = []
    const add = (el: MuweaveElementSummaryV1, workspaceId?: string) => {
      if (seen.has(el.elementId) || plannedRefs.has(el.elementId)) return
      seen.add(el.elementId)
      rows.push({ ref: el.elementId, label: el.title, kind: el.kind, status: el.status, workspaceId: workspaceId ?? refWorkspace.get(el.elementId) })
    }
    // Project workspaces first so their tag wins; the default workspace fills in the rest.
    for (const { workspaceId, element } of projectElements) add(element, workspaceId)
    for (const el of elements) add(el)
    rows.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.label.localeCompare(b.label))
    const groups = scopeBacklogRows(rows, project)
    return {
      mine: groups.mine.slice(0, BACKLOG_LIMIT),
      unknown: groups.unknown.slice(0, BACKLOG_LIMIT),
      others: groups.others.slice(0, BACKLOG_LIMIT),
      // Statistics must count everything; only the rendered rows are capped.
      totals: {
        mine: groups.mine.length,
        unknown: groups.unknown.length,
        others: groups.others.length,
      },
    }
  }, [elements, projectElements, plannedRefs, refWorkspace, project])
  const backlog = useMemo(
    () => [...backlogGroups.mine, ...backlogGroups.unknown, ...(showOthers ? backlogGroups.others : [])],
    [backlogGroups, showOthers],
  )
  const backlogTotal =
    backlogGroups.totals.mine + backlogGroups.totals.unknown + (showOthers ? backlogGroups.totals.others : 0)
  const othersCount = scopedEntries.others.length + backlogGroups.totals.others

  const monthPrefix = `${cursor.year}-${`${cursor.month0 + 1}`.padStart(2, '0')}`
  const monthEntries = visibleEntries.filter((e) => e.date.startsWith(monthPrefix))
  const monthUnknown = project ? monthEntries.filter((e) => scopeByRef.get(e.ref)?.ownership === 'unknown').length : 0
  const monthInferred = project ? monthEntries.filter((e) => scopeByRef.get(e.ref)?.basis === 'inferred').length : 0
  const overdue = visibleEntries.filter((e) => e.date < today).length
  const weeks = useMemo(() => monthMatrix(cursor.year, cursor.month0), [cursor])
  const monthLabel = new Date(cursor.year, cursor.month0, 1).toLocaleDateString(lang === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long' })

  useEffect(() => {
    calendarRef.current?.querySelector<HTMLElement>(`[data-day="${focusedDay}"]`)?.focus()
  }, [focusedDay, cursor])

  const kindLabel = (kind: string): string => {
    if (kind.startsWith('auctra.scene') || kind === 'auctra.screenplay.room') return t('kindScene')
    if (kind.startsWith('drama.shot') || kind === 'drama.storyboard_table') return t('kindShot')
    if (kind.includes('draft') || kind.includes('candidate_diff')) return t('kindDraft')
    if (kind.startsWith('eikona.')) return t('kindVisual')
    if (kind.startsWith('harness.') || kind.startsWith('pi.')) return t('kindArtifact')
    if (kind.startsWith('script.')) return t('kindScene')
    if (kind === 'shot' || kind === 'scene') return t(kind === 'shot' ? 'kindShot' : 'kindScene')
    return t('kindElement')
  }

  /**
   * Moving an existing entry keeps whatever projectId it already has (none stays none: re-dating is
   * not a claim of ownership). A new entry takes the active project; without one it is sent bare.
   */
  const plan = async (ref: string, date: string, label: string, kind: string, recordUndo = true, restoreProjectId?: string) => {
    const previous = entries.find((entry) => entry.ref === ref)
    const projectIdToSend = previous ? entryProjectId(previous) : recordUndo ? project?.id : restoreProjectId
    const payload: Record<string, unknown> = { ref, date, label, kind, note: note.trim() || undefined }
    if (projectIdToSend) payload.projectId = projectIdToSend
    const res = await rpc.call<ScheduleBoardV1>('schedule.plan', payload)
    if (res.ok) {
      const next = boardEntries(res.data)
      if (next) setEntries(next)
      else void loadBoard()
      setNotice({ tone: 'ok', text: tf('savedNotice', { date }) })
      if (recordUndo) setUndoStack((stack) => pushUndo(stack, { kind: 'plan', ref, date, prevDate: previous?.date }))
      setSelectedRef(undefined)
      setNote('')
    } else {
      setNotice({ tone: 'bad', text: tf('failedNotice', { code: res.error.code }) })
    }
  }

  const clearOne = async (ref: string, recordUndo = true) => {
    const previous = entries.find((entry) => entry.ref === ref)
    const res = await rpc.call<ScheduleBoardV1>('schedule.clear', { ref })
    if (res.ok) {
      if (previous) clearedProjectRef.current.set(ref, entryProjectId(previous))
      const next = boardEntries(res.data)
      if (next) setEntries(next)
      else void loadBoard()
      setNotice({ tone: 'neutral', text: tf('clearedNotice', { ref }) })
      if (recordUndo && previous) setUndoStack((stack) => pushUndo(stack, { kind: 'clear', ref, date: previous.date }))
    } else {
      setNotice({ tone: 'bad', text: tf('failedNotice', { code: res.error.code }) })
    }
  }

  const selectedRow = backlog.find((b) => b.ref === selectedRef)
  const selectedEntry = entries.find((e) => e.ref === selectedRef)

  const dropOn = (date: string) => {
    const ref = dragRef.current ?? selectedRef
    dragRef.current = undefined
    setDraggingRef(undefined)
    setDropActiveDate(undefined)
    backlogPanel.closeDrawer()
    if (!ref) return
    const row = backlog.find((b) => b.ref === ref)
    const entry = entries.find((e) => e.ref === ref)
    if (row) void plan(row.ref, date, row.label, row.kind)
    else if (entry) void plan(entry.ref, date, entry.label, entry.kind)
  }

  const undo = async () => {
    const result = popUndo(undoStack)
    if (!result.entry) return
    setUndoStack(result.stack)
    const entry = result.entry
    const current = entries.find((item) => item.ref === entry.ref)
    const source = current ?? elements.find((item) => item.elementId === entry.ref) ?? projectElements.find((item) => item.element.elementId === entry.ref)?.element
    const sourceLabel = current?.label ?? (source && 'title' in source ? source.title : undefined) ?? entry.ref
    const sourceKind = source?.kind ?? 'element'
    if (entry.kind === 'plan' && entry.prevDate) await plan(entry.ref, entry.prevDate, sourceLabel, sourceKind, false)
    else if (entry.kind === 'plan') await clearOne(entry.ref, false)
    else if (entry.date) await plan(entry.ref, entry.date, sourceLabel, sourceKind, false, clearedProjectRef.current.get(entry.ref))
  }

  const goTo = (day: string) => {
    setFocusedDay(day)
    setCursor({ year: Number(day.slice(0, 4)), month0: Number(day.slice(5, 7)) - 1 })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!calendarRef.current?.contains(document.activeElement)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        void undo()
      } else if (event.key === 't') {
        event.preventDefault()
        goTo(today)
      } else if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        goTo(addMonths(focusedDay, event.key === '[' ? -1 : 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const weekday = [t('weekdayMon'), t('weekdayTue'), t('weekdayWed'), t('weekdayThu'), t('weekdayFri'), t('weekdaySat'), t('weekdaySun')]

  const renderBacklogRow = (row: BacklogRow, ownership?: ScheduleEntryOwnership) => (
    <li key={row.ref}>
      <button
        type="button"
        className="mw-sched-row"
        data-selected={selectedRef === row.ref ? 'true' : undefined}
        data-ownership={project ? ownership : undefined}
        draggable
        onDragStart={() => {
          dragRef.current = row.ref
          setDraggingRef(row.ref)
        }}
        onDragEnd={() => {
          dragRef.current = undefined
          setDraggingRef(undefined)
          setDropActiveDate(undefined)
        }}
        data-dragging={draggingRef === row.ref ? 'true' : undefined}
        onClick={() => {
          const next = row.ref === selectedRef ? undefined : row.ref
          setSelectedRef(next)
          // On a narrow stage the drawer covers the calendar; get out of the way so a day can be tapped.
          if (next) backlogPanel.closeDrawer()
        }}
      >
        <span className="mw-sched-row-main">
          <span className="mw-sched-row-title">{row.label}</span>
          <span className="mw-sched-row-meta">
            {kindLabel(row.kind)} · {statusLabel(row.status, lang)}
          </span>
        </span>
        <span className="mw-sched-row-dot" data-tone={statusTone(row.status)} />
      </button>
    </li>
  )

  const backlogEmpty = backlogGroups.mine.length + backlogGroups.unknown.length + backlogGroups.others.length === 0
  const normalizedBacklogQuery = backlogQuery.trim().toLowerCase()
  const filterBacklogRows = (rows: readonly BacklogRow[]) =>
    rows.filter((row) => {
      if (!matchesBacklogDomain(row.kind, backlogDomain)) return false
      if (!normalizedBacklogQuery) return true
      return (
        row.label.toLowerCase().includes(normalizedBacklogQuery) ||
        row.ref.toLowerCase().includes(normalizedBacklogQuery) ||
        kindLabel(row.kind).toLowerCase().includes(normalizedBacklogQuery)
      )
    })
  const filteredMine = filterBacklogRows(backlogGroups.mine)
  const filteredUnknown = filterBacklogRows(backlogGroups.unknown)
  const filteredOthers = showOthers ? filterBacklogRows(backlogGroups.others) : []
  const filteredBacklogCount = filteredMine.length + filteredUnknown.length + filteredOthers.length
  const calHeaderTitle = lang === 'en' ? monthLabel : `${cursor.year} 年 ${cursor.month0 + 1} 月`

  const backlogPanelNode = (
    <aside
      id={BACKLOG_PANEL_ID}
      className="mw-sched-side mw-stack"
      data-gap="sm"
      data-drawer={backlogPanel.narrow ? 'true' : undefined}
      aria-label={t('backlogTitle')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && backlogPanel.narrow) {
          event.stopPropagation()
          backlogPanel.closeDrawer()
        }
      }}
    >
      <div className="mw-spread">
        <h3 className="mw-card-title">{t('backlogTitle')}</h3>
        {selectedRef ? (
          <PillButton icon="close" onClick={() => setSelectedRef(undefined)}>
            {t('clearSelection')}
          </PillButton>
        ) : null}
      </div>
      <div className="sched-backlog-filter mw-stack" data-gap="xs" data-schedule-backlog-filter="true">
        <input
          type="search"
          className="mw-input"
          aria-label={t('backlogSearchPlaceholder')}
          placeholder={t('backlogSearchPlaceholder')}
          value={backlogQuery}
          onChange={(ev) => setBacklogQuery(ev.target.value)}
        />
        <div className="mw-row" data-gap="xs" role="group" aria-label={t('backlogTitle')}>
          {BACKLOG_DOMAIN_FILTERS.map((f) => {
            const active = backlogDomain === f.id
            return (
              <button
                key={f.id}
                type="button"
                className="mw-dsh-btn"
                data-size="sm"
                data-variant={active ? 'primary' : 'quiet'}
                data-domain={f.id}
                aria-pressed={active}
                onClick={() => setBacklogDomain(f.id)}
              >
                {t(f.labelKey)}
              </button>
            )
          })}
        </div>
      </div>
      {legacyCount > 0 ? (
        <p className="mw-sched-legacy" data-muweave-schedule-legacy={legacyCount}>
          {tf('legacyEntriesHint', { count: String(legacyCount) })}
        </p>
      ) : null}
      <p className="mw-dsh-muted">{t('backlogHint')}</p>
      {backlogEmpty ? (
        <EmptyState icon="inbox">
          <span>{t('backlogEmpty')}</span>{' '}
          <PillButton icon="sync" onClick={() => void loadElements()}>{t('syncEmptyAction')}</PillButton>
        </EmptyState>
      ) : filteredBacklogCount === 0 ? (
        <EmptyState icon="inbox">{t('backlogFilterEmpty')}</EmptyState>
      ) : (
        <ul className="mw-sched-backlog" data-muweave-schedule-backlog="true">
          {filteredMine.map((row) => renderBacklogRow(row, 'mine'))}
          {filteredUnknown.length > 0 ? (
            <li className="mw-sched-group" data-ownership="unknown">
              <span className="mw-sched-group-title">{t('unknownGroupTitle')}</span>
              <span className="mw-dsh-muted">{t('unknownOwnershipHint')}</span>
            </li>
          ) : null}
          {filteredUnknown.map((row) => renderBacklogRow(row, 'unknown'))}
          {showOthers && filteredOthers.length > 0 ? (
            <li className="mw-sched-group" data-ownership="others">
              <span className="mw-sched-group-title">{t('othersGroupTitle')}</span>
            </li>
          ) : null}
          {showOthers ? filteredOthers.map((row) => renderBacklogRow(row, 'others')) : null}
        </ul>
      )}
      {selectedRow ? (
        <NoteCard eyebrow={t('selected')} title={selectedRow.label} ink>
          <p className="mw-dsh-muted">{kindLabel(selectedRow.kind)}</p>
          <label className="mw-field">
            <span>{t('noteLabel')}</span>
            <input
              className="mw-input"
              value={note}
              placeholder={t('notePlaceholder')}
              onChange={(ev) => setNote(ev.target.value)}
            />
          </label>
        </NoteCard>
      ) : null}
    </aside>
  )

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      rpc={rpc}
      t={coreT}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      projectBar={<ScheduleProjectBar project={project} unsupported={projectsUnsupported} t={t} />}
      hero={<RoomHero eyebrow={t('heroEyebrow')} title={t('heroTitle')} lede={t('heroLede')} />}
      stageTabs={[
        {
          id: 'board',
          label: () => `${cursor.year} · ${cursor.month0 + 1} · ${t('boardTitle')}`,
          render: () => (
            <div className="mw-stack" data-muweave-schedule-board="true">
              <ScheduleToolbar
                monthLabel={monthLabel}
                backlogOpen={backlogPanel.open}
                backlogCount={backlogTotal}
                onToggleBacklog={backlogPanel.toggle}
                onPrev={() => goTo(addMonths(focusedDay, -1))}
                onToday={() => goTo(today)}
                onNext={() => goTo(addMonths(focusedDay, 1))}
                stats={[
                  { id: 'month', label: t('statMonth'), value: monthEntries.length },
                  { id: 'backlog', label: t('statBacklog'), value: backlog.length },
                  { id: 'overdue', label: t('statOverdue'), value: overdue, tone: overdue > 0 ? 'warn' : undefined },
                ]}
                trailing={
                  othersCount > 0 ? (
                    <button
                      type="button"
                      className="mw-dsh-btn mw-sched-others-toggle"
                      data-variant="quiet"
                      data-size="sm"
                      aria-pressed={showOthers}
                      data-muweave-schedule-others={showOthers ? 'shown' : 'hidden'}
                      onClick={() => setShowOthers((v) => !v)}
                    >
                      {showOthers ? t('hideOtherProjectEntries') : t('showOtherProjectEntries')}
                      <span className="mw-sched-count">{othersCount}</span>
                    </button>
                  ) : null
                }
                t={t}
              />
              <div
                ref={layoutRef}
                className="mw-sched-layout"
                data-backlog={backlogPanel.open ? 'open' : 'closed'}
                data-narrow={backlogPanel.narrow ? 'true' : undefined}
              >
                {backlogPanel.open ? backlogPanelNode : null}

                <section className="mw-sched-main mw-stack" data-gap="sm">
                  <ScheduleCalendarHeader
                    monthTitle={calHeaderTitle}
                    plannedCountLabel={tf('calPlannedCount', { n: String(monthEntries.length) })}
                    onPrev={() => goTo(addMonths(focusedDay, -1))}
                    onToday={() => goTo(today)}
                    onNext={() => goTo(addMonths(focusedDay, 1))}
                    t={t}
                  />
                  <div className="mw-sched-weekhead" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }} aria-hidden="true">
                    {weekday.map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <div
                    ref={calendarRef}
                    className="mw-sched-grid"
                    role="grid"
                    aria-label={t('boardTitle')}
                    onKeyDown={(event) => {
                      const rows = byDate.get(focusedDay) ?? []
                      // A chip handles its own Enter/Delete; only bare cells fall through to the day actions.
                      if ((event.target as HTMLElement | null)?.closest('.mw-sched-chip')) return
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        if (selectedRow) void plan(selectedRow.ref, focusedDay, selectedRow.label, selectedRow.kind)
                        else if (selectedEntry) void plan(selectedEntry.ref, focusedDay, selectedEntry.label, selectedEntry.kind)
                        else if (rows[0]) void clearOne(rows[0].ref)
                        return
                      }
                      if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault()
                        if (rows[0]) void clearOne(rows[0].ref)
                        return
                      }
                      const next = moveDayFocus(focusedDay, event.key)
                      if (next !== focusedDay) {
                        event.preventDefault()
                        goTo(next)
                      }
                    }}
                  >
                    {weeks.map((week) => (
                      <div key={week[0]} className="mw-sched-week" role="row">
                      {week.map((date, col) => {
                      const inMonth = date.startsWith(monthPrefix)
                      const rows = byDate.get(date) ?? []
                      return (
                        <div
                          key={date}
                          className="mw-sched-cell"
                          role="gridcell"
                          data-in-month={inMonth ? 'true' : undefined}
                          data-today={date === today ? 'true' : undefined}
                          data-past={date < today ? 'true' : undefined}
                          data-weekend={col >= 5 ? 'true' : undefined}
                          data-has-entries={rows.length > 0 ? 'true' : undefined}
                          data-drop-ready={selectedRef ? 'true' : undefined}
                          data-day={date}
                          data-drop-active={dropActiveDate === date ? 'true' : undefined}
                          tabIndex={focusedDay === date ? 0 : -1}
                          aria-label={`${date} · ${rows.length}`}
                          aria-selected={focusedDay === date ? 'true' : 'false'}
                          onFocus={() => setFocusedDay(date)}
                          onClick={() => {
                            setFocusedDay(date)
                            if (selectedRow) void plan(selectedRow.ref, date, selectedRow.label, selectedRow.kind)
                            else if (selectedEntry) void plan(selectedEntry.ref, date, selectedEntry.label, selectedEntry.kind)
                          }}
                          onDragOver={(ev) => {
                            if (dragRef.current) {
                              ev.preventDefault()
                              setDropActiveDate(date)
                            }
                          }}
                          onDragLeave={() => setDropActiveDate((active) => (active === date ? undefined : active))}
                          onDrop={(ev) => {
                            ev.preventDefault()
                            dropOn(date)
                          }}
                        >
                          <span className="mw-sched-day">{Number(date.slice(8, 10))}</span>
                          <ul className="mw-sched-chips">
                            {rows.map((row) => {
                              const scope = project ? scopeByRef.get(row.ref) : undefined
                              const ownership = scope?.ownership
                              const inferred = scope?.basis === 'inferred'
                              const suffix = ownership === 'unknown' ? t('unknownChipSuffix') : ownership === 'others' ? t('othersChipSuffix') : undefined
                              const title = [row.label, row.note, suffix, inferred ? t('inferredChipSuffix') : undefined].filter(Boolean).join(' · ')
                              return (
                                <li key={row.ref}>
                                  <button
                                    type="button"
                                    className="mw-sched-chip"
                                    title={title}
                                    data-kind={kindLabel(row.kind)}
                                    data-ownership={ownership}
                                    data-basis={scope?.basis}
                                    data-tone={project ? chipTone(ownership, date < today) : date < today ? 'warn' : 'neutral'}
                                    onKeyDown={(ev) => {
                                      if (ev.key !== 'Enter' && ev.key !== 'Delete' && ev.key !== 'Backspace') return
                                      ev.preventDefault()
                                      ev.stopPropagation()
                                      void clearOne(row.ref)
                                    }}
                                    onClick={(ev) => {
                                      ev.stopPropagation()
                                      void clearOne(row.ref)
                                    }}
                                  >
                                    <span className="mw-sched-chip-label">{row.label}</span>
                                    {inferred ? <span className="mw-sched-chip-basis">{t('inferredChipMark')}</span> : null}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )
                      })}
                      </div>
                    ))}
                  </div>
                  {monthUnknown > 0 ? (
                    <p className="mw-dsh-muted" data-muweave-schedule-unknown={monthUnknown}>
                      {t('unknownOwnershipHint')} · {monthUnknown}
                    </p>
                  ) : null}
                  {monthInferred > 0 ? (
                    <p className="mw-dsh-muted" data-muweave-schedule-inferred={monthInferred}>
                      {t('inferredOwnershipHint')} · {monthInferred}
                    </p>
                  ) : null}
                  <p className="mw-dsh-muted mw-sched-legend">{t('legendHint')} · {t('dayNavHint')}</p>
                  {undoStack.length > 0 ? (
                    <div className="mw-sched-undo" role="status">
                      <span>{tf('undoNotice', { date: undoStack[undoStack.length - 1]?.date ?? '' })}</span>
                      <PillButton icon="back" onClick={() => void undo()}>{t('undoAction')}</PillButton>
                    </div>
                  ) : null}
                  {monthEntries.length === 0 ? <EmptyState icon="inbox">{t('monthEmpty')}</EmptyState> : null}
                </section>
              </div>
            </div>
          ),
        },
      ]}
    />
  )
}

export function ScheduleCompanionPane({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  return <CompanionList rpc={rpc} coreT={coreT} title={t('companionTitle')} domain="drama" companionId="schedule" />
}

export function apply(ctx: DshClientContextLike): void {
  // Rebound on every call so a host locale switch is picked up without remounting the room.
  const tFn = () => ctx.locale.bind(SCHEDULE_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: SCHEDULE_LOCALE_NS,
    dictionaries: { zh, en },
    pane: {
      pluginId: 'muweave-schedule',
      panelId: SCHEDULE_PANEL_ID,
      order: 46,
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: ['muweave'],
      companionId: SCHEDULE_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: ScheduleIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    },
    MainComponent: ScheduleMainPage,
    CompanionComponent: ScheduleCompanionPane,
  })
}
