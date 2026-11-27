import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import type {
  CanvasBoardSaveInputV1,
  CanvasBoardV1,
  CanvasEdgeV1,
  CanvasNodeKind,
  CanvasNodeV1,
} from './protocol'

export const CANVAS_BOARD_SCHEMA = 'muweave.canvas-board.v1' as const

const NODE_KINDS = new Set<CanvasNodeKind>(['character', 'scene', 'prop', 'shot', 'note', 'asset'])
const EDGE_KINDS = new Set(['flow', 'ref', 'conflict'])
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

export class CanvasBoardInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

function defaultBoard(workspaceId: string): CanvasBoardV1 {
  return {
    schema: CANVAS_BOARD_SCHEMA,
    workspaceId,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    revision: '0',
    updatedAt: '',
  }
}

function assertFinite(n: unknown, field: string): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new CanvasBoardInputError('muweave/invalid_canvas_input', `${field} must be a finite number`)
  }
  return n
}

function validateNodes(raw: unknown): CanvasNodeV1[] {
  if (!Array.isArray(raw)) throw new CanvasBoardInputError('muweave/invalid_canvas_input', 'nodes must be an array')
  if (raw.length > 300) throw new CanvasBoardInputError('muweave/invalid_canvas_input', 'nodes exceeds max 300')
  const seen = new Set<string>()
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new CanvasBoardInputError('muweave/invalid_canvas_input', `nodes[${idx}] must be an object`)
    }
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    if (!SAFE_ID_RE.test(id) || seen.has(id)) {
      throw new CanvasBoardInputError('muweave/invalid_canvas_input', `nodes[${idx}].id must be a unique safe id`)
    }
    seen.add(id)
    const kind = r.kind as CanvasNodeKind
    if (!NODE_KINDS.has(kind)) {
      throw new CanvasBoardInputError('muweave/invalid_canvas_input', `nodes[${idx}].kind is invalid`)
    }
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 160) : ''
    if (!title) throw new CanvasBoardInputError('muweave/invalid_canvas_input', `nodes[${idx}].title is required`)
    const subtitle = typeof r.subtitle === 'string' && r.subtitle.trim() ? r.subtitle.trim().slice(0, 240) : undefined
    const x = assertFinite(r.x, `nodes[${idx}].x`)
    const y = assertFinite(r.y, `nodes[${idx}].y`)
    return {
      id,
      kind,
      title,
      ...(subtitle ? { subtitle } : {}),
      x,
      y,
      ...(typeof r.width === 'number' && Number.isFinite(r.width) ? { width: r.width } : {}),
      ...(typeof r.height === 'number' && Number.isFinite(r.height) ? { height: r.height } : {}),
      ...(typeof r.color === 'string' && r.color.trim() ? { color: r.color.trim().slice(0, 32) } : {}),
      ...(typeof r.elementId === 'string' && r.elementId.trim() ? { elementId: r.elementId.trim().slice(0, 128) } : {}),
      ...(typeof r.refId === 'string' && r.refId.trim() ? { refId: r.refId.trim().slice(0, 128) } : {}),
      ...(typeof r.sha256 === 'string' && r.sha256.trim() ? { sha256: r.sha256.trim().slice(0, 80) } : {}),
    }
  })
}

function validateEdges(raw: unknown): CanvasEdgeV1[] {
  if (!Array.isArray(raw)) throw new CanvasBoardInputError('muweave/invalid_canvas_input', 'edges must be an array')
  if (raw.length > 600) throw new CanvasBoardInputError('muweave/invalid_canvas_input', 'edges exceeds max 600')
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new CanvasBoardInputError('muweave/invalid_canvas_input', `edges[${idx}] must be an object`)
    }
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    const from = typeof r.from === 'string' ? r.from.trim() : ''
    const to = typeof r.to === 'string' ? r.to.trim() : ''
    if (!SAFE_ID_RE.test(id) || !SAFE_ID_RE.test(from) || !SAFE_ID_RE.test(to)) {
      throw new CanvasBoardInputError('muweave/invalid_canvas_input', `edges[${idx}] has invalid id/from/to`)
    }
    const kind = typeof r.kind === 'string' && EDGE_KINDS.has(r.kind) ? (r.kind as CanvasEdgeV1['kind']) : undefined
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 80) : undefined
    return {
      id,
      from,
      to,
      ...(label ? { label } : {}),
      ...(kind ? { kind } : {}),
    }
  })
}

function cloneBoard(b: CanvasBoardV1): CanvasBoardV1 {
  return {
    ...b,
    nodes: b.nodes.map((n) => ({ ...n })),
    edges: b.edges.map((e) => ({ ...e })),
    ...(b.viewport ? { viewport: { ...b.viewport } } : {}),
  }
}

export class CanvasBoardStore {
  private readonly file: string
  private readonly boards = new Map<string, CanvasBoardV1>()
  corruptFile?: string

