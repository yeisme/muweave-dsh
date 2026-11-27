import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import type {
  WorkspaceTabPresetId,
  WorkspaceTabsConfigV1,
  WorkspaceTabsSaveInputV1,
} from './protocol'

export const WORKSPACE_TABS_SCHEMA = 'muweave.workspace-tabs.v1' as const

const VALID_PRESETS = new Set<WorkspaceTabPresetId>([
  'default',
  'director',
  'writer',
  'visual_3d',
  'full_studio',
  'custom',
])
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/

export const WORKSPACE_TAB_PRESETS: Record<
  Exclude<WorkspaceTabPresetId, 'custom'>,
  { pinnedRoomIds: string[]; roomOrder: string[]; hiddenRoomIds: string[] }
> = {
  default: {
    pinnedRoomIds: [
      'muweave-workbench',
      'muweave-script',
      'muweave-eikona',
      'muweave-drama',
      'muweave-draft',
      'muweave-canvas',
      'muweave-stage3d',
      'muweave-audio',
      'muweave-assets',
      'muweave-kit',
      'muweave-schedule',
    ],
    roomOrder: [
      'muweave-workbench',
      'muweave-script',
      'muweave-eikona',
      'muweave-drama',
      'muweave-draft',
      'muweave-canvas',
      'muweave-stage3d',
      'muweave-audio',
      'muweave-assets',
      'muweave-kit',
      'muweave-schedule',
    ],
    hiddenRoomIds: [],
  },
  director: {
    pinnedRoomIds: ['muweave-workbench', 'muweave-drama', 'muweave-stage3d', 'muweave-audio', 'muweave-draft'],
    roomOrder: [
      'muweave-workbench',
      'muweave-drama',
      'muweave-stage3d',
      'muweave-audio',
      'muweave-draft',
      'muweave-script',
      'muweave-eikona',
      'muweave-canvas',
      'muweave-assets',
      'muweave-kit',
      'muweave-schedule',
    ],
    hiddenRoomIds: [],
  },
  writer: {
    pinnedRoomIds: ['muweave-workbench', 'muweave-script', 'muweave-canvas', 'muweave-drama', 'muweave-draft'],
    roomOrder: [
      'muweave-workbench',
      'muweave-script',
      'muweave-canvas',
      'muweave-drama',
      'muweave-draft',
      'muweave-eikona',
      'muweave-assets',
      'muweave-stage3d',
      'muweave-audio',
      'muweave-kit',
      'muweave-schedule',
    ],
    hiddenRoomIds: [],
  },
  visual_3d: {
    pinnedRoomIds: ['muweave-workbench', 'muweave-eikona', 'muweave-stage3d', 'muweave-assets', 'muweave-drama'],
    roomOrder: [
      'muweave-workbench',
      'muweave-eikona',
      'muweave-stage3d',
      'muweave-assets',
      'muweave-drama',
      'muweave-canvas',
      'muweave-script',
      'muweave-audio',
      'muweave-draft',
      'muweave-kit',
      'muweave-schedule',
    ],
    hiddenRoomIds: [],
  },
  full_studio: {
    pinnedRoomIds: [
      'muweave-workbench',
      'muweave-script',
      'muweave-eikona',
      'muweave-drama',
      'muweave-canvas',
      'muweave-stage3d',
      'muweave-audio',
      'muweave-assets',
      'muweave-draft',
    ],
    roomOrder: [
      'muweave-workbench',
      'muweave-script',
      'muweave-eikona',
      'muweave-drama',
      'muweave-canvas',
      'muweave-stage3d',
      'muweave-audio',
      'muweave-assets',
      'muweave-draft',
      'muweave-kit',
      'muweave-schedule',
    ],
    hiddenRoomIds: [],
  },
}

export class WorkspaceTabsInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

function defaultConfig(workspaceId: string): WorkspaceTabsConfigV1 {
  const base = WORKSPACE_TAB_PRESETS.default
  return {
    schema: WORKSPACE_TABS_SCHEMA,
    workspaceId,
    presetId: 'default',
    pinnedRoomIds: [...base.pinnedRoomIds],
    roomOrder: [...base.roomOrder],
    hiddenRoomIds: [...base.hiddenRoomIds],
    revision: '0',
    updatedAt: '',
  }
}

function validateRoomIds(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) {
    throw new WorkspaceTabsInputError('muweave/invalid_tabs_input', `${field} must be an array of room ids`)
  }
  if (raw.length > 32) {
    throw new WorkspaceTabsInputError('muweave/invalid_tabs_input', `${field} exceeds max length 32`)
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || !SAFE_ID_RE.test(item.trim())) {
      throw new WorkspaceTabsInputError('muweave/invalid_tabs_input', `${field} contains an invalid room id`)
    }
    const id = item.trim()
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

function cloneConfig(c: WorkspaceTabsConfigV1): WorkspaceTabsConfigV1 {
  return {
    ...c,
    pinnedRoomIds: [...c.pinnedRoomIds],
    roomOrder: [...c.roomOrder],
    hiddenRoomIds: [...c.hiddenRoomIds],
  }
}

export class WorkspaceTabsStore {
  private readonly file: string
  private readonly configs = new Map<string, WorkspaceTabsConfigV1>()
  corruptFile?: string

