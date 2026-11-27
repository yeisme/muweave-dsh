/**
 * Pure TypeScript 3D perspective camera projection, shot-scale estimation,
 * 180-degree axis-crossing guard, and Canvas2D greybox renderer.
 * Zero external dependencies — React 18 externalized & browser-safe.
 */

import type {
  Stage3dActorV1,
  Stage3dCameraV1,
  Stage3dLightV1,
  Stage3dPropV1,
  Stage3dShotSceneV1,
} from '@yeisme/dsh-muweave-core/client'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type Stage3dPresetId = 'ots' | 'hero_low' | 'two_shot' | 'ecu' | 'birds_eye'

export interface Stage3dCameraPreset {
  id: Stage3dPresetId
  labelZh: string
  labelEn: string
  camera: Stage3dCameraV1
}

export const STAGE3D_FOCAL_LENGTHS = [24, 35, 50, 85, 135] as const

export const STAGE3D_CAMERA_PRESETS: readonly Stage3dCameraPreset[] = [
  {
    id: 'ots',
    labelZh: '过肩 (OTS)',
    labelEn: 'Over-the-Shoulder',
    camera: { x: -1.8, y: 1.55, z: 2.2, targetX: 0.8, targetY: 1.45, targetZ: -1.2, fovMm: 50, preset: 'ots' },
  },
  {
    id: 'hero_low',
    labelZh: '低机位仰拍',
    labelEn: 'Hero Low Angle',
    camera: { x: 0.2, y: 0.65, z: 3.4, targetX: 0, targetY: 1.6, targetZ: -0.4, fovMm: 35, preset: 'hero_low' },
  },
  {
    id: 'two_shot',
    labelZh: '双人中景',
    labelEn: 'Two-Shot Medium',
    camera: { x: 0, y: 1.5, z: 4.4, targetX: 0, targetY: 1.35, targetZ: -0.5, fovMm: 35, preset: 'two_shot' },
  },
  {
    id: 'ecu',
    labelZh: '情绪特写 (ECU)',
    labelEn: 'Extreme Close-Up',
    camera: { x: -0.4, y: 1.58, z: 1.15, targetX: -0.6, targetY: 1.55, targetZ: -0.5, fovMm: 85, preset: 'ecu' },
  },
  {
    id: 'birds_eye',
    labelZh: '俯视上帝视角',
    labelEn: "Bird's-Eye Top",
    camera: { x: 0.1, y: 6.2, z: 1.8, targetX: 0, targetY: 0.5, targetZ: -0.5, fovMm: 24, preset: 'birds_eye' },
  },
] as const

