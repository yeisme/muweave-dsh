import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MuweaveElementSummaryV1 } from '../protocol'
import type { MuweaveTranslator } from './i18n'
import { getActiveTheaterRoomId, subscribeTheater } from './theater/registry'
import { Icon, IconButton } from './ui'

export type FloatingAgentMode = 'pill' | 'bar' | 'panel'

export interface PageRectBounds {
  left: number
  width: number
}

export interface StagedComposerItem {
  id: string
  kind: 'element' | 'template' | 'skill'
  ref: string
  label: string
  serializedLine: string
}

interface FloatingAgentStoreState {
  activeMuweavePanelIds: Set<string>
  pageBounds: PageRectBounds | undefined
  mode: FloatingAgentMode
  staged: StagedComposerItem[]
  draftText: string
  knownElements: MuweaveElementSummaryV1[]
}

interface SharedFloatingStoreHolder {
  state: FloatingAgentStoreState
  listeners: Set<() => void>
}

declare global {
  // eslint-disable-next-line no-var
  var __YEISME_MUWEAVE_FLOAT_STORE__: SharedFloatingStoreHolder | undefined
}

function getHolder(): SharedFloatingStoreHolder {
  if (!globalThis.__YEISME_MUWEAVE_FLOAT_STORE__) {
    globalThis.__YEISME_MUWEAVE_FLOAT_STORE__ = {
      state: {
        activeMuweavePanelIds: new Set<string>(),
        pageBounds: undefined,
        mode: 'bar',
        staged: [],
        draftText: '',
        knownElements: [],
      },
      listeners: new Set<() => void>(),
    }
  }
  return globalThis.__YEISME_MUWEAVE_FLOAT_STORE__
}

function notifyListeners(): void {
  for (const fn of getHolder().listeners) fn()
}

export function subscribeFloatingAgent(listener: () => void): () => void {
  const h = getHolder()
  h.listeners.add(listener)
  return () => {
    h.listeners.delete(listener)
  }
}

export function getFloatingAgentSnapshot(): FloatingAgentStoreState {
  return getHolder().state
}

export function registerMuweavePanelId(panelId: string): () => void {
  const h = getHolder()
  const nextSet = new Set(h.state.activeMuweavePanelIds)
  nextSet.add(panelId)
  h.state = { ...h.state, activeMuweavePanelIds: nextSet }
  notifyListeners()
  return () => {
    const cur = getHolder()
    const afterSet = new Set(cur.state.activeMuweavePanelIds)
    afterSet.delete(panelId)
    cur.state = { ...cur.state, activeMuweavePanelIds: afterSet }
    notifyListeners()
  }
}

export function publishMuweavePageBounds(bounds: PageRectBounds | undefined): void {
  const h = getHolder()
  h.state = { ...h.state, pageBounds: bounds }
  notifyListeners()
}

export function publishKnownElementsForTriggers(elements: MuweaveElementSummaryV1[]): void {
  const h = getHolder()
  h.state = { ...h.state, knownElements: elements }
  notifyListeners()
}

export function setFloatingAgentMode(mode: FloatingAgentMode): void {
  const h = getHolder()
  h.state = { ...h.state, mode }
  notifyListeners()
}

export function setFloatingAgentDraft(text: string): void {
  const h = getHolder()
  h.state = { ...h.state, draftText: text }
  notifyListeners()
}

export function stageItemToFloatingAgent(item: Omit<StagedComposerItem, 'id'>): void {
  const h = getHolder()
  const exists = h.state.staged.some((s) => s.kind === item.kind && s.ref === item.ref)
  const nextStaged = exists
    ? h.state.staged
    : [...h.state.staged, { ...item, id: `${item.kind}:${item.ref}` }]
  const nextMode = h.state.mode === 'pill' ? 'bar' : h.state.mode
  h.state = { ...h.state, staged: nextStaged, mode: nextMode }
  notifyListeners()
}

export function removeStagedItemFromFloatingAgent(id: string): void {
  const h = getHolder()
  const nextStaged = h.state.staged.filter((s) => s.id !== id)
  if (nextStaged.length === h.state.staged.length) return
  h.state = { ...h.state, staged: nextStaged }
  notifyListeners()
}

export function clearFloatingAgentStaged(): void {
  const h = getHolder()
  h.state = { ...h.state, staged: [] }
  notifyListeners()
}

interface QuickPromptChip {
  id: string
  labelZh: string
  labelEn: string
  promptZh: string
  promptEn: string
}

