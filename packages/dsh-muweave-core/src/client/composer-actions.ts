import type { MuweaveElementSummaryV1, ProductionAnchorV1 } from '../protocol'
import { COMPOSER_DICT_EN, COMPOSER_DICT_ZH } from './composer-chips'
import { openGeneration } from './generation-store'
import { getTheaterRooms, setActiveTheaterRoom } from './theater/registry'
import type { MuweaveIconName } from './ui'

export type ComposerActionScope = 'visual' | 'scene' | 'element' | 'workspace' | 'global'

export interface ComposerActionContext {
  selections: readonly { ref: string; label: string; serializedLine: string }[]
  knownElements: readonly MuweaveElementSummaryV1[]
  draftText: string
  opener: HTMLElement
  signal: AbortSignal
  syncBundle?: (signal: AbortSignal) => Promise<{ count: number; revision: number }>
  openPalette?: () => void
  openKeymap: () => void
}

export type ComposerActionResult =
  | { kind: 'generation'; target: string }
  | { kind: 'schedule'; target: string }
  | { kind: 'sync'; count: number; revision: number }
  | { kind: 'opened' }

export type ComposerActionDisabledReason = 'needVisual' | 'needScene' | 'needElement' | 'unavailable'

export interface ComposerAction {
  id: 'eikona.generate' | 'sonora.voice' | 'schedule.plan' | 'bundle.sync' | 'palette.open' | 'keymap.open'
  labelZh: string
  labelEn: string
  icon: MuweaveIconName
  scope: ComposerActionScope
  run: (ctx: ComposerActionContext) => ComposerActionResult | Promise<ComposerActionResult>
}

export const composerActionLabelKeys = {
  'eikona.generate': 'image',
  'sonora.voice': 'voice',
  'schedule.plan': 'schedule',
  'bundle.sync': 'sync',
  'palette.open': 'palette',
  'keymap.open': 'keymap',
} as const satisfies Record<ComposerAction['id'], keyof typeof COMPOSER_DICT_ZH>

type Selection = ComposerActionContext['selections'][number]

interface SelectionInfo {
  selection: Selection
  element?: MuweaveElementSummaryV1
  anchor: ProductionAnchorV1
  visual: boolean
  scene: boolean
}

function throwActionError(code: string): never {
  throw Object.assign(new Error(code), { code })
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throwActionError('muweave/aborted')
}

function selectedInfo({ selections, knownElements }: Pick<ComposerActionContext, 'selections' | 'knownElements'>): SelectionInfo[] {
  return selections.map((selection) => {
    const [elementId, owner] = selection.ref.split('|')
    const element = knownElements.find((candidate) => candidate.elementId === elementId)
      ?? knownElements.find((candidate) => elementId?.startsWith(candidate.elementId + ':'))
    const serialized = selection.serializedLine
    const shot = /^\[ScaenaShot breakdown=\S+ scene=([^\s\]]+) shot=([^\s\]]+)\]/.exec(serialized)
    const sceneCard = /^\[AuctraSceneCard ref=([^\s\]]+)/.exec(serialized)
    const scene = Boolean(sceneCard || element?.kind === 'script.scene_card')
    const sceneRef = shot?.[1] ?? sceneCard?.[1] ?? element?.sceneRef ?? (scene ? element?.sourceRef : undefined)
    const shotRef = shot?.[2] ?? (element?.shotRefs?.length === 1 ? element.shotRefs[0] : undefined)
    const anchor: ProductionAnchorV1 = {
      ...(element?.episodeRef ? { episodeRef: element.episodeRef } : {}),
      ...(sceneRef ? { sceneRef } : {}),
      ...(shotRef ? { shotRef } : {}),
      ...(element?.characterRefs?.length ? { characterRefs: element.characterRefs } : {}),
    }
    const visual = Boolean(scene || shot || element?.domain === 'eikona' || owner === 'eikona' ||
      /^\[Eikona(?:Run|Artifact)\b/.test(serialized) || element?.kind === 'drama.storyboard_table')
    return { selection, element, anchor, visual, scene }
  })
}

function firstInfo(ctx: ComposerActionContext, predicate: (info: SelectionInfo) => boolean): SelectionInfo | undefined {
  return selectedInfo(ctx).find(predicate)
}

function runImage(ctx: ComposerActionContext): ComposerActionResult {
  ensureNotAborted(ctx.signal)
  const info = firstInfo(ctx, (candidate) => candidate.visual)
  if (!info) throwActionError('muweave/need_visual')
  const text = ctx.draftText.trim()
  const prompt = text || info.element?.title || info.selection.label
  openGeneration(
    {
      capabilityId: 'eikona.image.generate',
      input: prompt ? { prompt } : {},
      anchor: info.anchor,
      stage: ['visual', 'storyboard'],
    },
    ctx.opener,
  )
  return { kind: 'generation', target: info.selection.label }
}

