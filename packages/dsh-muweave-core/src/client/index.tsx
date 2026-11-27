import type { ComponentType } from 'react'
import {
  FloatingAgentOverlay,
  getFloatingAgentSnapshot,
  publishKnownElementsForTriggers,
  registerMuweavePanelId,
  removeStagedItemFromFloatingAgent,
  stageItemToFloatingAgent,
  type FloatingAgentMode,
} from './floating-agent'
import {
  MUWEAVE_DICTIONARIES,
  MUWEAVE_LOCALE_NS,
  createFallbackTranslator,
  type MuweaveDictKey,
  type MuweaveTranslator,
} from './i18n'
import { ProgressStrip } from './progress-strip'
import { createMuweaveRpcClient, getSharedMuweaveRpcClient, type MuweaveRpcClient } from './rpc-client'
import { mountMuweaveCoreStyles } from './styles'
import {
  CREATOR_CHINESE_SKILLS,
  createMuweaveElementAtSource,
  createMuweaveSlashSource,
  type DshInputTriggerSourceLike,
} from './triggers'
import { appendSessionLog, elementIdFromRef } from './session-log'
import { DramaSessionView } from './session-view'
import {
  THEATER_COMPANION_ID,
  THEATER_PANEL_ID,
  joinTheaterSeat,
  registerTheaterRoom,
  roomIdForDomain,
  setActiveTheaterRoom,
} from './theater/registry'
import { TheaterCompanion, TheaterHeaderAction, TheaterPage, useTheaterRooms } from './theater/TheaterPage'
import { WorkspaceShell, type CreatorPaneSpec, type CreatorStageTabSpec, type StageSplitMode } from './workspace-shell'

export type DshDisposer = () => void | Promise<void>

/** Sidebar order of the single 「做剧剧场」 entry (the old first plugin page's slot). */
export const THEATER_ORDER = 41

export type DshOptionalService = { registerSource?: (src: DshInputTriggerSourceLike) => DshDisposer } | undefined

export interface DshClientContextLike {
  effect(execute: () => void | DshDisposer, label?: string): void
  on?(event: string, listener: (...args: unknown[]) => void): DshDisposer
  inject?(deps: readonly string[], callback: (subCtx: DshClientContextLike) => void): void
  get?(name: string): DshOptionalService
  slots: {
    inject(key: string, callback: () => void | DshDisposer): void | DshDisposer
    register(options: Record<string, unknown>, component: ComponentType<any>): DshDisposer
  }
  locale: {
    register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): DshDisposer
    bind(ns: string): (key: string) => string
    getLocale?: () => { active: string }
  }
  sidebarRight?: {
    openTab?(kind: string): void
  }
  sidebarRightTabs?: {
    register(definition: {
      id: string
      kind: string
      title: () => string
      guide?: ReadonlyArray<{
        id: string
        order: number
        title: () => string
        description?: () => string
        icon?: ComponentType<{ size?: number }>
      }>
    }): DshDisposer
  }
  layout?: {
    selectPanel(panelId: string | null): void
    panelInfo?: { getSnapshot(): { activePanelId: string | null } }
  }
  inputTriggers?: {
    registerSource(src: DshInputTriggerSourceLike): DshDisposer
  }
  sessions?: {
    list?: {
      getSnapshot(): {
        byId: Record<
          string,
          {
            id?: string
            cwd?: string
            retainedBy?: { mainView?: number }
            projectionValues?: { agentPreset?: string }
          }
        >
      }
    }
  }
  workspaces?: {
    list?: {
      getSnapshot(): {
        items?: ReadonlyArray<{ workspaceId: string }>
      }
    }
  }
  uiWorkspace?: {
    openSession?(sessionId: string): void
    startSession?(workspaceId: string | undefined, options?: { agentPreset?: string; prompt?: string }): Promise<unknown> | unknown
  }
}