const ROOM_QUICK_CHIPS: Record<string, readonly QuickPromptChip[]> = {
  'muweave-drama': [
    { id: 'drama-missing', labelZh: '诊断缺媒镜头', labelEn: 'Diagnose missing media', promptZh: '请诊断当前剧集分镜中缺失关键帧、视频或音频的镜头，并按优先级给出补齐建议。', promptEn: 'Diagnose shots missing keyframe, video, or audio and prioritize fixes.' },
    { id: 'drama-revisions', labelZh: '汇总待修改批注', labelEn: 'Summarize revisions', promptZh: '请汇总当前所有标为「需修改」的镜头批注，整理成可执行返工清单。', promptEn: 'Summarize all needs_revision director notes into an actionable checklist.' },
  ],
  'muweave-script': [
    { id: 'script-hook', labelZh: '精修前3秒钩子', labelEn: 'Polish 3s hook', promptZh: '请检查本集开场前 3 秒钩子与核心冲突，给出更有张力的竖屏短剧改写建议。', promptEn: 'Review and sharpen the opening 3-second hook and conflict for vertical drama.' },
    { id: 'script-breakdown', labelZh: '按本场拆解 9:16 分镜', labelEn: 'Break down 9:16 shots', promptZh: '请按当前剧本场次拆解 9:16 竖屏分镜表，注明景别、运镜与建议时长。', promptEn: 'Break down the current script scene into a 9:16 vertical storyboard with timing.' },
  ],
  'muweave-eikona': [
    { id: 'eikona-turnaround', labelZh: '角色三视图配方', labelEn: 'Character turnaround', promptZh: '请为当前主角生成一致性角色三视图提示词配方（正面/侧面/背面）。', promptEn: 'Draft a consistent 3-view character turnaround prompt recipe.' },
    { id: 'eikona-sunburst', labelZh: '核对 Sunburst 规格', labelEn: 'Check Sunburst spec', promptZh: '请核对当前视觉候选的 Sunburst 像素尺寸（WxH）与画幅比例是否合规。', promptEn: 'Verify Sunburst WxH pixel dimensions and aspect ratios for current candidates.' },
  ],
  'muweave-schedule': [
    { id: 'sched-week', labelZh: '建议本周排期', labelEn: 'Suggest weekly plan', promptZh: '请结合待排池与当前交付节点，建议本周最优发布排期方案。', promptEn: 'Suggest an optimal publishing schedule for this week from the backlog.' },
    { id: 'sched-risks', labelZh: '检查阻塞交付项', labelEn: 'Check blocked items', promptZh: '请排查本月已排内容中尚未就绪或存在资产阻塞的风险项。', promptEn: 'Check scheduled items this month for unready assets or delivery blockers.' },
  ],
}

const DEFAULT_QUICK_CHIPS: readonly QuickPromptChip[] = [
  { id: 'default-progress', labelZh: '汇总当前制作进度', labelEn: 'Production status', promptZh: '请汇总当前工作区的剧本、视觉、分镜与排期整体进度。', promptEn: 'Summarize current script, visual, storyboard, and schedule progress.' },
  { id: 'default-diagnose', labelZh: '检查阻塞与缺口', labelEn: 'Check blockers', promptZh: '请检查当前项目中的资产阻塞、审片待改项与未同步状态。', promptEn: 'Check project asset blockers, pending revisions, and sync health.' },
]

export interface DshFloatingAgentProps {
  t: MuweaveTranslator
  usePanelInfo?: <R>(selector: (info: { activePanelId: string | null }) => R) => R
  activePanelIdFallback?: string | null
  onJumpToNativeSession?: (sessionId?: string, composedText?: string) => void
  resolveCurrentSessionId?: () => string | undefined
}

/**
 * Three-state Floating Agent mounted in DSH `shell.overlay`:
 * - Only renders when `activePanelId` belongs to one of our MuWeave global panels.
 * - Constrained strictly inside `.mw-dsh-root` published rectangle (`pageBounds`) so at 390px/768px
 *   it NEVER overlaps DSH's 56px left rail or `[data-slot="settings.launcher"] button`.
 * - Every mode (`pill`, `bar`, `panel`) carries `data-ready="true"` so accessibility trees never drop it.
 */
