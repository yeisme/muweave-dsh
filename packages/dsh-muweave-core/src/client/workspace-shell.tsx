import { useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { focusFloatingComposer, mountComposerWorkspace, publishKnownElementsForTriggers, publishMuweavePageBounds } from './floating-agent'
import type { MuweaveTone, MuweaveTranslator } from './i18n'
import { ProgressStrip } from './progress-strip'
import type { MuweaveRpcClient } from './rpc-client'
import { AmbientBackdrop } from './editorial'
import { GenerationLauncher } from './generation'
import { CommandPalette, type CommandPaletteItem } from './command-palette'
import { useTiltDelegation } from './motion'
import { getActiveTheaterRoomId, getTheaterRooms, setActiveTheaterRoom, theaterChromeContext } from './theater/registry'
import type { CapabilityStage, MuweaveIndexV1 } from '../protocol'
import { Icon, IconButton, Segmented } from './ui'

export type StageSplitMode = 'single' | 'horizontal' | 'vertical'
export type WorkspacePresetId = 'balanced' | 'focus' | 'compare'

export interface CreatorStageTabSpec {
  id: string
  label: () => string
  render: (ctx: { splitMode: StageSplitMode; onPinCompare: (node: ReactNode) => void }) => ReactNode
}

export interface CreatorPaneSpec {
  pluginId: string
  panelId: string
  order: number
  title: () => string
  /** Short name in the theater's workspace switcher (总览 / 视觉 / 剧本 / 分镜生产 / 工具箱). */
  roomTitle?: () => string
  /** Element domains this room owns, for jumping from an @ chip. */
  domains?: readonly string[]
  companionId: string
  companionTitle: () => string
  icon: ComponentType<{ size?: number; active?: boolean }>
  renderLeftTree?: () => ReactNode
  stageTabs: readonly CreatorStageTabSpec[]
  renderRightInspector?: () => ReactNode
  renderRightbarCompanion: () => ReactNode
}

export interface WorkspaceShellProps {
  title: string
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  /** Room-scoped filters/tree; Desk v3 shows them in a popover instead of a permanent column. */
  leftTree?: ReactNode
  stageTabs: readonly CreatorStageTabSpec[]
  rightInspector?: ReactNode
  headerActions?: ReactNode
  refreshCounter?: number
  onSyncRequested?: () => Promise<void> | void
  /** One line under the title (project, owner or rule reminder). */
  subtitle?: ReactNode
  /** Transient receipt from the last action; shown as a toned strip above the stage. */
  notice?: WorkspaceNotice | null
  onDismissNotice?: () => void
  /** Persistent project context bar above the hero: current project, switcher, create action. */
  projectBar?: ReactNode
  /** Work-first hero above the stage tabs (RoomHero); scrolls away with the stage. */
  hero?: ReactNode
  /** Stage(s) whose capabilities the 「生成」 desk lists; defaults from the active theater room. */
  stage?: CapabilityStage | readonly CapabilityStage[]
}

/** Rooms that lead with one stage; rooms not listed (总览, 工具箱) show every capability. */
const ROOM_STAGE: Record<string, CapabilityStage> = {
  'muweave-eikona': 'visual',
  'muweave-script': 'script',
  'muweave-drama': 'storyboard',
}

export interface WorkspaceNotice {
  tone?: MuweaveTone
  text: string
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * One-layer workspace (docs/design/desk-v3.md): the stage is full width, room filters live in a
 * popover, every layout control lives behind one 「视图」 popover, and ⌘K opens one searchable list of
 * rooms / stage views / shell actions. Publishes its container bounding box via ResizeObserver so the
 * `shell.overlay` Floating Agent stays strictly within `.mw-dsh-root` and never covers DSH's sidebar.
 */
export function WorkspaceShell({
  title,
  rpc,
  t,
  leftTree,
  stageTabs,
  rightInspector,
  headerActions,
  refreshCounter = 0,
  onSyncRequested,
  subtitle,
  notice,
  onDismissNotice,
  projectBar,
  hero,
  stage,
}: WorkspaceShellProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewBtnRef = useRef<HTMLDivElement | null>(null)
  const filterBtnRef = useRef<HTMLDivElement | null>(null)
  const [activeTabId, setActiveTabId] = useState<string>(stageTabs[0]?.id ?? 'default')
  const [splitMode, setSplitMode] = useState<StageSplitMode>('single')
  const [showRight, setShowRight] = useState<boolean>(false)
  const [compareSecondary, setCompareSecondary] = useState<ReactNode | null>(null)
  const [containerWidth, setContainerWidth] = useState<number>(1200)
  const chrome = useContext(theaterChromeContext())
  const [syncing, setSyncing] = useState(false)
  const syncInFlight = useRef(false)
  const [syncedAt, setSyncedAt] = useState<string | undefined>(undefined)
  const [localRefresh, setLocalRefresh] = useState(0)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // One delegated pointer listener gives every interactive card the 3D tilt.
  useTiltDelegation(rootRef)

  const hasLeft = Boolean(leftTree)
  const hasInspector = Boolean(rightInspector)

  useEffect(() => {
    // A room reveals the inspector when the user selects something; hide it again when it empties.
    setShowRight(hasInspector)
  }, [hasInspector])

  useEffect(() => {
    if (!stageTabs.some((st) => st.id === activeTabId) && stageTabs[0]) {
      setActiveTabId(stageTabs[0].id)
    }
  }, [stageTabs, activeTabId])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const publish = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0) {
        setContainerWidth(rect.width)
        publishMuweavePageBounds({ left: rect.left, width: rect.width })
      }
    }
    publish()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : undefined
    ro?.observe(el)
    window.addEventListener('resize', publish)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', publish)
      publishMuweavePageBounds(undefined)
    }
  }, [])

  useEffect(() => {
    if (!viewMenuOpen && !filterOpen) return undefined
    const onPointer = (ev: PointerEvent) => {
      const target = ev.target as Node
      if (viewMenuOpen && viewBtnRef.current && !viewBtnRef.current.contains(target)) setViewMenuOpen(false)
      if (filterOpen && filterBtnRef.current && !filterBtnRef.current.contains(target)) setFilterOpen(false)
    }
    // Escape closes a popover even when focus is still on the trigger button.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      setViewMenuOpen(false)
      setFilterOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [viewMenuOpen, filterOpen])

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      // The theater can keep other rooms mounted; only the visible shell owns the shortcuts,
      // otherwise one ⌘K is handled twice and the palette opens then closes.
      const mine = rootRef.current
      const roots = Array.from(document.querySelectorAll('[data-muweave-workspace-root="true"]'))
      const visible = roots.filter((el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null)
      if (mine && visible.length > 0 && visible[visible.length - 1] !== mine) return
      if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && (ev.key === 'k' || ev.key === 'K')) {
        ev.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if ((ev.key === '@' || ev.key === '/') && !ev.defaultPrevented && !ev.isComposing && ev.keyCode !== 229 &&
          !ev.metaKey && !ev.ctrlKey && !ev.altKey && !isEditableTarget(ev.target) &&
          !(ev.target instanceof Element && ev.target.closest('[role="dialog"], [role="menu"]'))) {
        ev.preventDefault()
        focusFloatingComposer(ev.key)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const applyPreset = (preset: WorkspacePresetId) => {
    if (preset === 'focus') {
      setShowRight(false)
      setSplitMode('single')
    } else if (preset === 'compare') {
      setShowRight(false)
      setSplitMode('horizontal')
    } else {
      setShowRight(hasInspector)
      setSplitMode('single')
    }
    // Focus rescue: keep keyboard focus inside the shell if a side column collapsed
    if (typeof document !== 'undefined' && document.activeElement === document.body) {
      rootRef.current?.focus()
    }
  }

  const handleSync = async (signal?: AbortSignal) => {
    if (syncInFlight.current) {
      if (signal) throw Object.assign(new Error('muweave/bundle_sync_in_progress'), { code: 'muweave/bundle_sync_in_progress' })
      return undefined
    }
    syncInFlight.current = true
    setSyncing(true)
    try {
      // The host performs this write to completion. Keep its receipt even if the composer stops waiting.
      const response = await rpc.call<{ index: MuweaveIndexV1 }>('bundle.sync', {})
      if (signal && !response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code })
      const index = response.ok ? response.data?.index : undefined
      if (signal && (!index || !Array.isArray(index.elements) || !Number.isSafeInteger(index.counts?.total) || !Number.isSafeInteger(index.revision))) {
        throw Object.assign(new Error('muweave/composer_sync_receipt_missing'), { code: 'muweave/composer_sync_receipt_missing' })
      }
      if (signal && index) publishKnownElementsForTriggers(index.elements)
      await onSyncRequested?.()
      setLocalRefresh((n) => n + 1)
      setSyncedAt(new Date().toLocaleTimeString(t('langCode') === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' }))
      return index
    } finally {
      syncInFlight.current = false
      setSyncing(false)
    }
  }
  // The palette is memoised on a narrow dependency list, so it must read the newest handler.
  const handleSyncRef = useRef(handleSync)
  handleSyncRef.current = handleSync
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    return mountComposerWorkspace(root, {
      openPalette: () => setPaletteOpen(true),
      syncBundle: async (signal) => {
        const index = await handleSyncRef.current(signal)
        if (!index) throw Object.assign(new Error('muweave/composer_sync_receipt_missing'), { code: 'muweave/composer_sync_receipt_missing' })
        return { count: index.counts.total, revision: index.revision }
      },
    })
  }, [])

  const isNarrow = containerWidth < 860
  const effectiveRight = showRight && hasInspector && !isNarrow
  const gridTemplateColumns = effectiveRight ? 'minmax(0, 1fr) 19rem' : 'minmax(0, 1fr)'

  // Derived rather than stored, so the segmented control always reflects manual pane toggles.
  const activePreset: WorkspacePresetId | undefined =
    splitMode === 'horizontal' && !showRight
      ? 'compare'
      : splitMode === 'single' && !showRight
        ? 'focus'
        : splitMode === 'single' && showRight === hasInspector
          ? 'balanced'
          : undefined

  const currentTab = stageTabs.find((st) => st.id === activeTabId) ?? stageTabs[0]
  const compareOpen = splitMode !== 'single' && compareSecondary !== null

  const viewControls = (
    <>
      <Segmented<WorkspacePresetId>
        label={t('layoutLabel')}
        value={activePreset}
        onChange={applyPreset}
        options={[
          { value: 'balanced', label: t('presetBalanced') },
          { value: 'focus', label: t('presetFocus') },
          { value: 'compare', label: t('presetCompare') },
        ]}
      />
      <Segmented<StageSplitMode>
        label={t('splitLabel')}
        value={splitMode}
        onChange={setSplitMode}
        options={[
          { value: 'single', label: t('tabSingle'), icon: 'splitSingle' },
          { value: 'horizontal', label: t('tabSplitH'), icon: 'splitH' },
          { value: 'vertical', label: t('tabSplitV'), icon: 'splitV' },
        ]}
      />
      {hasInspector ? (
        <IconButton
          icon="panelRight"
          size="sm"
          label={t('toggleRightPane')}
          pressed={showRight}
          onClick={() => setShowRight((v) => !v)}
        />
      ) : null}
    </>
  )

  const paletteItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = []
    const activeRoom = getActiveTheaterRoomId()
    for (const room of getTheaterRooms()) {
      items.push({
        id: `room-${room.id}`,
        group: t('commandGroupRooms'),
        label: room.title(),
        hint: t('paletteFocusRoom'),
        current: room.id === activeRoom,
        run: () => setActiveTheaterRoom(room.id),
      })
    }
    for (const tab of stageTabs) {
      items.push({
        id: `view-${tab.id}`,
        group: t('commandGroupViews'),
        label: tab.label(),
        hint: t('paletteFocusView'),
        current: tab.id === currentTab?.id,
        run: () => setActiveTabId(tab.id),
      })
    }
    items.push(
      {
        id: 'action-generate',
        group: t('commandGroupActions'),
        label: t('paletteGenerate'),
        icon: 'spark',
        run: () => {
          const launcher = rootRef.current?.querySelector<HTMLButtonElement>('[data-muweave-generate-open]')
          launcher?.click()
        },
      },
      { id: 'action-agent', group: t('commandGroupActions'), label: t('paletteAgent'), icon: 'at', run: () => focusFloatingComposer() },
      {
        id: 'action-sync',
        group: t('commandGroupActions'),
        label: t('paletteSync'),
        icon: 'sync',
        run: () => {
          void handleSyncRef.current()
        },
      },
      { id: 'action-view', group: t('commandGroupActions'), label: t('paletteView'), icon: 'sliders', run: () => setViewMenuOpen(true) },
    )
    if (hasLeft) {
      items.push({ id: 'action-filter', group: t('commandGroupActions'), label: t('paletteFilter'), icon: 'filter', run: () => setFilterOpen(true) })
    }
    return items
    // handleSync is reached through a ref so this list can stay narrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageTabs, currentTab?.id, hasLeft, t])

  return (
    <div ref={rootRef} className="mw-dsh-root" tabIndex={-1} data-muweave-workspace-root="true">
      <AmbientBackdrop />
      <header className="mw-dsh-topbar">
        {chrome ? (
          <div className="mw-dsh-title-group" data-theater="true">
            <h1 className="mw-sr-only">{title}</h1>
            {chrome.switcher}
            {/* The room hero carries the subtitle here; repeating it would push the toolbar to a second row. */}
            {subtitle && !hero ? <p className="mw-dsh-subtitle">{subtitle}</p> : null}
          </div>
        ) : (
          <div className="mw-dsh-title-group">
            <h1 className="mw-dsh-title">{title}</h1>
            {subtitle ? <p className="mw-dsh-subtitle">{subtitle}</p> : null}
          </div>
        )}

        <div className="mw-dsh-toolbar" role="toolbar" aria-label={title}>
          {headerActions}
          <GenerationLauncher rpc={rpc} t={t} stage={stage ?? ROOM_STAGE[getActiveTheaterRoomId() ?? '']} />
          <button
            type="button"
            className="mw-dsh-btn"
            data-variant="quiet"
            aria-label={syncing ? t('syncingBundle') : t('syncBundle')}
            title={t('syncBundle')}
            disabled={syncing}
            onClick={() => void handleSync()}
          >
            <Icon name="sync" />
            {isNarrow ? null : (
              <span>{syncing ? t('syncingBundle') : syncedAt ? `${t('syncedAt')} ${syncedAt}` : t('syncShort')}</span>
            )}
          </button>
          <IconButton
            icon="command"
            size="sm"
            label={t('commandOpenHint')}
            pressed={paletteOpen}
            onClick={() => setPaletteOpen(true)}
          />
          {chrome?.trailing}
        </div>
      </header>

      {notice ? (
        <div className="mw-dsh-notice" data-tone={notice.tone ?? 'neutral'} role="status">
          <span className="mw-dot" />
          <p>{notice.text}</p>
          {onDismissNotice ? <IconButton icon="close" size="sm" label={t('dismissNotice')} onClick={onDismissNotice} /> : null}
        </div>
      ) : null}

      <div className="mw-dsh-workspace-grid" style={{ gridTemplateColumns }}>
        <main className="mw-dsh-col" data-muweave-pane="stage">
          <div className="mw-dsh-stage-scroll">
            {projectBar ? <div className="mw-stage-projectbar">{projectBar}</div> : null}
            {hero}
            <div className="mw-dsh-stagebar">
              {stageTabs.length > 1 ? (
                <div className="mw-dsh-tablist" role="tablist" aria-label={title}>
                  {stageTabs.map((tab) => (
                    <button
                      key={tab.id}
                      role="tab"
                      type="button"
                      className="mw-dsh-tab"
                      id={`mw-tab-${tab.id}`}
                      aria-selected={currentTab?.id === tab.id}
                      aria-controls={`mw-tabpanel-${tab.id}`}
                      onClick={() => setActiveTabId(tab.id)}
                    >
                      {tab.label()}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mw-spacer" />
              )}

              <div className="mw-dsh-stage-actions">
                {hasLeft ? (
                  <div ref={filterBtnRef} className="mw-dsh-pop">
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-variant="ghost"
                      data-size="sm"
                      aria-label={t('filterPaneLabel')}
                      aria-expanded={filterOpen}
                      aria-haspopup="true"
                      onClick={() => setFilterOpen((v) => !v)}
                    >
                      <Icon name="filter" />
                      {isNarrow ? null : <span>{t('filterPane')}</span>}
                    </button>
                    {filterOpen ? (
                      <div
                        className="mw-dsh-viewctl mw-dsh-filter-panel"
                        data-popover="true"
                        data-muweave-pane="left"
                        onKeyDown={(ev) => {
                          if (ev.key === 'Escape') {
                            ev.stopPropagation()
                            setFilterOpen(false)
                          }
                        }}
                      >
                        {leftTree}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div ref={viewBtnRef} className="mw-dsh-pop">
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-variant="ghost"
                    data-size="sm"
                    aria-label={t('viewMenu')}
                    aria-expanded={viewMenuOpen}
                    aria-haspopup="true"
                    onClick={() => setViewMenuOpen((v) => !v)}
                  >
                    <Icon name="sliders" />
                    {isNarrow ? null : <span>{t('viewMenu')}</span>}
                  </button>
                  {viewMenuOpen ? (
                    <div
                      className="mw-dsh-viewctl"
                      data-popover="true"
                      onKeyDown={(ev) => {
                        if (ev.key === 'Escape') {
                          ev.stopPropagation()
                          setViewMenuOpen(false)
                        }
                      }}
                    >
                      {viewControls}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mw-dsh-stage-body">
              <div
                className="mw-dsh-stage-split"
                data-split={compareOpen ? splitMode : 'single'}
                role="tabpanel"
                id={currentTab ? `mw-tabpanel-${currentTab.id}` : undefined}
                aria-labelledby={currentTab ? `mw-tab-${currentTab.id}` : undefined}
              >
                <div>
                  {currentTab?.render({
                    splitMode,
                    onPinCompare: (node) => {
                      setCompareSecondary(node)
                      if (splitMode === 'single') setSplitMode('horizontal')
                    },
                  })}
                </div>

                {compareOpen ? (
                  <section className="mw-dsh-compare-pane mw-stack" data-gap="sm" data-muweave-compare-secondary="true">
                    <div className="mw-spread">
                      <span className="mw-eyebrow">{t('presetCompare')}</span>
                      <IconButton
                        icon="close"
                        size="sm"
                        label={t('closeCompare')}
                        onClick={() => {
                          setCompareSecondary(null)
                          setSplitMode('single')
                        }}
                      />
                    </div>
                    {compareSecondary}
                  </section>
                ) : null}
              </div>

              {splitMode !== 'single' && !compareOpen ? (
                <div className="mw-dsh-compare-hint" data-muweave-compare-secondary="true">
                  <Icon name="pin" />
                  <span>{t('compareEmptyHint')}</span>
                </div>
              ) : null}
            </div>
          </div>
        </main>

        {effectiveRight ? (
          <aside className="mw-dsh-col" data-muweave-pane="inspector">
            {rightInspector}
          </aside>
        ) : null}
      </div>

      {isNarrow && hasInspector && showRight ? (
        <aside className="mw-dsh-col" data-muweave-pane="inspector">
          {rightInspector}
        </aside>
      ) : null}

      <ProgressStrip
        rpc={rpc}
        t={t}
        refreshTrigger={refreshCounter + localRefresh}
        onReconciled={() => setLocalRefresh((n) => n + 1)}
      />

      <CommandPalette open={paletteOpen} items={paletteItems} t={t} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
