import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { addShotMediaLink, putCasBlob } from '@yeisme/muweave-bundle'
import type { CapabilityRegistry } from './capabilities/registry'
import type { AdapterContext, CapabilityInput, PollOutcome } from './capabilities/types'
import {
  JOB_ERROR_CODES,
  jobIsActive,
  type CostAmountV1,
  type JobErrorCode,
  type JobRecordV1,
  type JobSlotV1,
  type JobStatus,
  type ShotMediaLinkV1,
} from './capability-protocol'

export const JOBS_SCHEMA = 'muweave.jobs.v1'
export const MAX_JOB_RECORDS = 200
export const POLL_INTERVAL_MS = 3_000
/** Scratch request files older than this at startup are leftovers of a dead process. */
export const STALE_TMP_MS = 5 * 60 * 1000

/** Error carrying one of the stable JOB_ERROR_CODES; the RPC layer turns it into an envelope. */
export class JobError extends Error {
  constructor(readonly code: JobErrorCode, message: string) {
    super(message)
  }
}

export function nextActionOf(status: JobStatus): JobRecordV1['nextAction'] {
  if (status === 'waiting_approval') return 'approve'
  if (status === 'queued' || status === 'running') return 'wait'
  if (status === 'waiting_for_human') return 'review'
  if (status === 'reconcile_required') return 'reconcile'
  return 'none'
}

const TERMINAL_SLOT = new Set(['done', 'failed', 'skipped'])
const ROLE_BY_KIND: Record<string, ShotMediaLinkV1['role']> = {
  image: 'keyframe', video: 'video', voice: 'voice', music: 'music', sfx: 'sfx',
}

function validJob(raw: unknown): JobRecordV1 | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Partial<JobRecordV1>
  if (typeof r.jobId !== 'string' || typeof r.status !== 'string' || typeof r.capabilityId !== 'string') return undefined
  if (typeof r.idempotencyKey !== 'string' || !Array.isArray(r.slots)) return undefined
  return r as JobRecordV1
}

export interface JobEngineDeps {
  /** Absolute path of jobs.v1.json inside pluginDataDir. */
  file: string
  registry: CapabilityRegistry
  adapterContext(workspaceId: string): AdapterContext
  workspaceDir(workspaceId: string): string
  onChange(): void
  /** Called after a slot review so the bundle picks up the new link, like other host writes. */
  afterReview(workspaceId: string): Promise<void>
  pollIntervalMs?: number
}

interface PendingInput {
  input: CapabilityInput
  expiresAtMs: number
}

export class JobEngine {
  private readonly jobs = new Map<string, JobRecordV1>()
  /** Prompts live here only (memory) until submit; they are never part of a record. */
  private readonly pending = new Map<string, PendingInput>()
  private readonly tails = new Map<string, Promise<void>>()
  private persistTail: Promise<void> = Promise.resolve()
  private timer?: ReturnType<typeof setInterval>
  private ticking = false
  private disposed = false
  /** Set when jobs.v1.json was unreadable; the original is renamed aside and paid approval stays off. */
  corruptFile?: string

  constructor(private readonly deps: JobEngineDeps) {
    this.loadSync()
    this.startupCleanup()
  }

  /** Stale scratch request files and owner output dirs of finished or unknown jobs are removed. */
  private startupCleanup(): void {
    const base = path.dirname(this.deps.file)
    const tmp = path.join(base, 'tmp-requests')
    try {
      for (const name of readdirSync(tmp)) {
        const full = path.join(tmp, name)
        try {
          if (Date.now() - statSync(full).mtimeMs > STALE_TMP_MS) rmSync(full, { recursive: true, force: true })
        } catch { /* best effort */ }
      }
    } catch { /* no scratch dir */ }
    const out = path.join(base, 'owner-out')
    const live = new Set<string>()
    for (const job of this.jobs.values()) {
      if (job.ownerJobRef && job.status !== 'completed' && job.status !== 'cancelled' && job.status !== 'failed') live.add(job.ownerJobRef)
    }
    try {
      for (const name of readdirSync(out)) {
        if (!live.has(name)) rmSync(path.join(out, name), { recursive: true, force: true })
      }
    } catch { /* no output root */ }
  }

