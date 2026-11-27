import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import type {
  Stage3dActorV1,
  Stage3dCameraV1,
  Stage3dLightV1,
  Stage3dPropV1,
  Stage3dSceneSaveInputV1,
  Stage3dScenesV1,
  Stage3dShotSceneV1,
} from './protocol'

export const STAGE3D_SCENES_SCHEMA = 'muweave.stage3d-scenes.v1' as const

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const LIGHT_KINDS = new Set<Stage3dLightV1['kind']>(['key', 'fill', 'rim', 'ambient'])

export class Stage3dInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

function assertNum(val: unknown, field: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Stage3dInputError('muweave/invalid_stage3d_input', `${field} must be a finite number`)
  }
  return val
}

function validateCamera(raw: unknown): Stage3dCameraV1 {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Stage3dInputError('muweave/invalid_stage3d_input', 'camera must be an object')
  }
  const c = raw as Record<string, unknown>
  return {
    x: assertNum(c.x, 'camera.x'),
    y: assertNum(c.y, 'camera.y'),
    z: assertNum(c.z, 'camera.z'),
    targetX: assertNum(c.targetX, 'camera.targetX'),
    targetY: assertNum(c.targetY, 'camera.targetY'),
    targetZ: assertNum(c.targetZ, 'camera.targetZ'),
    fovMm: Math.max(12, Math.min(200, assertNum(c.fovMm ?? 35, 'camera.fovMm'))),
    ...(typeof c.preset === 'string' && c.preset.trim() ? { preset: c.preset.trim().slice(0, 64) } : {}),
  }
}

function validateActors(raw: unknown): Stage3dActorV1[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 16) {
    throw new Stage3dInputError('muweave/invalid_stage3d_input', 'actors must be an array of at most 16 entries')
  }
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Stage3dInputError('muweave/invalid_stage3d_input', `actors[${i}] must be an object`)
    }
    const a = item as Record<string, unknown>
    const id = typeof a.id === 'string' ? a.id.trim() : ''
    const name = typeof a.name === 'string' ? a.name.trim().slice(0, 80) : ''
    if (!SAFE_ID_RE.test(id) || !name) {
      throw new Stage3dInputError('muweave/invalid_stage3d_input', `actors[${i}] requires valid id and name`)
    }
    return {
      id,
      name,
      x: assertNum(a.x, `actors[${i}].x`),
      y: assertNum(a.y, `actors[${i}].y`),
      z: assertNum(a.z, `actors[${i}].z`),
      yawDeg: assertNum(a.yawDeg ?? 0, `actors[${i}].yawDeg`),
      ...(typeof a.pose === 'string' && a.pose.trim() ? { pose: a.pose.trim().slice(0, 64) } : {}),
      ...(typeof a.color === 'string' && a.color.trim() ? { color: a.color.trim().slice(0, 32) } : {}),
      ...(typeof a.roleRef === 'string' && a.roleRef.trim() ? { roleRef: a.roleRef.trim().slice(0, 128) } : {}),
    }
  })
}

function validateLights(raw: unknown): Stage3dLightV1[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 12) {
    throw new Stage3dInputError('muweave/invalid_stage3d_input', 'lights must be an array of at most 12 entries')
  }
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Stage3dInputError('muweave/invalid_stage3d_input', `lights[${i}] must be an object`)
    }
    const l = item as Record<string, unknown>
    const id = typeof l.id === 'string' ? l.id.trim() : ''
    const kind = l.kind as Stage3dLightV1['kind']
    if (!SAFE_ID_RE.test(id) || !LIGHT_KINDS.has(kind)) {
      throw new Stage3dInputError('muweave/invalid_stage3d_input', `lights[${i}] requires valid id and kind`)
    }
    return {
      id,
      kind,
      x: assertNum(l.x, `lights[${i}].x`),
      y: assertNum(l.y, `lights[${i}].y`),
      z: assertNum(l.z, `lights[${i}].z`),
      intensityPct: Math.max(0, Math.min(200, assertNum(l.intensityPct ?? 100, `lights[${i}].intensityPct`))),
      ...(typeof l.colorHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(l.colorHex.trim()) ? { colorHex: l.colorHex.trim() } : {}),
    }
  })
}