/** A second room registered by the same plugin (the workbench plugin adds 成稿 next to 总览). */
export interface ExtraTheaterRoomSpec {
  panelId: string
  order: number
  title: () => string
  roomTitle?: () => string
  domains?: readonly string[]
  icon: ComponentType<{ size?: number; active?: boolean }>
  MainComponent: ComponentType<{ rpc: MuweaveRpcClient; t: (key: string) => string; coreT: MuweaveTranslator }>
  /** Defaults to the plugin's own companion. */
  CompanionComponent?: ComponentType<{ rpc: MuweaveRpcClient; t: (key: string) => string; coreT: MuweaveTranslator }>
}

export interface RegisterCreatorPluginOptions {
  pluginNamespace: string
  dictionaries: { zh: Record<string, string>; en: Record<string, string> }
  pane: CreatorPaneSpec
  MainComponent: ComponentType<{ rpc: MuweaveRpcClient; t: (key: string) => string; coreT: MuweaveTranslator }>
  CompanionComponent: ComponentType<{ rpc: MuweaveRpcClient; t: (key: string) => string; coreT: MuweaveTranslator }>
  rpc?: MuweaveRpcClient
  /** Register the session 「做剧」 conversation view (only the drama plugin does). */
  sessionView?: { id: string; order: number }
  /** Additional theater rooms owned by this plugin; each is registered and removed with it. */
  extraRooms?: readonly ExtraTheaterRoomSpec[]
}

/** Handles a plugin ctx can only reach inside `ctx.inject(...)` sub-fibers. */
interface OptionalHandles {
  layout?: DshClientContextLike['layout']
  sidebarRight?: DshClientContextLike['sidebarRight']
  sessions?: DshClientContextLike['sessions']
  workspaces?: DshClientContextLike['workspaces']
  uiWorkspace?: DshClientContextLike['uiWorkspace']
}

function resolveCreatorSessionId(handles: OptionalHandles): string | undefined {
  const byId = handles.sessions?.list?.getSnapshot().byId ?? {}
  for (const [sid, row] of Object.entries(byId)) {
    if ((row.retainedBy?.mainView ?? 0) > 0 && row.projectionValues?.agentPreset === 'muweave-creator') return sid
  }
  for (const [sid, row] of Object.entries(byId)) {
    if (row.projectionValues?.agentPreset === 'muweave-creator') return sid
  }
  return undefined
}

function sessionIdFromStartResult(res: unknown): string | undefined {
  if (typeof res === 'string') return res
  if (res && typeof res === 'object') {
    const r = res as { sessionId?: unknown; id?: unknown }
    if (typeof r.sessionId === 'string') return r.sessionId
    if (typeof r.id === 'string') return r.id
  }
  return undefined
}

/** Open the theater, optionally at the room owning the element behind a trigger ref. */
export function openTheater(layout: DshClientContextLike['layout'], target?: { roomId?: string; ref?: string }): void {
  let roomId = target?.roomId
  if (!roomId && target?.ref) {
    const elementId = elementIdFromRef(target.ref)
    const el = getFloatingAgentSnapshot().knownElements.find((e) => e.elementId === elementId)
    roomId = roomIdForDomain(el?.domain)
  }
  if (roomId) setActiveTheaterRoom(roomId)
  layout?.selectPanel(THEATER_PANEL_ID)
}

/**
 * Universal registration helper for all 5 MuWeave DSH plugins:
 * 1. Registers the plugin dictionary, shared core styles and the plugin's theater room;
 * 2. Joins the shared seats. Exactly one live plugin holds each seat at a time and hands it on
 *    when unloaded: the single 「做剧剧场」 global page (`sidebar.panellist` + `main`, never
 *    selected at startup), its one right-sidebar tab, the session header action, the core
 *    dictionary, the `shell.overlay` floating agent, and the `@` / `/` input triggers.
 */
