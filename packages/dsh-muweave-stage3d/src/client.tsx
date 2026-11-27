import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import {
  Callout,
  CompanionList,
  EmptyState,
  RoomHero,
  SectionHead,
  Segmented,
  StatusTag,
  WorkspaceShell,
  notifyShotMediaChanged,
  registerMuweaveCreatorPlugin,
  stageItemToFloatingAgent,
  type DshClientContextLike,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  type Stage3dScenesV1,
  type Stage3dShotSceneV1,
  type Stage3dSnapshotSaveResultV1,
  type WorkspaceNotice,
} from '@yeisme/dsh-muweave-core/client'
import {
  FALLBACK_GREYBOX_PNG_DATA_URL,
  STAGE3D_CAMERA_PRESETS,
  STAGE3D_FOCAL_LENGTHS,
  compileStage3dPromptLocal,
  createDefaultStage3dScene,
  detectStageAxisCrossing,
  estimateShotScale,
  renderGreyboxSnapshotPng,
  renderStage3dCanvas,
  type Stage3dPresetId,
} from './projection3d'

export const name = '@yeisme/dsh-muweave-stage3d'
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const STAGE3D_PANEL_ID = 'muweave-stage3d'
export const STAGE3D_COMPANION_ID = 'muweave-stage3d/companion'
export const STAGE3D_LOCALE_NS = 'muweaveStage3d'

const zh = {
  panelTitle: '3D 导演台 (3D Pre-Vis Stage)',
  roomTitle: '3D导演台',
  companionTitle: '3D 机位与走位',
  heroEyebrow: 'MuWeave Studio · 3D 导演台',
  heroTitle: '3D 机位与走位预演台',
  heroLede: '零依赖 3D 透视预演：调焦段、防 180° 越轴、一键导出结构化机位提示词与灰模参考图。',
  tabStage: '3D 预演台',
  tabCameraSheet: '全集机位表',
  statShots: '已配置机位',
  statLens: '当前焦段',
  shotSelectLabel: '当前镜头',
  aspectLabel: '画幅',
  safeZoneToggle: '9:16 安全区',
  presetsLabel: '经典机位预设',
  focalLabel: '焦段 (mm)',
  monitorTitle: '3D 监视器（拖拽旋转视角）',
  floorplanTitle: '俯视片场走位图（拖拽机位 / 演员）',
  axisCrossingAlert: '180° 越轴预警：当前机位相对上一镜已跨越双人轴线',
  promptTitle: '结构化机位提示词',
  stageToAgent: '@ 注入助手',
  snapshotAndBind: '渲染 3D 灰模并绑定镜头',
  snapshotDone: '3D 灰模已写入 CAS 并绑定到镜头',
  saveScene: '保存机位',
  savingScene: '保存中…',
  saveDone: '机位已保存',
  resetScene: '重置机位',
  colShot: '镜头',
  colLens: '焦段',
  colScale: '景别',
  colPitch: '俯仰角',
  colSnapshot: '灰模参考',
  openInStage: '调机位',
  snapshotBound: '已绑定',
  snapshotNone: '未渲染',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: '3D Director Stage',
  roomTitle: '3D Stage',
  companionTitle: '3D Camera Blocking',
  heroEyebrow: 'MuWeave Studio · 3D Director Stage',
  heroTitle: '3D Pre-Vis Director Stage',
  heroLede: 'Zero-dependency 3D perspective pre-vis: lens presets, 180° axis guard, structured prompts & greybox snapshots.',
  tabStage: '3D Pre-Vis Stage',
  tabCameraSheet: 'Camera Sheet',
  statShots: 'blocked shots',
  statLens: 'current lens',
  shotSelectLabel: 'Active Shot',
  aspectLabel: 'Aspect',
  safeZoneToggle: '9:16 Safe Zone',
  presetsLabel: 'Camera Presets',
  focalLabel: 'Focal Length (mm)',
  monitorTitle: '3D Monitor (Drag to Orbit)',
  floorplanTitle: 'Top-Down Floorplan (Drag Camera / Actors)',
  axisCrossingAlert: '180° Axis-Crossing Alert: camera crossed the actor line vs previous shot',
  promptTitle: 'Structured Camera Prompt',
  stageToAgent: '@ Stage to Agent',
  snapshotAndBind: 'Render 3D Greybox & Bind Shot',
  snapshotDone: '3D greybox snapshot saved to CAS & bound to shot',
  saveScene: 'Save Camera',
  savingScene: 'Saving…',
  saveDone: 'Camera scene saved',
  resetScene: 'Reset',
  colShot: 'Shot',
  colLens: 'Lens',
  colScale: 'Scale',
  colPitch: 'Pitch',
  colSnapshot: 'Greybox',
  openInStage: 'Edit',
  snapshotBound: 'Bound',
  snapshotNone: 'None',
}