function validateProps(raw: unknown): Stage3dPropV1[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 32) {
    throw new Stage3dInputError('muweave/invalid_stage3d_input', 'props must be an array of at most 32 entries')
  }
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Stage3dInputError('muweave/invalid_stage3d_input', `props[${i}] must be an object`)
    }
    const p = item as Record<string, unknown>
    const id = typeof p.id === 'string' ? p.id.trim() : ''
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 80) : ''
    if (!SAFE_ID_RE.test(id) || !name) {
      throw new Stage3dInputError('muweave/invalid_stage3d_input', `props[${i}] requires valid id and name`)
    }
    return {
      id,
      name,
      x: assertNum(p.x, `props[${i}].x`),
      y: assertNum(p.y, `props[${i}].y`),
      z: assertNum(p.z, `props[${i}].z`),
      ...(typeof p.scale === 'number' && Number.isFinite(p.scale) && p.scale > 0 ? { scale: p.scale } : {}),
    }
  })
}

function defaultScenes(workspaceId: string): Stage3dScenesV1 {
  return {
    schema: STAGE3D_SCENES_SCHEMA,
    workspaceId,
    scenes: {},
    revision: '0',
    updatedAt: '',
  }
}

function cloneScenes(s: Stage3dScenesV1): Stage3dScenesV1 {
  const scenes: Record<string, Stage3dShotSceneV1> = {}
  for (const [k, v] of Object.entries(s.scenes)) {
    scenes[k] = {
      ...v,
      camera: { ...v.camera },
      actors: v.actors.map((a) => ({ ...a })),
      lights: v.lights.map((l) => ({ ...l })),
      props: v.props.map((p) => ({ ...p })),
    }
  }
  return { ...s, scenes }
}

export class Stage3dStore {
  private readonly file: string
  private readonly store = new Map<string, Stage3dScenesV1>()
  corruptFile?: string

  constructor(pluginDataDir: string) {
    this.file = path.join(pluginDataDir, 'stage3d-scenes.v1.json')
    this.load()
  }

  get(workspaceId: string): Stage3dScenesV1 {
    const hit = this.store.get(workspaceId)
    return hit ? cloneScenes(hit) : defaultScenes(workspaceId)
  }

  saveScene(workspaceId: string, input: Stage3dSceneSaveInputV1): { scenes: Stage3dScenesV1; scene: Stage3dShotSceneV1 } {
    if (findPlaintextCredential(input) || containsHostPath(input)) {
      throw new Stage3dInputError('muweave/invalid_stage3d_input', 'Stage3D scene must not contain credentials or host paths')
    }
    const wsId = workspaceId.trim()
    const shotRef = typeof input.shotRef === 'string' ? input.shotRef.trim() : ''
    if (!SAFE_ID_RE.test(wsId) || !SAFE_ID_RE.test(shotRef)) {
      throw new Stage3dInputError('muweave/invalid_stage3d_input', 'workspaceId and shotRef must be valid opaque references')
    }

    const prev = this.store.get(wsId)
    const currentRev = prev ? Number(prev.revision) || 0 : 0
    if (input.expectedRevision !== undefined && input.expectedRevision !== '') {
      if (String(input.expectedRevision) !== String(currentRev)) {
        throw new Stage3dInputError(
          'muweave/stage3d_revision_conflict',
          `Stage3D revision conflict: expected ${input.expectedRevision}, current is ${currentRev}`,
          { currentRevision: String(currentRev) },
        )
      }
    }

    const prevScene = prev?.scenes[shotRef]
    const now = new Date().toISOString()
    const scene: Stage3dShotSceneV1 = {
      shotRef,
      ...(typeof input.episodeRef === 'string' && SAFE_ID_RE.test(input.episodeRef.trim())
        ? { episodeRef: input.episodeRef.trim() }
        : prevScene?.episodeRef
          ? { episodeRef: prevScene.episodeRef }
          : {}),
      ...(typeof input.sceneRef === 'string' && SAFE_ID_RE.test(input.sceneRef.trim())
        ? { sceneRef: input.sceneRef.trim() }
        : prevScene?.sceneRef
          ? { sceneRef: prevScene.sceneRef }
          : {}),
      camera: validateCamera(input.camera),
      actors: input.actors !== undefined ? validateActors(input.actors) : (prevScene ? prevScene.actors.map((a) => ({ ...a })) : []),
      lights: input.lights !== undefined ? validateLights(input.lights) : (prevScene ? prevScene.lights.map((l) => ({ ...l })) : []),
      props: input.props !== undefined ? validateProps(input.props) : (prevScene ? prevScene.props.map((p) => ({ ...p })) : []),
      ...(typeof input.snapshotSha256 === 'string' && input.snapshotSha256.trim()
        ? { snapshotSha256: input.snapshotSha256.trim() }
        : prevScene?.snapshotSha256
          ? { snapshotSha256: prevScene.snapshotSha256 }
          : {}),
      ...(typeof input.notes === 'string' && input.notes.trim()
        ? { notes: input.notes.trim().slice(0, 500) }
        : prevScene?.notes
          ? { notes: prevScene.notes }
          : {}),
      updatedAt: now,
    }

    const next: Stage3dScenesV1 = {
      schema: STAGE3D_SCENES_SCHEMA,
      workspaceId: wsId,
      scenes: { ...(prev?.scenes ?? {}), [shotRef]: scene },
      revision: String(currentRev + 1),
      updatedAt: now,
    }
    this.store.set(wsId, next)
    this.persist()
    const cloned = cloneScenes(next)
    return { scenes: cloned, scene: cloned.scenes[shotRef]! }
  }