export function createDefaultStage3dScene(shotRef: string, sceneRef?: string, episodeRef?: string): Stage3dShotSceneV1 {
  const actors: Stage3dActorV1[] = [
    { id: 'actor_a', name: '主角 A', x: -0.8, y: 0, z: -0.5, yawDeg: 75 },
    { id: 'actor_b', name: '对手 B', x: 0.9, y: 0, z: -0.8, yawDeg: -105 },
  ]
  const lights: Stage3dLightV1[] = [
    { id: 'light_key', kind: 'key', x: -2.5, y: 3.2, z: 2.0, intensityPct: 100 },
    { id: 'light_rim', kind: 'rim', x: 2.2, y: 2.8, z: -2.4, intensityPct: 70 },
  ]
  const props: Stage3dPropV1[] = [
    { id: 'prop_table', name: '长桌', x: 0.05, y: 0, z: -0.65, scale: 1 },
  ]
  return {
    shotRef,
    ...(episodeRef ? { episodeRef } : {}),
    ...(sceneRef ? { sceneRef } : {}),
    camera: { ...STAGE3D_CAMERA_PRESETS[2]!.camera },
    actors,
    lights,
    props,
    updatedAt: new Date().toISOString(),
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z)
  if (len < 1e-6) return { x: 0, y: 0, z: -1 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

export interface ProjectedPoint {
  x: number
  y: number
  depth: number
  visible: boolean
}

export interface CameraBasis {
  pos: Vec3
  forward: Vec3
  right: Vec3
  up: Vec3
  fovYRad: number
}

export function computeCameraBasis(cam: Stage3dCameraV1): CameraBasis {
  const pos: Vec3 = { x: cam.x, y: cam.y, z: cam.z }
  const target: Vec3 = { x: cam.targetX, y: cam.targetY, z: cam.targetZ }
  const forward = normalize(sub(target, pos))
  const worldUp: Vec3 = Math.abs(forward.y) > 0.98 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 }
  const right = normalize(cross(forward, worldUp))
  const up = normalize(cross(right, forward))
  const focal = Math.max(12, Math.min(200, cam.fovMm || 35))
  const fovYRad = 2 * Math.atan(24 / (2 * focal))
  return { pos, forward, right, up, fovYRad }
}

export function projectPoint(
  world: Vec3,
  basis: CameraBasis,
  width: number,
  height: number,
): ProjectedPoint {
  const rel = sub(world, basis.pos)
  const depth = dot(rel, basis.forward)
  if (depth <= 0.1) {
    return { x: 0, y: 0, depth, visible: false }
  }
  const cx = dot(rel, basis.right)
  const cy = dot(rel, basis.up)
  const f = height / (2 * Math.tan(basis.fovYRad / 2))
  const sx = width / 2 + (cx / depth) * f
  const sy = height / 2 - (cy / depth) * f
  return { x: sx, y: sy, depth, visible: true }
}

export interface ShotScaleEstimate {
  scaleZh: '特写' | '近景' | '中景' | '全景'
  scaleEn: 'Close-Up' | 'Medium Close-Up' | 'Medium Shot' | 'Wide Shot'
  pitchDeg: number
  distanceM: number
}

export function estimateShotScale(scene: Stage3dShotSceneV1): ShotScaleEstimate {
  const cam = scene.camera
  const primary = scene.actors[0]
  const tx = primary ? primary.x : cam.targetX
  const ty = primary ? primary.y + 1.35 : cam.targetY
  const tz = primary ? primary.z : cam.targetZ
  const dx = tx - cam.x
  const dy = ty - cam.y
  const dz = tz - cam.z
  const dist = Math.max(0.2, Math.hypot(dx, dy, dz))
  const horiz = Math.max(0.01, Math.hypot(dx, dz))
  const pitchDeg = Math.round((Math.atan2(dy, horiz) * 180) / Math.PI)

  const equivDist = dist * (50 / Math.max(12, cam.fovMm || 35))
  if (equivDist < 1.6) {
    return { scaleZh: '特写', scaleEn: 'Close-Up', pitchDeg, distanceM: Number(dist.toFixed(1)) }
  }
  if (equivDist < 3.0) {
    return { scaleZh: '近景', scaleEn: 'Medium Close-Up', pitchDeg, distanceM: Number(dist.toFixed(1)) }
  }
  if (equivDist < 5.5) {
    return { scaleZh: '中景', scaleEn: 'Medium Shot', pitchDeg, distanceM: Number(dist.toFixed(1)) }
  }
  return { scaleZh: '全景', scaleEn: 'Wide Shot', pitchDeg, distanceM: Number(dist.toFixed(1)) }
}

export function detectStageAxisCrossing(
  prev: Stage3dShotSceneV1 | undefined,
  cur: Stage3dShotSceneV1,
): { crossed: boolean; detail?: string } {
  if (!prev || cur.actors.length < 2 || prev.actors.length < 2) return { crossed: false }
  const a1 = cur.actors[0]!
  const a2 = cur.actors[1]!
  const ax = a2.x - a1.x
  const az = a2.z - a1.z
  if (Math.hypot(ax, az) < 0.05) return { crossed: false }

  const prevSide = ax * (prev.camera.z - a1.z) - az * (prev.camera.x - a1.x)
  const curSide = ax * (cur.camera.z - a1.z) - az * (cur.camera.x - a1.x)
  if (Math.abs(prevSide) < 0.05 || Math.abs(curSide) < 0.05) return { crossed: false }
  if (Math.sign(prevSide) !== Math.sign(curSide)) {
    return {
      crossed: true,
      detail: `${a1.name} ↔ ${a2.name} (${prev.shotRef} → ${cur.shotRef})`,
    }
  }
  return { crossed: false }
}

export function compileStage3dPromptLocal(
  scene: Stage3dShotSceneV1,
  aspectRatio: '9:16' | '16:9' = '9:16',
): {
  zh: string
  en: string
  shotScale: string
  pitchDeg: number
} {
  const est = estimateShotScale(scene)
  const angleZh = est.pitchDeg > 10 ? '仰拍' : est.pitchDeg < -10 ? '俯拍' : '平视'
  const angleEn = est.pitchDeg > 10 ? 'low-angle' : est.pitchDeg < -10 ? 'high-angle' : 'eye-level'
  const actorNames = scene.actors.map((a) => a.name).join('、') || '主体'
  const actorNamesEn = scene.actors.map((a) => a.name).join(', ') || 'subject'
  const lightSummary = scene.lights.map((l) => l.kind).join('/') || 'key'
  const zh = `${aspectRatio} 构图，${est.scaleZh}，${scene.camera.fovMm}mm 镜头，${angleZh}（俯仰 ${est.pitchDeg}°），机位距离 ${est.distanceM}m，人物：${actorNames}，布光：${lightSummary}`
  const en = `${aspectRatio} framing, ${est.scaleEn}, ${scene.camera.fovMm}mm lens, ${angleEn} (pitch ${est.pitchDeg} deg), camera distance ${est.distanceM}m, actors: ${actorNamesEn}, lighting: ${lightSummary}`
  return { zh, en, shotScale: est.scaleZh, pitchDeg: est.pitchDeg }
}

export interface RenderStage3dOptions {
  showSafeZone?: boolean
  showGrid?: boolean
}

export function renderStage3dCanvas(
  ctx: CanvasRenderingContext2D,
  scene: Stage3dShotSceneV1,
  width: number,
  height: number,
  options: RenderStage3dOptions = {},
): void {
  const { showSafeZone = false, showGrid = true } = options
  const basis = computeCameraBasis(scene.camera)

  const grad = ctx.createLinearGradient(0, 0, 0, height)
  grad.addColorStop(0, '#181a20')
  grad.addColorStop(0.55, '#20242d')
  grad.addColorStop(1, '#12141a')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)

  if (showGrid) {
    ctx.strokeStyle = 'rgba(180, 196, 220, 0.16)'
    ctx.lineWidth = 1
    for (let i = -5; i <= 5; i += 1) {
      const a = projectPoint({ x: i, y: 0, z: -5 }, basis, width, height)
      const b = projectPoint({ x: i, y: 0, z: 5 }, basis, width, height)
      if (a.visible && b.visible) {
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      const c = projectPoint({ x: -5, y: 0, z: i }, basis, width, height)
      const d = projectPoint({ x: 5, y: 0, z: i }, basis, width, height)
      if (c.visible && d.visible) {
        ctx.beginPath()
        ctx.moveTo(c.x, c.y)
        ctx.lineTo(d.x, d.y)
        ctx.stroke()
      }
    }
  }

  type DrawItem = { depth: number; draw: () => void }
  const items: DrawItem[] = []

  for (const prop of scene.props) {
    const s = prop.scale ?? 1
    const pw = 0.55 * s
    const pd = 0.32 * s
    const ph = 0.78 * s
    const center = projectPoint({ x: prop.x, y: prop.y + ph / 2, z: prop.z }, basis, width, height)
    if (!center.visible) continue
    items.push({
      depth: center.depth,
      draw: () => {
        const corners = [
          projectPoint({ x: prop.x - pw, y: prop.y + ph, z: prop.z - pd }, basis, width, height),
          projectPoint({ x: prop.x + pw, y: prop.y + ph, z: prop.z - pd }, basis, width, height),
          projectPoint({ x: prop.x + pw, y: prop.y + ph, z: prop.z + pd }, basis, width, height),
          projectPoint({ x: prop.x - pw, y: prop.y + ph, z: prop.z + pd }, basis, width, height),
        ]
        if (corners.every((p) => p.visible)) {
          ctx.fillStyle = 'rgba(130, 148, 175, 0.38)'
          ctx.strokeStyle = 'rgba(200, 214, 235, 0.65)'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.moveTo(corners[0]!.x, corners[0]!.y)
          for (let i = 1; i < corners.length; i += 1) {
            ctx.lineTo(corners[i]!.x, corners[i]!.y)
          }
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
        }
        ctx.fillStyle = '#cbd5e1'
        ctx.font = '11px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(prop.name, center.x, center.y + 4)
      },
    })
  }

  for (const actor of scene.actors) {
    const h = 1.72
    const foot = projectPoint({ x: actor.x, y: actor.y, z: actor.z }, basis, width, height)
    const head = projectPoint({ x: actor.x, y: actor.y + h, z: actor.z }, basis, width, height)
    if (!foot.visible || !head.visible) continue
    const rad = (actor.yawDeg * Math.PI) / 180
    const facingTip = projectPoint(
      { x: actor.x + Math.sin(rad) * 0.65, y: actor.y + h * 0.72, z: actor.z + Math.cos(rad) * 0.65 },
      basis,
      width,
      height,
    )
    items.push({
      depth: (foot.depth + head.depth) / 2,
      draw: () => {
        const pxHeight = Math.max(16, Math.abs(foot.y - head.y))
        const bodyW = Math.max(8, pxHeight * 0.24)
        const headR = Math.max(4, pxHeight * 0.085)

        ctx.fillStyle = 'rgba(96, 165, 250, 0.42)'
        ctx.strokeStyle = '#93c5fd'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.rect(head.x - bodyW / 2, head.y + headR * 2, bodyW, pxHeight - headR * 2)
        ctx.fill()
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(head.x, head.y + headR, headR, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(147, 197, 253, 0.7)'
        ctx.fill()
        ctx.stroke()

        if (facingTip.visible) {
          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(head.x, head.y + pxHeight * 0.28)
          ctx.lineTo(facingTip.x, facingTip.y)
          ctx.stroke()
        }

        ctx.fillStyle = '#f8fafc'
        ctx.font = 'bold 11px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(actor.name, head.x, head.y - 6)
      },
    })
  }

  for (const light of scene.lights) {
    const lp = projectPoint({ x: light.x, y: light.y, z: light.z }, basis, width, height)
    if (!lp.visible) continue
    items.push({
      depth: lp.depth,
      draw: () => {
        ctx.fillStyle = 'rgba(250, 232, 160, 0.85)'
        ctx.beginPath()
        ctx.arc(lp.x, lp.y, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#e2e8f0'
        ctx.font = '10px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(light.kind, lp.x, lp.y - 8)
      },
    })
  }

  items.sort((a, b) => b.depth - a.depth)
  for (const it of items) it.draw()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
  ctx.lineWidth = 1
  for (const frac of [1 / 3, 2 / 3]) {
    ctx.beginPath()
    ctx.moveTo(width * frac, 0)
    ctx.lineTo(width * frac, height)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, height * frac)
    ctx.lineTo(width, height * frac)
    ctx.stroke()
  }

  if (showSafeZone) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)'
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1.2
    ctx.strokeRect(width * 0.08, height * 0.12, width * 0.76, height * 0.68)
    ctx.setLineDash([])
  }
}

// Valid minimal 1x1 PNG fallback for headless/jsdom environments where HTMLCanvasElement.getContext('2d') returns null.
export const FALLBACK_GREYBOX_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export function renderGreyboxSnapshotPng(
  scene: Stage3dShotSceneV1,
  aspectRatio: '9:16' | '16:9' = '9:16',
): string | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const isVertical = aspectRatio !== '16:9'
  canvas.width = isVertical ? 360 : 640
  canvas.height = isVertical ? 640 : 360
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  renderStage3dCanvas(ctx, scene, canvas.width, canvas.height, { showSafeZone: false, showGrid: true })
  try {
    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.startsWith('data:image/png;base64,') ? dataUrl : null
  } catch {
    return null
  }
}
