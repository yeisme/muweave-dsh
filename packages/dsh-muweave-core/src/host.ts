import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  bindBundleRef,
  BundleValidationError,
  casBlobPath,
  defaultCliRunner,
  filterElements,
  isSha256Digest,
  muweaveRoot,
  readBundleIndexFromDisk,
  readBundleManifestFromDisk,
  readCasBlobVerified,
  readElementFromDisk,
  sha256Digest,
  stripHostPaths,
  syncBundle,
  validateBundleOnDisk,
  validateEikonaGenerationSpec,
  type BindingTargetKind,
  type CliRunner,
} from '@yeisme/muweave-bundle'
import {
  MUWEAVE_MEDIA_PATH,
  MUWEAVE_RPC_PATH,
  rpcFail,
  rpcOk,
  stampHost,
  validateIncomingRpcBody,
  type AllowlistedCliCardDefV1,
  type MuweaveDomain,
  type MuweaveElementKind,
  type MuweaveSourceOwner,
  type OperationRecordView,
  type RpcEnvelope,
  type TemplateCatalogEntryV1,
  type TimingProjectionSnapshotV1,
  type TimingSpanProjectionV1,
  type WorkspaceSummaryView,
} from './protocol'
import { CapabilityService } from './capabilities/service'
import { ScheduleInputError, ScheduleStore } from './schedule-store'
import { ProjectInputError, ProjectStore } from './project-store'
import type { JobRecordV1 } from './capability-protocol'

export interface DshRequestLike {
  method?: string
  url?: string
  headers?: { get(name: string): string | null }
  signal?: AbortSignal
  text(): Promise<string>
}

export interface DshFetchRouteDef {
  path: string
  methods: readonly string[]
  requestBody?: 'buffered'
  fetch: (request: DshRequestLike) => Promise<Response>
}

export type DshDisposer = () => void | Promise<void>

export interface DshHostContextLike {
  connection?: {
    fetch: {
      register(route: DshFetchRouteDef): DshDisposer
    }
  }
  effect(fn: () => void | DshDisposer, label?: string): void
  inject?(deps: readonly string[], callback: (subCtx: Record<string, unknown>) => void): void
  logger?(name: string): { info(...args: unknown[]): void; warn(...args: unknown[]): void }
}

export const ALLOWLISTED_CLI_CARDS: readonly AllowlistedCliCardDefV1[] = [
  {
    operationId: 'bundle.doctor',
    owner: 'muweave-bundle',
    title: '检查工作区做剧标记 (.muweave / .eikona / .auctra / .scaena / .pi)',
    description: '本地只读检查项目目录初始化状态，不创建隐藏数据库文件。',
    readOnly: true,
  },
  {
    operationId: 'bundle.validate',
    owner: 'muweave-bundle',
    title: '校验 .muweave/ 物化元件完整性与脱敏约束',
    description: '核对全部元件 SHA-256 摘要、CAS 媒体哈希及零路径/零密钥围栏。',
    readOnly: true,
  },
  {
    operationId: 'eikona.doctor',
    owner: 'eikona',
    title: 'Eikona 环境与渠道就绪诊断',
    description: '执行 eikona doctor --agent，零远端生图调用、零额度消耗。',
    readOnly: true,
  },
  {
    operationId: 'eikona.models.recommend',
    owner: 'eikona',
    title: '读取 Eikona 推荐图像模型清单',
    description: '执行 eikona models recommend --agent，默认付费推荐 openai/gpt-image-2.5-sunburst。',
    readOnly: true,
  },
  {
    operationId: 'auctra.room.describe',
    owner: 'auctra',
    title: '读取 Auctra 可视化编剧室结构快照',
    description: '预检 .auctra/ 存在后执行 auctra screenplay room describe --json。',
    readOnly: true,
    requiresMarker: 'auctra',
  },
  {
    operationId: 'scaena.production.doctor',
    owner: 'scaena',
    title: 'Scaena 生产控制面本地诊断',
    description: '预检 .scaena/project.json 存在后执行 scaena production doctor --agent --no-remote。',
    readOnly: true,
    requiresMarker: 'scaena',
  },
]

export const BUILTIN_CREATOR_TEMPLATES: readonly TemplateCatalogEntryV1[] = [
  {
    templateRef: 'promptrepo://official/image/drama-character-turnaround-v1@1.0.0?locale=zh',
    releaseId: 'rel_char_turnaround_v1',
    title: '漫剧角色三视图与定妆母版配方',
    category: 'eikona',
    version: '1.0.0',
    digest: sha256Digest('drama-character-turnaround-v1@1.0.0'),
    summary: '生成正面/侧面/背面一致服装光影的角色定妆图，自动对齐 Sunburst 1152x2048 高质规格。',
    slots: [
      { name: 'character_name', label: '角色姓名与年龄气质', inputType: 'text', required: true },
      { name: 'wardrobe_anchor', label: '核心服装与随身标志道具', inputType: 'textarea', required: true },
      { name: 'visual_style', label: '漫剧画风基调', inputType: 'enum', required: true, options: ['赛博霓虹写实漫', '东方新国风厚涂', '韩系都市高反差条漫'] },
    ],
  },
  {
    templateRef: 'promptrepo://official/writing/screenplay-scene-conflict-turn-v1@1.0.0?locale=zh',
    releaseId: 'rel_scene_conflict_v1',
    title: '单场戏剧冲突与前三秒钩子精修',
    category: 'script',
    version: '1.0.0',
    digest: sha256Digest('screenplay-scene-conflict-turn-v1@1.0.0'),
    summary: '围绕目标、阻碍、代价与反转（Turn）重构 60 秒竖屏短剧单场 Scene Card 与对白候选。',
    slots: [
      { name: 'scene_goal', label: '主动人物本场核心目标', inputType: 'text', required: true },
      { name: 'core_obstacle', label: '最大外部/心理阻碍', inputType: 'text', required: true },
      { name: 'hook_line', label: '开场 3 秒视觉或台词钩子草案', inputType: 'textarea', required: false },
    ],
  },
  {
    templateRef: 'promptrepo://official/video/vertical-shot-breakdown-9x16-v1@1.0.0?locale=zh',
    releaseId: 'rel_shot_breakdown_v1',
    title: '9:16 竖屏连载分镜拆解与景别节奏卡',
    category: 'drama',
    version: '1.0.0',
    digest: sha256Digest('vertical-shot-breakdown-9x16-v1@1.0.0'),
    summary: '将已审阅剧本场次拆解为镜头序列、景别运动、预计微秒时长与声画意图。',
    slots: [
      { name: 'episode_scene_ref', label: '目标集场引用 (如 episode:01 / scene:01)', inputType: 'text', required: true },
      { name: 'target_duration_sec', label: '目标总时长（秒）', inputType: 'enum', required: true, options: ['45', '60', '90'] },
      { name: 'pacing_mode', label: '剪辑节奏档位', inputType: 'enum', required: true, options: ['高频快切反转', '情绪张力递进', '悬疑压迫留白'] },
    ],
  },
]

interface MediaGrantEntry {
  token: string
  workspaceDir: string
  blobDigest: string
  mimeType: string
  expiresAtMs: number
}

const BINDING_TARGETS = new Set<BindingTargetKind>([
  'eikona-run', 'eikona-handle', 'eikona-collection', 'eikona-batch', 'auctra-project',
  'auctra-scene', 'scaena-episode', 'scaena-breakdown', 'scaena-edit-session',
])
const MEDIA_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'audio/wav', 'audio/mpeg', 'audio/ogg', 'video/mp4', 'video/webm'])
const OPERATION_STATUSES = new Set([
  'queued', 'running', 'waiting_approval', 'waiting_for_human', 'completed', 'failed',
  'cancelled', 'timeout', 'unknown', 'reconcile_required',
])
const LEDGER_SCHEMA = 'muweave.host-ledger.v1'
const SENSITIVE_RECORD_RE = /(?:stderr|stdout|provider|password|secret|token|authorization|cookie|path|body)/i