  constructor(pluginDataDir: string) {
    this.file = path.join(pluginDataDir, 'workspace-tabs.v1.json')
    this.load()
  }

  get(workspaceId: string): WorkspaceTabsConfigV1 {
    const hit = this.configs.get(workspaceId)
    return hit ? cloneConfig(hit) : defaultConfig(workspaceId)
  }

  save(workspaceId: string, input: WorkspaceTabsSaveInputV1): WorkspaceTabsConfigV1 {
    if (findPlaintextCredential(input) || containsHostPath(input)) {
      throw new WorkspaceTabsInputError('muweave/invalid_tabs_input', 'Tabs config must not contain credentials or host paths')
    }
    const wsId = workspaceId.trim()
    if (!SAFE_ID_RE.test(wsId)) {
      throw new WorkspaceTabsInputError('muweave/invalid_tabs_input', 'workspaceId is invalid')
    }

    const prev = this.configs.get(wsId)
    const currentRev = prev ? Number(prev.revision) || 0 : 0
    if (input.expectedRevision !== undefined && input.expectedRevision !== '') {
      if (String(input.expectedRevision) !== String(currentRev)) {
        throw new WorkspaceTabsInputError(
          'muweave/tabs_revision_conflict',
          `Tabs revision conflict: expected ${input.expectedRevision}, current is ${currentRev}`,
          { currentRevision: String(currentRev) },
        )
      }
    }

    const presetId: WorkspaceTabPresetId = input.presetId ?? prev?.presetId ?? 'default'
    if (!VALID_PRESETS.has(presetId)) {
      throw new WorkspaceTabsInputError('muweave/invalid_tabs_input', `Unknown presetId: ${String(presetId)}`)
    }

    const presetDefaults = presetId !== 'custom' ? WORKSPACE_TAB_PRESETS[presetId] : undefined
    const pinnedRoomIds = input.pinnedRoomIds !== undefined
      ? validateRoomIds(input.pinnedRoomIds, 'pinnedRoomIds')
      : presetDefaults
        ? [...presetDefaults.pinnedRoomIds]
        : (prev ? [...prev.pinnedRoomIds] : [...WORKSPACE_TAB_PRESETS.default.pinnedRoomIds])
    const roomOrder = input.roomOrder !== undefined
      ? validateRoomIds(input.roomOrder, 'roomOrder')
      : presetDefaults
        ? [...presetDefaults.roomOrder]
        : (prev ? [...prev.roomOrder] : [...WORKSPACE_TAB_PRESETS.default.roomOrder])
    const hiddenRoomIds = input.hiddenRoomIds !== undefined
      ? validateRoomIds(input.hiddenRoomIds, 'hiddenRoomIds')
      : presetDefaults
        ? [...presetDefaults.hiddenRoomIds]
        : (prev ? [...prev.hiddenRoomIds] : [])

    const next: WorkspaceTabsConfigV1 = {
      schema: WORKSPACE_TABS_SCHEMA,
      workspaceId: wsId,
      presetId,
      pinnedRoomIds,
      roomOrder,
      hiddenRoomIds,
      revision: String(currentRev + 1),
      updatedAt: new Date().toISOString(),
    }
    this.configs.set(wsId, next)
    this.persist()
    return cloneConfig(next)
  }

  reset(workspaceId: string): WorkspaceTabsConfigV1 {
    const deleted = this.configs.delete(workspaceId)
    if (deleted) this.persist()
    return defaultConfig(workspaceId)
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      const list = typeof parsed === 'object' && parsed !== null ? (parsed as { configs?: unknown }).configs : undefined
      if (!Array.isArray(list)) throw new Error('configs is not an array')
      for (const raw of list) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
        if (findPlaintextCredential(raw) || containsHostPath(raw)) continue
        const r = raw as Partial<WorkspaceTabsConfigV1>
        if (typeof r.workspaceId !== 'string' || !SAFE_ID_RE.test(r.workspaceId)) continue
        const presetId = VALID_PRESETS.has(r.presetId as WorkspaceTabPresetId) ? (r.presetId as WorkspaceTabPresetId) : 'default'
        try {
          this.configs.set(r.workspaceId, {
            schema: WORKSPACE_TABS_SCHEMA,
            workspaceId: r.workspaceId,
            presetId,
            pinnedRoomIds: validateRoomIds(r.pinnedRoomIds ?? [], 'pinnedRoomIds'),
            roomOrder: validateRoomIds(r.roomOrder ?? [], 'roomOrder'),
            hiddenRoomIds: validateRoomIds(r.hiddenRoomIds ?? [], 'hiddenRoomIds'),
            revision: typeof r.revision === 'string' ? r.revision : '1',
            updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
          })
        } catch {
          /* skip malformed row */
        }
      }
    } catch {
      this.configs.clear()
      const aside = path.join(path.dirname(this.file), `workspace-tabs.v1.corrupt-${Date.now()}.json`)
      try {
        renameSync(this.file, aside)
        this.corruptFile = aside
      } catch {
        this.corruptFile = this.file
      }
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
    writeFileSync(
      tmp,
      `${JSON.stringify({ schema: WORKSPACE_TABS_SCHEMA, configs: [...this.configs.values()] }, null, 2)}\n`,
      { mode: 0o600 },
    )
    renameSync(tmp, this.file)
  }
}
