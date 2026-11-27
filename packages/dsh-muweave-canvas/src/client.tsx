import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import {
  CompanionList,
  EmptyState,
  IconButton,
  MediaPreview,
  RoomHero,
  SectionHead,
  WorkspaceShell,
  navigateToTheaterRoom,
  openGeneration,
  registerMuweaveCreatorPlugin,
  stageItemToFloatingAgent,
  type CanvasBoardV1,
  type CanvasEdgeV1,
  type CanvasNodeKind,
  type CanvasNodeV1,
  type ContinuityBibleV1,
  type DshClientContextLike,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  type WorkspaceNotice,
} from '@yeisme/dsh-muweave-core/client'

export const name = '@yeisme/dsh-muweave-canvas'
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const CANVAS_PANEL_ID = 'muweave-canvas'
export const CANVAS_COMPANION_ID = 'muweave-canvas/companion'
export const CANVAS_LOCALE_NS = 'muweaveCanvas'

const zh = {
  panelTitle: '空间画布 (Spatial Canvas)',
  roomTitle: '画布',
  companionTitle: '画布节点与连线',
  heroEyebrow: 'MuWeave Studio · 空间画布',
  heroTitle: '创作空间画布',
  heroLede: '在一张无限画布上把角色母版、连续性圣经、剧本场次与分镜镜头串联起来。',
  tabBoard: '空间画布',
  tabOutline: '节点清单',
  statNodes: '节点',
  statEdges: '连线',
  autoLayout: '从当前集自动铺开',
  addNote: '添加便签',
  addScene: '添加场次卡',
  addShot: '添加镜头卡',
  addAsset: '添加资产卡',
  connectMode: '连线模式',
  connectPickSource: '点击起点节点，再点击目标节点连线',
  connectPickTarget: '已选起点：{title}，点击目标节点完成连线',
  saveBoard: '保存画布',
  savingBoard: '保存中…',
  resetBoard: '清空重置',
  savedReceipt: '画布已保存',
  resetReceipt: '画布已重置',
  zoomOut: '缩小',
  zoomIn: '放大',
  zoomReset: '重置缩放',
  emptyBoardHint: '画布为空，点击「从当前集自动铺开」即可自动生成角色、场次与分镜关系图。',
  nodeKind_character: '角色',
  nodeKind_scene: '场次',
  nodeKind_prop: '道具',
  nodeKind_shot: '分镜',
  nodeKind_note: '便签',
  nodeKind_asset: '资产',
  openSourceRoom: '跳回原房间',
  generateFromNode: '生成',
  removeNode: '移除节点',
  outlineSearchPlaceholder: '搜索节点标题、类型或引用…',
  exportMermaid: '导出 Mermaid',
  mermaidCopied: '已复制 Mermaid 流程图',
  nodesSection: '节点清单',
  edgesSection: '有向连线',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: 'Spatial Canvas',
  roomTitle: 'Canvas',
  companionTitle: 'Canvas Nodes & Edges',
  heroEyebrow: 'MuWeave Studio · Spatial Canvas',
  heroTitle: 'Creator Spatial Canvas',
  heroLede: 'Arrange masters, Continuity Bible palette, scenes, and shots on one connected board.',
  tabBoard: 'Spatial Board',
  tabOutline: 'Node Outline',
  statNodes: 'nodes',
  statEdges: 'edges',
  autoLayout: 'Auto-Layout Episode',
  addNote: 'Add Note',
  addScene: 'Add Scene',
  addShot: 'Add Shot',
  addAsset: 'Add Asset',
  connectMode: 'Connect Mode',
  connectPickSource: 'Click a source node, then a target node to link',
  connectPickTarget: 'Source selected: {title}. Click target node to connect',
  saveBoard: 'Save Board',
  savingBoard: 'Saving…',
  resetBoard: 'Reset',
  savedReceipt: 'Canvas board saved',
  resetReceipt: 'Canvas board reset',
  zoomOut: 'Zoom Out',
  zoomIn: 'Zoom In',
  zoomReset: 'Reset Zoom',
  emptyBoardHint: 'Board is empty. Click "Auto-Layout Episode" to populate masters, scenes, and shots.',
  nodeKind_character: 'Character',
  nodeKind_scene: 'Scene',
  nodeKind_prop: 'Prop',
  nodeKind_shot: 'Shot',
  nodeKind_note: 'Note',
  nodeKind_asset: 'Asset',
  openSourceRoom: 'Open Source Room',
  generateFromNode: 'Generate',
  removeNode: 'Remove Node',
  outlineSearchPlaceholder: 'Search nodes by title, kind, or ref…',
  exportMermaid: 'Export Mermaid',
  mermaidCopied: 'Copied Mermaid flowchart',
  nodesSection: 'Nodes',
  edgesSection: 'Edges',
}

