import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CliRunner } from '@yeisme/muweave-bundle'
import { CreatorHostService, type JobRecordV1 } from '@yeisme/dsh-muweave-core'

const PROMPT = 'secret-ish rooftop prompt about a heist gone wrong'
const dirs: string[] = []
const services: CreatorHostService[] = []
afterEach(async () => {
  for (const s of services.splice(0)) s.dispose()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

type Mode = 'ok' | 'timeout' | 'timedOut-flag'

async function boot(dir: string, calls: string[][], mode: Mode = 'ok'): Promise<CreatorHostService> {
  const runner: CliRunner = async (bin, args) => {
    const a = [...args]
    if (a[0] === '--version') return { exitCode: 0, stdout: 'v', stderr: '' }
    calls.push(a)
    if (a[0] === 'generate' && a.includes('--dry-run')) return { exitCode: 0, stdout: JSON.stringify({ data: { estimated_usd: 0.2 } }), stderr: '' }
    if (a[0] === 'generate') {
      if (mode === 'timeout') return { exitCode: 124, stdout: '', stderr: '' }
      if (mode === 'timedOut-flag') return { exitCode: 1, stdout: '', stderr: '', timedOut: true } as never
      return { exitCode: 0, stdout: JSON.stringify({ data: { run_id: a[a.indexOf('--run-id') + 1] } }), stderr: '' }
    }
    if (a[0] === 'status') return { exitCode: 0, stdout: JSON.stringify({ data: { status: 'running' } }), stderr: '' }
    return { exitCode: 1, stdout: '', stderr: '' }
  }
  const svc = new CreatorHostService({ defaultWorkspaceDir: dir, pluginDataDir: path.join(dir, 'plugin-data'), runner })
  services.push(svc)
  return svc
}

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'muweave-jobs-'))
  dirs.push(dir)
  await mkdir(path.join(dir, 'plugin-data'), { recursive: true })
  await writeFile(path.join(dir, 'plugin-data', 'settings.v1.json'), JSON.stringify({ paidEnabled: true }))
  return dir
}