  attachSnapshot(workspaceId: string, shotRef: string, sha256: string): boolean {
    const existing = this.store.get(workspaceId)
    const scene = existing?.scenes[shotRef]
    if (!existing || !scene) return false
    scene.snapshotSha256 = sha256
    scene.updatedAt = new Date().toISOString()
    existing.revision = String((Number(existing.revision) || 0) + 1)
    existing.updatedAt = scene.updatedAt
    this.persist()
    return true
  }

  reset(workspaceId: string, shotRef?: string): Stage3dScenesV1 {
    const existing = this.store.get(workspaceId)
    if (!existing) return defaultScenes(workspaceId)
    if (shotRef && existing.scenes[shotRef]) {
      delete existing.scenes[shotRef]
      existing.revision = String((Number(existing.revision) || 0) + 1)
      existing.updatedAt = new Date().toISOString()
      this.persist()
      return cloneScenes(existing)
    }
    this.store.delete(workspaceId)
    this.persist()
    return defaultScenes(workspaceId)
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      const list = typeof parsed === 'object' && parsed !== null ? (parsed as { workspaces?: unknown }).workspaces : undefined
      if (!Array.isArray(list)) throw new Error('workspaces is not an array')
      for (const raw of list) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
        if (findPlaintextCredential(raw) || containsHostPath(raw)) continue
        const r = raw as Partial<Stage3dScenesV1>
        if (typeof r.workspaceId !== 'string' || !SAFE_ID_RE.test(r.workspaceId)) continue
        if (typeof r.scenes !== 'object' || r.scenes === null || Array.isArray(r.scenes)) continue
        this.store.set(r.workspaceId, {
          schema: STAGE3D_SCENES_SCHEMA,
          workspaceId: r.workspaceId,
          scenes: r.scenes as Record<string, Stage3dShotSceneV1>,
          revision: typeof r.revision === 'string' ? r.revision : '1',
          updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
        })
      }
    } catch {
      this.store.clear()
      const aside = path.join(path.dirname(this.file), `stage3d-scenes.v1.corrupt-${Date.now()}.json`)
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
      `${JSON.stringify({ schema: STAGE3D_SCENES_SCHEMA, workspaces: [...this.store.values()] }, null, 2)}\n`,
      { mode: 0o600 },
    )
    renameSync(tmp, this.file)
  }
}