  // ---------------------------------------------------------------- persistence

  private loadSync(): void {
    if (!existsSync(this.deps.file)) return
    let changed = false
    try {
      const parsed = JSON.parse(readFileSync(this.deps.file, 'utf8')) as { jobs?: unknown[] }
      for (const raw of parsed.jobs ?? []) {
        const job = validJob(raw)
        if (!job) continue
        // A process that died mid-flight cannot know the owner outcome: reconcile, never resubmit.
        // Prompts live in memory only: an estimate that survived a restart has no input left to submit.
        if (job.status === 'waiting_approval') {
          job.status = 'failed'
          job.errorCode = 'ESTIMATE_EXPIRED'
          job.nextAction = 'none'
          for (const slot of job.slots) slot.status = 'failed'
          job.updatedAt = new Date().toISOString()
          changed = true
        } else if (job.status === 'queued' || job.status === 'running') {
          job.status = 'reconcile_required'
          job.nextAction = 'reconcile'
          job.updatedAt = new Date().toISOString()
          changed = true
        }
        this.jobs.set(job.jobId, job)
      }
    } catch {
      this.jobs.clear()
      const aside = path.join(path.dirname(this.deps.file), `jobs.v1.corrupt-${Date.now()}.json`)
      try {
        renameSync(this.deps.file, aside)
        this.corruptFile = aside
      } catch {
        this.corruptFile = this.deps.file
      }
      return
    }
    if (changed) {
      const tmp = `${this.deps.file}.tmp.${process.pid}`
      writeFileSync(tmp, this.serialize(), { mode: 0o600 })
      renameSync(tmp, this.deps.file)
    }
  }

  private serialize(): string {
    return JSON.stringify({ schema: JOBS_SCHEMA, jobs: this.trimmed() })
  }

