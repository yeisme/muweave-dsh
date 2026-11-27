import {
  findPlaintextCredential,
  stripHostPaths,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
} from '@yeisme/muweave-bundle'
import { CreatorHostService, type CreatorHostServiceOptions } from '../host'
import type {
  DramaExportFormat,
  DramaExportResultV1,
  RpcEnvelope,
  ShotReviewRecordV1,
} from '../protocol'

export const MCP_SERVER_NAME = 'muweave-dsh-mcp' as const
export const MCP_SERVER_VERSION = '0.1.0' as const
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpResourceDefinition {
  uri: string
  name: string
  description: string
  mimeType: string
}

export interface McpPromptDefinition {
  name: string
  description: string
  arguments: Array<{ name: string; description: string; required?: boolean }>
}

export interface McpRpcBridge {
  call(action: string, payload?: Record<string, unknown>): Promise<RpcEnvelope<unknown>>
  dispose?(): void
}

export function createLocalMcpBridge(
  options: CreatorHostServiceOptions & { host?: CreatorHostService } = {},
): McpRpcBridge {
  const ownsHost = !options.host
  const host = options.host ?? new CreatorHostService(options)
  return {
    call: (action, payload = {}) => host.handleRpcAction(action, payload),
    dispose: () => {
      if (ownsHost) host.dispose()
    },
  }
}