export function FloatingAgentOverlay({
  t,
  usePanelInfo,
  activePanelIdFallback,
  onJumpToNativeSession,
  resolveCurrentSessionId,
}: DshFloatingAgentProps) {
  const snap = useSyncExternalStore(subscribeFloatingAgent, getFloatingAgentSnapshot, getFloatingAgentSnapshot)
  const activeRoomId = useSyncExternalStore(subscribeTheater, getActiveTheaterRoomId, getActiveTheaterRoomId)
  const [, setTick] = useState(0)

  useEffect(() => {
    const onResize = () => setTick((n) => n + 1)
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    return undefined
  }, [])

  const hostActivePanel = usePanelInfo
    ? usePanelInfo((info) => info.activePanelId)
    : (activePanelIdFallback ?? null)

  if (!hostActivePanel || !snap.activeMuweavePanelIds.has(hostActivePanel)) {
    return null
  }

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
  // Leave at least 68px on the left when pageBounds has not measured yet so 56px rail + settings launcher stay clear
  const minSafeLeft = viewportWidth <= 900 ? 68 : 80
  const rawLeft = snap.pageBounds ? Math.max(snap.pageBounds.left + 8, minSafeLeft) : minSafeLeft
  const availableWidth = snap.pageBounds
    ? Math.max(220, Math.min(snap.pageBounds.width - 16, viewportWidth - rawLeft - 12))
    : Math.max(220, viewportWidth - rawLeft - 16)

  const targetWidth = snap.mode === 'pill' ? Math.min(180, availableWidth) : Math.min(680, availableWidth)
  const computedLeft =
    snap.mode === 'pill'
      ? rawLeft + availableWidth - targetWidth
      : rawLeft + Math.max(0, Math.floor((availableWidth - targetWidth) / 2))

  const handleOpenInConversation = () => {
    const sid = resolveCurrentSessionId?.()
    const composedLines = [
      ...snap.staged.map((s) => s.serializedLine),
      snap.draftText.trim(),
    ].filter(Boolean)
    onJumpToNativeSession?.(sid, composedLines.join('\n'))
  }

  // Coordinates are measured in px by the host; they are the only inline values on the overlay.
  const position = { left: `${computedLeft}px`, width: `${targetWidth}px` }

  const isEn = t('langCode') === 'en'
  const quickChips = (activeRoomId ? ROOM_QUICK_CHIPS[activeRoomId] : undefined) ?? DEFAULT_QUICK_CHIPS

  const stagedChips = snap.staged.map((item) => (
    <span key={item.id} className="mw-chip" data-staged-chip={item.kind} title={item.serializedLine}>
      <span>{`@${item.label}`}</span>
      <button
        type="button"
        className="mw-chip-remove"
        data-remove-staged-chip={item.id}
        aria-label={isEn ? `Remove ${item.label}` : `移除 ${item.label}`}
        onClick={() => removeStagedItemFromFloatingAgent(item.id)}
      >
        ×
      </button>
    </span>
  ))

  const quickChipsRow = (
    <div className="mw-float-quick-chips" data-float-quick-chips="true" data-active-room={activeRoomId ?? 'default'}>
      {quickChips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className="mw-float-quick-chip"
          data-quick-chip={chip.id}
          onClick={() => setFloatingAgentDraft(isEn ? chip.promptEn : chip.promptZh)}
        >
          {isEn ? chip.labelEn : chip.labelZh}
        </button>
      ))}
    </div>
  )

  if (snap.mode === 'pill') {
    return (
      <aside
        className="mw-dsh-float-root mw-fa-bottom"
        data-muweave-floating-agent="pill"
        data-ready="true"
        role="region"
        aria-label={t('agentPillLabel')}
        style={position}
      >
        <button type="button" className="mw-dsh-btn mw-fa-pill" onClick={() => setFloatingAgentMode('bar')}>
          <span className="mw-fa-spark">
            <Icon name="spark" />
          </span>
          {t('agentPillLabel')}
          {snap.staged.length > 0 ? <span className="mw-chip">{snap.staged.length}</span> : null}
        </button>
      </aside>
    )
  }

  const compact = targetWidth < 400

  return (
    <section
      className="mw-dsh-float-root mw-fa-bottom"
      data-muweave-floating-agent={snap.mode}
      data-ready="true"
      role="dialog"
      aria-modal="false"
      aria-label={t('agentPillLabel')}
      style={position}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !snap.draftText.trim() && snap.staged.length === 0) {
          e.preventDefault()
          setFloatingAgentMode('pill')
        }
      }}
    >
      {snap.mode === 'panel' ? (
        <div className="mw-fa-panel">
          <div className="mw-spread">
            <span className="mw-row" data-gap="xs">
              <span className="mw-fa-spark">
                <Icon name="spark" />
              </span>
              <strong>{t('agentPillLabel')}</strong>
            </span>
            <span className="mw-row" data-gap="xs">
              <IconButton
                icon="external"
                size="sm"
                label={t('agentOpenNativeSession')}
                onClick={handleOpenInConversation}
              />
              <IconButton
                icon="collapse"
                size="sm"
                label={t('agentCollapseBar')}
                onClick={() => setFloatingAgentMode('bar')}
              />
            </span>
          </div>

          {snap.staged.length > 0 ? (
            <div className="mw-stack" data-gap="xs">
              <div className="mw-spread">
                <span className="mw-dsh-muted">{t('agentQueuedRefsTitle')}</span>
                <button
                  type="button"
                  className="mw-dsh-btn"
                  data-variant="ghost"
                  data-size="sm"
                  onClick={() => clearFloatingAgentStaged()}
                >
                  {t('agentClearQueue')}
                </button>
              </div>
              <div className="mw-row" data-gap="xs">
                {stagedChips}
              </div>
            </div>
          ) : (
            // The input row already carries the placeholder; repeating it here wastes the panel body.
            <p className="mw-fa-hint">{t('agentPanelHint')}</p>
          )}
          {quickChipsRow}
        </div>
      ) : (
        <>
          {snap.staged.length > 0 ? (
            <div className="mw-row" data-gap="xs">
              {stagedChips}
              <IconButton icon="close" size="sm" label={t('agentClearQueue')} onClick={() => clearFloatingAgentStaged()} />
            </div>
          ) : null}
          {quickChipsRow}
        </>
      )}

      <div className="mw-fa-input-row">
        <span className="mw-fa-spark" aria-hidden="true">
          <Icon name="spark" />
        </span>
        <input
          type="text"
          className="mw-fa-input"
          aria-label={t('agentPillLabel')}
          placeholder={t('agentBarPlaceholder')}
          value={snap.draftText}
          onChange={(e) => setFloatingAgentDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && (snap.draftText.trim() || snap.staged.length > 0)) {
              e.preventDefault()
              handleOpenInConversation()
            }
          }}
        />
        {snap.mode === 'bar' && !compact ? (
          <IconButton icon="expand" label={t('agentExpandPanel')} onClick={() => setFloatingAgentMode('panel')} />
        ) : null}
        <IconButton icon="minimize" label={t('agentMinimizePill')} onClick={() => setFloatingAgentMode('pill')} />
        <IconButton icon="send" variant="primary" label={t('agentSend')} onClick={handleOpenInConversation} />
      </div>
    </section>
  )
}