  /** Keep every active record; drop the oldest terminal ones past the cap. */
  private trimmed(): JobRecordV1[] {
    const all = [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    let excess = all.length - MAX_JOB_RECORDS
    const dropped = new Set<string>()
    for (const job of all) {
      if (excess <= 0) break
      if (!jobIsActive(job.status) && job.status !== 'waiting_for_human') {
        dropped.add(job.jobId)
        excess -= 1
      }
    }
    for (const id of dropped) this.jobs.delete(id)
    return all.filter((j) => !dropped.has(j.jobId))
  }

  private persist(): Promise<void> {
    const body = this.serialize()
    // Writes stay serialized, but a failure must reach the caller: approve aborts before the owner call.
    const run = this.persistTail.then(async () => {
      await mkdir(path.dirname(this.deps.file), { recursive: true })
      const tmp = `${this.deps.file}.tmp.${process.pid}`
      await writeFile(tmp, body, { mode: 0o600 })
      await rename(tmp, this.deps.file)
    })
    this.persistTail = run.catch(() => undefined)
    return run
  }

  private withJob<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.tails.get(jobId) ?? Promise.resolve()).then(fn)
    this.tails.set(jobId, run.then(() => undefined, () => undefined))
    return run
  }

  private touch(job: JobRecordV1, status?: JobStatus): void {
    if (status) job.status = status
    job.nextAction = nextActionOf(job.status)
    job.updatedAt = new Date().toISOString()
  }

  private async commit(): Promise<void> {
    await this.persist()
    this.deps.onChange()
    this.refreshPoller()
  }

  // ---------------------------------------------------------------- queries

  list(workspaceId?: string): JobRecordV1[] {
    return [...this.jobs.values()]
      .filter((j) => !workspaceId || j.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(jobId: string): JobRecordV1 | undefined {
    return this.jobs.get(jobId)
  }

  require(jobId: string): JobRecordV1 {
    const job = this.jobs.get(jobId)
    if (!job) throw new JobError('JOB_NOT_FOUND', 'Job does not exist')
    return job
  }

  findByIdempotencyKey(workspaceId: string, key: string): JobRecordV1 | undefined {
    return this.list(workspaceId).find((j) => j.idempotencyKey === key)
  }

  inputFor(jobId: string): CapabilityInput | undefined {
    const hit = this.pending.get(jobId)
    if (!hit || hit.expiresAtMs < Date.now()) return undefined
    return hit.input
  }

  // ---------------------------------------------------------------- lifecycle

  async create(job: JobRecordV1, input: CapabilityInput, expiresAtMs: number): Promise<JobRecordV1> {
    this.jobs.set(job.jobId, job)
    this.pending.set(job.jobId, { input, expiresAtMs })
    await this.commit()
    return job
  }

  /**
   * Phase 1 of approval: write the intent (queued + ceiling) before the owner is contacted. If the write
   * fails the in-memory change is rolled back and the owner is never called.
   */
  async prepareSubmit(jobId: string, ceiling: CostAmountV1): Promise<void> {
    await this.withJob(jobId, async () => {
      const job = this.require(jobId)
      if (job.status !== 'waiting_approval') throw new JobError('APPROVAL_REQUIRED', 'Job is not waiting for approval')
      if (!this.inputFor(jobId)) throw new JobError('ESTIMATE_EXPIRED', 'The estimate expired; request a new one')
      if (!this.deps.registry.find(job.capabilityId)) throw new JobError('CAPABILITY_UNAVAILABLE', 'Capability is not registered')
      job.approvedCeiling = ceiling
      job.approvedAt = new Date().toISOString()
      this.touch(job, 'queued')
      try {
        await this.persist()
      } catch {
        delete job.approvedCeiling
        delete job.approvedAt
        this.touch(job, 'waiting_approval')
        throw new JobError('OWNER_SUBMIT_FAILED', 'Could not persist the approval; nothing was sent to the owner')
      }
      this.deps.onChange()
    })
  }

  /** Phase 2: the owner call. Preconditions (paid switch, ceiling, budget) were enforced before prepareSubmit. */
  async runSubmit(jobId: string, acceptUnknownCost: boolean): Promise<JobRecordV1> {
    return this.withJob(jobId, async () => {
      const job = this.require(jobId)
      const ceiling = job.approvedCeiling
      const input = this.inputFor(jobId)
      const adapter = this.deps.registry.find(job.capabilityId)
      if (job.status !== 'queued' || !ceiling || job.ownerJobRef) throw new JobError('APPROVAL_REQUIRED', 'Job is not waiting for approval')
      let outcome: Awaited<ReturnType<NonNullable<typeof adapter>['submit']>> = { outcome: 'ambiguous' }
      if (input && adapter) {
        try {
          outcome = await adapter.submit(this.deps.adapterContext(job.workspaceId), {
            jobId, idempotencyKey: job.idempotencyKey, input, slots: job.slots.length, ceiling, acceptUnknownCost,
          })
        } catch {
          outcome = { outcome: 'ambiguous' }
        }
      }
      this.pending.delete(jobId)
      if (outcome.ownerJobRef) job.ownerJobRef = outcome.ownerJobRef
      if (outcome.outcome === 'submitted') {
        for (const slot of job.slots) slot.status = 'running'
        this.touch(job, 'running')
      } else if (outcome.outcome === 'ambiguous') {
        job.errorCode = 'OWNER_STATUS_UNKNOWN'
        this.touch(job, 'reconcile_required')
      } else {
        job.errorCode = 'OWNER_SUBMIT_FAILED'
        for (const slot of job.slots) slot.status = 'failed'
        this.touch(job, 'failed')
      }
      await this.commit()
      return job
    })
  }

  async cancel(jobId: string): Promise<JobRecordV1> {
    return this.withJob(jobId, async () => {
      const job = this.require(jobId)
      const adapter = this.deps.registry.find(job.capabilityId)
      if (job.status === 'waiting_approval') {
        this.pending.delete(jobId)
        this.touch(job, 'cancelled')
      } else if ((job.status === 'queued' || job.status === 'running') && job.ownerJobRef) {
        const ok = adapter?.cancel ? await adapter.cancel(this.deps.adapterContext(job.workspaceId), job.ownerJobRef) : false
        if (!ok) throw new JobError('CAPABILITY_UNAVAILABLE', 'Owner does not support cancelling this job')
        this.touch(job, 'cancelled')
      } else if (job.status === 'reconcile_required') {
        // Explicit abandon path: try the owner first; if there is no ref or the owner cannot cancel, give up
        // locally. The spend stays unknown (and committed in the budget) because the owner may have billed.
        let ok = false
        if (job.ownerJobRef && adapter?.cancel) {
          try {
            ok = await adapter.cancel(this.deps.adapterContext(job.workspaceId), job.ownerJobRef)
          } catch {
            ok = false
          }
        }
        if (!ok) job.errorCode = 'SPEND_UNKNOWN'
        else delete job.errorCode
        this.touch(job, 'cancelled')
      } else {
        throw new JobError('CAPABILITY_UNAVAILABLE', 'Job cannot be cancelled in its current state')
      }
      await this.commit()
      return job
    })
  }

  // ---------------------------------------------------------------- polling and reconcile

  private async applyPoll(job: JobRecordV1, out: PollOutcome): Promise<void> {
    if (out.actualCost) job.actualCost = out.actualCost
    for (const update of out.slots) {
      const slot: JobSlotV1 | undefined = job.slots[update.index]
      if (!slot || TERMINAL_SLOT.has(slot.status)) continue
      if (update.ownerRef) slot.ownerRef = update.ownerRef
      if (update.label) slot.label = update.label.slice(0, 40)
      slot.status = update.status
      if (update.status === 'failed') slot.errorCode = update.errorCode ?? 'OWNER_STATUS_UNKNOWN'
      if (update.status !== 'done') continue
      slot.mime = update.mime
      if (update.bytes) {
        try {
          const blob = await putCasBlob(this.deps.workspaceDir(job.workspaceId), update.bytes, update.mime ?? 'application/octet-stream', 'candidate')
          slot.sha256 = blob.blobDigest
          slot.mime = blob.mimeType
        } catch {
          slot.status = 'failed'
          slot.errorCode = 'OWNER_STATUS_UNKNOWN'
        }
      } else if (update.sha256) {
        slot.sha256 = update.sha256
      }
    }
    if (out.state === 'running') {
      if (job.status === 'reconcile_required') delete job.errorCode
      this.touch(job, 'running')
    } else if (out.state === 'done' || out.state === 'failed') {
      for (const slot of job.slots) {
        if (TERMINAL_SLOT.has(slot.status)) continue
        slot.status = out.state === 'done' ? 'skipped' : 'failed'
        if (out.state === 'failed') slot.errorCode = 'OWNER_SUBMIT_FAILED'
      }
      if (job.slots.some((s) => s.status === 'done')) {
        delete job.errorCode
        this.touch(job, 'waiting_for_human')
      } else {
        job.errorCode = 'OWNER_SUBMIT_FAILED'
        this.touch(job, 'failed')
      }
    } else if (job.status === 'reconcile_required') {
      job.errorCode = 'OWNER_STATUS_UNKNOWN'
      this.touch(job)
    }
  }

  /** One status query against the owner; never submits. */
  private async pollJob(jobId: string): Promise<void> {
    await this.withJob(jobId, async () => {
      const job = this.jobs.get(jobId)
      if (!job || !(job.status === 'queued' || job.status === 'running' || job.status === 'reconcile_required')) return
      const adapter = this.deps.registry.find(job.capabilityId)
      if (!job.ownerJobRef || !adapter) {
        job.errorCode = 'OWNER_STATUS_UNKNOWN'
        this.touch(job)
        return this.commit()
      }
      let out: PollOutcome
      try {
        out = await adapter.poll(this.deps.adapterContext(job.workspaceId), job.ownerJobRef, job.slots.length)
      } catch {
        out = { state: 'unknown', slots: [] }
      }
      await this.applyPoll(job, out)
      await this.commit()
    })
  }

  async reconcile(jobId: string): Promise<JobRecordV1> {
    const job = this.require(jobId)
    if (job.status !== 'reconcile_required') throw new JobError('OWNER_STATUS_UNKNOWN', 'Job does not need reconciling')
    await this.pollJob(jobId)
    return this.require(jobId)
  }

  private hasPollable(): boolean {
    return [...this.jobs.values()].some((j) => (j.status === 'queued' || j.status === 'running' || j.status === 'reconcile_required') && j.ownerJobRef)
  }

  /** The 3 s timer exists only while a submitted job is in flight; it never keeps the process alive. */
  refreshPoller(): void {
    if (this.disposed) return
    if (this.hasPollable() && !this.timer) {
      this.timer = setInterval(() => void this.tick(), this.deps.pollIntervalMs ?? POLL_INTERVAL_MS)
      this.timer.unref?.()
    } else if (!this.hasPollable() && this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  pollerActive(): boolean {
    return this.timer !== undefined
  }

  async tick(): Promise<void> {
    if (this.ticking || this.disposed) return
    this.ticking = true
    try {
      for (const job of [...this.jobs.values()]) {
        if ((job.status === 'queued' || job.status === 'running' || job.status === 'reconcile_required') && job.ownerJobRef) {
          // reconcile_required jobs are polled too: status only, never a submit.
          await this.pollJob(job.jobId).catch(() => undefined)
        }
      }
    } finally {
      this.ticking = false
      this.refreshPoller()
    }
  }

  // ---------------------------------------------------------------- slot review

  async reviewSlot(jobId: string, slotId: string, decision: 'accept' | 'reject', linkToShot: boolean): Promise<JobRecordV1> {
    const result = await this.withJob(jobId, async () => {
      const job = this.require(jobId)
      const slot = job.slots.find((s) => s.slotId === slotId)
      // Already reviewed: return the current state, never call the owner a second time.
      if (slot && slot.status === 'done' && slot.review !== 'unreviewed') return job
      if (!slot || slot.status !== 'done' || job.status !== 'waiting_for_human') {
        throw new JobError('SLOT_NOT_READY', 'Slot has no finished output to review')
      }
      // Owner call and link first; the slot is only mutated once both succeeded, then persisted once.
      const adapter = this.deps.registry.find(job.capabilityId)
      if (adapter?.review && job.ownerJobRef) {
        const ok = await adapter.review(this.deps.adapterContext(job.workspaceId), {
          ownerJobRef: job.ownerJobRef, slotOwnerRef: slot.ownerRef, decision,
        })
        if (!ok) throw new JobError('OWNER_SUBMIT_FAILED', 'Owner did not record the review decision')
      }
      const shotRef = job.anchor?.shotRef
      if (decision === 'accept' && linkToShot && shotRef && slot.sha256) {
        await addShotMediaLink(this.deps.workspaceDir(job.workspaceId), {
          shotRef,
          ...(job.anchor?.sceneRef ? { sceneRef: job.anchor.sceneRef } : {}),
          ...(job.anchor?.episodeRef ? { episodeRef: job.anchor.episodeRef } : {}),
          sha256: slot.sha256,
          ...(slot.ownerRef ? { artifactId: slot.ownerRef } : {}),
          role: ROLE_BY_KIND[job.kind] ?? 'reference',
          ...(slot.mime ? { mime: slot.mime } : {}),
          jobId: job.jobId,
          linkedAt: new Date().toISOString(),
        })
      }
      const prevStatus = job.status
      slot.review = decision === 'accept' ? 'accepted' : 'rejected'
      if (job.slots.every((s) => s.status !== 'done' || s.review !== 'unreviewed')) this.touch(job, 'completed')
      else this.touch(job)
      try {
        await this.commit()
      } catch (err) {
        slot.review = 'unreviewed'
        this.touch(job, prevStatus)
        throw err
      }
      return job
    })
    await this.deps.afterReview(result.workspaceId).catch(() => undefined)
    return result
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}

export { JOB_ERROR_CODES }