export function registerMuweaveCreatorPlugin(
  ctx: DshClientContextLike,
  options: RegisterCreatorPluginOptions,
): void {
  const rpc = options.rpc ?? getSharedMuweaveRpcClient()
  const pane = options.pane

  const pluginTRef = { current: ctx.locale.bind(options.pluginNamespace) }
  const coreT = ((key: MuweaveDictKey) => {
    const bound = ctx.locale.bind(MUWEAVE_LOCALE_NS)
    return bound(key) || createFallbackTranslator('zh')(key)
  }) as MuweaveTranslator

  ctx.effect(() => ctx.locale.register(options.pluginNamespace, options.dictionaries), `${pane.pluginId}: dict`)
  ctx.effect(() => mountMuweaveCoreStyles(), `${pane.pluginId}: core styles`)

  if (ctx.on) {
    const on = ctx.on.bind(ctx)
    ctx.effect(
      () =>
        on('locale/change', () => {
          pluginTRef.current = ctx.locale.bind(options.pluginNamespace)
        }),
      `${pane.pluginId}: locale/change`,
    )
  }

  // Optional service handles populated strictly inside `ctx.inject(...)` sub-fibers so Cordis
  // Context proxies never throw `cannot get property "..." without inject`.
  const optHandles: OptionalHandles = {}
  if (typeof ctx.inject === 'function') {
    ctx.inject(['layout'], (sub) => {
      optHandles.layout = sub.layout
    })
    ctx.inject(['sidebarRight'], (sub) => {
      optHandles.sidebarRight = sub.sidebarRight
    })
    ctx.inject(['sessions', 'workspaces', 'uiWorkspace'], (sub) => {
      optHandles.sessions = sub.sessions
      optHandles.workspaces = sub.workspaces
      optHandles.uiWorkspace = sub.uiWorkspace
    })
  } else {
    // Plain-object unit test mock fallback
    optHandles.layout = ctx.layout
    optHandles.sidebarRight = ctx.sidebarRight
    optHandles.sessions = ctx.sessions
    optHandles.workspaces = ctx.workspaces
    optHandles.uiWorkspace = ctx.uiWorkspace
  }

  // Prime trigger cache with current .muweave/ elements in background
  ctx.effect(() => {
    let cancelled = false
    void rpc
      .call<{ elements: Array<any> }>('bundle.elements.list', {})
      .then((res) => {
        if (!cancelled && res.ok && Array.isArray(res.data.elements)) {
          publishKnownElementsForTriggers(res.data.elements)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, `${pane.pluginId}: prime element cache`)

  const MainBound = () => (
    <options.MainComponent rpc={rpc} t={(k) => pluginTRef.current(k)} coreT={coreT} />
  )
  const CompanionBound = () => (
    <options.CompanionComponent rpc={rpc} t={(k) => pluginTRef.current(k)} coreT={coreT} />
  )

  ctx.effect(
    () =>
      registerTheaterRoom({
        id: pane.panelId,
        order: pane.order,
        title: pane.roomTitle ?? pane.title,
        description: pane.title,
        icon: pane.icon,
        domains: pane.domains ?? [],
        Main: MainBound,
        Companion: CompanionBound,
      }),
    `${pane.pluginId}: theater room`,
  )

  for (const extra of options.extraRooms ?? []) {
    const ExtraMain = () => <extra.MainComponent rpc={rpc} t={(k) => pluginTRef.current(k)} coreT={coreT} />
    const ExtraCompanion = extra.CompanionComponent ?? options.CompanionComponent
    const ExtraCompanionBound = () => <ExtraCompanion rpc={rpc} t={(k) => pluginTRef.current(k)} coreT={coreT} />
    ctx.effect(
      () =>
        registerTheaterRoom({
          id: extra.panelId,
          order: extra.order,
          title: extra.roomTitle ?? extra.title,
          description: extra.title,
          icon: extra.icon,
          domains: extra.domains ?? [],
          Main: ExtraMain,
          Companion: ExtraCompanionBound,
        }),
      `${pane.pluginId}: theater room ${extra.panelId}`,
    )
  }

  const openCompanionWithRetry = (attempt = 0) => {
    setTimeout(() => {
      try {
        optHandles.sidebarRight?.openTab?.(THEATER_COMPANION_ID)
      } catch {
        if (attempt < 6) openCompanionWithRetry(attempt + 1)
      }
    }, 120)
  }

  const jumpToNativeSession = (sid: string | undefined, composedText: string | undefined) => {
    const handed = getFloatingAgentSnapshot().staged
    const logHandoff = (sessionId: string | undefined) => {
      for (const item of handed) {
        appendSessionLog(sessionId, { kind: 'handoff', ref: item.ref, label: item.label, itemKind: item.kind })
      }
    }
    if (sid && optHandles.uiWorkspace?.openSession) {
      logHandoff(sid)
      optHandles.uiWorkspace.openSession(sid)
      openCompanionWithRetry()
    } else if (optHandles.uiWorkspace?.startSession) {
      const wsId = optHandles.workspaces?.list?.getSnapshot().items?.[0]?.workspaceId
      void Promise.resolve(
        optHandles.uiWorkspace.startSession(wsId, {
          agentPreset: 'muweave-creator',
          ...(composedText ? { prompt: composedText } : {}),
        }),
      )
        .then((res) => {
          logHandoff(sessionIdFromStartResult(res))
          openCompanionWithRetry()
        })
        .catch(() => {
          optHandles.layout?.selectPanel(null)
        })
    } else {
      optHandles.layout?.selectPanel(null)
    }
  }

  const OverlayWrapper = (overlayProps: {
    usePanelInfo?: <R>(sel: (info: { activePanelId: string | null }) => R) => R
  }) => (
    <FloatingAgentOverlay
      t={coreT}
      usePanelInfo={overlayProps.usePanelInfo}
      activePanelIdFallback={optHandles.layout?.panelInfo?.getSnapshot().activePanelId ?? null}
      resolveCurrentSessionId={() => resolveCreatorSessionId(optHandles)}
      onJumpToNativeSession={jumpToNativeSession}
    />
  )

  const TheaterMain = () => <TheaterPage t={coreT} onBackToChat={() => optHandles.layout?.selectPanel(null)} />
  const TheaterCompanionBound = () => <TheaterCompanion t={coreT} />
  const TheaterEntryIcon = (props: { size?: number; active?: boolean }) => {
    const rooms = useTheaterRooms()
    const First = rooms[0]?.icon ?? pane.icon
    return <First {...props} />
  }
  const SessionHeaderAction = () => (
    <TheaterHeaderAction t={coreT} onOpen={() => openTheater(optHandles.layout)} />
  )

  const register = (options_: Record<string, unknown>, component: ComponentType<any>) => () =>
    ctx.slots.register(options_, component)

  // The theater seat: one sidebar entry, one main page, one right tab, one header action.
  ctx.effect(
    () =>
      joinTheaterSeat('theater', () => {
        const disposers: Array<DshDisposer | void> = []
        try {
          disposers.push(ctx.locale.register(MUWEAVE_LOCALE_NS, MUWEAVE_DICTIONARIES))
          disposers.push(registerMuweavePanelId(THEATER_PANEL_ID))
          disposers.push(
            ctx.slots.inject(
              'shell.overlay',
              register({ name: 'shell.overlay', id: 'muweave.floating-agent', locale: MUWEAVE_LOCALE_NS }, OverlayWrapper),
            ),
          )
          disposers.push(
            ctx.slots.inject('main', register({ name: 'main', key: THEATER_PANEL_ID, locale: MUWEAVE_LOCALE_NS }, TheaterMain)),
          )
          disposers.push(
            ctx.slots.inject(
              'sidebar.panellist',
              register(
                {
                  name: 'sidebar.panellist',
                  id: THEATER_PANEL_ID,
                  order: THEATER_ORDER,
                  label: () => coreT('theaterTitle'),
                  locale: MUWEAVE_LOCALE_NS,
                },
                TheaterEntryIcon,
              ),
            ),
          )
          if (ctx.sidebarRightTabs) {
            disposers.push(
              ctx.sidebarRightTabs.register({
                id: THEATER_COMPANION_ID,
                kind: THEATER_COMPANION_ID,
                title: () => coreT('theaterCompanionTitle'),
                guide: [
                  {
                    id: `${THEATER_COMPANION_ID}.guide`,
                    order: THEATER_ORDER,
                    title: () => coreT('theaterTitle'),
                    icon: TheaterEntryIcon,
                  },
                ],
              }),
            )
          }
          disposers.push(
            ctx.slots.inject(
              'sidebar.right.pane.tab',
              register({ name: 'sidebar.right.pane.tab', key: THEATER_COMPANION_ID, locale: MUWEAVE_LOCALE_NS }, TheaterCompanionBound),
            ),
          )
          try {
            disposers.push(
              ctx.slots.inject(
                'conversation.session.header.actions',
                register(
                  {
                    name: 'conversation.session.header.actions',
                    id: 'muweave.theater',
                    order: 60,
                    locale: MUWEAVE_LOCALE_NS,
                  },
                  SessionHeaderAction,
                ),
              ),
            )
          } catch {
            // Older hosts without the header action seat keep the sidebar entry only.
          }
        } catch (err) {
          for (const d of disposers.reverse()) void d?.()
          throw err
        }
        return () => {
          for (const d of disposers.reverse()) void d?.()
        }
      }),
    `${pane.pluginId}: theater seat`,
  )

  if (options.sessionView) {
    const view = options.sessionView
    const SessionViewBound = (props: { muweaveSessionId?: string; sessionId?: string }) => (
      <DramaSessionView
        rpc={rpc}
        t={coreT}
        sessionId={props.muweaveSessionId ?? props.sessionId}
        onOpenTheater={(target) => openTheater(optHandles.layout, target)}
      />
    )
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            {
              name: 'conversation.view',
              id: view.id,
              order: view.order,
              locale: MUWEAVE_LOCALE_NS,
              label: () => coreT('sessionViewLabel'),
              inject: (sessionId: string) => ({ muweaveSessionId: sessionId }),
            },
            SessionViewBound,
          ),
        ),
      `${pane.pluginId}: conversation.view`,
    )
  }

  // The trigger seat: `@` elements and `/` skills, registered once across all plugins.
  const claimTriggers = (svc: { registerSource(src: DshInputTriggerSourceLike): DshDisposer }) => () => {
    const dAt = svc.registerSource(
      createMuweaveElementAtSource({
        onOpenElement: (ref) => openTheater(optHandles.layout, { ref }),
        onPicked: (sessionId, pick) =>
          appendSessionLog(sessionId, { kind: 'mentioned', ref: pick.ref, label: pick.label, itemKind: 'element' }),
      }),
    )
    const dSlash = svc.registerSource(createMuweaveSlashSource())
    return () => {
      void dAt?.()
      void dSlash?.()
    }
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['inputTriggers'], (sub) => {
      const triggerSvc = sub.inputTriggers
      if (!triggerSvc?.registerSource) return
      sub.effect(() => joinTheaterSeat('triggers', claimTriggers(triggerSvc)), 'muweave: triggers')
    })
  } else if (ctx.inputTriggers?.registerSource) {
    const triggerSvc = ctx.inputTriggers
    ctx.effect(() => joinTheaterSeat('triggers', claimTriggers(triggerSvc)), `${pane.pluginId}: triggers`)
  }
}