/** Focus the composer input, optionally seeding the first keystroke (e.g. the "/" that opened it). */
export function focusFloatingComposer(seed?: string): void {
  setFloatingAgentMode('panel')
  requestAnimationFrame(() => {
    const host =
      document.querySelector('[data-muweave-floating-agent]') ??
      document.querySelector('.mw-dsh-float-root')
    const input = host?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    if (!input) return
    if (seed && seed.length === 1) {
      const current = input.value ?? ''
      if (!current.startsWith(seed)) setFloatingAgentDraft(seed + current)
    }
    input.focus()
    const end = input.value.length
    input.setSelectionRange?.(end, end)
  })
}

export interface ComposerWorkspaceHandlers {
  openPalette: () => void
  syncBundle: (signal?: AbortSignal) => Promise<unknown>
  openKeymap?: () => void
}

/**
 * Mounts the composer's host-level wiring for one workspace root: shortcut plumbing that does not
 * belong to any single room. Returns a disposer, mirroring the other mount* helpers.
 */
export function mountComposerWorkspace(
  root: HTMLElement,
  handlers: ComposerWorkspaceHandlers,
): () => void {
  let disposed = false
  const onKeyDown = (event: KeyboardEvent) => {
    if (disposed) return
    const mod = event.metaKey || event.ctrlKey
    if (mod && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault()
      handlers.openPalette()
      return
    }
    if (event.key === '?' && !mod && !event.altKey) {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      handlers.openKeymap?.()
    }
  }
  root.addEventListener('keydown', onKeyDown)
  return () => {
    disposed = true
    root.removeEventListener('keydown', onKeyDown)
  }
}