/** Timeout-killed children report exitCode 124 and, on newer runners, timedOut: true. */
function isTimedOut(res: { exitCode: number; stderr: string; timedOut?: boolean }): boolean {
  return res.timedOut === true || res.exitCode === 124 || res.stderr.includes('ETIMEDOUT')
}

function isBindingTarget(value: string): value is BindingTargetKind {
  return BINDING_TARGETS.has(value as BindingTargetKind)
}

function parseByteRange(header: string, total: number): { start: number; end: number } | 'invalid' | 'absent' {
  if (!header) return 'absent'
  const matched = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!matched || total <= 0) return 'invalid'
  const rawStart = matched[1] ?? ''
  const rawEnd = matched[2] ?? ''
  if (!rawStart && !rawEnd) return 'invalid'
  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, total - suffix), end: total - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isSafeInteger(start) || start < 0 || start >= total) return 'invalid'
  if (!rawEnd) return { start, end: total - 1 }
  const requestedEnd = Number(rawEnd)
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return 'invalid'
  return { start, end: Math.min(requestedEnd, total - 1) }
}

function isSensitivePath(candidate: string): boolean {
  const normalized = path.resolve(candidate)
  return normalized === path.parse(normalized).root || ['/etc', '/proc', '/sys', '/dev', '/root', '/private/etc'].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`))
}

function containedByRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function safeRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const stripped = stripHostPaths(value)
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(stripped)) {
    if (SENSITIVE_RECORD_RE.test(key)) continue
    if (entry === null || ['string', 'number', 'boolean'].includes(typeof entry)) out[key] = entry
  }
  return out
}

function reconcileOutcome(
  stdout: string,
  exitCode: number,
  expected: { operationRef: string; idempotencyKey: string; workspaceId: string },
): 'completed' | 'failed' | 'reconcile_required' {
  if (exitCode !== 0) return 'reconcile_required'
  try {
    const parsed = JSON.parse(stdout) as { status?: unknown; operationRef?: unknown; idempotencyKey?: unknown; workspaceId?: unknown }
    const matches = (value: unknown, expectedValue: string) => value === undefined || value === expectedValue
    const identityMatches = matches(parsed.operationRef, expected.operationRef) &&
      matches(parsed.idempotencyKey, expected.idempotencyKey) &&
      matches(parsed.workspaceId, expected.workspaceId)
    const hasIdentity = parsed.operationRef !== undefined || parsed.idempotencyKey !== undefined || parsed.workspaceId !== undefined
    if (!identityMatches || !hasIdentity) return 'reconcile_required'
    if (parsed.status === 'completed') return 'completed'
    if (parsed.status === 'failed') return 'failed'
  } catch {
    return 'reconcile_required'
  }
  return 'reconcile_required'
}

export interface CreatorHostServiceOptions {
  defaultWorkspaceDir?: string
  pluginDataDir?: string
  templateRegistryUrl?: string
  runner?: CliRunner
  fetchImpl?: typeof globalThis.fetch
  mediaTtlMs?: number
  workspaceRoots?: readonly string[]
}

export class CreatorHostService {
  private generation = 1
  private readonly workspaces = new Map<string, { id: string; label: string; dir: string }>()
  private readonly operations = new Map<string, OperationRecordView>()
  private readonly idempotencyIndex = new Map<string, string>()
  private readonly mediaGrants = new Map<string, MediaGrantEntry>()
  private readonly mutationTails = new Map<string, Promise<void>>()
  private readonly dshToolArtifacts = new Map<
    string,
    Array<{
      artifactId: string
      toolName: string
      title: string
      status: string
      episodeRef?: string
      sceneRef?: string
      summary: Record<string, unknown>
    }>
  >()
  private readonly runner: CliRunner
  private readonly fetchImpl?: typeof globalThis.fetch
  private readonly templateRegistryUrl?: string
  private readonly pluginDataDir: string
  private readonly mediaTtlMs: number
  private readonly allowedRoots: string[]
  private readonly defaultWorkspaceId: string
  private readonly hostInstanceId = randomUUID()
  private readonly ledgerDiagnostics: string[] = []
  private readonly capabilities: CapabilityService
  /** Publishing board; its own file, so a bad schedule never touches the job ledger. */
  private readonly schedule: ScheduleStore
  /** Project registry: identity + user intent only; element truth stays in .muweave/. */
  private readonly projects: ProjectStore

  constructor(options: CreatorHostServiceOptions = {}) {
    this.runner = options.runner ?? defaultCliRunner
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.templateRegistryUrl = options.templateRegistryUrl ?? process.env.MUWEAVE_TEMPLATE_REGISTRY_URL
    const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
    this.pluginDataDir = options.pluginDataDir ?? path.join(dshHome, 'plugin-data', 'muweave-dsh')
    this.mediaTtlMs = options.mediaTtlMs ?? 5 * 60 * 1000
    const initialWs = this.canonicalDir(options.defaultWorkspaceDir ?? process.env.MUWEAVE_WORKSPACE_DIR ?? process.cwd())
    const configuredRoots = options.workspaceRoots?.length ? options.workspaceRoots : [initialWs]
    this.allowedRoots = configuredRoots.map((root) => this.canonicalDir(root))
    this.defaultWorkspaceId = this.registerWorkspaceInternal(initialWs).workspaceId
    this.schedule = new ScheduleStore(path.join(this.pluginDataDir, 'schedule.v1.json'))
    this.projects = new ProjectStore(path.join(this.pluginDataDir, 'projects.v1.json'))
    this.restorePersistedLedgerSync()
    this.capabilities = new CapabilityService({
      pluginDataDir: this.pluginDataDir,
      runner: this.runner,
      resolveWorkspace: (id) => this.resolveWorkspace(id),
      generation: () => this.generation,
      bumpGeneration: () => void this.bumpGeneration(),
      syncWorkspace: async (ws) => {
        await syncBundle({ workspaceDir: ws.dir, runner: this.runner, upstreamPayloads: { dshArtifacts: this.dshToolArtifacts.get(ws.id) ?? [] } })
      },
    })
  }

  /** Agent tools call this directly; it creates a waiting_approval job and has no approve counterpart. */
  requestJobFromAgent(input: { estimateId: string; idempotencyKey: string; workspaceId?: string }): Promise<RpcEnvelope<JobRecordV1>> {
    return this.capabilities.requestJobFromAgent(input).then((env) => stampHost(env, this.hostInstanceId))
  }

  /** Stops the job poller; safe to call more than once. */
  dispose(): void {
    this.capabilities.dispose()
  }

  private restorePersistedLedgerSync(): void {
    const ledgerFile = path.join(this.pluginDataDir, 'ledger.v1.json')
    if (!existsSync(ledgerFile)) return
    const restored = new Map<string, OperationRecordView>()
    const restoredIndex = new Map<string, string>()
    try {
      const parsed = JSON.parse(readFileSync(ledgerFile, 'utf8')) as {
        schema?: unknown
        generation?: unknown
        operations?: unknown
      }
      if (parsed.schema !== LEDGER_SCHEMA || !Number.isSafeInteger(parsed.generation) || Number(parsed.generation) < 1) return
      if (!Array.isArray(parsed.operations)) return
      for (const raw of parsed.operations) {
        const op = this.validOperation(raw)
        if (!op) {
          this.ledgerDiagnostics.push('skipped_invalid_operation')
          continue
        }
        const scopeKey = `${op.workspaceId}:${op.owner}:${op.action}:${op.idempotencyKey}`
        if (restored.has(op.operationRef) || restoredIndex.has(scopeKey)) {
          this.ledgerDiagnostics.push('skipped_duplicate_operation')
          continue
        }
        restored.set(op.operationRef, op)
        if (this.workspaces.has(op.workspaceId)) restoredIndex.set(scopeKey, op.operationRef)
      }
      this.operations.clear()
      this.idempotencyIndex.clear()
      for (const [ref, op] of restored) this.operations.set(ref, op)
      for (const [scope, ref] of restoredIndex) this.idempotencyIndex.set(scope, ref)
      this.generation = Math.max(this.generation, Number(parsed.generation))
    } catch {
      // Corrupted ledger degrades fail-closed without crashing host startup or polluting memory.
    }
  }

  private validOperation(raw: unknown): OperationRecordView | undefined {
    if (typeof raw !== 'object' || raw === null) return undefined
    const op = raw as Partial<OperationRecordView>
    const owners = new Set(['eikona', 'auctra', 'scaena', 'cli'])
    if (typeof op.operationRef !== 'string' || !/^op_[a-z]+_[a-z0-9-]{8,}$/.test(op.operationRef)) return undefined
    if (typeof op.workspaceId !== 'string' || typeof op.action !== 'string' || !owners.has(String(op.owner))) return undefined
    if (typeof op.idempotencyKey !== 'string' || !op.idempotencyKey.trim() || !isSha256Digest(op.requestDigest)) return undefined
    if (typeof op.status !== 'string' || !OPERATION_STATUSES.has(op.status)) return undefined
    if (typeof op.createdAt !== 'string' || typeof op.updatedAt !== 'string') return undefined
    if (Number.isNaN(Date.parse(op.createdAt)) || Number.isNaN(Date.parse(op.updatedAt))) return undefined
    return {
      operationRef: op.operationRef,
      workspaceId: op.workspaceId,
      action: op.action,
      owner: op.owner as OperationRecordView['owner'],
      idempotencyKey: op.idempotencyKey,
      requestDigest: op.requestDigest,
      ...(typeof op.expectedRevision === 'string' ? { expectedRevision: op.expectedRevision } : {}),
      status: op.status,
      createdAt: op.createdAt,
      updatedAt: op.updatedAt,
      ...(safeRecord(op.receiptSummary) ? { receiptSummary: safeRecord(op.receiptSummary) } : {}),
      ...(typeof op.errorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(op.errorCode) ? { errorCode: op.errorCode } : {}),
    }
  }

  private bumpGeneration(): number {
    this.generation += 1
    return this.generation
  }

  currentGeneration(): number {
    return this.generation
  }

  registerWorkspaceInternal(dirPath: string, customLabel?: string): WorkspaceSummaryView {
    const resolved = this.canonicalDir(dirPath)
    const id = `ws_${createHash('sha256').update(resolved).digest('hex').slice(0, 12)}`
    const label = customLabel?.trim() || path.basename(resolved) || 'workspace'
    this.workspaces.set(id, { id, label, dir: resolved })
    this.reindexWorkspace(id)
    return this.describeWorkspace(id)!
  }

  private canonicalDir(dirPath: string): string {
    const resolved = path.resolve(dirPath)
    try {
      return realpathSync(resolved)
    } catch {
      return resolved
    }
  }

  private reindexWorkspace(workspaceId: string): void {
    for (const op of this.operations.values()) {
      if (op.workspaceId !== workspaceId) continue
      this.idempotencyIndex.set(`${op.workspaceId}:${op.owner}:${op.action}:${op.idempotencyKey}`, op.operationRef)
    }
  }

  private assertRegisterableWorkspace(requested: string): string {
    const base = this.workspaces.get(this.defaultWorkspaceId)?.dir ?? process.cwd()
    const candidate = path.resolve(base, requested)
    let linked: ReturnType<typeof lstatSync>
    let resolvedStat: ReturnType<typeof statSync>
    let resolved: string
    try {
      linked = lstatSync(candidate)
      resolved = realpathSync(candidate)
      resolvedStat = statSync(resolved)
    } catch {
      throw new Error('WORKSPACE_PATH_REJECTED')
    }
    if (!linked.isDirectory() || !resolvedStat.isDirectory() || isSensitivePath(resolved)) throw new Error('WORKSPACE_PATH_REJECTED')
    if (!this.allowedRoots.some((root) => containedByRoot(resolved, root))) throw new Error('WORKSPACE_PATH_REJECTED')
    return resolved
  }

  private describeWorkspace(workspaceId: string): WorkspaceSummaryView | undefined {
    const entry = this.workspaces.get(workspaceId)
    if (!entry) return undefined
    return {
      workspaceId: entry.id,
      label: entry.label,
      hasBundle: existsSync(path.join(muweaveRoot(entry.dir), 'bundle.v1.json')),
      ownerMarkers: {
        eikona: existsSync(path.join(entry.dir, '.eikona')),
        auctra: existsSync(path.join(entry.dir, '.auctra')),
        scaena: existsSync(path.join(entry.dir, '.scaena', 'project.json')),
        pi: existsSync(path.join(entry.dir, '.pi')),
      },
    }
  }

  private resolveWorkspace(workspaceId?: unknown): { id: string; label: string; dir: string } {
    if (workspaceId === undefined) {
      const fallback = this.workspaces.get(this.defaultWorkspaceId)
      if (fallback) return fallback
    }
    if (typeof workspaceId === 'string' && this.workspaces.has(workspaceId)) return this.workspaces.get(workspaceId)!
    throw new Error('WORKSPACE_NOT_FOUND')
  }

  async recordDshToolArtifact(
    workspaceId: string | undefined,
    artifact: {
      artifactId: string
      toolName: string
      title: string
      status: string
      episodeRef?: string
      sceneRef?: string
      summary: Record<string, unknown>
    },
  ): Promise<void> {
    const ws = this.resolveWorkspace(workspaceId)
    const list = this.dshToolArtifacts.get(ws.id) ?? []
    list.push({ ...artifact, summary: stripHostPaths(artifact.summary) })
    this.dshToolArtifacts.set(ws.id, list)
    await syncBundle({
      workspaceDir: ws.dir,
      runner: this.runner,
      upstreamPayloads: { dshArtifacts: list },
    })
    this.bumpGeneration()
  }

  private async persistStateAtomic(): Promise<void> {
    await mkdir(this.pluginDataDir, { recursive: true })
    const file = path.join(this.pluginDataDir, 'ledger.v1.json')
    const tmp = `${file}.tmp.${randomUUID().slice(0, 8)}`
    const safeOps = Array.from(this.operations.values()).map((op) => this.validOperation(op)).filter((op) => op !== undefined)
    const body = { schema: LEDGER_SCHEMA, generation: this.generation, operations: safeOps }
    await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, file)
  }

  private async withIdempotencyLock<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(scopeKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => gate)
    this.mutationTails.set(scopeKey, tail)
    await previous.catch(() => undefined)
    try {
      return await fn()
    } finally {
      release()
      if (this.mutationTails.get(scopeKey) === tail) this.mutationTails.delete(scopeKey)
    }
  }

  issueMediaToken(workspaceId: string | undefined, blobDigest: string, mimeType = 'image/png'): string {
    if (!MEDIA_MIME_TYPES.has(mimeType) || !isSha256Digest(blobDigest)) throw new Error('INVALID_MEDIA_GRANT')
    const ws = this.resolveWorkspace(workspaceId)
    const token = randomBytes(24).toString('hex')
    this.mediaGrants.set(token, {
      token,
      workspaceDir: ws.dir,
      blobDigest,
      mimeType,
      expiresAtMs: Date.now() + this.mediaTtlMs,
    })
    return token
  }

  private async executeControlledMutation(params: {
    workspace: { id: string; dir: string }
    action: string
    owner: 'eikona' | 'auctra' | 'scaena' | 'cli'
    idempotencyKey: string
    expectedRevision?: string
    canonicalPayload: Record<string, unknown>
    invoke: () => Promise<{ status: 'completed' | 'failed' | 'unknown'; receipt?: Record<string, unknown>; errorCode?: string }>
  }): Promise<RpcEnvelope<{ operation: OperationRecordView }>> {
    const idem = params.idempotencyKey.trim()
    if (!idem) {
      return rpcFail(this.generation, 'muweave/missing_idempotency_key', 'Controlled mutations require idempotencyKey')
    }
    const reqDigest = sha256Digest(JSON.stringify(params.canonicalPayload))
    const scopeKey = `${params.workspace.id}:${params.owner}:${params.action}:${idem}`
    return this.withIdempotencyLock(scopeKey, async () => {
      const existingRef = this.idempotencyIndex.get(scopeKey)
      if (existingRef) {
        const prev = this.operations.get(existingRef)!
        if (prev.requestDigest !== reqDigest) {
          return rpcFail(this.generation, 'IDEMPOTENCY_CONFLICT', 'Same idempotencyKey submitted with a different payload digest', {
            retryable: false,
            operationRef: prev.operationRef,
          })
        }
        if (prev.status === 'completed') return rpcOk(this.generation, { operation: prev })
        const code = prev.status === 'unknown' || prev.status === 'reconcile_required' || prev.status === 'running'
          ? 'RECONCILE_REQUIRED'
          : 'IDEMPOTENT_REPLAY_NOT_SUCCESSFUL'
        return rpcFail(this.generation, code, 'Original operation did not complete successfully', {
          retryable: false,
          operationRef: prev.operationRef,
        })
      }

      const now = new Date().toISOString()
      const operationRef = `op_${params.owner}_${randomUUID().slice(0, 10)}`
      const record: OperationRecordView = {
        operationRef,
        workspaceId: params.workspace.id,
        action: params.action,
        owner: params.owner,
        idempotencyKey: idem,
        requestDigest: reqDigest,
        ...(params.expectedRevision ? { expectedRevision: params.expectedRevision } : {}),
        status: 'running',
        createdAt: now,
        updatedAt: now,
      }
      this.operations.set(operationRef, record)
      this.idempotencyIndex.set(scopeKey, operationRef)
      try {
        await this.persistStateAtomic()
      } catch {
        this.operations.delete(operationRef)
        this.idempotencyIndex.delete(scopeKey)
        return rpcFail(this.generation, 'muweave/ledger_persist_failed', 'Operation was not started because its ledger record could not be persisted', { retryable: true })
      }
      const outcome = await params.invoke()
      const nextStatus = outcome.status === 'unknown' ? 'reconcile_required' : outcome.status
      const updated: OperationRecordView = {
        ...record,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
        ...(safeRecord(outcome.receipt) ? { receiptSummary: safeRecord(outcome.receipt) } : {}),
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      }
      this.operations.set(operationRef, updated)
      this.bumpGeneration()
      await this.persistStateAtomic().catch(() => undefined)
      if (nextStatus === 'reconcile_required') {
        return rpcFail(this.generation, 'RECONCILE_REQUIRED', 'Mutation outcome is unknown; reconcile the original operation instead of retrying', {
          retryable: false,
          operationRef,
        })
      }
      if (nextStatus === 'failed') {
        return rpcFail(this.generation, outcome.errorCode ?? 'OWNER_MUTATION_FAILED', 'Owner rejected the controlled mutation', {
          retryable: false,
          operationRef,
        })
      }
      return rpcOk(this.generation, { operation: updated })
    })
  }

  async handleRpcAction(action: string, payload: Record<string, unknown>): Promise<RpcEnvelope<unknown>> {
    try {
      return stampHost(await this.dispatchRpcAction(action, payload), this.hostInstanceId)
    } catch (err) {
      if (err instanceof Error && err.message === 'WORKSPACE_NOT_FOUND') {
        return stampHost(rpcFail(this.generation, 'WORKSPACE_NOT_FOUND', 'Workspace is not registered', { retryable: false }), this.hostInstanceId)
      }
      if (err instanceof Error && err.message === 'WORKSPACE_PATH_REJECTED') {
        return stampHost(rpcFail(this.generation, 'muweave/workspace_path_rejected', 'Workspace path is outside the configured roots', { retryable: false }), this.hostInstanceId)
      }
      if (err instanceof BundleValidationError) {
        return stampHost(rpcFail(this.generation, `muweave/${err.code}`, err.message, { retryable: false }), this.hostInstanceId)
      }
      if (err instanceof ProjectInputError) {
        return stampHost(rpcFail(this.generation, err.code, err.message, {
          retryable: false,
          ...(err.details ? { details: err.details } : {}),
        }), this.hostInstanceId)
      }
      throw err
    }
  }

  private async dispatchRpcAction(action: string, payload: Record<string, unknown>): Promise<RpcEnvelope<unknown>> {
    if (this.capabilities.isCapabilityAction(action)) return this.capabilities.handle(action, payload)
    switch (action) {
      case 'workspace.list': {
        const items = Array.from(this.workspaces.keys()).map((id) => this.describeWorkspace(id)!)
        return rpcOk(this.generation, { workspaces: items })
      }

      case 'workspace.register': {
        const requested = typeof payload.workspaceDir === 'string' ? payload.workspaceDir.trim() : ''
        if (!requested) return rpcFail(this.generation, 'muweave/workspace_path_rejected', 'workspaceDir is required', { retryable: false })
        const label = typeof payload.label === 'string' ? payload.label.trim() : ''
        const workspace = this.registerWorkspaceInternal(this.assertRegisterableWorkspace(requested), label || undefined)
        return rpcOk(this.generation, { workspace })
      }

      case 'bundle.status': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        const desc = this.describeWorkspace(ws.id)!
        if (!desc.hasBundle) {
          return rpcOk(this.generation, { initialized: false, workspace: desc })
        }
        await readBundleManifestFromDisk(ws.dir)
        const index = await readBundleIndexFromDisk(ws.dir)
        return rpcOk(this.generation, { initialized: true, workspace: desc, index })
      }

      case 'bundle.bind': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        const target = typeof payload.target === 'string' ? payload.target : ''
        const ref = typeof payload.ref === 'string' ? payload.ref.trim() : ''
        if (!isBindingTarget(target) || !ref) {
          return rpcFail(this.generation, 'muweave/invalid_binding_target', 'Binding target is not allowlisted', { retryable: false })
        }
        const manifest = await bindBundleRef(ws.dir, target, ref)
        this.bumpGeneration()
        return rpcOk(this.generation, { manifest })
      }

      case 'bundle.sync': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        const index = await syncBundle({
          workspaceDir: ws.dir,
          runner: this.runner,
          upstreamPayloads: {
            dshArtifacts: this.dshToolArtifacts.get(ws.id) ?? [],
          },
        })
        this.bumpGeneration()
        return rpcOk(this.generation, { index })
      }

      case 'bundle.elements.list': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        await readBundleManifestFromDisk(ws.dir)
        const index = await readBundleIndexFromDisk(ws.dir)
        const filtered = filterElements(index.elements, {
          domain: typeof payload.domain === 'string' ? (payload.domain as MuweaveDomain) : undefined,
          kind: typeof payload.kind === 'string' ? (payload.kind as MuweaveElementKind) : undefined,
          sourceOwner: typeof payload.sourceOwner === 'string' ? (payload.sourceOwner as MuweaveSourceOwner) : undefined,
          episodeRef: typeof payload.episodeRef === 'string' ? payload.episodeRef : undefined,
          sceneRef: typeof payload.sceneRef === 'string' ? payload.sceneRef : undefined,
          characterRef: typeof payload.characterRef === 'string' ? payload.characterRef : undefined,
          query: typeof payload.query === 'string' ? payload.query : undefined,
        })
        return rpcOk(this.generation, {
          projectId: index.projectId,
          title: index.title,
          revision: index.revision,
          ownerStates: index.ownerStates,
          elements: filtered,
        })
      }

      case 'bundle.element.get': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        const elementId = String(payload.elementId ?? '')
        if (!elementId) return rpcFail(this.generation, 'muweave/missing_element_id', 'elementId is required')
        const element = await readElementFromDisk(ws.dir, elementId)
        return rpcOk(this.generation, { element })
      }

      case 'media.token.issue': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        const blobDigest = String(payload.blobDigest ?? '')
        const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : 'image/png'
        if (!MEDIA_MIME_TYPES.has(mimeType)) return rpcFail(this.generation, 'muweave/unsupported_media_type', 'Media MIME type is not allowlisted')
        if (!isSha256Digest(blobDigest)) {
          return rpcFail(this.generation, 'muweave/invalid_digest', 'blobDigest must be a valid 64-hex sha256:<hex> digest')
        }
        if (!existsSync(casBlobPath(muweaveRoot(ws.dir), blobDigest))) {
          return rpcFail(this.generation, 'muweave/media_not_found', 'CAS blob does not exist in workspace .muweave/')
        }
        const token = this.issueMediaToken(ws.id, blobDigest, mimeType)
        return rpcOk(this.generation, {
          token,
          url: `${MUWEAVE_MEDIA_PATH}?token=${encodeURIComponent(token)}`,
          expiresInMs: this.mediaTtlMs,
        })
      }

      case 'eikona.spec.validate': {
        const check = validateEikonaGenerationSpec({
          model: String(payload.model ?? 'openai/gpt-image-2.5-sunburst'),
          size: String(payload.size ?? '1152x2048'),
          quality: typeof payload.quality === 'string' ? payload.quality : 'high',
          aspect: typeof payload.aspect === 'string' ? payload.aspect : '9:16',
          channel: typeof payload.channel === 'string' ? payload.channel : 'noemi',
        })
        if (!check.ok) {
          return rpcFail(this.generation, check.code, check.message, { retryable: false })
        }
        return rpcOk(this.generation, { valid: true, normalized: check.normalized })
      }

      case 'eikona.feedback.decide': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        const runId = String(payload.runId ?? '').trim()
        const artifactId = String(payload.artifactId ?? '').trim()
        if (payload.decision !== 'accept' && payload.decision !== 'reject') {
          return rpcFail(this.generation, 'eikona/invalid_decision', "decision must be 'accept' or 'reject'")
        }
        const decision = payload.decision
        const reason = String(payload.reason ?? 'composition').trim()
        const idempotencyKey = String(payload.idempotencyKey ?? '')
        if (!runId || !artifactId) {
          return rpcFail(this.generation, 'eikona/missing_target', 'runId and artifactId are required')
        }
        return this.executeControlledMutation({
          workspace: ws,
          action: `eikona.feedback.${decision}`,
          owner: 'eikona',
          idempotencyKey,
          canonicalPayload: { runId, artifactId, decision, reason },
          invoke: async () => {
            const res = await this.runner(
              'eikona',
              ['feedback', decision, runId, '--artifact', artifactId, '--reason', reason, '--json'],
              { cwd: ws.dir },
            )
            if (isTimedOut(res)) {
              return { status: 'unknown', errorCode: 'TIMEOUT_AMBIGUOUS' }
            }
            if (res.exitCode !== 0) {
              return { status: 'failed', errorCode: 'EIKONA_FEEDBACK_FAILED' }
            }
            await syncBundle({ workspaceDir: ws.dir, runner: this.runner, upstreamPayloads: { dshArtifacts: this.dshToolArtifacts.get(ws.id) ?? [] } })
            return { status: 'completed', receipt: { runId, artifactId, decision } }
          },
        })
      }

      case 'eikona.asset.bind': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        const handle = String(payload.handle ?? '').trim()
        const role = String(payload.role ?? 'character').trim()
        const idempotencyKey = String(payload.idempotencyKey ?? '')
        if (!handle) return rpcFail(this.generation, 'eikona/missing_handle', 'handle is required')
        return this.executeControlledMutation({
          workspace: ws,
          action: 'eikona.asset.bind',
          owner: 'eikona',
          idempotencyKey,
          canonicalPayload: { handle, role },
          invoke: async () => {
            const res = await this.runner('eikona', ['assets', 'bind', handle, '--role', role, '--json'], { cwd: ws.dir })
            if (isTimedOut(res)) return { status: 'unknown' }
            if (res.exitCode !== 0) return { status: 'failed', errorCode: 'EIKONA_BIND_FAILED' }
            await bindBundleRef(ws.dir, 'eikona-handle', handle)
            await syncBundle({ workspaceDir: ws.dir, runner: this.runner })
            return { status: 'completed', receipt: { handle, role } }
          },
        })
      }

      case 'eikona.asset.handoff': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        const handle = String(payload.handle ?? '').trim()
        const idempotencyKey = String(payload.idempotencyKey ?? '')
        if (!handle) return rpcFail(this.generation, 'eikona/missing_handle', 'handle is required')
        return this.executeControlledMutation({
          workspace: ws,
          action: 'eikona.asset.handoff',
          owner: 'eikona',
          idempotencyKey,
          canonicalPayload: { handle },
          invoke: async () => {
            const res = await this.runner('eikona', ['assets', 'handoff', handle, '--json'], { cwd: ws.dir })
            if (isTimedOut(res)) return { status: 'unknown' }
            if (res.exitCode !== 0) return { status: 'failed', errorCode: 'EIKONA_HANDOFF_FAILED' }
            await bindBundleRef(ws.dir, 'eikona-handle', handle)
            await syncBundle({ workspaceDir: ws.dir, runner: this.runner })
            return { status: 'completed', receipt: { handle, handedOff: true } }
          },
        })
      }

      case 'auctra.scene_card.save': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        if (!existsSync(path.join(ws.dir, '.auctra'))) {
          return rpcFail(this.generation, 'UNINITIALIZED_OWNER', 'Workspace lacks .auctra/ marker; refusing write')
        }
        const sceneRef = String(payload.sceneRef ?? '').trim()
        const expectedRevision = String(payload.expectedRevision ?? '').trim()
        const idempotencyKey = String(payload.idempotencyKey ?? '')
        const cardDraft = (payload.card ?? {}) as Record<string, unknown>
        if (!sceneRef || !expectedRevision) {
          return rpcFail(this.generation, 'auctra/missing_revision_or_ref', 'sceneRef and expectedRevision are required')
        }
        return this.executeControlledMutation({
          workspace: ws,
          action: 'auctra.scene_card.save',
          owner: 'auctra',
          idempotencyKey,
          expectedRevision,
          canonicalPayload: { sceneRef, expectedRevision, cardDraft },
          invoke: async () => {
            const tmpReqDir = path.join(this.pluginDataDir, 'tmp-requests')
            await mkdir(tmpReqDir, { recursive: true })
            const reqFile = path.join(tmpReqDir, `scene-card-${randomUUID().slice(0, 8)}.json`)
            await writeFile(reqFile, JSON.stringify(cardDraft), { mode: 0o600 })
            const res = await this.runner(
              'auctra',
              [
                'screenplay',
                'room',
                'scene-card',
                'save',
                sceneRef,
                '--project',
                ws.dir,
                '--request-file',
                reqFile,
                '--expected-revision',
                expectedRevision,
                '--idempotency-key',
                idempotencyKey,
                '--json',
              ],
              { cwd: ws.dir },
            )
            if (isTimedOut(res)) return { status: 'unknown' }
            if (res.stdout.includes('version_conflict') || res.exitCode === 409) {
              return { status: 'failed', errorCode: 'REVISION_CONFLICT' }
            }
            if (res.exitCode !== 0) return { status: 'failed', errorCode: 'AUCTRA_SAVE_FAILED' }
            await bindBundleRef(ws.dir, 'auctra-scene', sceneRef)
            await syncBundle({ workspaceDir: ws.dir, runner: this.runner })
            return { status: 'completed', receipt: { sceneRef, previousRevision: expectedRevision } }
          },
        })
      }

      case 'auctra.scene_card.submit': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        if (!existsSync(path.join(ws.dir, '.auctra'))) {
          return rpcFail(this.generation, 'UNINITIALIZED_OWNER', 'Workspace lacks .auctra/ marker; refusing submit')
        }
        const sceneRef = String(payload.sceneRef ?? '').trim()
        const expectedRevision = String(payload.expectedRevision ?? '').trim()
        const idempotencyKey = String(payload.idempotencyKey ?? '')
        if (!sceneRef || !expectedRevision) {
          return rpcFail(this.generation, 'auctra/missing_revision_or_ref', 'sceneRef and expectedRevision are required')
        }
        return this.executeControlledMutation({
          workspace: ws,
          action: 'auctra.scene_card.submit',
          owner: 'auctra',
          idempotencyKey,
          expectedRevision,
          canonicalPayload: { sceneRef, expectedRevision },
          invoke: async () => {
            const res = await this.runner(
              'auctra',
              [
                'screenplay',
                'room',
                'scene-card',
                'submit',
                sceneRef,
                '--project',
                ws.dir,
                '--expected-revision',
                expectedRevision,
                '--idempotency-key',
                idempotencyKey,
                '--json',
              ],
              { cwd: ws.dir },
            )
            if (isTimedOut(res)) return { status: 'unknown' }
            if (res.exitCode !== 0) return { status: 'failed', errorCode: 'AUCTRA_SUBMIT_FAILED' }
            await syncBundle({ workspaceDir: ws.dir, runner: this.runner })
            return { status: 'completed', receipt: { sceneRef, submittedRevision: expectedRevision } }
          },
        })
      }

      case 'schedule.list': {
        return rpcOk(this.generation, this.schedule.list())
      }

      case 'schedule.plan': {
        try {
          const board = this.schedule.plan({
            ref: typeof payload.ref === 'string' ? payload.ref : '',
            date: typeof payload.date === 'string' ? payload.date : '',
            label: typeof payload.label === 'string' ? payload.label : undefined,
            kind: typeof payload.kind === 'string' ? payload.kind : undefined,
            note: typeof payload.note === 'string' ? payload.note : undefined,
          })
          this.bumpGeneration()
          return rpcOk(this.generation, board)
        } catch (err) {
          if (err instanceof ScheduleInputError) {
            return rpcFail(this.generation, err.code, err.message, { retryable: false })
          }
          throw err
        }
      }

      case 'schedule.clear': {
        const board = this.schedule.clear(typeof payload.ref === 'string' ? payload.ref : '')
        this.bumpGeneration()
        return rpcOk(this.generation, board)
      }

      case 'project.list': {
        return rpcOk(this.generation, this.projects.list(payload.includeArchived === true))
      }

      case 'project.create': {
        try {
          const project = this.projects.create({
            title: typeof payload.title === 'string' ? payload.title : '',
            status: typeof payload.status === 'string' ? (payload.status as never) : undefined,
            workspaceIds: Array.isArray(payload.workspaceIds)
              ? (payload.workspaceIds as string[])
              : Array.isArray(payload.workspaceRefs)
                ? (payload.workspaceRefs as string[])
                : [],
          })
          this.bumpGeneration()
          // `{ project }` keeps create symmetric with archive/restore/activate and with clone.
          return rpcOk(this.generation, { project })
        } catch (err) {
          if (err instanceof ProjectInputError) return rpcFail(this.generation, err.code, err.message, { retryable: false })
          throw err
        }
      }

      case 'project.clone': {
        try {
          const result = this.projects.clone({
            sourceProjectId: typeof payload.sourceProjectId === 'string' ? payload.sourceProjectId : '',
            title: typeof payload.title === 'string' ? payload.title : '',
            workspaceIds: Array.isArray(payload.workspaceIds) ? (payload.workspaceIds as string[]) : undefined,
          })
          this.bumpGeneration()
          return rpcOk(this.generation, result)
        } catch (err) {
          if (err instanceof ProjectInputError) return rpcFail(this.generation, err.code, err.message, { retryable: false })
          throw err
        }
      }

      case 'project.update':
      case 'project.archive':
      case 'project.restore':
      case 'project.activate': {
        try {
          const projectId = typeof payload.projectId === 'string' ? payload.projectId : ''
          if (action === 'project.update') {
            const registry = this.projects.update(projectId, {
              title: typeof payload.title === 'string' ? payload.title : undefined,
              status: typeof payload.status === 'string' ? (payload.status as never) : undefined,
              coverRef: typeof payload.coverRef === 'string' ? payload.coverRef : undefined,
            })
            this.bumpGeneration()
            return rpcOk(this.generation, registry)
          }
          if (action === 'project.archive') {
            const project = this.projects.archive(projectId, typeof payload.expectedUpdatedAt === 'string' ? payload.expectedUpdatedAt : undefined)
            this.bumpGeneration()
            return rpcOk(this.generation, { project })
          }
          if (action === 'project.restore') {
            const project = this.projects.restore(projectId)
            this.bumpGeneration()
            return rpcOk(this.generation, { project })
          }
          const project = this.projects.activate(projectId)
          this.bumpGeneration()
          return rpcOk(this.generation, { project })
        } catch (err) {
          if (err instanceof ProjectInputError) return rpcFail(this.generation, err.code, err.message, { retryable: false })
          throw err
        }
      }

      case 'project.bind':
      case 'project.unbind': {
        try {
          const projectId = typeof payload.projectId === 'string' ? payload.projectId : ''
          const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : ''
          const owner = (typeof payload.owner === 'string' ? payload.owner : '') as never
          const refs = Array.isArray(payload.refs) ? (payload.refs as string[]) : undefined
          const registry =
            action === 'project.bind'
              ? this.projects.bind({
                  projectId,
                  workspaceId,
                  owner,
                  refs: refs ?? [],
                  expectedRevision: typeof payload.expectedRevision === 'string'
                    ? payload.expectedRevision
                    : undefined,
                  workspaceRegistered: this.workspaces.has(workspaceId),
                })
              : this.projects.unbind({ projectId, workspaceId, owner, refs })
          this.bumpGeneration()
          return rpcOk(this.generation, registry)
        } catch (err) {
          if (err instanceof ProjectInputError) return rpcFail(this.generation, err.code, err.message, {
            retryable: false,
            ...(err.details ? { details: err.details } : {}),
          })
          throw err
        }
      }

      case 'cli.catalog': {
        return rpcOk(this.generation, { operations: ALLOWLISTED_CLI_CARDS })
      }

      case 'cli.run_allowlisted': {
        const ws = this.resolveWorkspace(payload.workspaceId)
        const operationId = String(payload.operationId ?? '')
        const card = ALLOWLISTED_CLI_CARDS.find((c) => c.operationId === operationId)
        if (!card) {
          return rpcFail(this.generation, 'untrusted_execution_rejected', `Operation not in fixed allowlist: ${operationId}`)
        }
        if (card.requiresMarker === 'auctra' && !existsSync(path.join(ws.dir, '.auctra'))) {
          return rpcFail(this.generation, 'uninitialized_owner', 'Workspace does not contain .auctra/ marker')
        }
        if (card.requiresMarker === 'scaena' && !existsSync(path.join(ws.dir, '.scaena', 'project.json'))) {
          return rpcFail(this.generation, 'uninitialized_owner', 'Workspace does not contain .scaena/project.json marker')
        }
        if (operationId === 'bundle.doctor') {
          return rpcOk(this.generation, {
            operationId,
            exitCode: 0,
            summary: this.describeWorkspace(ws.id),
          })
        }
        if (operationId === 'bundle.validate') {
          const report = await validateBundleOnDisk(ws.dir)
          return rpcOk(this.generation, { operationId, exitCode: report.ok ? 0 : 1, summary: report })
        }
        let cmdBin = 'eikona'
        let cmdArgs: string[] = ['doctor', '--agent']
        if (operationId === 'eikona.models.recommend') {
          cmdBin = 'eikona'
          cmdArgs = ['models', 'recommend', '--agent']
        } else if (operationId === 'auctra.room.describe') {
          cmdBin = 'auctra'
          cmdArgs = ['screenplay', 'room', 'describe', '--project', ws.dir, '--json']
        } else if (operationId === 'scaena.production.doctor') {
          cmdBin = 'scaena'
          cmdArgs = ['production', 'doctor', '--project', ws.dir, '--agent', '--no-remote']
        }
        const execRes = await this.runner(cmdBin, cmdArgs, { cwd: ws.dir, timeoutMs: 10_000 })
        return rpcOk(this.generation, {
          operationId,
          exitCode: execRes.exitCode,
          outputExcerpt: stripHostPaths(execRes.stdout.slice(0, 2000)),
        })
      }

      case 'templates.list': {
        const category = typeof payload.category === 'string' ? payload.category : undefined
        const query = typeof payload.query === 'string' ? payload.query.trim().toLowerCase() : ''
        let items: TemplateCatalogEntryV1[] = [...BUILTIN_CREATOR_TEMPLATES]

        if (this.templateRegistryUrl && this.fetchImpl) {
          try {
            const url = new URL('/v1/template-catalog?kind=prompt&limit=60', this.templateRegistryUrl)
            if (query) url.searchParams.set('q', query)
            const resp = await this.fetchImpl(url, {
              method: 'GET',
              headers: { accept: 'application/json' },
              signal: AbortSignal.timeout(2500),
            })
            if (resp.ok) {
              const body = (await resp.json()) as { items?: Array<Record<string, unknown>> }
              if (Array.isArray(body.items)) {
                for (const r of body.items) {
                  const preview = (r.preview ?? {}) as Record<string, unknown>
                  const rawSlots = Array.isArray(preview.slots) ? preview.slots : []
                  items.push({
                    templateRef: String(r.ref ?? `promptrepo://registry/${String(r.release_id ?? 'rel')}`),
                    releaseId: String(r.release_id ?? 'rel'),
                    title: String(r.title ?? r.ref ?? 'Template'),
                    category: 'drama',
                    version: String(r.version ?? '1.0.0'),
                    digest: String(r.digest ?? sha256Digest(String(r.ref ?? ''))),
                    summary: String(r.summary ?? '来自 Template Registry 的已发布模板'),
                    slots: rawSlots.map((s) => {
                      const sl = (s ?? {}) as Record<string, unknown>
                      return {
                        name: String(sl.name ?? 'input'),
                        label: String(sl.label ?? sl.name ?? '输入'),
                        inputType: sl.input_type === 'enum' ? 'enum' : 'text',
                        required: Boolean(sl.required),
                        ...(Array.isArray(sl.options) ? { options: sl.options.map(String) } : {}),
                      }
                    }),
                  })
                }
              }
            }
          } catch {
            // Offline / unreachable Template Registry degrades gracefully to local reviewed builtin catalog
          }
        }

        if (category) items = items.filter((t) => t.category === category)
        if (query) {
          items = items.filter((t) => `${t.title} ${t.summary} ${t.templateRef}`.toLowerCase().includes(query))
        }
        return rpcOk(this.generation, { templates: items })
      }

      case 'templates.render_preview': {
        const templateRef = String(payload.templateRef ?? '')
        const values = (payload.values ?? {}) as Record<string, unknown>
        const tpl = BUILTIN_CREATOR_TEMPLATES.find((t) => t.templateRef === templateRef)
        if (!tpl) {
          return rpcFail(this.generation, 'template/not_found', `Unknown templateRef: ${templateRef}`)
        }
        for (const slot of tpl.slots) {
          const val = String(values[slot.name] ?? '').trim()
          if (slot.required && !val) {
            return rpcFail(this.generation, 'template/missing_required_slot', `缺少必填插槽：${slot.label}`)
          }
        }
        const slotSummary = tpl.slots
          .map((s) => {
            const val = String(values[s.name] ?? '').trim()
            return val ? `- ${s.label}: ${val}` : undefined
          })
          .filter(Boolean)
          .join('\n')
        const structuredInstruction = [`[TemplateRef: ${tpl.templateRef}]`, `任务：${tpl.title}`, slotSummary]
          .filter(Boolean)
          .join('\n')
        return rpcOk(this.generation, {
          templateRef: tpl.templateRef,
          digest: tpl.digest,
          structuredInstruction,
        })
      }

      case 'timing.projection': {
        const nowMs = Date.now()
        const spans: TimingSpanProjectionV1[] = Array.from(this.operations.values()).map((op) => {
          const startedMs = Date.parse(op.createdAt) || nowMs
          const endMs =
            op.status === 'completed' || op.status === 'failed' || op.status === 'cancelled'
              ? Date.parse(op.updatedAt) || nowMs
              : nowMs
          return {
            spanId: `span_${op.operationRef}`,
            operationRef: op.operationRef,
            owner: op.owner,
            stageLabel: op.action,
            status: op.status,
            startedAt: op.createdAt,
            updatedAt: op.updatedAt,
            elapsedMs: Math.max(0, endMs - startedMs),
            idempotencyKey: op.idempotencyKey,
            ...(op.errorCode ? { blockerReason: op.errorCode } : {}),
            nextAction:
              op.status === 'reconcile_required' || op.status === 'unknown'
                ? 'reconcile_original'
                : op.status === 'waiting_approval'
                  ? 'approve'
                  : op.status === 'waiting_for_human'
                    ? 'human_review'
                    : 'none',
          }
        })
        const snapshot: TimingProjectionSnapshotV1 = {
          capturedAt: new Date(nowMs).toISOString(),
          activeCount: spans.filter((s) => s.status === 'running' || s.status === 'queued').length,
          waitingHumanCount: spans.filter((s) => s.status === 'waiting_approval' || s.status === 'waiting_for_human').length,
          reconcileRequiredCount: spans.filter((s) => s.status === 'reconcile_required' || s.status === 'unknown').length,
          spans,
        }
        return rpcOk(this.generation, snapshot)
      }

      case 'operation.reconcile': {
        const operationRef = String(payload.operationRef ?? '').trim()
        const existing = this.operations.get(operationRef)
        if (!existing) {
          return rpcFail(this.generation, 'NOT_FOUND', `Unknown operationRef: ${operationRef}`)
        }
        if (existing.status !== 'reconcile_required' && existing.status !== 'unknown') {
          return rpcOk(this.generation, { operation: existing })
        }
        const ws = this.resolveWorkspace(existing.workspaceId)
        if (existing.owner === 'auctra' && existsSync(path.join(ws.dir, '.auctra'))) {
          const recRes = await this.runner(
            'auctra',
            [
              'screenplay',
              'room',
              'receipt',
              'reconcile',
              '--operation',
              existing.action.replace('auctra.', 'screenplay.room.'),
              '--idempotency-key',
              existing.idempotencyKey,
              '--project',
              ws.dir,
              '--json',
            ],
            { cwd: ws.dir },
          )
          const outcome = reconcileOutcome(recRes.stdout, recRes.exitCode, {
            operationRef: existing.operationRef,
            idempotencyKey: existing.idempotencyKey,
            workspaceId: existing.workspaceId,
          })
          if (outcome === 'completed') {
            const settled: OperationRecordView = { ...existing, status: outcome, updatedAt: new Date().toISOString() }
            this.operations.set(operationRef, settled)
            this.bumpGeneration()
            await this.persistStateAtomic().catch(() => undefined)
            return rpcOk(this.generation, { operation: settled })
          }
          if (outcome === 'failed') {
            const settled: OperationRecordView = { ...existing, status: 'failed', updatedAt: new Date().toISOString(), errorCode: 'OWNER_RECONCILE_FAILED' }
            this.operations.set(operationRef, settled)
            this.bumpGeneration()
            await this.persistStateAtomic().catch(() => undefined)
            return rpcFail(this.generation, 'OWNER_RECONCILE_FAILED', 'Owner reconciliation reported failure', { retryable: false, operationRef })
          }
          return rpcFail(this.generation, 'RECONCILE_REQUIRED', 'Original operation outcome remains unknown', { retryable: false, operationRef })
        }
        return rpcFail(this.generation, 'CAPABILITY_UNAVAILABLE', 'No structured reconcile adapter is available for this owner', {
          retryable: false,
          operationRef,
        })
      }

      default:
        return rpcFail(this.generation, 'muweave/unsupported', `Unhandled action: ${action}`)
    }
  }

  createRpcFetchHandler(): (request: DshRequestLike) => Promise<Response> {
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    }
    return async (request) => {
      try {
        const method = (request.method ?? 'POST').toUpperCase()
        if (method !== 'POST') {
          return new Response(JSON.stringify(rpcFail(this.generation, 'muweave/method_not_allowed', 'Only POST is allowed')), {
            status: 405,
            headers,
          })
        }
        const site = request.headers?.get('sec-fetch-site')
        if (site && site !== 'same-origin' && site !== 'none') {
          return new Response(JSON.stringify(rpcFail(this.generation, 'muweave/cross_site_rejected', 'Cross-site requests rejected')), {
            status: 403,
            headers,
          })
        }
        const rawText = await request.text()
        if (rawText.length > 1024 * 1024) {
          return new Response(JSON.stringify(rpcFail(this.generation, 'muweave/payload_too_large', 'Request exceeds 1 MiB')), {
            status: 413,
            headers,
          })
        }
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(rawText)
        } catch {
          return new Response(JSON.stringify(rpcFail(this.generation, 'muweave/invalid_json', 'Body is not valid JSON')), {
            status: 200,
            headers,
          })
        }
        const validated = validateIncomingRpcBody(parsedJson)
        if (!validated.ok) {
          return new Response(JSON.stringify(rpcFail(this.generation, validated.code, validated.message)), {
            status: 200,
            headers,
          })
        }
        if (validated.action === 'job.approve' && site !== 'same-origin') {
          // Approval must come from the user's browser, which always sends sec-fetch-site: same-origin.
          // Residual (documented, not solved): an agent with shell access to the machine can still act as the user.
          return new Response(
            JSON.stringify(rpcFail(this.generation, 'APPROVAL_REQUIRED', 'Approval must be given from the browser UI', { retryable: false })),
            { status: 403, headers },
          )
        }
        const envelope = await this.handleRpcAction(validated.action, validated.payload)
        return new Response(JSON.stringify(envelope), { status: 200, headers })
      } catch (err) {
        const msg = err instanceof Error ? stripHostPaths(err.message.slice(0, 160)) : 'Unexpected host error'
        return new Response(JSON.stringify(rpcFail(this.generation, 'muweave/internal_error', msg)), {
          status: 200,
          headers,
        })
      }
    }
  }

  createMediaFetchHandler(): (request: DshRequestLike) => Promise<Response> {
    return async (request) => {
      try {
        const site = request.headers?.get('sec-fetch-site')
        if (site && site !== 'same-origin' && site !== 'none') {
          return new Response(null, { status: 403 })
        }
        const url = new URL(request.url ?? 'http://127.0.0.1/api/muweave-dsh/media', 'http://127.0.0.1')
        const token = url.searchParams.get('token') ?? ''
        const grant = this.mediaGrants.get(token)
        if (!grant || Date.now() > grant.expiresAtMs) {
          if (grant) this.mediaGrants.delete(token)
          return new Response(null, { status: 404 })
        }
        const bytes = await readCasBlobVerified(grant.workspaceDir, grant.blobDigest)
        const total = bytes.byteLength
        const rangeHeader = request.headers?.get('range')
        const baseHeaders: Record<string, string> = {
          'content-type': grant.mimeType,
          'accept-ranges': 'bytes',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'",
        }

        const parsedRange = parseByteRange(rangeHeader ?? '', total)
        if (parsedRange === 'invalid') {
          return new Response(null, {
            status: 416,
            headers: { ...baseHeaders, 'content-range': `bytes */${total}` },
          })
        }
        if (parsedRange !== 'absent') {
          const { start, end } = parsedRange
          const slice = new Uint8Array(bytes.subarray(start, end + 1))
          return new Response(slice, {
            status: 206,
            headers: {
              ...baseHeaders,
              'content-range': `bytes ${start}-${end}/${total}`,
              'content-length': String(slice.byteLength),
            },
          })
        }

        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            ...baseHeaders,
            'content-length': String(total),
          },
        })
      } catch {
        return new Response(null, { status: 404 })
      }
    }
  }
}

