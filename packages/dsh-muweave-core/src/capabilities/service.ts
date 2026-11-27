import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { addShotMediaLink, removeShotMediaLink, validateShotMediaEntry, type CliRunner } from '@yeisme/muweave-bundle'
import {
  CAPABILITY_RPC_ACTIONS,
  JOB_ERROR_CODES,
  jobIsActive,
  type CapabilityCatalogV1,
  type CapabilityEstimateRequestV1,
  type CapabilityEstimateV1,
  type CostAmountV1,
  type JobRecordV1,
  type JobRequester,
  type ProductionAnchorV1,
  type ShotMediaLinkV1,
} from '../capability-protocol'
import { JobEngine, JobError, nextActionOf } from '../jobs'
import { rpcFail, rpcOk, type RpcEnvelope } from '../protocol'
import { CapabilityRegistry, CAPABILITY_ADAPTERS } from './registry'
import { buildCustomCapabilityAdapter, type CustomAdapterStore } from './custom-adapters'
import { computeBudget, readSettings } from './settings'
import { deriveTitle, promptDigestOf, type AdapterContext, type CapabilityInput } from './types'

export const ESTIMATE_TTL_MS = 15 * 60 * 1000
const ROLES = ['keyframe', 'reference', 'video', 'voice', 'music', 'sfx']
const ESTIMATES_SCHEMA = 'muweave.estimates.v1'

export interface CapabilityServiceDeps {
  pluginDataDir: string
  runner: CliRunner
  resolveWorkspace(workspaceId?: unknown): { id: string; label: string; dir: string }
  generation(): number
  bumpGeneration(): void
  syncWorkspace(ws: { id: string; dir: string }): Promise<void>
  env?: NodeJS.ProcessEnv
  pollIntervalMs?: number
  logger?: (event: string, fields: Record<string, unknown>) => void
  customAdapters?: CustomAdapterStore
  fetchImpl?: typeof globalThis.fetch
}

class InputError extends Error {}

function str(v: unknown, max = 200): string | undefined {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function payloadDigest(capabilityId: string, promptDigest: string, slots: number, anchor?: ProductionAnchorV1): string {
  return `sha256:${createHash('sha256').update(canonicalJson({ capabilityId, promptDigest, slots, anchor: anchor ?? null })).digest('hex')}`
}

interface PersistedEstimateDigestV1 {
  estimateId: string
  workspaceId: string
  payloadDigest: string
  expiresAt: string
}

/** Same opaque-ref rules the bundle applies to shot media entries; anything else is rejected up front. */
function opaque(raw: unknown, field: string): string {
  const probe = validateShotMediaEntry({ shotRef: raw, role: 'reference', elementId: 'x', linkedAt: new Date().toISOString() })
  if (!probe.ok || typeof raw !== 'string') throw new InputError(`anchor.${field} must be an opaque reference`)
  return raw
}

function cleanAnchor(raw: unknown): ProductionAnchorV1 | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('anchor must be an object')
  const r = raw as Record<string, unknown>
  const out: ProductionAnchorV1 = {}
  for (const k of ['episodeRef', 'sceneRef', 'shotRef'] as const) {
    if (r[k] !== undefined) out[k] = opaque(r[k], k)
  }
  if (r.characterRefs !== undefined) {
    if (!Array.isArray(r.characterRefs) || r.characterRefs.length > 16) throw new InputError('anchor.characterRefs must be at most 16 references')
    out.characterRefs = r.characterRefs.map((x) => opaque(x, 'characterRefs'))
  }
  return Object.keys(out).length && (out.characterRefs?.length || out.episodeRef || out.sceneRef || out.shotRef) ? out : undefined
}

function cleanCost(raw: unknown): CostAmountV1 {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const unit = r.unit === 'usd' || r.unit === 'credits' || r.unit === 'none' ? r.unit : undefined
  if (!unit) throw new InputError('ceiling.unit must be usd, credits or none')
  return typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount >= 0 ? { unit, amount: r.amount } : { unit }
}

export class CapabilityService {
  readonly registry: CapabilityRegistry
  readonly engine: JobEngine
  /** One global lock around budget check -> queued transition, so two approvals cannot both pass the cap. */
  private budgetTail: Promise<void> = Promise.resolve()
  private readonly estimates = new Map<string, { est: CapabilityEstimateV1; input: CapabilityInput; workspaceId: string }>()
  private readonly persistedEstimateDigests = new Map<string, PersistedEstimateDigestV1>()