function runVoice(ctx: ComposerActionContext): ComposerActionResult {
  ensureNotAborted(ctx.signal)
  const info = firstInfo(ctx, (candidate) => candidate.scene)
  if (!info) throwActionError('muweave/need_scene')
  const text = ctx.draftText.trim()
  openGeneration(
    {
      capabilityId: 'sonora.voice.tts',
      input: text ? { text } : {},
      anchor: info.anchor,
      stage: ['script', 'sound'],
    },
    ctx.opener,
  )
  return { kind: 'generation', target: info.selection.label }
}

function runSchedule(ctx: ComposerActionContext): ComposerActionResult {
  ensureNotAborted(ctx.signal)
  const selection = ctx.selections[0]
  if (!selection) throwActionError('muweave/need_element')
  const room = getTheaterRooms().find((candidate) => candidate.id === 'muweave-schedule')
  if (!room) throwActionError('muweave/unavailable')
  setActiveTheaterRoom(room.id)
  return { kind: 'schedule', target: selection.label }
}

async function runSync(ctx: ComposerActionContext): Promise<ComposerActionResult> {
  ensureNotAborted(ctx.signal)
  if (!ctx.syncBundle) throwActionError('muweave/unavailable')
  try {
    const result = await ctx.syncBundle(ctx.signal)
    return { kind: 'sync', count: result.count, revision: result.revision }
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && typeof error.code === 'string') throw error
    throw Object.assign(new Error('muweave/sync_failed', { cause: error }), { code: 'muweave/sync_failed' })
  }
}

function runPalette(ctx: ComposerActionContext): ComposerActionResult {
  ensureNotAborted(ctx.signal)
  if (!ctx.openPalette) throwActionError('muweave/unavailable')
  ctx.openPalette()
  return { kind: 'opened' }
}

function runKeymap(ctx: ComposerActionContext): ComposerActionResult {
  ensureNotAborted(ctx.signal)
  if (typeof ctx.openKeymap !== 'function') throwActionError('muweave/unavailable')
  ctx.openKeymap()
  return { kind: 'opened' }
}

export const COMPOSER_ACTIONS: readonly ComposerAction[] = [
  { id: 'eikona.generate', labelZh: COMPOSER_DICT_ZH.image, labelEn: COMPOSER_DICT_EN.image, icon: 'image', scope: 'visual', run: runImage },
  { id: 'sonora.voice', labelZh: COMPOSER_DICT_ZH.voice, labelEn: COMPOSER_DICT_EN.voice, icon: 'spark', scope: 'scene', run: runVoice },
  { id: 'schedule.plan', labelZh: COMPOSER_DICT_ZH.schedule, labelEn: COMPOSER_DICT_EN.schedule, icon: 'inbox', scope: 'element', run: runSchedule },
  { id: 'bundle.sync', labelZh: COMPOSER_DICT_ZH.sync, labelEn: COMPOSER_DICT_EN.sync, icon: 'sync', scope: 'workspace', run: runSync },
  { id: 'palette.open', labelZh: COMPOSER_DICT_ZH.palette, labelEn: COMPOSER_DICT_EN.palette, icon: 'command', scope: 'global', run: runPalette },
  { id: 'keymap.open', labelZh: COMPOSER_DICT_ZH.keymap, labelEn: COMPOSER_DICT_EN.keymap, icon: 'command', scope: 'global', run: runKeymap },
] as const

export function composerActionDisabledReason(action: ComposerAction, ctx: Omit<ComposerActionContext, 'opener' | 'signal'>): ComposerActionDisabledReason | undefined {
  if (action.scope === 'visual') return selectedInfo(ctx).some((info) => info.visual) ? undefined : 'needVisual'
  if (action.scope === 'scene') return selectedInfo(ctx).some((info) => info.scene) ? undefined : 'needScene'
  if (action.id === 'schedule.plan') {
    if (ctx.selections.length === 0) return 'needElement'
    if (!getTheaterRooms().some((room) => room.id === 'muweave-schedule')) return 'unavailable'
    return undefined
  }
  if (action.id === 'bundle.sync') return typeof ctx.syncBundle === 'function' ? undefined : 'unavailable'
  if (action.id === 'palette.open') return typeof ctx.openPalette === 'function' ? undefined : 'unavailable'
  return typeof ctx.openKeymap === 'function' ? undefined : 'unavailable'
}