  constructor(pluginDataDir: string) {
    this.file = path.join(pluginDataDir, 'canvas-board.v1.json')
    this.load()
  }

  get(workspaceId: string): CanvasBoardV1 {
    const hit = this.boards.get(workspaceId)
    return hit ? cloneBoard(hit) : defaultBoard(workspaceId)
  }

  save(workspaceId: string, input: CanvasBoardSaveInputV1): CanvasBoardV1 {
    if (findPlaintextCredential(input) || containsHostPath(input)) {
      throw new CanvasBoardInputError('muweave/invalid_canvas_input', 'Canvas board must not contain credentials or host paths')
    }
    const wsId = workspaceId.trim()
    if (!SAFE_ID_RE.test(wsId)) {
      throw new CanvasBoardInputError('muweave/invalid_canvas_input', 'workspaceId is invalid')
    }
    const prev = this.boards.get(wsId)
    const currentRev = prev ? Number(prev.revision) || 0 : 0
    if (input.expectedRevision !== undefined && input.expectedRevision !== '') {
      if (String(input.expectedRevision) !== String(currentRev)) {
        throw new CanvasBoardInputError(
          'muweave/canvas_revision_conflict',
          `Canvas revision conflict: expected ${input.expectedRevision}, current is ${currentRev}`,
          { currentRevision: String(currentRev) },
        )
      }
    }

    const nodes = input.nodes !== undefined ? validateNodes(input.nodes) : (prev ? prev.nodes.map((n) => ({ ...n })) : [])
    const edges = input.edges !== undefined ? validateEdges(input.edges) : (prev ? prev.edges.map((e) => ({ ...e })) : [])
    const viewport = input.viewport
      ? {
          x: assertFinite(input.viewport.x, 'viewport.x'),
          y: assertFinite(input.viewport.y, 'viewport.y'),
          zoom: Math.max(0.1, Math.min(4, assertFinite(input.viewport.zoom, 'viewport.zoom'))),
        }
      : (prev?.viewport ? { ...prev.viewport } : { x: 0, y: 0, zoom: 1 })

    const next: CanvasBoardV1 = {
      schema: CANVAS_BOARD_SCHEMA,
      workspaceId: wsId,
      nodes,
      edges,
      viewport,
      revision: String(currentRev + 1),
      updatedAt: new Date().toISOString(),
    }
    this.boards.set(wsId, next)
    this.persist()
    return cloneBoard(next)
  }

  reset(workspaceId: string): CanvasBoardV1 {
    const deleted = this.boards.delete(workspaceId)
    if (deleted) this.persist()
    return defaultBoard(workspaceId)
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      const list = typeof parsed === 'object' && parsed !== null ? (parsed as { boards?: unknown }).boards : undefined
      if (!Array.isArray(list)) throw new Error('boards is not an array')
      for (const raw of list) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
        if (findPlaintextCredential(raw) || containsHostPath(raw)) continue
        const r = raw as Partial<CanvasBoardV1>
        if (typeof r.workspaceId !== 'string' || !SAFE_ID_RE.test(r.workspaceId)) continue
        try {
          this.boards.set(r.workspaceId, {
            schema: CANVAS_BOARD_SCHEMA,
            workspaceId: r.workspaceId,
            nodes: validateNodes(r.nodes ?? []),
            edges: validateEdges(r.edges ?? []),
            ...(r.viewport ? { viewport: r.viewport } : {}),
            revision: typeof r.revision === 'string' ? r.revision : '1',
            updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
          })
        } catch {
          /* skip invalid board */
        }
      }
    } catch {
      this.boards.clear()
      const aside = path.join(path.dirname(this.file), `canvas-board.v1.corrupt-${Date.now()}.json`)
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
      `${JSON.stringify({ schema: CANVAS_BOARD_SCHEMA, boards: [...this.boards.values()] }, null, 2)}\n`,
      { mode: 0o600 },
    )
    renameSync(tmp, this.file)
  }
}

function mermaidSafeId(raw: string): string {
  return `n_${raw.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

function mermaidSafeLabel(raw: string): string {
  return raw.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim()
}

/** Pure sanitized Mermaid flowchart LR exporter for a CanvasBoardV1. */
export function exportCanvasMermaid(board: CanvasBoardV1): string {
  const lines: string[] = ['flowchart LR']
  for (const node of board.nodes) {
    const nid = mermaidSafeId(node.id)
    const label = mermaidSafeLabel(`[${node.kind}] ${node.title}`)
    lines.push(`  ${nid}["${label}"]`)
  }
  for (const edge of board.edges) {
    const fromId = mermaidSafeId(edge.from)
    const toId = mermaidSafeId(edge.to)
    if (edge.label) {
      lines.push(`  ${fromId} -->|"${mermaidSafeLabel(edge.label)}"| ${toId}`)
    } else {
      lines.push(`  ${fromId} --> ${toId}`)
    }
  }
  return `${lines.join('\n')}\n`
}