export {
  CREATOR_CHINESE_SKILLS,
  FloatingAgentOverlay,
  MUWEAVE_DICTIONARIES,
  MUWEAVE_LOCALE_NS,
  ProgressStrip,
  WorkspaceShell,
  createFallbackTranslator,
  createMuweaveElementAtSource,
  createMuweaveRpcClient,
  createMuweaveSlashSource,
  getSharedMuweaveRpcClient,
  mountMuweaveCoreStyles,
  publishKnownElementsForTriggers,
  removeStagedItemFromFloatingAgent,
  stageItemToFloatingAgent,
  type CreatorPaneSpec,
  type CreatorStageTabSpec,
  type FloatingAgentMode,
  type MuweaveDictKey,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  type StageSplitMode,
}
export { ALLOWLISTED_CLI_CARDS_BROWSER, BUILTIN_CREATOR_TEMPLATES } from '../host-safe-catalog'
export * from '../protocol'
export {
  Callout,
  CompanionList,
  EmptyState,
  Icon,
  IconButton,
  SectionHead,
  Segmented,
  StatusTag,
  ToneDot,
  type MuweaveIconName,
  type SegmentedOption,
} from './ui'
export { statusLabel, statusTone, type MuweaveTone } from './i18n'

/** Desk v5 motion primitives: delegated pointer tilt plus a reduced-motion probe. */
export { usePrefersReducedMotion, useTiltDelegation } from './motion'
export type { WorkspaceNotice } from './workspace-shell'
export {
  ProgressLine,
  ReadinessDots,
  SceneMini,
  ShotStrip,
  assetIsReady,
  loadDramaDigest,
  useDramaDigest,
  type DigestAsset,
  type DigestShot,
  type DramaDigest,
} from './drama-components'
export { DramaSessionView } from './session-view'
export {
  SESSION_LOG_PREFIX,
  appendSessionLog,
  readSessionLog,
  type SessionLogEntry,
} from './session-log'
export {
  THEATER_COMPANION_ID,
  THEATER_PANEL_ID,
  THEATER_ROOM_STORAGE_KEY,
  getActiveTheaterRoomId,
  getTheaterRoomBadges,
  getTheaterRooms,
  navigateToTheaterRoom,
  publishTheaterRoomBadges,
  setActiveTheaterRoom,
  theaterSeatOwner,
  useTheaterRoomBadges,
  type TheaterRoom,
  type TheaterRoomBadge,
  type TheaterRoomBadgeTone,
} from './theater/registry'
export { ShortcutsHelpModal, type ShortcutsHelpModalProps } from './shortcuts-modal'
export { RoomNav, RoomSwitcher, TheaterPage } from './theater/TheaterPage'
export {
  AmbientBackdrop,
  CoverCollage,
  HeroStat,
  Masonry,
  MediaCard,
  NoteCard,
  PillButton,
  Poster,
  QuoteCard,
  RoomHero,
  type HeroStatItem,
} from './editorial'
export {
  MediaPreview,
  forgetProjectCovers,
  useMediaUrl,
  useProjectCovers,
  type ProjectCover,
  type ProjectCoverRef,
} from './media'
export { GenerationLauncher } from './generation'
export { OrchestrationPanel } from './orchestration-panel'
export { formatKeyHint, isEditableTarget, keyBinding, matchKey, useKeySequence, type KeyBinding } from './keymap'
export {
  closeGeneration,
  getGenerationSnapshot,
  notifyShotMediaChanged,
  openGeneration,
  useGenerationStore,
  type GenerationOpenRequest,
} from './generation-store'
export {
  SHOT_MEDIA_ROLE_LIST,
  ShotGenerateButton,
  ShotMedia,
  keyframeDigest,
  mediaForRole,
  shotDescription,
  shotReadinessSummary,
  type LinkedMediaRef,
  type ShotMediaRole,
  type ShotReadinessSummary,
} from './shot-media'
export {
  AnimaticPlayer,
  type AnimaticAspect,
  type AnimaticPlayerProps,
  type AnimaticShotRow,
} from './animatic-player'
export { OrchestrationHealthBanner, type OrchestrationHealthSummary } from './generation-jobs'
export { ElementChip, SkillChip, FileChip, GenerateChip } from './composer-chips'
export { COMPOSER_ACTIONS, composerActionDisabledReason } from './composer-actions'
export { ToolRunCard } from './tool-run-card'
export {
  useToolCatalog,
  groupToolCatalog,
  toolOwnerLabel,
  toolCatalogIntent,
  unavailableReasonLabel,
  type ToolCatalogEntry,
  type ToolCatalogGroups,
  type ToolCatalogIntent,
} from './tool-catalog'