function worldToPct(val: number): number {
  return Math.max(4, Math.min(96, ((val + 5) / 10) * 100))
}

function pctToWorld(pct: number): number {
  return Number((((pct / 100) * 10 - 5)).toFixed(2))
}

export function Stage3dIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <path d="M8 2L13.5 5v6L8 14 2.5 11V5L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 8v6M8 8l5.5-3M8 8L2.5 5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function Stage3dMainPage({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  const [shotRefs, setShotRefs] = useState<string[]>(['shot:01', 'shot:02'])
  const [activeShotRef, setActiveShotRef] = useState<string>('shot:01')
  const [scenesByShot, setScenesByShot] = useState<Record<string, Stage3dShotSceneV1>>({})
  const [revision, setRevision] = useState<string>('0')
  const [aspect, setAspect] = useState<'9:16' | '16:9'>('9:16')
  const [showSafeZone, setShowSafeZone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [snapshotReceipt, setSnapshotReceipt] = useState<string | null>(null)
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const orbitRef = useRef<{ x: number; y: number } | null>(null)
  const floorDragRef = useRef<{ kind: 'camera' | 'actor'; id?: string } | null>(null)
  const floorBoxRef = useRef<HTMLDivElement | null>(null)
  const lang = coreT('langCode')

  const loadAll = useCallback(async () => {
    const [sceneRes, dramaRes] = await Promise.all([
      rpc.call<{ scenes?: Stage3dScenesV1 } | Stage3dScenesV1>('stage3d.scene.get', {}),
      rpc.call<{ elements?: MuweaveElementSummaryV1[] }>('bundle.elements.list', { domain: 'drama' }),
    ])
    if (sceneRes.ok) {
      const container = 'scenes' in (sceneRes.data ?? {}) && (sceneRes.data as { scenes?: Stage3dScenesV1 }).scenes?.schema === 'muweave.stage3d-scenes.v1'
        ? (sceneRes.data as { scenes: Stage3dScenesV1 }).scenes
        : (sceneRes.data as Stage3dScenesV1 | undefined)
      if (container && container.scenes && typeof container.scenes === 'object') {
        setScenesByShot(container.scenes)
        setRevision(String(container.revision ?? '0'))
      }
    }
    if (dramaRes.ok && Array.isArray(dramaRes.data?.elements)) {
      const sb = dramaRes.data.elements.find((e) => e.kind === 'drama.storyboard_table')
      if (sb) {
        const detail = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: sb.elementId })
        if (detail.ok) {
          const rows = ((detail.data.element.payload ?? {}) as { rows?: Array<{ shotRef?: string }> }).rows ?? []
          const refs = rows.map((r) => r.shotRef).filter((s): s is string => typeof s === 'string' && s.length > 0)
          if (refs.length > 0) {
            setShotRefs(refs)
            setActiveShotRef((prev) => (refs.includes(prev) ? prev : refs[0]!))
          }
        }
      }
    }
  }, [rpc])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const currentScene: Stage3dShotSceneV1 = useMemo(
    () => scenesByShot[activeShotRef] ?? createDefaultStage3dScene(activeShotRef),
    [scenesByShot, activeShotRef],
  )

  const prevShotRef = useMemo(() => {
    const idx = shotRefs.indexOf(activeShotRef)
    return idx > 0 ? shotRefs[idx - 1] : undefined
  }, [shotRefs, activeShotRef])

  const prevScene = prevShotRef ? (scenesByShot[prevShotRef] ?? createDefaultStage3dScene(prevShotRef)) : undefined
  const axisCheck = useMemo(() => detectStageAxisCrossing(prevScene, currentScene), [prevScene, currentScene])
  const scaleEst = useMemo(() => estimateShotScale(currentScene), [currentScene])
  const promptData = useMemo(() => compileStage3dPromptLocal(currentScene, aspect), [currentScene, aspect])

  const updateCurrentScene = useCallback(
    (updater: (prev: Stage3dShotSceneV1) => Stage3dShotSceneV1) => {
      setScenesByShot((prev) => {
        const base = prev[activeShotRef] ?? createDefaultStage3dScene(activeShotRef)
        return { ...prev, [activeShotRef]: updater(base) }
      })
    },
    [activeShotRef],
  )

  // Paint 3D perspective Canvas2D monitor
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = aspect === '9:16' ? 270 : 480
    const h = aspect === '9:16' ? 480 : 270
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    renderStage3dCanvas(ctx, currentScene, w, h, { showSafeZone, showGrid: true })
  }, [currentScene, aspect, showSafeZone])

  const applyPreset = (presetId: Stage3dPresetId) => {
    const found = STAGE3D_CAMERA_PRESETS.find((p) => p.id === presetId)
    if (!found) return
    updateCurrentScene((prev) => ({ ...prev, camera: { ...found.camera } }))
  }

  const handleOrbitDown = (ev: PointerEvent<HTMLCanvasElement>) => {
    orbitRef.current = { x: ev.clientX, y: ev.clientY }
  }

  const handleOrbitMove = (ev: PointerEvent<HTMLCanvasElement>) => {
    const start = orbitRef.current
    if (!start) return
    const dx = ev.clientX - start.x
    const dy = ev.clientY - start.y
    orbitRef.current = { x: ev.clientX, y: ev.clientY }
    updateCurrentScene((prev) => {
      const c = prev.camera
      const rx = c.x - c.targetX
      const rz = c.z - c.targetZ
      const angle = dx * 0.01
      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)
      const nx = c.targetX + rx * cosA - rz * sinA
      const nz = c.targetZ + rx * sinA + rz * cosA
      const ny = Math.max(0.3, Math.min(8, c.y + dy * 0.015))
      return {
        ...prev,
        camera: { ...c, x: Number(nx.toFixed(2)), y: Number(ny.toFixed(2)), z: Number(nz.toFixed(2)) },
      }
    })
  }

  const handleOrbitUp = () => {
    orbitRef.current = null
  }

  const handleFloorPointerMove = (ev: PointerEvent<HTMLDivElement>) => {
    const drag = floorDragRef.current
    const box = floorBoxRef.current
    if (!drag || !box) return
    const rect = box.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const pctX = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100))
    const pctZ = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100))
    const wx = pctToWorld(pctX)
    const wz = pctToWorld(pctZ)
    if (drag.kind === 'camera') {
      updateCurrentScene((prev) => ({ ...prev, camera: { ...prev.camera, x: wx, z: wz } }))
    } else if (drag.kind === 'actor' && drag.id) {
      updateCurrentScene((prev) => ({
        ...prev,
        actors: prev.actors.map((a) => (a.id === drag.id ? { ...a, x: wx, z: wz } : a)),
      }))
    }
  }

  const handleSaveScene = async () => {
    setSaving(true)
    try {
      const res = await rpc.call<{ scenes?: Stage3dScenesV1 }>('stage3d.scene.save', {
        shotRef: activeShotRef,
        camera: currentScene.camera,
        actors: currentScene.actors,
        lights: currentScene.lights,
        props: currentScene.props,
        ...(currentScene.snapshotSha256 ? { snapshotSha256: currentScene.snapshotSha256 } : {}),
        expectedRevision: revision,
      })
      if (!res.ok) {
        setNotice({ tone: 'bad', text: res.error.message })
        return
      }
      if (res.data?.scenes?.revision) setRevision(res.data.scenes.revision)
      setNotice({ tone: 'ok', text: `${activeShotRef} · ${t('saveDone')}` })
    } finally {
      setSaving(false)
    }
  }

  const handleSnapshotBind = async () => {
    setSaving(true)
    setSnapshotReceipt(null)
    try {
      const dataUrl = renderGreyboxSnapshotPng(currentScene, aspect) ?? FALLBACK_GREYBOX_PNG_DATA_URL
      const res = await rpc.call<Stage3dSnapshotSaveResultV1 | { snapshot?: Stage3dSnapshotSaveResultV1 }>(
        'stage3d.snapshot.save',
        {
          shotRef: activeShotRef,
          dataUrl,
          label: `${activeShotRef} 3D greybox (${currentScene.camera.fovMm}mm)`,
          bindToShot: true,
        },
      )
      if (!res.ok) {
        setNotice({ tone: 'bad', text: res.error.message })
        return
      }
      const snap = 'snapshot' in (res.data ?? {}) && (res.data as { snapshot?: Stage3dSnapshotSaveResultV1 }).snapshot
        ? (res.data as { snapshot: Stage3dSnapshotSaveResultV1 }).snapshot
        : (res.data as Stage3dSnapshotSaveResultV1)
      updateCurrentScene((prev) => ({ ...prev, snapshotSha256: snap.sha256 }))
      notifyShotMediaChanged()
      const msg = `${t('snapshotDone')} (${snap.boundShotRef ?? activeShotRef})`
      setSnapshotReceipt(msg)
      setNotice({ tone: 'ok', text: msg })
    } finally {
      setSaving(false)
    }
  }

  const camPctX = worldToPct(currentScene.camera.x)
  const camPctZ = worldToPct(currentScene.camera.z)
  const tgtPctX = worldToPct(currentScene.camera.targetX)
  const tgtPctZ = worldToPct(currentScene.camera.targetZ)

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      rpc={rpc}
      t={coreT}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      onSyncRequested={loadAll}
      hero={
        <RoomHero
          eyebrow={t('heroEyebrow')}
          title={t('heroTitle')}
          lede={t('heroLede')}
          stats={[
            { icon: 'play', value: Object.keys(scenesByShot).length || shotRefs.length, label: t('statShots') },
            { icon: 'sliders', value: `${currentScene.camera.fovMm}mm`, label: t('statLens') },
          ]}
        />
      }
      stageTabs={[
        {
          id: 'director-stage',
          label: () => t('tabStage'),
          render: () => (
            <div className="mw-s3d-layout mw-stack" data-gap="md" data-stage3d-root="true">
              <div className="mw-s3d-toolbar mw-spread">
                <div className="mw-row" data-gap="xs">
                  <select
                    className="mw-dsh-input"
                    aria-label={t('shotSelectLabel')}
                    data-stage3d-shot-select="true"
                    value={activeShotRef}
                    onChange={(ev) => setActiveShotRef(ev.target.value)}
                  >
                    {shotRefs.map((ref) => (
                      <option key={ref} value={ref}>
                        {ref}
                      </option>
                    ))}
                  </select>
                  <Segmented<'9:16' | '16:9'>
                    label={t('aspectLabel')}
                    value={aspect}
                    options={[
                      { value: '9:16', label: '9:16' },
                      { value: '16:9', label: '16:9' },
                    ]}
                    onChange={setAspect}
                  />
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="ghost"
                    data-stage3d-safezone="true"
                    aria-pressed={showSafeZone}
                    onClick={() => setShowSafeZone((s) => !s)}
                  >
                    {t('safeZoneToggle')}
                  </button>
                </div>

                <div className="mw-row" data-gap="xs">
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="quiet"
                    data-stage3d-snapshot-bind="true"
                    disabled={saving}
                    onClick={() => void handleSnapshotBind()}
                  >
                    {t('snapshotAndBind')}
                  </button>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="primary"
                    data-stage3d-save="true"
                    disabled={saving}
                    onClick={() => void handleSaveScene()}
                  >
                    {saving ? t('savingScene') : t('saveScene')}
                  </button>
                </div>
              </div>

              {axisCheck.crossed ? (
                <div data-stage3d-axis-alert="true">
                  <Callout tone="warn" role="alert">
                    {t('axisCrossingAlert')} {axisCheck.detail ? `· ${axisCheck.detail}` : ''}
                  </Callout>
                </div>
              ) : null}

              {snapshotReceipt ? (
                <p className="mw-dsh-muted" role="status" data-stage3d-snapshot-receipt="true">
                  {snapshotReceipt}
                </p>
              ) : null}

              <div className="mw-s3d-presets mw-row" data-gap="xs" role="group" aria-label={t('presetsLabel')}>
                {STAGE3D_CAMERA_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="ghost"
                    data-stage3d-preset={preset.id}
                    aria-pressed={currentScene.camera.preset === preset.id}
                    onClick={() => applyPreset(preset.id)}
                  >
                    {lang === 'en' ? preset.labelEn : preset.labelZh}
                  </button>
                ))}
                {STAGE3D_FOCAL_LENGTHS.map((mm) => (
                  <button
                    key={mm}
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="ghost"
                    data-stage3d-focal={String(mm)}
                    aria-pressed={currentScene.camera.fovMm === mm}
                    onClick={() =>
                      updateCurrentScene((prev) => ({ ...prev, camera: { ...prev.camera, fovMm: mm } }))
                    }
                  >
                    {mm}mm
                  </button>
                ))}
              </div>

              <div className="mw-s3d-grid mw-split-2">
                <section className="mw-s3d-viewport mw-dsh-card mw-stack" data-gap="xs" data-stage3d-monitor="true" data-aspect={aspect}>
                  <div className="mw-spread">
                    <span className="mw-eyebrow">{t('monitorTitle')}</span>
                    <span className="mw-chip">
                      {lang === 'en' ? scaleEst.scaleEn : scaleEst.scaleZh} · {currentScene.camera.fovMm}mm · {scaleEst.pitchDeg}° · {scaleEst.distanceM}m
                    </span>
                  </div>
                  <canvas
                    ref={canvasRef}
                    className="mw-s3d-canvas"
                    onPointerDown={handleOrbitDown}
                    onPointerMove={handleOrbitMove}
                    onPointerUp={handleOrbitUp}
                    onPointerLeave={handleOrbitUp}
                  />
                </section>

                <section className="mw-s3d-controls mw-dsh-card mw-stack" data-gap="xs">
                  <span className="mw-eyebrow">{t('floorplanTitle')}</span>
                  <div
                    ref={floorBoxRef}
                    className="mw-s3d-topdown"
                    data-stage3d-floorplan="true"
                    onPointerMove={handleFloorPointerMove}
                    onPointerUp={() => {
                      floorDragRef.current = null
                    }}
                    onPointerLeave={() => {
                      floorDragRef.current = null
                    }}
                  >
                    <svg className="mw-s3d-frustum" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <line x1={camPctX} y1={camPctZ} x2={tgtPctX} y2={tgtPctZ} className="mw-s3d-frustum-line" />
                      {currentScene.actors.length >= 2 ? (
                        <line
                          x1={worldToPct(currentScene.actors[0]!.x)}
                          y1={worldToPct(currentScene.actors[0]!.z)}
                          x2={worldToPct(currentScene.actors[1]!.x)}
                          y2={worldToPct(currentScene.actors[1]!.z)}
                          className="mw-s3d-axis-line"
                        />
                      ) : null}
                    </svg>

                    <button
                      type="button"
                      className="mw-s3d-marker"
                      data-marker-kind="camera"
                      data-stage3d-camera-marker="true"
                      onPointerDown={() => {
                        floorDragRef.current = { kind: 'camera' }
                      }}
                      style={
                        {
                          '--mw-x': `${camPctX}%`,
                          '--mw-y': `${camPctZ}%`,
                        } as CSSProperties
                      }
                    >
                      CAM
                    </button>

                    {currentScene.actors.map((actor) => (
                      <button
                        key={actor.id}
                        type="button"
                        className="mw-s3d-marker"
                        data-marker-kind="actor"
                        data-stage3d-actor={actor.id}
                        onPointerDown={() => {
                          floorDragRef.current = { kind: 'actor', id: actor.id }
                        }}
                        style={
                          {
                            '--mw-x': `${worldToPct(actor.x)}%`,
                            '--mw-y': `${worldToPct(actor.z)}%`,
                          } as CSSProperties
                        }
                      >
                        {actor.name}
                      </button>
                    ))}

                    {currentScene.lights.map((light) => (
                      <span
                        key={light.id}
                        className="mw-s3d-marker"
                        data-marker-kind="light"
                        style={
                          {
                            '--mw-x': `${worldToPct(light.x)}%`,
                            '--mw-y': `${worldToPct(light.z)}%`,
                          } as CSSProperties
                        }
                      >
                        {light.kind}
                      </span>
                    ))}

                    {currentScene.props.map((prop) => (
                      <span
                        key={prop.id}
                        className="mw-s3d-marker"
                        data-marker-kind="prop"
                        style={
                          {
                            '--mw-x': `${worldToPct(prop.x)}%`,
                            '--mw-y': `${worldToPct(prop.z)}%`,
                          } as CSSProperties
                        }
                      >
                        {prop.name}
                      </span>
                    ))}
                  </div>
                </section>
              </div>

              <section className="mw-s3d-prompt-box mw-dsh-card mw-stack" data-flat="true" data-gap="xs">
                <div className="mw-spread">
                  <span className="mw-eyebrow">{t('promptTitle')}</span>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="quiet"
                    data-stage3d-stage-agent="true"
                    onClick={() =>
                      stageItemToFloatingAgent({
                        kind: 'element',
                        ref: `stage3d:${activeShotRef}`,
                        label: `${activeShotRef} (${currentScene.camera.fovMm}mm)`,
                        serializedLine: `[Stage3DCamera shot=${activeShotRef} lens=${currentScene.camera.fovMm}mm scale=${promptData.shotScale}] ${lang === 'en' ? promptData.en : promptData.zh}`,
                      })
                    }
                  >
                    {t('stageToAgent')}
                  </button>
                </div>
                <p className="mw-dsh-code" data-stage3d-prompt="true">
                  {lang === 'en' ? promptData.en : promptData.zh}
                </p>
              </section>
            </div>
          ),
        },
        {
          id: 'camera-sheet',
          label: () => t('tabCameraSheet'),
          render: () =>
            shotRefs.length === 0 ? (
              <EmptyState>{coreT('emptyElements')}</EmptyState>
            ) : (
              <div className="mw-stack" data-gap="sm" data-stage3d-camera-sheet="true">
                <SectionHead title={t('tabCameraSheet')} meta={String(shotRefs.length)} />
                <div className="mw-table-wrap">
                  <table className="mw-table">
                    <thead>
                      <tr>
                        <th>{t('colShot')}</th>
                        <th data-num="true">{t('colLens')}</th>
                        <th>{t('colScale')}</th>
                        <th data-num="true">{t('colPitch')}</th>
                        <th>{t('colSnapshot')}</th>
                        <th aria-label={t('openInStage')} />
                      </tr>
                    </thead>
                    <tbody>
                      {shotRefs.map((ref) => {
                        const sc = scenesByShot[ref] ?? createDefaultStage3dScene(ref)
                        const est = estimateShotScale(sc)
                        return (
                          <tr key={ref}>
                            <td className="mw-dsh-code">{ref}</td>
                            <td data-num="true">{sc.camera.fovMm}mm</td>
                            <td>{lang === 'en' ? est.scaleEn : est.scaleZh}</td>
                            <td data-num="true">{est.pitchDeg}°</td>
                            <td>
                              <StatusTag
                                status={sc.snapshotSha256 ? 'ready' : 'draft'}
                                lang={lang}
                                label={sc.snapshotSha256 ? t('snapshotBound') : t('snapshotNone')}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="mw-dsh-btn"
                                data-size="sm"
                                data-variant="ghost"
                                onClick={() => {
                                  setActiveShotRef(ref)
                                  if (typeof document !== 'undefined') {
                                    const btn = document.getElementById('mw-tab-director-stage')
                                    if (btn instanceof HTMLButtonElement) btn.click()
                                  }
                                }}
                              >
                                {t('openInStage')}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
        },
      ]}
    />
  )
}

export function Stage3dCompanionPane({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  return <CompanionList rpc={rpc} coreT={coreT} title={t('companionTitle')} domain="drama" companionId="stage3d" />
}

export function apply(ctx: DshClientContextLike): void {
  const tFn = () => ctx.locale.bind(STAGE3D_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: STAGE3D_LOCALE_NS,
    dictionaries: { zh, en },
    group: 'studio',
    pane: {
      pluginId: 'muweave-stage3d',
      panelId: STAGE3D_PANEL_ID,
      order: 44.7,
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: ['drama'],
      companionId: STAGE3D_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: Stage3dIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    },
    MainComponent: Stage3dMainPage,
    CompanionComponent: Stage3dCompanionPane,
  })
}