function targetRoomForKind(kind: CanvasNodeKind): string {
  if (kind === 'character' || kind === 'asset') return 'muweave-eikona'
  if (kind === 'scene') return 'muweave-script'
  if (kind === 'shot') return 'muweave-drama'
  return 'muweave-workbench'
}

function buildMermaidLocal(nodes: readonly CanvasNodeV1[], edges: readonly CanvasEdgeV1[]): string {
  const safeId = (raw: string) => raw.replace(/[^A-Za-z0-9_]/g, '_')
  const safeLabel = (raw: string) => raw.replace(/["[\]\n\r]/g, ' ').trim()
  const lines = ['flowchart LR']
  for (const n of nodes) {
    lines.push(`  ${safeId(n.id)}["${safeLabel(n.title)} (${n.kind})"]`)
  }
  for (const e of edges) {
    const lbl = e.label ? `|${safeLabel(e.label)}|` : ''
    lines.push(`  ${safeId(e.from)} -->${lbl} ${safeId(e.to)}`)
  }
  return lines.join('\n')
}

async function copyTextSafe(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // ignore
    }
  }
}

export function CanvasIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <rect x="2" y="2.5" width="4.5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="2.5" width="4.5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="5.75" y="9.5" width="4.5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 4.5h3M4.25 6.5v1.5h3.75v1.5M11.75 6.5v1.5H8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function CanvasMainPage({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  const [nodes, setNodes] = useState<CanvasNodeV1[]>([])
  const [edges, setEdges] = useState<CanvasEdgeV1[]>([])
  const [revision, setRevision] = useState<string>('0')
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [connectMode, setConnectMode] = useState(false)
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null)
  const [outlineQuery, setOutlineQuery] = useState('')
  const [mermaidPreview, setMermaidPreview] = useState<string | null>(null)
  const [elements, setElements] = useState<MuweaveElementSummaryV1[]>([])
  const [bible, setBible] = useState<ContinuityBibleV1 | null>(null)
  const [storyboardRows, setStoryboardRows] = useState<Array<{ shotRef: string; sceneRef: string; order: number }>>([])
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)

  const loadAll = useCallback(async () => {
    const [boardRes, elRes, bibleRes] = await Promise.all([
      rpc.call<{ board?: CanvasBoardV1 } | CanvasBoardV1>('canvas.board.get', {}),
      rpc.call<{ elements?: MuweaveElementSummaryV1[] }>('bundle.elements.list', {}),
      rpc.call<{ bible?: ContinuityBibleV1 | null }>('project.bible.get', {}),
    ])
    if (boardRes.ok) {
      const b = 'board' in (boardRes.data ?? {}) && (boardRes.data as { board?: CanvasBoardV1 }).board
        ? (boardRes.data as { board: CanvasBoardV1 }).board
        : (boardRes.data as CanvasBoardV1 | undefined)
      if (b && Array.isArray(b.nodes)) {
        setNodes(b.nodes)
        setEdges(Array.isArray(b.edges) ? b.edges : [])
        setRevision(String(b.revision ?? '0'))
        if (b.viewport) {
          setPanX(b.viewport.x ?? 0)
          setPanY(b.viewport.y ?? 0)
          setZoom(Math.min(2, Math.max(0.25, b.viewport.zoom ?? 1)))
        }
      }
    }
    if (elRes.ok && Array.isArray(elRes.data?.elements)) {
      setElements(elRes.data.elements)
      const sb = elRes.data.elements.find((e) => e.kind === 'drama.storyboard_table')
      if (sb) {
        const sbDetail = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { elementId: sb.elementId })
        if (sbDetail.ok) {
          const rows = ((sbDetail.data.element.payload ?? {}) as {
            rows?: Array<{ shotRef?: string; sceneRef?: string; order?: number }>
          }).rows ?? []
          setStoryboardRows(
            rows
              .filter((r): r is { shotRef: string; sceneRef: string; order: number } => typeof r.shotRef === 'string')
              .slice(0, 12),
          )
        }
      }
    }
    if (bibleRes.ok) {
      setBible(bibleRes.data?.bible ?? null)
    }
  }, [rpc])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const handleAutoLayout = useCallback(() => {
    const nextNodes: CanvasNodeV1[] = []
    const nextEdges: CanvasEdgeV1[] = []

    const masters = elements.filter((e) => e.kind === 'eikona.master_binding' || e.kind === 'eikona.candidate_group').slice(0, 4)
    masters.forEach((m, idx) => {
      nextNodes.push({
        id: `node_master_${idx + 1}`,
        kind: 'character',
        title: m.title,
        subtitle: m.subtitle,
        x: 24,
        y: 24 + idx * 140,
        width: 220,
        height: 112,
        elementId: m.elementId,
        refId: m.sourceRef,
      })
    })

    if (bible && (bible.visualGrammar.styleDirective || bible.colorPalette.length > 0)) {
      nextNodes.push({
        id: 'node_bible_palette',
        kind: 'asset',
        title: bible.projectTitle || 'Continuity Bible',
        subtitle: bible.visualGrammar.styleDirective || bible.colorPalette.map((c) => c.name).join(' · '),
        x: 24,
        y: 24 + Math.max(1, masters.length) * 140,
        width: 220,
        height: 112,
        refId: 'project:continuity_bible',
      })
    }

    const scenes = elements.filter((e) => e.kind === 'script.scene_card').slice(0, 6)
    const sceneIdByRef = new Map<string, string>()
    scenes.forEach((sc, idx) => {
      const id = `node_scene_${idx + 1}`
      const ref = sc.sceneRef || sc.sourceRef || sc.elementId
      sceneIdByRef.set(ref, id)
      nextNodes.push({
        id,
        kind: 'scene',
        title: sc.title,
        subtitle: sc.subtitle,
        x: 300,
        y: 24 + idx * 140,
        width: 230,
        height: 112,
        elementId: sc.elementId,
        refId: ref,
      })
      if (masters[0]) {
        nextEdges.push({
          id: `edge_m_${idx + 1}`,
          from: 'node_master_1',
          to: id,
          label: 'cast',
          kind: 'ref',
        })
      }
    })

    storyboardRows.forEach((row, idx) => {
      const id = `node_shot_${idx + 1}`
      nextNodes.push({
        id,
        kind: 'shot',
        title: `#${String(row.order).padStart(2, '0')} ${row.shotRef}`,
        subtitle: row.sceneRef,
        x: 590,
        y: 24 + idx * 130,
        width: 220,
        height: 104,
        refId: row.shotRef,
      })
      const parentSceneNodeId = sceneIdByRef.get(row.sceneRef)
      if (parentSceneNodeId) {
        nextEdges.push({
          id: `edge_sc_sh_${idx + 1}`,
          from: parentSceneNodeId,
          to: id,
          label: 'breakdown',
          kind: 'flow',
        })
      }
      if (idx > 0) {
        nextEdges.push({
          id: `edge_seq_${idx}`,
          from: `node_shot_${idx}`,
          to: id,
          kind: 'flow',
        })
      }
    })

    if (nextNodes.length === 0) {
      nextNodes.push(
        { id: 'node_note_1', kind: 'note', title: '开场钩子 (0-3s)', subtitle: '特写推镜建立悬念', x: 40, y: 40, width: 220, height: 104 },
        { id: 'node_shot_1', kind: 'shot', title: '#01 shot:01', subtitle: 'scene:01', x: 320, y: 40, width: 220, height: 104, refId: 'shot:01' },
      )
      nextEdges.push({ id: 'edge_init_1', from: 'node_note_1', to: 'node_shot_1', label: 'hook', kind: 'flow' })
    }

    setNodes(nextNodes)
    setEdges(nextEdges)
  }, [elements, bible, storyboardRows])

  const handleAddNode = (kind: CanvasNodeKind) => {
    const idx = nodes.length + 1
    const newNode: CanvasNodeV1 = {
      id: `node_${kind}_${Date.now()}_${idx}`,
      kind,
      title: `${t(`nodeKind_${kind}`)} #${idx}`,
      x: 40 + (idx % 4) * 240,
      y: 40 + Math.floor(idx / 4) * 140,
      width: 220,
      height: 104,
    }
    setNodes((prev) => [...prev, newNode])
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await rpc.call<{ board?: CanvasBoardV1 }>('canvas.board.save', {
        nodes,
        edges,
        viewport: { x: panX, y: panY, zoom },
        expectedRevision: revision,
      })
      if (!res.ok) {
        setNotice({ tone: 'bad', text: res.error.message })
        return
      }
      if (res.data?.board?.revision) setRevision(res.data.board.revision)
      setNotice({ tone: 'ok', text: t('savedReceipt') })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    try {
      const res = await rpc.call<{ board?: CanvasBoardV1 }>('canvas.board.reset', {})
      if (res.ok) {
        setNodes([])
        setEdges([])
        if (res.data?.board?.revision) setRevision(res.data.board.revision)
        setNotice({ tone: 'ok', text: t('resetReceipt') })
      }
    } finally {
      setSaving(false)
    }
  }

  const handleNodeClick = (node: CanvasNodeV1) => {
    if (!connectMode) return
    if (!connectSourceId) {
      setConnectSourceId(node.id)
      return
    }
    if (connectSourceId === node.id) {
      setConnectSourceId(null)
      return
    }
    const edgeId = `edge_${connectSourceId}_${node.id}`
    if (!edges.some((e) => e.from === connectSourceId && e.to === node.id)) {
      setEdges((prev) => [...prev, { id: edgeId, from: connectSourceId, to: node.id, kind: 'flow' }])
    }
    setConnectSourceId(null)
  }

  const handleNodePointerDown = (node: CanvasNodeV1, ev: PointerEvent<HTMLElement>) => {
    if (connectMode) return
    if ((ev.target as HTMLElement).closest('button, input, select')) return
    dragRef.current = {
      id: node.id,
      startX: ev.clientX,
      startY: ev.clientY,
      origX: node.x,
      origY: node.y,
    }
  }

  const handleBoardPointerMove = (ev: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = (ev.clientX - drag.startX) / zoom
    const dy = (ev.clientY - drag.startY) / zoom
    setNodes((prev) =>
      prev.map((n) => (n.id === drag.id ? { ...n, x: Math.round(drag.origX + dx), y: Math.round(drag.origY + dy) } : n)),
    )
  }

  const handleBoardPointerUp = () => {
    dragRef.current = null
  }

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const filteredOutlineNodes = useMemo(() => {
    const q = outlineQuery.trim().toLowerCase()
    if (!q) return nodes
    return nodes.filter((n) => `${n.title} ${n.subtitle ?? ''} ${n.kind} ${n.refId ?? ''}`.toLowerCase().includes(q))
  }, [nodes, outlineQuery])

  const handleExportMermaid = async () => {
    const code = buildMermaidLocal(nodes, edges)
    setMermaidPreview(code)
    await copyTextSafe(code)
    setNotice({ tone: 'ok', text: t('mermaidCopied') })
  }

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
            { icon: 'inbox', value: nodes.length, label: t('statNodes') },
            { icon: 'link', value: edges.length, label: t('statEdges') },
          ]}
        />
      }
      stageTabs={[
        {
          id: 'board',
          label: () => t('tabBoard'),
          render: () => (
            <div className="mw-stack" data-gap="md">
              <div className="mw-canvas-toolbar mw-spread" data-canvas-toolbar="true">
                <div className="mw-row" data-gap="xs">
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="primary"
                    data-canvas-autolayout="true"
                    onClick={handleAutoLayout}
                  >
                    {t('autoLayout')}
                  </button>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="quiet"
                    data-canvas-add-note="true"
                    onClick={() => handleAddNode('note')}
                  >
                    {t('addNote')}
                  </button>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="quiet"
                    data-canvas-add-scene="true"
                    onClick={() => handleAddNode('scene')}
                  >
                    {t('addScene')}
                  </button>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="quiet"
                    data-canvas-add-shot="true"
                    onClick={() => handleAddNode('shot')}
                  >
                    {t('addShot')}
                  </button>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="ghost"
                    data-canvas-connect-mode="true"
                    aria-pressed={connectMode}
                    onClick={() => {
                      setConnectMode((m) => !m)
                      setConnectSourceId(null)
                    }}
                  >
                    {t('connectMode')}
                  </button>
                </div>

                <div className="mw-row" data-gap="xs">
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="ghost"
                    aria-label={t('zoomOut')}
                    onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.15).toFixed(2))))}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="ghost"
                    onClick={() => {
                      setZoom(1)
                      setPanX(0)
                      setPanY(0)
                    }}
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="ghost"
                    aria-label={t('zoomIn')}
                    onClick={() => setZoom((z) => Math.min(2, Number((z + 0.15).toFixed(2))))}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="primary"
                    data-canvas-save="true"
                    disabled={saving}
                    onClick={() => void handleSave()}
                  >
                    {saving ? t('savingBoard') : t('saveBoard')}
                  </button>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="ghost"
                    data-canvas-reset="true"
                    disabled={saving}
                    onClick={() => void handleReset()}
                  >
                    {t('resetBoard')}
                  </button>
                </div>
              </div>

              {connectMode ? (
                <p className="mw-dsh-muted" role="status">
                  {connectSourceId
                    ? t('connectPickTarget').replace('{title}', nodeById.get(connectSourceId)?.title ?? connectSourceId)
                    : t('connectPickSource')}
                </p>
              ) : null}

              <div
                className="mw-canvas-viewport"
                data-canvas-board="true"
                onPointerMove={handleBoardPointerMove}
                onPointerUp={handleBoardPointerUp}
                style={
                  {
                    '--mw-pan-x': `${panX}px`,
                    '--mw-pan-y': `${panY}px`,
                    '--mw-zoom': String(zoom),
                  } as CSSProperties
                }
              >
                {nodes.length === 0 ? (
                  <EmptyState icon="inbox">{t('emptyBoardHint')}</EmptyState>
                ) : (
                  <div className="mw-canvas-stage">
                    <svg className="mw-canvas-edges" aria-hidden="true">
                      {edges.map((edge) => {
                        const a = nodeById.get(edge.from)
                        const b = nodeById.get(edge.to)
                        if (!a || !b) return null
                        const x1 = a.x + (a.width ?? 220) / 2
                        const y1 = a.y + (a.height ?? 104) / 2
                        const x2 = b.x + (b.width ?? 220) / 2
                        const y2 = b.y + (b.height ?? 104) / 2
                        return <line key={edge.id} x1={x1} y1={y1} x2={x2} y2={y2} className="mw-canvas-edge" />
                      })}
                    </svg>

                    {nodes.map((node) => (
                      <article
                        key={node.id}
                        className="mw-canvas-node mw-dsh-card mw-stack"
                        data-gap="xs"
                        data-canvas-node={node.id}
                        data-node-kind={node.kind}
                        data-selected={connectSourceId === node.id ? 'true' : undefined}
                        onClick={() => handleNodeClick(node)}
                        onPointerDown={(ev) => handleNodePointerDown(node, ev)}
                        style={
                          {
                            '--mw-x': `${node.x}px`,
                            '--mw-y': `${node.y}px`,
                            '--mw-w': `${node.width ?? 220}px`,
                            '--mw-h': `${node.height ?? 104}px`,
                          } as CSSProperties
                        }
                      >
                        <div className="mw-spread">
                          <span className="mw-eyebrow">{t(`nodeKind_${node.kind}`)}</span>
                          <div className="mw-row" data-gap="xs">
                            <IconButton
                              icon="at"
                              size="sm"
                              label={coreT('insertRefChip')}
                              onClick={() =>
                                stageItemToFloatingAgent({
                                  kind: 'element',
                                  ref: node.elementId ?? node.refId ?? node.id,
                                  label: node.title,
                                  serializedLine: `[CanvasNode kind=${node.kind} id=${node.id} title=${node.title}]`,
                                })
                              }
                            />
                            <IconButton
                              icon="close"
                              size="sm"
                              label={t('removeNode')}
                              onClick={() => {
                                setNodes((prev) => prev.filter((n) => n.id !== node.id))
                                setEdges((prev) => prev.filter((e) => e.from !== node.id && e.to !== node.id))
                              }}
                            />
                          </div>
                        </div>
                        <strong className="mw-title">{node.title}</strong>
                        {node.subtitle ? <span className="mw-dsh-muted mw-clamp-2">{node.subtitle}</span> : null}
                        {node.sha256 ? (
                          <MediaPreview
                            rpc={rpc}
                            sha256={node.sha256}
                            alt={node.title}
                            pendingLabel={coreT('loading')}
                            emptyLabel={node.title}
                          />
                        ) : null}
                        <div className="mw-row" data-gap="xs">
                          <button
                            type="button"
                            className="mw-dsh-btn"
                            data-size="sm"
                            data-variant="ghost"
                            onClick={(ev) =>
                              openGeneration(
                                {
                                  capabilityId: 'eikona.image.generate',
                                  input: { prompt: `${node.title} ${node.subtitle ?? ''}`.trim() },
                                  ...(node.kind === 'shot' && node.refId ? { anchor: { shotRef: node.refId } } : {}),
                                },
                                ev.currentTarget,
                              )
                            }
                          >
                            {t('generateFromNode')}
                          </button>
                          <button
                            type="button"
                            className="mw-dsh-btn"
                            data-size="sm"
                            data-variant="ghost"
                            onClick={() => navigateToTheaterRoom(targetRoomForKind(node.kind))}
                          >
                            {t('openSourceRoom')}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        },
        {
          id: 'outline',
          label: () => t('tabOutline'),
          render: () => (
            <div className="mw-stack" data-gap="md" data-canvas-outline="true">
              <div className="mw-spread">
                <input
                  type="search"
                  className="mw-dsh-input"
                  aria-label={t('outlineSearchPlaceholder')}
                  placeholder={t('outlineSearchPlaceholder')}
                  value={outlineQuery}
                  onChange={(ev) => setOutlineQuery(ev.target.value)}
                />
                <button
                  type="button"
                  className="mw-dsh-btn"
                  data-size="sm"
                  data-variant="quiet"
                  data-canvas-mermaid="true"
                  onClick={() => void handleExportMermaid()}
                >
                  {t('exportMermaid')}
                </button>
              </div>

              {mermaidPreview ? (
                <pre className="mw-pre" data-canvas-mermaid-output="true">
                  {mermaidPreview}
                </pre>
              ) : null}

              <SectionHead title={t('nodesSection')} meta={String(filteredOutlineNodes.length)} />
              {filteredOutlineNodes.length === 0 ? (
                <EmptyState>{coreT('emptyElements')}</EmptyState>
              ) : (
                <div className="mw-table-wrap">
                  <table className="mw-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Title</th>
                        <th>Kind</th>
                        <th>Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOutlineNodes.map((n) => (
                        <tr key={n.id}>
                          <td className="mw-dsh-code">{n.id}</td>
                          <td>{n.title}</td>
                          <td>{t(`nodeKind_${n.kind}`)}</td>
                          <td className="mw-dsh-code">{n.refId ?? n.elementId ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {edges.length > 0 ? (
                <>
                  <SectionHead title={t('edgesSection')} meta={String(edges.length)} />
                  <ul className="mw-stack" data-gap="xs">
                    {edges.map((e) => (
                      <li key={e.id} className="mw-row" data-gap="xs">
                        <span className="mw-dsh-code">{e.from}</span>
                        <span>→</span>
                        <span className="mw-dsh-code">{e.to}</span>
                        {e.label ? <span className="mw-chip">{e.label}</span> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ),
        },
      ]}
    />
  )
}

export function CanvasCompanionPane({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  return <CompanionList rpc={rpc} coreT={coreT} title={t('companionTitle')} companionId="canvas" />
}

export function apply(ctx: DshClientContextLike): void {
  const tFn = () => ctx.locale.bind(CANVAS_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: CANVAS_LOCALE_NS,
    dictionaries: { zh, en },
    group: 'studio',
    pane: {
      pluginId: 'muweave-canvas',
      panelId: CANVAS_PANEL_ID,
      order: 44.6,
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: ['drama', 'script', 'eikona'],
      companionId: CANVAS_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: CanvasIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    },
    MainComponent: CanvasMainPage,
    CompanionComponent: CanvasCompanionPane,
  })
}