export interface CompiledStage3dPrompt {
  zh: string
  en: string
  shotScale: 'ECU' | 'CU' | 'MCU' | 'MS' | 'WS'
  pitchDeg: number
}

/** Pure compiler turning 3D camera geometry + actors + lighting into bilingual cinematography prompts. */
export function compileStage3dPrompt(scene: Stage3dShotSceneV1): CompiledStage3dPrompt {
  const dx = scene.camera.targetX - scene.camera.x
  const dy = scene.camera.targetY - scene.camera.y
  const dz = scene.camera.targetZ - scene.camera.z
  const horiz = Math.hypot(dx, dz)
  const dist = Math.hypot(horiz, dy)
  const pitchDeg = Math.round((Math.atan2(dy, Math.max(0.001, horiz)) * 180) / Math.PI)
  const effectiveDist = dist / Math.max(0.4, scene.camera.fovMm / 35)

  let shotScale: CompiledStage3dPrompt['shotScale']
  let scaleZh: string
  let scaleEn: string
  if (effectiveDist < 1.2) {
    shotScale = 'ECU'; scaleZh = '大特写'; scaleEn = 'extreme close-up'
  } else if (effectiveDist < 2.4) {
    shotScale = 'CU'; scaleZh = '特写'; scaleEn = 'close-up'
  } else if (effectiveDist < 4.0) {
    shotScale = 'MCU'; scaleZh = '近景'; scaleEn = 'medium close-up'
  } else if (effectiveDist < 6.5) {
    shotScale = 'MS'; scaleZh = '中景'; scaleEn = 'medium shot'
  } else {
    shotScale = 'WS'; scaleZh = '全景'; scaleEn = 'wide shot'
  }

  const angleZh = pitchDeg > 10 ? '仰拍' : pitchDeg < -10 ? '俯拍' : '平视'
  const angleEn = pitchDeg > 10 ? 'low-angle' : pitchDeg < -10 ? 'high-angle' : 'eye-level'
  const actorNames = scene.actors.map((a) => a.name).join('、') || '主体'
  const actorNamesEn = scene.actors.map((a) => a.name).join(', ') || 'subject'
  const keyLight = scene.lights.find((l) => l.kind === 'key')
  const lightZh = keyLight ? `主光强度 ${keyLight.intensityPct}%` : '自然电影布光'
  const lightEn = keyLight ? `key light ${keyLight.intensityPct}%` : 'cinematic lighting'

  return {
    shotScale,
    pitchDeg,
    zh: `${scene.camera.fovMm}mm 镜头，${scaleZh}（${shotScale}），${angleZh}（${pitchDeg}°），画面主体：${actorNames}，${lightZh}。`,
    en: `${scene.camera.fovMm}mm lens, ${scaleEn} (${shotScale}), ${angleEn} (${pitchDeg} deg), featuring ${actorNamesEn}, ${lightEn}.`,
  }
}

/**
 * 180-degree rule (axis-crossing) detector using 2D XZ cross-product sign of camera position
 * against the line from actors[0] to actors[1].
 */
export function detectAxisCrossing(
  prev: Stage3dShotSceneV1 | undefined,
  cur: Stage3dShotSceneV1,
): { crossed: boolean; detail?: string } {
  if (!prev || prev.actors.length < 2 || cur.actors.length < 2) {
    return { crossed: false }
  }
  const side = (s: Stage3dShotSceneV1): number => {
    const a = s.actors[0]!
    const b = s.actors[1]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const acx = s.camera.x - a.x
    const acz = s.camera.z - a.z
    return abx * acz - abz * acx
  }
  const sPrev = side(prev)
  const sCur = side(cur)
  if (Math.abs(sPrev) < 1e-4 || Math.abs(sCur) < 1e-4) {
    return { crossed: false }
  }
  if ((sPrev > 0 && sCur < 0) || (sPrev < 0 && sCur > 0)) {
    return {
      crossed: true,
      detail: `Camera crossed the 180° action axis between ${cur.actors[0]!.name} and ${cur.actors[1]!.name} (${prev.shotRef} -> ${cur.shotRef}).`,
    }
  }
  return { crossed: false }
}