async function submitJob(svc: CreatorHostService, key: string): Promise<JobRecordV1> {
  const est = await svc.handleRpcAction('capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: PROMPT }, slots: 1 })
  const id = (est as { data: { estimate: { estimateId: string } } }).data.estimate.estimateId
  const req = await svc.handleRpcAction('job.request', { estimateId: id, idempotencyKey: key, requestedBy: 'agent' })
  const job = (req as { data: { job: JobRecordV1 } }).data.job
  const ap = await svc.handleRpcAction('job.approve', { jobId: job.jobId, ceiling: { unit: 'usd', amount: 0.3 } })
  return (ap as { data: { job: JobRecordV1 } }).data.job
}

describe('job store, state machine and reconcile', () => {
  it('persists 0600 without prompt text, returns to reconcile_required on restart and only polls status', async () => {
    const dir = await workspace()
    const calls: string[][] = []
    const svc = await boot(dir, calls)
    const job = await submitJob(svc, 'k-restart')
    expect(job.status).toBe('running')
    const engineOf = (x: CreatorHostService) => (x as unknown as { capabilities: { engine: { pollerActive(): boolean } } }).capabilities.engine
    expect(engineOf(svc).pollerActive()).toBe(true)
    expect(job.requestedBy).toBe('agent')
    const file = path.join(dir, 'plugin-data', 'jobs.v1.json')
    expect(((await stat(file)).mode & 0o777)).toBe(0o600)
    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain(PROMPT)
    expect(raw).not.toContain(dir)
    expect(raw).toContain(job.promptDigest)
    svc.dispose()

    const calls2: string[][] = []
    const svc2 = await boot(dir, calls2)
    expect(engineOf(svc2).pollerActive()).toBe(false)
    const listed = await svc2.handleRpcAction('job.list', {})
    const [restored] = (listed as { data: { jobs: JobRecordV1[] } }).data.jobs
    expect(restored!.status).toBe('reconcile_required')
    expect(restored!.nextAction).toBe('reconcile')
    const rec = await svc2.handleRpcAction('job.reconcile', { jobId: job.jobId })
    expect(rec.ok).toBe(true)
    expect((rec as { data: { job: JobRecordV1 } }).data.job.status).toBe('running')
    expect(calls2.map((c) => c[0])).toEqual(['status'])
    expect(calls2.some((c) => c[0] === 'generate')).toBe(false)
  })

  it.each<Mode>(['timeout', 'timedOut-flag'])('ambiguous submit (%s) goes to reconcile_required with the run id kept', async (mode) => {
    const dir = await workspace()
    const calls: string[][] = []
    const svc = await boot(dir, calls, mode)
    const job = await submitJob(svc, `k-${mode}`)
    expect(job.status).toBe('reconcile_required')
    expect(job.ownerJobRef).toMatch(/^dsh-/)
    expect(calls.filter((c) => c[0] === 'generate' && !c.includes('--dry-run'))).toHaveLength(1)
  })

  it('replays the same idempotency key to the same job and flags a different payload', async () => {
    const dir = await workspace()
    const svc = await boot(dir, [])
    const est = await svc.handleRpcAction('capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: PROMPT }, slots: 1 })
    const id = (est as { data: { estimate: { estimateId: string } } }).data.estimate.estimateId
    const a = await svc.handleRpcAction('job.request', { estimateId: id, idempotencyKey: 'same', requestedBy: 'ui' })
    const b = await svc.handleRpcAction('job.request', { estimateId: id, idempotencyKey: 'same', requestedBy: 'ui' })
    expect((a as { data: { job: JobRecordV1 } }).data.job.jobId).toBe((b as { data: { job: JobRecordV1 } }).data.job.jobId)
    const est2 = await svc.handleRpcAction('capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: 'something else' }, slots: 1 })
    const id2 = (est2 as { data: { estimate: { estimateId: string } } }).data.estimate.estimateId
    const c = await svc.handleRpcAction('job.request', { estimateId: id2, idempotencyKey: 'same', requestedBy: 'ui' })
    expect(c.ok ? '' : c.error.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('rechecks the persisted digest after restart and never silently replays an old job', async () => {
    const dir = await workspace()
    const svc = await boot(dir, [])
    const first = await requestJob(svc, 'restart-digest', {}, PROMPT)
    svc.dispose()
    const svc2 = await boot(dir, [])
    const changed = await svc2.handleRpcAction('capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: 'changed after restart' }, slots: 1 })
    const conflict = await svc2.handleRpcAction('job.request', { estimateId: (changed as any).data.estimate.estimateId, idempotencyKey: 'restart-digest', requestedBy: 'ui' })
    expect(conflict.ok ? '' : conflict.error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect((conflict as any).data?.job?.jobId).not.toBe(first.jobId)
  })

  it('replays same key and same estimate digest after restart', async () => {
    const dir = await workspace()
    const svc = await boot(dir, [])
    const estimate = await svc.handleRpcAction('capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: PROMPT }, slots: 1 })
    const estimateId = (estimate as any).data.estimate.estimateId
    const first = await svc.handleRpcAction('job.request', { estimateId, idempotencyKey: 'restart-same', requestedBy: 'ui' })
    const firstJob = (first as any).data.job
    svc.dispose()
    const svc2 = await boot(dir, [])
    const replay = await svc2.handleRpcAction('job.request', { estimateId, idempotencyKey: 'restart-same', requestedBy: 'ui' })
    expect(replay.ok).toBe(true)
    expect((replay as any).data.job.jobId).toBe(firstJob.jobId)
  })

  it('keeps trimmed terminal jobs addressable and included in committed budget', async () => {
    const dir = await workspace()
    const svc = await bootWith(dir, okSubmit)
    const first = await requestJob(svc, 'trim-budget')
    const approved = await approve(svc, first.jobId)
    expect(approved.ok).toBe(true)
    const engine = engineOf(svc)
    engine.require(first.jobId).status = 'cancelled'
    await engine.persist()
    for (let i = 0; i < 205; i += 1) {
      const job = await requestJob(svc, `trim-${i}`, {}, `prompt-${i}`)
      await rpcOf(svc, 'job.cancel', { jobId: job.jobId })
    }
    const replayEstimate = await rpcOf(svc, 'capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: PROMPT }, slots: 1 })
    const replay = await rpcOf(svc, 'job.request', { estimateId: replayEstimate.data.estimate.estimateId, idempotencyKey: 'trim-budget', requestedBy: 'ui' })
    expect(replay.ok).toBe(true)
    expect(replay.data.job.jobId).toBe(first.jobId)
    const budget = await rpcOf(svc, 'budget.status', {})
    expect(budget.data.lines.find((line: any) => line.unit === 'usd').committed).toBeCloseTo(0.3)
  })

  it('cancels waiting_approval directly and refuses owners without cancel support', async () => {
    const dir = await workspace()
    const svc = await boot(dir, [])
    const est = await svc.handleRpcAction('capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: PROMPT }, slots: 1 })
    const id = (est as { data: { estimate: { estimateId: string } } }).data.estimate.estimateId
    const req = await svc.handleRpcAction('job.request', { estimateId: id, idempotencyKey: 'c1', requestedBy: 'ui' })
    const jobId = (req as { data: { job: JobRecordV1 } }).data.job.jobId
    const out = await svc.handleRpcAction('job.cancel', { jobId })
    expect((out as { data: { job: JobRecordV1 } }).data.job.status).toBe('cancelled')
    const missing = await svc.handleRpcAction('job.get', { jobId: 'nope' })
    expect(missing.ok ? '' : missing.error.code).toBe('JOB_NOT_FOUND')
  })
})

type Rpc = { ok: boolean; data?: any; error?: { code: string } }
const rpcOf = async (svc: CreatorHostService, action: string, payload: Record<string, unknown>): Promise<Rpc> => svc.handleRpcAction(action, payload) as unknown as Rpc

async function bootWith(dir: string, handler: (a: string[]) => { exitCode: number; stdout: string; stderr: string; timedOut?: boolean }): Promise<CreatorHostService> {
  const runner: CliRunner = async (_bin, args) => {
    const a = [...args]
    if (a[0] === '--version') return { exitCode: 0, stdout: 'v', stderr: '' }
    if (a[0] === 'generate' && a.includes('--dry-run')) return { exitCode: 0, stdout: JSON.stringify({ data: { estimated_usd: 0.2 } }), stderr: '' }
    return handler(a) as never
  }
  const svc = new CreatorHostService({ defaultWorkspaceDir: dir, pluginDataDir: path.join(dir, 'plugin-data'), runner })
  services.push(svc)
  return svc
}

const okSubmit = (a: string[]) => ({ exitCode: 0, stdout: JSON.stringify({ data: { run_id: a[a.indexOf('--run-id') + 1] } }), stderr: '' })
const engineOf = (x: CreatorHostService) => (x as unknown as { capabilities: { engine: any } }).capabilities.engine

async function requestJob(svc: CreatorHostService, key: string, extra: Record<string, unknown> = {}, prompt = PROMPT): Promise<JobRecordV1> {
  const est = await rpcOf(svc, 'capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt }, slots: 1, ...extra })
  const r = await rpcOf(svc, 'job.request', { estimateId: est.data.estimate.estimateId, idempotencyKey: key, requestedBy: 'ui' })
  return r.data.job
}
const approve = (svc: CreatorHostService, jobId: string, amount = 0.3) => rpcOf(svc, 'job.approve', { jobId, ceiling: { unit: 'usd', amount } })

describe('creator-platform review fixes', () => {
  it('reconcile_required without ownerJobRef or with an owner that cannot cancel can be abandoned as SPEND_UNKNOWN', async () => {
    const dir = await workspace()
    const svc = await bootWith(dir, () => ({ exitCode: 1, stdout: '', stderr: '', timedOut: true }))
    const job = await requestJob(svc, 'ab-1')
    const ap = await approve(svc, job.jobId)
    expect(ap.data.job.status).toBe('reconcile_required')
    delete engineOf(svc).require(job.jobId).ownerJobRef
    const out = await rpcOf(svc, 'job.cancel', { jobId: job.jobId })
    expect(out.data.job.status).toBe('cancelled')
    expect(out.data.job.errorCode).toBe('SPEND_UNKNOWN')
    const budget = await rpcOf(svc, 'budget.status', {})
    expect(budget.data.lines.find((l: any) => l.unit === 'usd').committed).toBeCloseTo(0.3)
    expect(budget.data.unknownCostJobs).toBe(1)
  })

  it('the poller also polls reconcile_required jobs that have an ownerJobRef, status only', async () => {
    const dir = await workspace()
    const calls: string[][] = []
    let mode: 'ambiguous' | 'running' = 'ambiguous'
    const svc = await bootWith(dir, (a) => {
      calls.push(a)
      if (a[0] === 'generate') return { exitCode: 7, stdout: '', stderr: 'boom' }
      return mode === 'running' ? { exitCode: 0, stdout: JSON.stringify({ data: { status: 'running' } }), stderr: '' } : { exitCode: 1, stdout: '', stderr: '' }
    })
    const job = await requestJob(svc, 'poll-rec')
    const ap = await approve(svc, job.jobId)
    // any non-zero exit after submit is ambiguous with the derived run id
    expect(ap.data.job.status).toBe('reconcile_required')
    expect(ap.data.job.ownerJobRef).toMatch(/^dsh-/)
    expect(engineOf(svc).pollerActive()).toBe(true)
    mode = 'running'
    await engineOf(svc).tick()
    expect(engineOf(svc).require(job.jobId).status).toBe('running')
    expect(calls.filter((c) => c[0] === 'generate' && !c.includes('--dry-run'))).toHaveLength(1)
  })

  it('startup cleanup removes stale tmp-requests, finished/unknown owner-out dirs and expires lost waiting_approval jobs', async () => {
    const dir = await workspace()
    const svc = await bootWith(dir, okSubmit)
    const done = await requestJob(svc, 'cl-1')
    await approve(svc, done.jobId)
    const waiting = await requestJob(svc, 'cl-2', {}, 'another prompt')
    const eng = engineOf(svc)
    eng.require(done.jobId).status = 'failed'
    await eng.persist()
    svc.dispose()
    const data = path.join(dir, 'plugin-data')
    await mkdir(path.join(data, 'tmp-requests'), { recursive: true })
    await writeFile(path.join(data, 'tmp-requests', 'stale.txt'), 'x')
    await writeFile(path.join(data, 'tmp-requests', 'fresh.txt'), 'x')
    const old = new Date(Date.now() - 3_600_000)
    await utimes(path.join(data, 'tmp-requests', 'stale.txt'), old, old)
    const ref = eng.require(done.jobId).ownerJobRef as string
    await mkdir(path.join(data, 'owner-out', ref), { recursive: true })
    await mkdir(path.join(data, 'owner-out', 'dsh-orphan'), { recursive: true })
    const svc2 = await bootWith(dir, okSubmit)
    expect(await readdir(path.join(data, 'tmp-requests'))).toEqual(['fresh.txt'])
    expect(await readdir(path.join(data, 'owner-out'))).toEqual([])
    const lost = engineOf(svc2).require(waiting.jobId)
    expect(lost.status).toBe('failed')
    expect(lost.errorCode).toBe('ESTIMATE_EXPIRED')
  })

  it('counts every job that reached the owner in committed, whatever its status, and enforces dailyCap with a mutex', async () => {
    const dir = await workspace()
    await writeFile(path.join(dir, 'plugin-data', 'settings.v1.json'), JSON.stringify({ paidEnabled: true, dailyCap: { usd: 0.5 } }))
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const svc = await bootWith(dir, (a) => (a[0] === 'generate' ? okSubmit(a) : { exitCode: 0, stdout: JSON.stringify({ data: { status: 'running' } }), stderr: '' }))
    const a = await requestJob(svc, 'bud-a')
    const b = await requestJob(svc, 'bud-b', {}, 'second')
    const [ra, rb] = await Promise.all([approve(svc, a.jobId, 0.3), approve(svc, b.jobId, 0.3)])
    release(); await gate
    expect([ra.ok, rb.ok].sort()).toEqual([false, true])
    expect((ra.error ?? rb.error)?.code).toBe('BUDGET_EXCEEDED')
    engineOf(svc).require(ra.ok ? a.jobId : b.jobId).status = 'failed'
    const budget = await rpcOf(svc, 'budget.status', {})
    expect(budget.data.lines.find((l: any) => l.unit === 'usd').committed).toBeCloseTo(0.3)
    expect(budget.data.unknownCostJobs).toBe(1)
  })

  it('does not hold budget for a definite submit rejection without an owner ref', async () => {
    const dir = await workspace()
    await writeFile(path.join(dir, 'plugin-data', 'settings.v1.json'), JSON.stringify({ paidEnabled: true }))
    const svc = await bootWith(dir, okSubmit)
    const job = await requestJob(svc, 'rej-1')
    const r = await approve(svc, job.jobId, 0.3)
    expect(r.ok).toBe(true)
    const rec = engineOf(svc).require(job.jobId)
    rec.status = 'failed'; rec.errorCode = 'OWNER_SUBMIT_FAILED'; delete rec.ownerJobRef
    const budget = await rpcOf(svc, 'budget.status', {})
    expect(budget.data.lines.find((l: any) => l.unit === 'usd').committed).toBe(0)
    expect(budget.data.unknownCostJobs).toBe(0)
  })

  it('never puts the prompt into the persisted title', async () => {
    const dir = await workspace()
    const svc = await bootWith(dir, okSubmit)
    const job = await requestJob(svc, 'title-1', { anchor: { shotRef: 'shot-12' } }, '雨夜回眸')
    expect(job.title).toContain('shot-12')
    const raw = await readFile(path.join(dir, 'plugin-data', 'jobs.v1.json'), 'utf8')
    expect(raw).not.toContain('雨夜回眸')
    expect(JSON.stringify(job)).not.toContain('雨夜回眸')
  })

  it('rejects invalid anchors at estimate time', async () => {
    const dir = await workspace()
    const svc = await bootWith(dir, okSubmit)
    const bad = await rpcOf(svc, 'capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: 'x' }, anchor: { shotRef: '../etc/passwd' } })
    expect(bad.ok).toBe(false)
    expect(bad.error?.code).toBe('capability/invalid_input')
  })

  it('job.approve needs sec-fetch-site: same-origin through the fetch handler', async () => {
    const dir = await workspace()
    const svc = await bootWith(dir, okSubmit)
    const job = await requestJob(svc, 'origin-1')
    const rpc = svc.createRpcFetchHandler()
    const body = JSON.stringify({ action: 'job.approve', payload: { jobId: job.jobId, ceiling: { unit: 'usd', amount: 0.3 } } })
    for (const site of [null, 'none']) {
      const res = await rpc({ method: 'POST', headers: { get: (k) => (k === 'sec-fetch-site' ? site : null) }, text: async () => body })
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('APPROVAL_REQUIRED')
    }
    expect(engineOf(svc).require(job.jobId).status).toBe('waiting_approval')
    const ok = await rpc({ method: 'POST', headers: { get: (k) => (k === 'sec-fetch-site' ? 'same-origin' : null) }, text: async () => body })
    expect((await ok.json()).ok).toBe(true)
  })

  it('does not call the owner when the intent write fails, and a corrupt jobs file disables approve', async () => {
    const dir = await workspace()
    const calls: string[][] = []
    const svc = await bootWith(dir, (a) => { calls.push(a); return okSubmit(a) })
    const job = await requestJob(svc, 'persist-1')
    const eng = engineOf(svc)
    const real = eng.persist.bind(eng)
    eng.persist = async () => { throw new Error('disk full') }
    const ap = await approve(svc, job.jobId)
    expect(ap.ok).toBe(false)
    expect(calls.some((c) => c[0] === 'generate' && !c.includes('--dry-run'))).toBe(false)
    expect(eng.require(job.jobId).status).toBe('waiting_approval')
    eng.persist = real
    svc.dispose()
    await writeFile(path.join(dir, 'plugin-data', 'jobs.v1.json'), '{ not json')
    const svc2 = await bootWith(dir, okSubmit)
    expect((await readdir(path.join(dir, 'plugin-data'))).some((f) => /^jobs\.v1\.corrupt-\d+\.json$/.test(f))).toBe(true)
    const j2 = await requestJob(svc2, 'persist-2')
    const ap2 = await approve(svc2, j2.jobId)
    expect(ap2.error?.code).toBe('PAID_DISABLED')
  })

  it('eikona slots without artifact_id fail with OWNER_STATUS_UNKNOWN and the job reaches failed', async () => {
    const dir = await workspace()
    const calls: string[][] = []
    const svc = await bootWith(dir, (a) => {
      calls.push(a)
      if (a[0] === 'generate') return okSubmit(a)
      if (a[0] === 'status') return { exitCode: 0, stdout: JSON.stringify({ data: { status: 'succeeded', artifacts: [{ artifact_id: 'art1' }, {}] } }), stderr: '' }
      if (a[0] === 'feedback') return { exitCode: 1, stdout: '', stderr: '' }
      return { exitCode: 1, stdout: '', stderr: '' }
    })
    const job = await requestJob(svc, 'rev-1', { slots: 2 })
    await approve(svc, job.jobId)
    const eng = engineOf(svc)
    await eng.tick()
    const j = eng.require(job.jobId)
    // artifact without artifact_id fails explicitly; the one with id has no readable bytes so also fails
    expect(j.slots.every((s: any) => s.status === 'failed')).toBe(true)
    expect(j.slots[1].errorCode).toBe('OWNER_STATUS_UNKNOWN')
    expect(j.status).toBe('failed')
  })

  it('slot review: failed owner call leaves the slot unreviewed; a repeated review does not call the owner again', async () => {
    const dir = await workspace()
    let feedbackOk = false
    const calls: string[][] = []
    const svc = await bootWith(dir, (a) => {
      calls.push(a)
      if (a[0] === 'generate') return okSubmit(a)
      if (a[0] === 'feedback') return { exitCode: feedbackOk ? 0 : 1, stdout: '', stderr: '' }
      return { exitCode: 0, stdout: JSON.stringify({ data: { status: 'running' } }), stderr: '' }
    })
    const job = await requestJob(svc, 'rev-2')
    await approve(svc, job.jobId)
    const j = engineOf(svc).require(job.jobId)
    j.status = 'waiting_for_human'
    j.slots[0].status = 'done'
    j.slots[0].ownerRef = 'art1'
    const slotId = j.slots[0].slotId
    const first = await rpcOf(svc, 'job.slot.review', { jobId: job.jobId, slotId, decision: 'accept' })
    expect(first.ok).toBe(false)
    expect(j.slots[0].review).toBe('unreviewed')
    feedbackOk = true
    const second = await rpcOf(svc, 'job.slot.review', { jobId: job.jobId, slotId, decision: 'accept' })
    expect(second.data.job.status).toBe('completed')
    const n = calls.filter((c) => c[0] === 'feedback').length
    const third = await rpcOf(svc, 'job.slot.review', { jobId: job.jobId, slotId, decision: 'accept' })
    expect(third.ok).toBe(true)
    expect(calls.filter((c) => c[0] === 'feedback').length).toBe(n)
  })
})