interface SharedHostBusState {
  service: CreatorHostService
  routeRefCount: number
  disposeRpc?: DshDisposer
  disposeMedia?: DshDisposer
}

declare global {
  // eslint-disable-next-line no-var
  var __YEISME_MUWEAVE_DSH_HOST_BUS__: SharedHostBusState | undefined
}

function getOrCreateSharedState(options?: CreatorHostServiceOptions): SharedHostBusState {
  if (!globalThis.__YEISME_MUWEAVE_DSH_HOST_BUS__) {
    globalThis.__YEISME_MUWEAVE_DSH_HOST_BUS__ = {
      service: new CreatorHostService(options),
      routeRefCount: 0,
    }
  }
  return globalThis.__YEISME_MUWEAVE_DSH_HOST_BUS__
}

export function getSharedCreatorHostService(options?: CreatorHostServiceOptions): CreatorHostService {
  return getOrCreateSharedState(options).service
}

export function mountSharedMuweaveHostRoutes(
  ctx: DshHostContextLike,
  pluginLabel: string,
  options?: CreatorHostServiceOptions,
): CreatorHostService {
  const state = getOrCreateSharedState(options)
  if (typeof process.env.MUWEAVE_WORKSPACE_DIR === 'string' && process.env.MUWEAVE_WORKSPACE_DIR.trim()) {
    const targetDir = path.resolve(process.env.MUWEAVE_WORKSPACE_DIR.trim())
    ctx.inject?.(['workspaceRegistry'], (sub) => {
      const reg = sub.workspaceRegistry as { create?: (p: string, title?: string) => Promise<unknown> } | undefined
      void reg?.create?.(targetDir, path.basename(targetDir))?.catch(() => undefined)
    })
  }
  if (!ctx.connection?.fetch) {
    return state.service
  }
  ctx.effect(() => {
    if (state.routeRefCount === 0 && ctx.connection?.fetch) {
      let disposeRpc: DshDisposer | undefined
      try {
        disposeRpc = ctx.connection.fetch.register({
          path: MUWEAVE_RPC_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: state.service.createRpcFetchHandler(),
        })
        state.disposeMedia = ctx.connection.fetch.register({
          path: MUWEAVE_MEDIA_PATH,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: state.service.createMediaFetchHandler(),
        })
        state.disposeRpc = disposeRpc
      } catch (err) {
        void disposeRpc?.()
        state.disposeRpc = undefined
        state.disposeMedia = undefined
        throw err
      }
    }
    state.routeRefCount += 1
    return () => {
      state.routeRefCount = Math.max(0, state.routeRefCount - 1)
      if (state.routeRefCount === 0) {
        const d1 = state.disposeRpc
        const d2 = state.disposeMedia
        state.disposeRpc = undefined
        state.disposeMedia = undefined
        void d1?.()
        void d2?.()
      }
    }
  }, `${pluginLabel}: shared muweave host routes`)

  return state.service
}