export function createRemoteMcpBridge(options: {
  hostUrl: string
  authToken?: string
  fetchImpl?: typeof globalThis.fetch
}): McpRpcBridge {
  const parsed = new URL(options.hostUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('hostUrl must use http: or https:')
  }
  const rpcEndpoint = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/api/muweave-dsh/rpc`
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const token = options.authToken?.trim()

  return {
    async call(action: string, payload: Record<string, unknown> = {}): Promise<RpcEnvelope<unknown>> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
      }
      if (token) {
        headers.authorization = `Bearer ${token}`
      }
      const res = await fetchImpl(rpcEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, payload }),
      })
      if (!res.ok) {
        return {
          ok: false,
          generation: 0,
          error: {
            code: 'muweave/remote_http_error',
            message: `Remote host returned HTTP ${res.status}`,
          },
        }
      }
      return (await res.json()) as RpcEnvelope<unknown>
    },
  }
}

function sanitizeOutput<T>(value: T): T {
  const stripped = stripHostPaths(value)
  if (findPlaintextCredential(stripped)) {
    throw new Error('REDACTED_CREDENTIAL_BLOCKED')
  }
  return stripped
}

function toolJsonResult(data: unknown, isError = false) {
  let safe: unknown
  try {
    safe = sanitizeOutput(data)
  } catch {
    safe = { ok: false, error: { code: 'muweave/unsafe_output_blocked', message: 'Output blocked by credential fence' } }
    isError = true
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(safe, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'muweave_workspace_status',
    description: 'Inspect registered MuWeave workspaces and .muweave/ bundle status.',
    inputSchema: {
      type: 'object',
      properties: { workspaceId: { type: 'string' } },
    },
  },
  {
    name: 'muweave_bundle_sync',
    description: 'Rebuild/sync the .muweave/ materialized bundle from initialized owner CLIs.',
    inputSchema: {
      type: 'object',
      properties: { workspaceId: { type: 'string' } },
    },
  },
  {
    name: 'muweave_elements_list',
    description: 'List materialized .muweave/ elements filtered by domain, kind, sceneRef, or query.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        domain: { type: 'string', enum: ['eikona', 'script', 'drama', 'harness'] },
        kind: { type: 'string' },
        sceneRef: { type: 'string' },
        episodeRef: { type: 'string' },
        query: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_element_get',
    description: 'Fetch a single materialized .muweave/ element payload by elementId.',
    inputSchema: {
      type: 'object',
      required: ['elementId'],
      properties: {
        workspaceId: { type: 'string' },
        elementId: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_drama_shots_list',
    description: 'List storyboard shots merged with director review status and 6-role media links.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        sceneRef: { type: 'string' },
        reviewStatus: { type: 'string', enum: ['draft', 'in_review', 'needs_revision', 'approved', 'locked'] },
        missingRole: { type: 'string', enum: ['keyframe', 'reference', 'video', 'voice', 'music', 'sfx'] },
      },
    },
  },
  {
    name: 'muweave_drama_review_set',
    description: 'Set optimistic-locked director review status, note, and tags for a shot.',
    inputSchema: {
      type: 'object',
      required: ['shotRef', 'status'],
      properties: {
        workspaceId: { type: 'string' },
        shotRef: { type: 'string' },
        sceneRef: { type: 'string' },
        episodeRef: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'in_review', 'needs_revision', 'approved', 'locked'] },
        note: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        expectedRevision: { type: 'integer' },
      },
    },
  },
  {
    name: 'muweave_drama_review_batch',
    description: 'Atomically batch-update director reviews for multiple shots with per-shot conflict isolation.',
    inputSchema: {
      type: 'object',
      required: ['items'],
      properties: {
        workspaceId: { type: 'string' },
        items: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'muweave_drama_export',
    description: 'Compile a sanitized rough-cut, subtitle, or offline review deck export package.',
    inputSchema: {
      type: 'object',
      required: ['format'],
      properties: {
        workspaceId: { type: 'string' },
        episodeRef: { type: 'string' },
        format: {
          type: 'string',
          enum: [
            'cut_manifest_v1',
            'cmx3600_edl',
            'shotlist_csv',
            'fcpxml_1_10',
            'jianying_draft_v1',
            'srt_subtitles',
            'webvtt_subtitles',
            'review_deck_html',
          ],
        },
        fps: { type: 'integer', enum: [24, 25, 30] },
        aspectRatio: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_schedule_manage',
    description: 'List, plan, or clear entries on the publishing schedule board.',
    inputSchema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['list', 'plan', 'clear'] },
        ref: { type: 'string' },
        date: { type: 'string' },
        label: { type: 'string' },
        kind: { type: 'string' },
        note: { type: 'string' },
        projectId: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_project_diagnose',
    description: 'Run read-only project diagnosis and v1->v2 registry migration report.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
    },
  },
  {
    name: 'muweave_capability_estimate',
    description: 'List available creative capabilities or run a zero-cost dry-run estimate.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        capabilityId: { type: 'string' },
        input: { type: 'object' },
        slots: { type: 'integer' },
        anchor: { type: 'object' },
      },
    },
  },
  {
    name: 'muweave_job_request_or_status',
    description: 'Request a waiting_approval generation job (human approval required in DSH browser UI) or inspect job status.',
    inputSchema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['request', 'list', 'get'] },
        workspaceId: { type: 'string' },
        estimateId: { type: 'string' },
        idempotencyKey: { type: 'string' },
        jobId: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_orchestration_status',
    description: 'Inspect bot roster circuit-breaker states, active/orphaned task counts, and recent orchestration tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_task_trace_or_cancel',
    description: 'Trace a task and its linked capability jobs, or cancel a task tree cascading to active capability jobs.',
    inputSchema: {
      type: 'object',
      required: ['action', 'taskId'],
      properties: {
        action: { type: 'string', enum: ['trace', 'cancel'] },
        taskId: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_adapters_manage',
    description: 'List, save, remove, or zero-cost test custom engine bridge adapters (env var names only, zero plaintext secrets).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'save', 'remove', 'test'] },
        adapterId: { type: 'string' },
        adapter: { type: 'object' },
      },
    },
  },
  {
    name: 'muweave_drama_cut_manage',
    description: 'Get, set (optimistic-locked), or reset non-destructive episode cut overrides (shot order, omissions, durations, transitions).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'reset'] },
        workspaceId: { type: 'string' },
        episodeRef: { type: 'string' },
        shotOrder: { type: 'array', items: { type: 'string' } },
        omittedShotRefs: { type: 'array', items: { type: 'string' } },
        durationOverridesMicros: { type: 'object' },
        transitions: { type: 'object' },
        expectedRevision: { type: 'integer' },
      },
    },
  },
  {
    name: 'muweave_project_bible',
    description: 'Read or update the workspace Continuity Bible (visual grammar, color palette, character anchors, guardrails, compliance disclosure).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['get', 'set'] },
        workspaceId: { type: 'string' },
        projectTitle: { type: 'string' },
        visualGrammar: { type: 'object' },
        colorPalette: { type: 'array', items: { type: 'object' } },
        characterAnchors: { type: 'array', items: { type: 'object' } },
        negativeGuardrails: { type: 'array', items: { type: 'string' } },
        complianceDisclosure: { type: 'string' },
        expectedRevision: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_drama_qc_report',
    description: 'Run the zero-cost automated Episode QC Gate (opening hook, media/lip-sync, 4-axis assets, review gate, compliance disclosure).',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        episodeRef: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_workspace_tabs',
    description: 'Get, save (with preset/pin/order/hide), or reset the modular workspace header tabs config.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['get', 'save', 'reset'] },
        workspaceId: { type: 'string' },
        presetId: { type: 'string', enum: ['default', 'director', 'writer', 'visual_3d', 'full_studio', 'custom'] },
        pinnedRoomIds: { type: 'array', items: { type: 'string' } },
        roomOrder: { type: 'array', items: { type: 'string' } },
        hiddenRoomIds: { type: 'array', items: { type: 'string' } },
        expectedRevision: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_canvas_board',
    description: 'Get, save, or reset the infinite canvas story/world-building board (nodes & edges).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['get', 'save', 'reset'] },
        workspaceId: { type: 'string' },
        nodes: { type: 'array', items: { type: 'object' } },
        edges: { type: 'array', items: { type: 'object' } },
        viewport: { type: 'object' },
        expectedRevision: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_stage3d_scene',
    description: 'Get, save, or reset 3D director stage blocking scenes (camera, actors, lights, props) per shot.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['get', 'save', 'reset'] },
        workspaceId: { type: 'string' },
        shotRef: { type: 'string' },
        camera: { type: 'object' },
        actors: { type: 'array', items: { type: 'object' } },
        lights: { type: 'array', items: { type: 'object' } },
        props: { type: 'array', items: { type: 'object' } },
        expectedRevision: { type: 'string' },
      },
    },
  },
  {
    name: 'muweave_audio_mix',
    description: 'Get, save, or reset multitrack audio mix settings (voice/music/sfx gains, mute/solo, fades, cue overrides).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['get', 'save', 'reset'] },
        workspaceId: { type: 'string' },
        episodeRef: { type: 'string' },
        masterGainPct: { type: 'number' },
        tracks: { type: 'object' },
        cues: { type: 'array', items: { type: 'object' } },
        expectedRevision: { type: 'string' },
      },
    },
  },
]

export const MCP_RESOURCES: readonly McpResourceDefinition[] = [
  {
    uri: 'muweave://workspace/overview',
    name: 'Workspace Overview',
    description: 'Registered workspaces, bundle status, and element summary counts.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://drama/storyboard',
    name: 'Drama Storyboard & Reviews',
    description: 'Merged storyboard shots with 6-role media links and director review statuses.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://drama/timeline/edl',
    name: 'Drama Rough-Cut CMX 3600 EDL',
    description: 'Sanitized CMX 3600 EDL compiled from the workspace storyboard and edit timeline.',
    mimeType: 'text/plain',
  },
  {
    uri: 'muweave://script/scenes',
    name: 'Script Scene Cards',
    description: 'Auctra screenplay scene cards materialized in .muweave/.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://schedule/board',
    name: 'Publishing Schedule Board',
    description: 'Current publishing schedule entries.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://orchestration/tasks',
    name: 'Orchestration Bots & Tasks',
    description: 'Bot roster states, circuit-breaker counts, and active/orphaned orchestration tasks.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://project/bible',
    name: 'Project Continuity Bible',
    description: 'Workspace visual grammar, color palette, character anchors, guardrails, and compliance disclosure.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://drama/qc',
    name: 'Episode QC Gate Report',
    description: 'Automated zero-cost Episode QC report across pacing, media/lip-sync, assets, reviews, and compliance.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://workspace/tabs',
    name: 'Workspace Modular Tabs Config',
    description: 'Pinned rooms, ordering, hidden rooms, and active preset for the modular studio header.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://canvas/board',
    name: 'Infinite Canvas Board',
    description: 'Nodes, edges, and viewport of the workspace creative canvas.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://stage3d/scenes',
    name: '3D Stage Blocking Scenes',
    description: 'Per-shot 3D camera, actor blocking, lighting, and prop layouts.',
    mimeType: 'application/json',
  },
  {
    uri: 'muweave://audio/mix',
    name: 'Multitrack Audio Mix Config',
    description: 'Voice/music/SFX track gains, mute/solo, fades, and per-shot cue overrides.',
    mimeType: 'application/json',
  },
]

export const MCP_PROMPTS: readonly McpPromptDefinition[] = [
  {
    name: 'drama_director_review',
    description: 'Structured director review checklist for a vertical-drama storyboard shot.',
    arguments: [
      { name: 'shotRef', description: 'Target shot reference (e.g. shot_01)', required: true },
      { name: 'focus', description: 'Optional review focus (pacing, lighting, audio)', required: false },
    ],
  },
  {
    name: 'drama_shot_breakdown_9x16',
    description: 'Break down a screenplay scene into 9:16 vertical-drama shots with planned durations.',
    arguments: [
      { name: 'sceneRef', description: 'Target scene reference (e.g. scene_01)', required: true },
      { name: 'targetDurationSec', description: 'Target scene duration in seconds', required: false },
    ],
  },
  {
    name: 'eikona_character_turnaround',
    description: 'Draft a Sunburst 1152x2048 character turnaround master sheet prompt.',
    arguments: [
      { name: 'characterName', description: 'Character name and persona', required: true },
      { name: 'visualStyle', description: 'Art style direction', required: false },
    ],
  },
]

interface StoryboardRow {
  sceneRef: string
  shotRef: string
  order: number
  plannedDurationMicros: number
  cells?: Record<string, unknown>
  restrictedFields?: string[]
  linkedMedia?: Array<{ role: string; sha256?: string; elementId?: string; mime?: string }>
}

export interface MuweaveMcpServer {
  handleJsonRpc(rawMessage: unknown): Promise<JsonRpcResponse | null>
  listTools(): readonly McpToolDefinition[]
  listResources(): readonly McpResourceDefinition[]
  listPrompts(): readonly McpPromptDefinition[]
  dispose(): void
}

export interface CreateMuweaveMcpServerOptions {
  bridge?: McpRpcBridge
  defaultWorkspaceDir?: string
  pluginDataDir?: string
  hostUrl?: string
  authToken?: string
  host?: CreatorHostService
}

export function createMuweaveMcpServer(options: CreateMuweaveMcpServerOptions = {}): MuweaveMcpServer {
  const bridge: McpRpcBridge =
    options.bridge ??
    (options.hostUrl
      ? createRemoteMcpBridge({ hostUrl: options.hostUrl, authToken: options.authToken })
      : createLocalMcpBridge({
          defaultWorkspaceDir: options.defaultWorkspaceDir,
          pluginDataDir: options.pluginDataDir,
          host: options.host,
        }))

  async function loadMergedShots(args: Record<string, unknown>) {
    const wsPayload = typeof args.workspaceId === 'string' ? { workspaceId: args.workspaceId } : {}
    const [listRes, reviewRes] = await Promise.all([
      bridge.call('bundle.elements.list', { ...wsPayload, domain: 'drama', kind: 'drama.storyboard_table' }),
      bridge.call('drama.shot.review.list', wsPayload),
    ])
    if (!listRes.ok) return { ok: false as const, error: listRes.error }
    const elements = (listRes.data as { elements?: MuweaveElementSummaryV1[] }).elements ?? []
    const reviews = reviewRes.ok
      ? ((reviewRes.data as { reviews?: ShotReviewRecordV1[] }).reviews ?? [])
      : []
    const reviewMap = new Map(reviews.map((r) => [r.shotRef, r]))

    const shots: Array<Record<string, unknown>> = []
    for (const el of elements) {
      const full = await bridge.call('bundle.element.get', { ...wsPayload, elementId: el.elementId })
      if (!full.ok) continue
      const payload = ((full.data as { element?: MuweaveElementV1 }).element?.payload ?? {}) as {
        rows?: StoryboardRow[]
      }
      for (const row of payload.rows ?? []) {
        const rev = reviewMap.get(row.shotRef)
        const linked = Array.isArray(row.linkedMedia) ? row.linkedMedia : []
        const rolesPresent = [...new Set(linked.map((m) => m.role))]
        shots.push({
          order: row.order,
          sceneRef: row.sceneRef,
          shotRef: row.shotRef,
          plannedDurationMicros: row.plannedDurationMicros,
          reviewStatus: rev?.status ?? 'draft',
          reviewRevision: rev?.revision ?? 0,
          ...(rev?.note ? { reviewNote: rev.note } : {}),
          reviewTags: rev?.tags ?? [],
          rolesPresent,
          linkedMedia: linked,
        })
      }
    }

    const sceneFilter = typeof args.sceneRef === 'string' && args.sceneRef.trim() ? args.sceneRef.trim() : undefined
    const statusFilter = typeof args.reviewStatus === 'string' && args.reviewStatus.trim() ? args.reviewStatus.trim() : undefined
    const missingRole = typeof args.missingRole === 'string' && args.missingRole.trim() ? args.missingRole.trim() : undefined

    const filtered = shots
      .filter((s) => !sceneFilter || s.sceneRef === sceneFilter)
      .filter((s) => !statusFilter || s.reviewStatus === statusFilter)
      .filter((s) => !missingRole || !(s.rolesPresent as string[]).includes(missingRole))

    return { ok: true as const, data: { total: filtered.length, shots: filtered } }
  }

  async function callTool(name: string, args: Record<string, unknown>) {
    switch (name) {
      case 'muweave_workspace_status': {
        const [wsList, status] = await Promise.all([
          bridge.call('workspace.list', {}),
          bridge.call('bundle.status', typeof args.workspaceId === 'string' ? { workspaceId: args.workspaceId } : {}),
        ])
        return toolJsonResult({
          workspaces: wsList.ok ? (wsList.data as { workspaces: unknown }).workspaces : [],
          bundle: status.ok ? status.data : { error: status.error },
        }, !status.ok)
      }

      case 'muweave_bundle_sync': {
        const res = await bridge.call('bundle.sync', args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_elements_list': {
        const res = await bridge.call('bundle.elements.list', args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_element_get': {
        const res = await bridge.call('bundle.element.get', args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_drama_shots_list': {
        const merged = await loadMergedShots(args)
        return toolJsonResult(merged.ok ? merged.data : { error: merged.error }, !merged.ok)
      }

      case 'muweave_drama_review_set': {
        const res = await bridge.call('drama.shot.review.set', args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_drama_review_batch': {
        const res = await bridge.call('drama.shot.review.batch', args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_drama_export': {
        const res = await bridge.call('drama.export.manifest', {
          ...(typeof args.workspaceId === 'string' ? { workspaceId: args.workspaceId } : {}),
          ...(typeof args.episodeRef === 'string' ? { episodeRef: args.episodeRef } : {}),
          format: args.format as DramaExportFormat,
          ...(typeof args.fps === 'number' ? { fps: args.fps } : {}),
          ...(typeof args.aspectRatio === 'string' ? { aspectRatio: args.aspectRatio } : {}),
        })
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_schedule_manage': {
        const mode = String(args.mode ?? 'list')
        const action = mode === 'plan' ? 'schedule.plan' : mode === 'clear' ? 'schedule.clear' : 'schedule.list'
        const res = await bridge.call(action, args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_project_diagnose': {
        const [diag, mig] = await Promise.all([
          bridge.call('project.diagnose', typeof args.projectId === 'string' ? { projectId: args.projectId } : {}),
          bridge.call('project.migration.report', {}),
        ])
        return toolJsonResult({
          diagnosis: diag.ok ? diag.data : { error: diag.error },
          migrationReport: mig.ok ? mig.data : { error: mig.error },
        }, !diag.ok || !mig.ok)
      }

      case 'muweave_capability_estimate': {
        if (typeof args.capabilityId === 'string' && args.input) {
          const res = await bridge.call('capability.estimate', args)
          return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
        }
        const res = await bridge.call('capability.catalog', typeof args.workspaceId === 'string' ? { workspaceId: args.workspaceId } : {})
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_job_request_or_status': {
        const mode = String(args.mode ?? 'list')
        if (mode === 'request') {
          const res = await bridge.call('job.request', {
            ...args,
            requestedBy: 'agent',
          })
          return toolJsonResult(
            res.ok
              ? {
                  ...(res.data as Record<string, unknown>),
                  humanApprovalRequired: true,
                  notice: 'Job created in waiting_approval state. Paid approval must be confirmed by a human in the DSH browser UI.',
                }
              : { error: res.error },
            !res.ok,
          )
        }
        if (mode === 'get') {
          const res = await bridge.call('job.get', { jobId: args.jobId })
          return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
        }
        const res = await bridge.call('job.list', typeof args.workspaceId === 'string' ? { workspaceId: args.workspaceId } : {})
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_orchestration_status': {
        const wsPayload = typeof args.workspaceId === 'string' ? { workspaceId: args.workspaceId } : {}
        const [rosterRes, tasksRes] = await Promise.all([
          bridge.call('bot.roster', wsPayload),
          bridge.call('task.list', wsPayload),
        ])
        if (!rosterRes.ok) {
          return toolJsonResult({ error: rosterRes.error }, true)
        }
        if (!tasksRes.ok) {
          return toolJsonResult({ error: tasksRes.error }, true)
        }
        const bots = ((rosterRes.data as { bots?: Array<{ state?: string }> }).bots ?? [])
        const taskData = tasksRes.data as { tasks?: Array<{ status?: string }>; orphanedCount?: number }
        const tasks = taskData.tasks ?? []
        const pausedCount = bots.filter((b) => b.state === 'paused').length
        const activeTaskCount = tasks.filter(
          (t) => t.status && !['succeeded', 'failed', 'cancelled'].includes(t.status),
        ).length
        return toolJsonResult({
          bots,
          pausedCount,
          activeTaskCount,
          orphanedCount: taskData.orphanedCount ?? 0,
          recentTasks: tasks.slice(0, 20),
        })
      }

      case 'muweave_task_trace_or_cancel': {
        const op = String(args.action ?? '')
        const taskId = typeof args.taskId === 'string' ? args.taskId : ''
        if (op !== 'trace' && op !== 'cancel') {
          return toolJsonResult({ error: { code: 'muweave/invalid_action', message: "action must be 'trace' or 'cancel'" } }, true)
        }
        const rpcAction = op === 'cancel' ? 'task.cancel' : 'task.trace'
        const res = await bridge.call(rpcAction, { taskId })
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_adapters_manage': {
        const op = String(args.action ?? 'list')
        const rpcAction =
          op === 'save'
            ? 'adapter.custom.save'
            : op === 'remove'
              ? 'adapter.custom.remove'
              : op === 'test'
                ? 'adapter.custom.test'
                : 'adapter.custom.list'
        const res = await bridge.call(rpcAction, args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_drama_cut_manage': {
        const op = String(args.action ?? 'get')
        const rpcAction =
          op === 'set' ? 'drama.cut.set' : op === 'reset' ? 'drama.cut.reset' : 'drama.cut.get'
        const res = await bridge.call(rpcAction, args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_project_bible': {
        const op = String(args.action ?? 'get')
        const rpcAction = op === 'set' ? 'project.bible.set' : 'project.bible.get'
        const res = await bridge.call(rpcAction, args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_drama_qc_report': {
        const res = await bridge.call('drama.qc.report', args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_workspace_tabs': {
        const op = String(args.action ?? 'get')
        const rpcAction = op === 'save' ? 'workspace.tabs.save' : op === 'reset' ? 'workspace.tabs.reset' : 'workspace.tabs.get'
        const res = await bridge.call(rpcAction, args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_canvas_board': {
        const op = String(args.action ?? 'get')
        const rpcAction = op === 'save' ? 'canvas.board.save' : op === 'reset' ? 'canvas.board.reset' : 'canvas.board.get'
        const res = await bridge.call(rpcAction, args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_stage3d_scene': {
        const op = String(args.action ?? 'get')
        const rpcAction = op === 'save' ? 'stage3d.scene.save' : op === 'reset' ? 'stage3d.scene.reset' : 'stage3d.scene.get'
        const res = await bridge.call(rpcAction, args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      case 'muweave_audio_mix': {
        const op = String(args.action ?? 'get')
        const rpcAction = op === 'save' ? 'audio.mix.save' : op === 'reset' ? 'audio.mix.reset' : 'audio.mix.get'
        const res = await bridge.call(rpcAction, args)
        return toolJsonResult(res.ok ? res.data : { error: res.error }, !res.ok)
      }

      default:
        return null
    }
  }

  async function readResource(uri: string) {
    switch (uri) {
      case 'muweave://workspace/overview': {
        const [wsList, status] = await Promise.all([
          bridge.call('workspace.list', {}),
          bridge.call('bundle.status', {}),
        ])
        const body = sanitizeOutput({
          workspaces: wsList.ok ? (wsList.data as { workspaces: unknown }).workspaces : [],
          bundle: status.ok ? status.data : null,
        })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://drama/storyboard': {
        const merged = await loadMergedShots({})
        const body = sanitizeOutput(merged.ok ? merged.data : { error: merged.error })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://drama/timeline/edl': {
        const res = await bridge.call('drama.export.manifest', { format: 'cmx3600_edl' })
        const text = res.ok
          ? sanitizeOutput((res.data as DramaExportResultV1).content)
          : `TITLE: Unavailable\n* ${res.error.code}\n`
        return { contents: [{ uri, mimeType: 'text/plain', text }] }
      }
      case 'muweave://script/scenes': {
        const res = await bridge.call('bundle.elements.list', { domain: 'script', kind: 'script.scene_card' })
        const elements = res.ok ? ((res.data as { elements?: MuweaveElementSummaryV1[] }).elements ?? []) : []
        const scenes: unknown[] = []
        for (const el of elements) {
          const full = await bridge.call('bundle.element.get', { elementId: el.elementId })
          if (full.ok) scenes.push((full.data as { element: MuweaveElementV1 }).element)
        }
        const body = sanitizeOutput({ count: scenes.length, scenes })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://schedule/board': {
        const res = await bridge.call('schedule.list', {})
        const body = sanitizeOutput(res.ok ? res.data : { error: res.error })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://orchestration/tasks': {
        const [rosterRes, tasksRes] = await Promise.all([
          bridge.call('bot.roster', {}),
          bridge.call('task.list', {}),
        ])
        const bots = rosterRes.ok ? ((rosterRes.data as { bots?: Array<{ state?: string }> }).bots ?? []) : []
        const taskData = tasksRes.ok ? (tasksRes.data as { tasks?: unknown[]; orphanedCount?: number }) : { tasks: [], orphanedCount: 0 }
        const body = sanitizeOutput({
          bots,
          pausedCount: bots.filter((b) => b.state === 'paused').length,
          orphanedCount: taskData.orphanedCount ?? 0,
          tasks: taskData.tasks ?? [],
        })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://project/bible': {
        const res = await bridge.call('project.bible.get', {})
        const body = sanitizeOutput(res.ok ? res.data : { error: res.error })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://drama/qc': {
        const res = await bridge.call('drama.qc.report', {})
        const body = sanitizeOutput(res.ok ? res.data : { error: res.error })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://workspace/tabs': {
        const res = await bridge.call('workspace.tabs.get', {})
        const body = sanitizeOutput(res.ok ? res.data : { error: res.error })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://canvas/board': {
        const res = await bridge.call('canvas.board.get', {})
        const body = sanitizeOutput(res.ok ? res.data : { error: res.error })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://stage3d/scenes': {
        const res = await bridge.call('stage3d.scene.get', {})
        const body = sanitizeOutput(res.ok ? res.data : { error: res.error })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      case 'muweave://audio/mix': {
        const res = await bridge.call('audio.mix.get', {})
        const body = sanitizeOutput(res.ok ? res.data : { error: res.error })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] }
      }
      default:
        return null
    }
  }

  function getPrompt(name: string, args: Record<string, unknown>) {
    switch (name) {
      case 'drama_director_review': {
        const shotRef = String(args.shotRef ?? 'shot_01')
        const focus = typeof args.focus === 'string' && args.focus.trim() ? args.focus.trim() : 'pacing, framing, and 6-track media readiness'
        return {
          description: 'Director review checklist for a storyboard shot',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Review shot ${shotRef} focusing on ${focus}. Inspect its 6 media roles (keyframe, reference, video, voice, music, sfx) and propose a concise status (approved | needs_revision | in_review) and actionable director note.`,
              },
            },
          ],
        }
      }
      case 'drama_shot_breakdown_9x16': {
        const sceneRef = String(args.sceneRef ?? 'scene_01')
        const sec = String(args.targetDurationSec ?? '60')
        return {
          description: '9:16 vertical-drama shot breakdown prompt',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Break down screenplay scene ${sceneRef} into a 9:16 vertical-drama storyboard targeting ${sec}s total duration, specifying shot size, camera motion, plannedDurationMicros, and audio cues.`,
              },
            },
          ],
        }
      }
      case 'eikona_character_turnaround': {
        const characterName = String(args.characterName ?? 'Lead Character')
        const visualStyle = String(args.visualStyle ?? 'cinematic stylized drama')
        return {
          description: 'Eikona Sunburst 1152x2048 character turnaround prompt',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Design a consistent 3-view character turnaround master sheet for ${characterName} in ${visualStyle} style, aligned with openai/gpt-image-2.5-sunburst 1152x2048 high quality.`,
              },
            },
          ],
        }
      }
      default:
        return null
    }
  }

  async function handleJsonRpc(rawMessage: unknown): Promise<JsonRpcResponse | null> {
    if (typeof rawMessage !== 'object' || rawMessage === null || Array.isArray(rawMessage)) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
    }
    const msg = rawMessage as Partial<JsonRpcRequest>
    const hasId = msg.id !== undefined
    const id = hasId ? (msg.id ?? null) : null
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC 2.0 message' } }
    }

    const params = (typeof msg.params === 'object' && msg.params !== null && !Array.isArray(msg.params)
      ? msg.params
      : {}) as Record<string, unknown>

    // Notifications (no id) return null so transport sends no JSON-RPC response (202 on HTTP, silent on stdio).
    if (!hasId || msg.method.startsWith('notifications/')) {
      return null
    }

    try {
      switch (msg.method) {
        case 'initialize': {
          const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
          const protocolVersion = (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
            ? requested
            : MCP_SUPPORTED_PROTOCOL_VERSIONS[0]
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion,
              serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
              capabilities: {
                tools: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
                prompts: { listChanged: false },
              },
            },
          }
        }
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} }
        case 'tools/list':
          return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }
        case 'tools/call': {
          const name = typeof params.name === 'string' ? params.name : ''
          const args = (typeof params.arguments === 'object' && params.arguments !== null && !Array.isArray(params.arguments)
            ? params.arguments
            : {}) as Record<string, unknown>
          const result = await callTool(name, args)
          if (!result) {
            return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } }
          }
          return { jsonrpc: '2.0', id, result }
        }
        case 'resources/list':
          return { jsonrpc: '2.0', id, result: { resources: MCP_RESOURCES } }
        case 'resources/read': {
          const uri = typeof params.uri === 'string' ? params.uri : ''
          const result = await readResource(uri)
          if (!result) {
            return { jsonrpc: '2.0', id, error: { code: -32002, message: `Unknown resource: ${uri}` } }
          }
          return { jsonrpc: '2.0', id, result }
        }
        case 'prompts/list':
          return { jsonrpc: '2.0', id, result: { prompts: MCP_PROMPTS } }
        case 'prompts/get': {
          const name = typeof params.name === 'string' ? params.name : ''
          const args = (typeof params.arguments === 'object' && params.arguments !== null && !Array.isArray(params.arguments)
            ? params.arguments
            : {}) as Record<string, unknown>
          const result = getPrompt(name, args)
          if (!result) {
            return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown prompt: ${name}` } }
          }
          return { jsonrpc: '2.0', id, result }
        }
        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } }
      }
    } catch (err) {
      const safeMsg = err instanceof Error ? stripHostPaths(err.message) : 'Internal MCP error'
      return { jsonrpc: '2.0', id, error: { code: -32603, message: safeMsg } }
    }
  }

  return {
    handleJsonRpc,
    listTools: () => MCP_TOOLS,
    listResources: () => MCP_RESOURCES,
    listPrompts: () => MCP_PROMPTS,
    dispose: () => bridge.dispose?.(),
  }
}

/**
 * Run MCP JSON-RPC 2.0 over stdio. Supports both newline-delimited JSON and Content-Length framing.
 * Logs strictly to stderr so stdout stays 100% clean for JSON-RPC frames.
 */
export function runStdioMcpServer(
  server: MuweaveMcpServer,
  io: {
    input?: NodeJS.ReadableStream
    output?: NodeJS.WritableStream
    stderr?: NodeJS.WritableStream
  } = {},
): Promise<void> {
  const input = io.input ?? process.stdin
  const output = io.output ?? process.stdout
  const stderr = io.stderr ?? process.stderr

  let buffer = Buffer.alloc(0)
  let useContentLength = false
  let chain: Promise<void> = Promise.resolve()

  const writeResponse = (res: JsonRpcResponse) => {
    const json = JSON.stringify(res)
    if (useContentLength) {
      const len = Buffer.byteLength(json, 'utf8')
      output.write(`Content-Length: ${len}\r\n\r\n${json}`)
    } else {
      output.write(`${json}\n`)
    }
  }

  const dispatchText = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    chain = chain.then(async () => {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        const res = await server.handleJsonRpc(parsed)
        if (res) writeResponse(res)
      } catch {
        writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      }
    })
  }

  const drainBuffer = () => {
    while (buffer.length > 0) {
      // Check for Content-Length framing first.
      const headerProbe = buffer.subarray(0, Math.min(buffer.length, 64)).toString('utf8')
      if (/^Content-Length:/i.test(headerProbe)) {
        useContentLength = true
        const sepIdx = buffer.indexOf('\r\n\r\n')
        if (sepIdx === -1) return
        const headerText = buffer.subarray(0, sepIdx).toString('utf8')
        const match = /Content-Length:\s*(\d+)/i.exec(headerText)
        if (!match) {
          buffer = buffer.subarray(sepIdx + 4)
          continue
        }
        const contentLen = Number(match[1])
        const bodyStart = sepIdx + 4
        if (buffer.length < bodyStart + contentLen) return
        const bodyText = buffer.subarray(bodyStart, bodyStart + contentLen).toString('utf8')
        buffer = buffer.subarray(bodyStart + contentLen)
        dispatchText(bodyText)
        continue
      }

      // Newline-delimited JSON-RPC framing.
      const nlIdx = buffer.indexOf(0x0a)
      if (nlIdx === -1) return
      const line = buffer.subarray(0, nlIdx).toString('utf8')
      buffer = buffer.subarray(nlIdx + 1)
      dispatchText(line)
    }
  }

  return new Promise<void>((resolve) => {
    stderr.write(`[${MCP_SERVER_NAME}] stdio transport ready\n`)
    input.on('data', (chunk: Buffer | string) => {
      const next = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      buffer = Buffer.concat([buffer, next])
      drainBuffer()
    })
    input.on('end', () => {
      if (buffer.length > 0) {
        const tail = buffer.toString('utf8').trim()
        buffer = Buffer.alloc(0)
        if (tail && !/^Content-Length:/i.test(tail)) dispatchText(tail)
      }
      void chain.finally(() => resolve())
    })
  })
}