  constructor(private readonly deps: CapabilityServiceDeps) {
    this.registry = new CapabilityRegistry(
      CAPABILITY_ADAPTERS,
      deps.customAdapters
        ? () =>
            deps.customAdapters!
              .allConfigs()
              .filter((c) => c.enabled)
              .map((c) => buildCustomCapabilityAdapter(c, deps.fetchImpl, deps.env))
        : undefined,
    )
    this.loadEstimateDigests()
    this.engine = new JobEngine({
      file: path.join(deps.pluginDataDir, 'jobs.v1.json'),
      registry: this.registry,
      adapterContext: (id) => this.ctx(id),
      workspaceDir: (id) => deps.resolveWorkspace(id).dir,
      onChange: () => deps.bumpGeneration(),
      afterReview: (id) => deps.syncWorkspace(deps.resolveWorkspace(id)),
      ...(deps.pollIntervalMs ? { pollIntervalMs: deps.pollIntervalMs } : {}),
      logger: deps.logger,
    })
  }

  private estimatesFile(): string {
    return path.join(this.deps.pluginDataDir, 'estimates.v1.json')
  }

  private loadEstimateDigests(): void {
    const file = this.estimatesFile()
    if (!existsSync(file)) return
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { records?: unknown[] }
      for (const raw of parsed.records ?? []) {
        if (typeof raw !== 'object' || raw === null) continue
        const record = raw as Partial<PersistedEstimateDigestV1>
        if (typeof record.estimateId === 'string' && typeof record.workspaceId === 'string' && typeof record.payloadDigest === 'string' && typeof record.expiresAt === 'string') {
          this.persistedEstimateDigests.set(record.estimateId, record as PersistedEstimateDigestV1)
        }
      }
    } catch {
      this.deps.logger?.('capability.estimate_digest_load_failed', { errorCode: 'ESTIMATE_DIGEST_INDEX_UNREADABLE' })
    }
  }

  private persistEstimateDigest(record: PersistedEstimateDigestV1): void {
    this.persistedEstimateDigests.set(record.estimateId, record)
    const records = [...this.persistedEstimateDigests.values()]
    mkdirSync(this.deps.pluginDataDir, { recursive: true })
    const file = this.estimatesFile()
    const temp = `${file}.tmp.${process.pid}`
    writeFileSync(temp, JSON.stringify({ schema: ESTIMATES_SCHEMA, records }), { mode: 0o600 })
    renameSync(temp, file)
  }

  private ctx(workspaceId?: string): AdapterContext {
    return { runner: this.deps.runner, cwd: this.deps.resolveWorkspace(workspaceId).dir, tmpDir: path.join(this.deps.pluginDataDir, 'tmp-requests') }
  }

  dispose(): void {
    this.engine.dispose()
  }

  settings() {
    return readSettings(this.deps.pluginDataDir, this.deps.env)
  }

  async catalog(workspaceId?: string): Promise<CapabilityCatalogV1> {
    const ctx = this.ctx(workspaceId)
    return { paidEnabled: this.settings().paidEnabled, capabilities: await this.registry.catalog(ctx) }
  }

  // ------------------------------------------------------------ estimate and request

  async estimate(payload: Record<string, unknown>): Promise<CapabilityEstimateV1> {
    const ws = this.deps.resolveWorkspace(payload.workspaceId)
    const req = payload as unknown as CapabilityEstimateRequestV1
    const anchor = cleanAnchor(req.anchor)
    const adapter = typeof req.capabilityId === 'string' ? this.registry.find(req.capabilityId) : undefined
    if (!adapter) throw new JobError('CAPABILITY_UNAVAILABLE', 'Unknown capability')
    const ctx = this.ctx(ws.id)
    const described = await this.registry.describe(ctx, adapter)
    if (!described.available) throw new JobError('CAPABILITY_UNAVAILABLE', `Capability unavailable: ${described.unavailableReason}`)
    const rawInput = typeof req.input === 'object' && req.input !== null && !Array.isArray(req.input) ? req.input : {}
    const input: CapabilityInput = {}
    for (const [k, v] of Object.entries(rawInput)) {
      if (typeof v === 'string' ? v.length <= 20_000 : typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))) input[k] = v
    }
    for (const f of adapter.descriptor.inputs) {
      if (f.required && !(typeof input[f.name] === 'string' ? (input[f.name] as string).trim() : input[f.name] !== undefined)) throw new InputError(`Missing input: ${f.name}`)
    }
    const d = adapter.descriptor
    const slots = Math.min(d.maxSlots, Math.max(1, Math.floor(Number(req.slots) || d.defaultSlots)))
    const out = await adapter.estimate(ctx, input, slots)
    if (!out.ok) throw new JobError(out.errorCode, 'Owner could not produce an estimate')
    const est: CapabilityEstimateV1 = {
      estimateId: `est_${randomBytes(8).toString('hex')}`,
      capabilityId: d.capabilityId,
      owner: d.owner,
      costClass: out.value.costClass,
      estimate: out.value.estimate,
      suggestedCeiling: out.value.suggestedCeiling,
      slots: out.value.slots,
      planLines: out.value.planLines,
      title: deriveTitle(d.title, anchor),
      promptDigest: promptDigestOf(input),
      ...(anchor ? { anchor } : {}),
      expiresAt: new Date(Date.now() + ESTIMATE_TTL_MS).toISOString(),
    }
    this.purgeEstimates()
    this.estimates.set(est.estimateId, { est, input, workspaceId: ws.id })
    this.persistEstimateDigest({
      estimateId: est.estimateId,
      workspaceId: ws.id,
      payloadDigest: payloadDigest(est.capabilityId, est.promptDigest, est.slots, est.anchor),
      expiresAt: est.expiresAt,
    })
    return est
  }

  private purgeEstimates(): void {
    const now = Date.now()
    for (const [id, e] of this.estimates) if (Date.parse(e.est.expiresAt) < now) this.estimates.delete(id)
  }

  async request(payload: Record<string, unknown>): Promise<JobRecordV1> {
    const ws = this.deps.resolveWorkspace(payload.workspaceId)
    const requestedBy = payload.requestedBy
    if (requestedBy !== 'ui' && requestedBy !== 'agent') throw new InputError("requestedBy must be 'ui' or 'agent'")
    const key = str(payload.idempotencyKey, 128)
    const estimateId = str(payload.estimateId, 64)
    if (!key || !estimateId) throw new InputError('estimateId and idempotencyKey are required')
    const requesterRaw = payload.requester
    const requester = requesterRaw && typeof requesterRaw === 'object' && !Array.isArray(requesterRaw)
      ? Object.fromEntries(['botId', 'sessionId', 'taskId', 'parentJobId'].flatMap((field) => {
          const value = str((requesterRaw as Record<string, unknown>)[field], 160)
          return value ? [[field, value]] : []
        }))
      : undefined
    const traceId = str(payload.traceId, 160)
    this.purgeEstimates()
    const hit = this.estimates.get(estimateId)
    const persistedDigest = this.persistedEstimateDigests.get(estimateId)
    const prior = this.engine.findByIdempotencyKey(ws.id, key)
    if (prior) {
      const priorDigest = prior.payloadDigest ?? payloadDigest(prior.capabilityId, prior.promptDigest, prior.slots.length, prior.anchor)
      const requestDigest = hit && hit.workspaceId === ws.id
        ? payloadDigest(hit.est.capabilityId, hit.est.promptDigest, hit.est.slots, hit.est.anchor)
        : persistedDigest?.workspaceId === ws.id ? persistedDigest.payloadDigest : undefined
      if (!requestDigest) throw new JobError('ESTIMATE_EXPIRED', 'The estimate expired; request a new one')
      if (requestDigest !== priorDigest) {
        throw new JobError('IDEMPOTENCY_CONFLICT', 'Same idempotencyKey was used for a different request')
      }
      return prior
    }
    if (!hit || hit.workspaceId !== ws.id) throw new JobError('ESTIMATE_EXPIRED', 'The estimate expired; request a new one')
    const adapter = this.registry.find(hit.est.capabilityId)!
    const now = new Date().toISOString()
    const job: JobRecordV1 = {
      jobId: `job_${randomUUID().slice(0, 12)}`,
      workspaceId: ws.id,
      capabilityId: hit.est.capabilityId,
      owner: hit.est.owner,
      kind: adapter.descriptor.kind,
      title: hit.est.title,
      promptDigest: hit.est.promptDigest,
      payloadDigest: payloadDigest(hit.est.capabilityId, hit.est.promptDigest, hit.est.slots, hit.est.anchor),
      requestedBy: requestedBy as JobRequester,
      ...(requester && Object.keys(requester).length ? { requester } : {}),
      ...(traceId ? { traceId } : {}),
      status: 'waiting_approval',
      estimate: hit.est.estimate,
      idempotencyKey: key,
      ...(hit.est.anchor ? { anchor: hit.est.anchor } : {}),
      slots: Array.from({ length: hit.est.slots }, (_, index) => ({ slotId: `slot_${index + 1}`, index, status: 'pending' as const, review: 'unreviewed' as const })),
      createdAt: now,
      updatedAt: now,
      nextAction: nextActionOf('waiting_approval'),
    }
    return this.engine.create(job, hit.input, Date.parse(hit.est.expiresAt))
  }

  // ------------------------------------------------------------ approval

  /** Checks run in the contract order; the owner is only reached after every one passes. */
  async approve(payload: Record<string, unknown>): Promise<JobRecordV1> {
    const run = this.budgetTail.then(() => this.approveLocked(payload))
    this.budgetTail = run.then(() => undefined, () => undefined)
    const { jobId, acceptUnknownCost } = await run
    // The owner call happens outside the lock; the intent (queued + ceiling) is already persisted.
    return this.engine.runSubmit(jobId, acceptUnknownCost)
  }

  private async approveLocked(payload: Record<string, unknown>): Promise<{ jobId: string; acceptUnknownCost: boolean }> {
    if (this.engine.corruptFile) {
      throw new JobError('PAID_DISABLED', `Job store was corrupt and moved to ${path.basename(this.engine.corruptFile)}; resolve it before approving jobs`)
    }
    const job = this.engine.require(String(payload.jobId ?? ''))
    if (job.status !== 'waiting_approval') throw new JobError('APPROVAL_REQUIRED', 'Job is not waiting for approval')
    const adapter = this.registry.find(job.capabilityId)
    const described = adapter ? await this.registry.describe(this.ctx(job.workspaceId), adapter) : undefined
    if (!adapter || !described?.available) throw new JobError('CAPABILITY_UNAVAILABLE', 'Capability is not available')
    const settings = this.settings()
    if (adapter.descriptor.costClass !== 'free' && !settings.paidEnabled) {
      throw new JobError('PAID_DISABLED', 'Paid generation is disabled on this host')
    }
    let ceiling: CostAmountV1
    try {
      ceiling = cleanCost(payload.ceiling)
    } catch {
      throw new JobError('CEILING_BELOW_ESTIMATE', 'A ceiling with a unit is required')
    }
    const est = job.estimate
    const unknown = est.amount === undefined && est.unit !== 'none'
    if (est.unit !== 'none') {
      const unitOk = ceiling.unit === est.unit && ceiling.amount !== undefined
      if (!unitOk || (est.amount !== undefined && ceiling.amount! < est.amount) || ceiling.amount === 0) {
        throw new JobError('CEILING_BELOW_ESTIMATE', 'Ceiling must be at or above the estimate, in the same unit')
      }
    }
    if (unknown && payload.acceptUnknownCost !== true) throw new JobError('UNKNOWN_COST_NOT_ACCEPTED', 'The owner cannot price this job; accept unknown cost explicitly')
    const cap = ceiling.unit === 'usd' ? settings.dailyCap?.usd : ceiling.unit === 'credits' ? settings.dailyCap?.credits : undefined
    if (cap !== undefined && ceiling.amount !== undefined) {
      const line = computeBudget(this.engine.all(), settings).lines.find((l) => l.unit === ceiling.unit)
      if ((line?.committed ?? 0) + (line?.spent ?? 0) + ceiling.amount > cap) throw new JobError('BUDGET_EXCEEDED', 'Daily budget would be exceeded')
    }
    const acceptUnknownCost = payload.acceptUnknownCost === true
    await this.engine.prepareSubmit(job.jobId, ceiling)
    return { jobId: job.jobId, acceptUnknownCost }
  }

  async linkShot(payload: Record<string, unknown>, remove: boolean): Promise<{ ok: true }> {
    const ws = this.deps.resolveWorkspace(payload.workspaceId)
    const shotRef = str(payload.shotRef, 120)
    if (!shotRef) throw new InputError('shotRef is required')
    const sha256 = str(payload.sha256, 80)
    const elementId = str(payload.elementId, 200)
    if (remove) {
      const role = str(payload.role, 20)
      await removeShotMediaLink(ws.dir, { shotRef, ...(sha256 ? { sha256 } : {}), ...(elementId ? { elementId } : {}), ...(role ? { role } : {}) })
    } else {
      const role = String(payload.role ?? '')
      if (!ROLES.includes(role) || Boolean(sha256) === Boolean(elementId)) throw new InputError('role and exactly one of sha256 or elementId are required')
      const entry = {
        shotRef, role: role as ShotMediaLinkV1['role'],
        ...(sha256 ? { sha256 } : {}), ...(elementId ? { elementId } : {}),
        ...(str(payload.sceneRef, 120) ? { sceneRef: str(payload.sceneRef, 120)! } : {}),
        ...(str(payload.episodeRef, 120) ? { episodeRef: str(payload.episodeRef, 120)! } : {}),
        ...(str(payload.artifactId, 200) ? { artifactId: str(payload.artifactId, 200)! } : {}),
      }
      await addShotMediaLink(ws.dir, entry)
    }
    await this.deps.syncWorkspace(ws).catch(() => undefined)
    this.deps.bumpGeneration()
    return { ok: true }
  }

  /** Cancel all active jobs whose requester.taskId is in taskIds. One failure does not stop others. */
  async cancelJobsForTasks(taskIds: readonly string[]): Promise<string[]> {
    if (!taskIds.length) return []
    const taskIdSet = new Set(taskIds)
    const cancelledJobIds: string[] = []
    for (const job of this.engine.all()) {
      if (!job.requester?.taskId || !taskIdSet.has(job.requester.taskId)) continue
      if (!jobIsActive(job.status)) continue
      try {
        const updated = await this.engine.cancel(job.jobId)
        if (updated.status === 'cancelled') {
          cancelledJobIds.push(job.jobId)
        }
      } catch (err) {
        this.deps.logger?.('capability.cascade_cancel_failed', {
          jobRef: job.jobId,
          taskRef: job.requester.taskId,
          errorCode: err instanceof JobError ? err.code : 'CASCADE_CANCEL_FAILED',
        })
      }
    }
    return cancelledJobIds
  }

  /** Agent tools may only request; there is deliberately no agent approve path. */
  requestJobFromAgent(input: { estimateId: string; idempotencyKey: string; workspaceId?: string }): Promise<RpcEnvelope<JobRecordV1>> {
    return this.guard(() => this.request({ ...input, requestedBy: 'agent' }))
  }

  // ------------------------------------------------------------ RPC

  private async guard<T>(fn: () => Promise<T>, refs?: Record<string, unknown>): Promise<RpcEnvelope<T>> {
    try {
      return rpcOk(this.deps.generation(), await fn())
    } catch (err) {
      if (err instanceof JobError) {
        this.deps.logger?.('capability.error', {
          errorCode: err.code,
          ...(typeof refs?.jobId === 'string' ? { jobRef: refs.jobId } : {}),
        })
        return rpcFail(this.deps.generation(), err.code, err.message, { retryable: err.code === 'OWNER_STATUS_UNKNOWN' })
      }
      if (err instanceof InputError) {
        this.deps.logger?.('capability.error', {
          errorCode: 'capability/invalid_input',
          ...(typeof refs?.jobId === 'string' ? { jobRef: refs.jobId } : {}),
        })
        return rpcFail(this.deps.generation(), 'capability/invalid_input', err.message)
      }
      throw err
    }
  }

  isCapabilityAction(action: string): boolean {
    return (CAPABILITY_RPC_ACTIONS as readonly string[]).includes(action)
  }

  handle(action: string, payload: Record<string, unknown>): Promise<RpcEnvelope<unknown>> {
    return this.guard<unknown>(async () => {
      switch (action) {
        case 'capability.catalog': return this.catalog(typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined)
        case 'capability.estimate': return { estimate: await this.estimate(payload) }
        case 'job.request': return { job: await this.request(payload) }
        case 'job.approve': return { job: await this.approve(payload) }
        case 'job.cancel': return { job: await this.engine.cancel(String(payload.jobId ?? '')) }
        case 'job.list': {
          const ws = this.deps.resolveWorkspace(payload.workspaceId)
          return { jobs: this.engine.list(ws.id) }
        }
        case 'job.get': return { job: this.engine.require(String(payload.jobId ?? '')) }
        case 'job.reconcile': return { job: await this.engine.reconcile(String(payload.jobId ?? '')) }
        case 'job.slot.review': {
          if (payload.decision !== 'accept' && payload.decision !== 'reject') throw new InputError("decision must be 'accept' or 'reject'")
          return { job: await this.engine.reviewSlot(String(payload.jobId ?? ''), String(payload.slotId ?? ''), payload.decision, payload.linkToShot === true) }
        }
        case 'shot.media.link': return this.linkShot(payload, false)
        case 'shot.media.unlink': return this.linkShot(payload, true)
        case 'budget.status': return computeBudget(this.engine.all(), this.settings())
        default: throw new InputError(`Unhandled action ${action}`)
      }
    }, payload)
  }
}

export { JOB_ERROR_CODES }
