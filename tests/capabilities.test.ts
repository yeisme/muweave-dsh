import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { CliRunner } from '@yeisme/muweave-bundle'
import { CreatorHostService, type JobRecordV1 } from '@yeisme/dsh-muweave-core'

const PROMPT = 'a rainy rooftop confrontation with neon reflections'
const IMG = Buffer.from('fake-png-bytes')
const IMG_SHA = `sha256:${createHash('sha256').update(IMG).digest('hex')}`

interface Harness {
  svc: CreatorHostService
  calls: Array<{ bin: string; args: string[] }>
  dir: string
  data: string
  setStatus(s: string): void
}

const dirs: string[] = []
const services: CreatorHostService[] = []
afterEach(async () => {
  for (const s of services.splice(0)) s.dispose()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function setup(opts: { installed?: string[]; estimateUsd?: number | null; settings?: Record<string, unknown> } = {}): Promise<Harness> {
  const dir = await mkdtemp(path.join(tmpdir(), 'muweave-cap-'))
  dirs.push(dir)
  const data = path.join(dir, 'plugin-data')
  const art = path.join(dir, 'art.png')
  await writeFile(art, IMG)
  const installed = new Set(opts.installed ?? ['eikona', 'sonora', 'scaena', 'auctra', 'anatomia'])
  let status = 'running'
  const calls: Harness['calls'] = []
  const runner: CliRunner = async (bin, args) => {
    calls.push({ bin, args: [...args] })
    const a = [...args]
    if (!installed.has(bin)) return { exitCode: 1, stdout: '', stderr: 'not found' }
    if (a[0] === '--version') return { exitCode: 0, stdout: 'v1', stderr: '' }
    if (bin === 'eikona' && a[0] === 'generate' && a.includes('--dry-run')) {
      const data = opts.estimateUsd === null ? {} : { estimated_usd: opts.estimateUsd ?? 0.4 }
      return { exitCode: 0, stdout: JSON.stringify({ data }), stderr: '' }
    }
    if (bin === 'eikona' && a[0] === 'generate') {
      // The owner copies finished artifacts into the private --output-dir; the host reads only there.
      const out = a[a.indexOf('--output-dir') + 1]!
      await mkdir(out, { recursive: true })
      await writeFile(path.join(out, 'art.png'), IMG)
      return { exitCode: 0, stdout: JSON.stringify({ data: { run_id: a[a.indexOf('--run-id') + 1] } }), stderr: '' }
    }
    if (bin === 'eikona' && a[0] === 'status') {
      return { exitCode: 0, stdout: JSON.stringify({ data: { status, cost: { actual_usd: 0.35 }, artifacts: [{ artifact_id: 'art_1', sha256: IMG_SHA, mime_type: 'image/png', path: art }] } }), stderr: '' }
    }
    if (bin === 'eikona' && a[0] === 'feedback') return { exitCode: 0, stdout: '{}', stderr: '' }
    return { exitCode: 1, stdout: '', stderr: 'unexpected' }
  }
  if (opts.settings) {
    await mkdir(data, { recursive: true })
    await writeFile(path.join(data, 'settings.v1.json'), JSON.stringify(opts.settings))
  }
  const svc = new CreatorHostService({ defaultWorkspaceDir: dir, pluginDataDir: data, runner })
  services.push(svc)
  return { svc, calls, dir, data, setStatus: (s) => { status = s } }
}

const rpc = (h: Harness, action: string, payload: Record<string, unknown> = {}) => h.svc.handleRpcAction(action, payload)
const ownerCalls = (h: Harness) => h.calls.filter((c) => c.args[0] === 'generate' && !c.args.includes('--dry-run'))

async function requestJob(h: Harness, key = 'k1', anchor?: Record<string, unknown>): Promise<JobRecordV1> {
  const est = await rpc(h, 'capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: PROMPT }, slots: 2, ...(anchor ? { anchor } : {}) })
  if (!est.ok) throw new Error(JSON.stringify(est))
  const id = (est.data as { estimate: { estimateId: string } }).estimate.estimateId
  const req = await rpc(h, 'job.request', { estimateId: id, idempotencyKey: key, requestedBy: 'ui' })
  if (!req.ok) throw new Error(JSON.stringify(req))
  return (req.data as { job: JobRecordV1 }).job
}

describe('capability catalog and estimates', () => {
  it('reports unavailable owners with stable reasons and never calls generate for an estimate', async () => {
    const h = await setup({ installed: ['eikona', 'sonora', 'scaena', 'auctra', 'anatomia'] })
    const cat = await rpc(h, 'capability.catalog')
    const caps = (cat as { data: { paidEnabled: boolean; capabilities: Array<{ capabilityId: string; available: boolean; unavailableReason?: string }> } }).data
    const by = Object.fromEntries(caps.capabilities.map((c) => [c.capabilityId, c]))
    expect(caps.paidEnabled).toBe(false)
    expect(by['eikona.image.generate']!.available).toBe(true)
    expect(by['auctra.text.generate']!.unavailableReason).toBe('NO_COST_CAP')
    expect(by['pinax.inbox.capture']!.unavailableReason).toBe('OWNER_NOT_INSTALLED')
    expect(by['manju-hotlist.research.query']!.unavailableReason).toBe('OWNER_NOT_INSTALLED')
    expect(by['scaena.shot.draw']!.available).toBe(false)
    const est = await rpc(h, 'capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: PROMPT }, slots: 4 })
    expect(est.ok).toBe(true)
    expect(ownerCalls(h)).toHaveLength(0)
    const e = (est as { data: { estimate: { estimate: { amount: number }; title: string; suggestedCeiling: { amount: number } } } }).data.estimate
    expect(e.estimate.amount).toBe(0.4)
    expect(e.title.length).toBeLessThanOrEqual(24)
    const blocked = await rpc(h, 'capability.estimate', { capabilityId: 'auctra.text.generate', input: { prompt: 'x' } })
    expect(blocked.ok ? '' : blocked.error.code).toBe('CAPABILITY_UNAVAILABLE')
  })

  it('rejects job.request from other requesters and bad eikona decisions', async () => {
    const h = await setup()
    const est = await rpc(h, 'capability.estimate', { capabilityId: 'eikona.image.generate', input: { prompt: PROMPT } })
    const id = (est as { data: { estimate: { estimateId: string } } }).data.estimate.estimateId
    const bad = await rpc(h, 'job.request', { estimateId: id, idempotencyKey: 'x', requestedBy: 'system' })
    expect(bad.ok).toBe(false)
    const dec = await rpc(h, 'eikona.feedback.decide', { runId: 'r', artifactId: 'a', decision: 'maybe', idempotencyKey: 'i' })
    expect(dec.ok ? '' : dec.error.code).toBe('eikona/invalid_decision')
  })
})

describe('approval gates', () => {
  it('blocks before the owner for PAID_DISABLED, CEILING_BELOW_ESTIMATE, UNKNOWN_COST_NOT_ACCEPTED, BUDGET_EXCEEDED', async () => {
    const h = await setup()
    const job = await requestJob(h)
    const code = async (payload: Record<string, unknown>) => {
      const r = await rpc(h, 'job.approve', { jobId: job.jobId, ...payload })
      return r.ok ? 'ok' : r.error.code
    }
    expect(await code({ ceiling: { unit: 'usd', amount: 1 } })).toBe('PAID_DISABLED')
    await mkdir(h.data, { recursive: true })
    await writeFile(path.join(h.data, 'settings.v1.json'), JSON.stringify({ paidEnabled: true, dailyCap: { usd: 0.5 } }))
    expect(await code({ ceiling: { unit: 'usd', amount: 0.1 } })).toBe('CEILING_BELOW_ESTIMATE')
    expect(await code({ ceiling: { unit: 'credits', amount: 5 } })).toBe('CEILING_BELOW_ESTIMATE')
    expect(await code({ ceiling: { unit: 'usd', amount: 0.9 } })).toBe('BUDGET_EXCEEDED')
    expect(ownerCalls(h)).toHaveLength(0)

    const h2 = await setup({ estimateUsd: null, settings: { paidEnabled: true } })
    const unk = await requestJob(h2)
    const r = await rpc(h2, 'job.approve', { jobId: unk.jobId, ceiling: { unit: 'usd', amount: 1 } })
    expect(r.ok ? 'ok' : r.error.code).toBe('UNKNOWN_COST_NOT_ACCEPTED')
    expect(ownerCalls(h2)).toHaveLength(0)
  })

  it('approves once with ceiling flag and idempotency-derived run id, then fills slots into CAS', async () => {
    const h = await setup({ settings: { paidEnabled: true } })
    const job = await requestJob(h, 'k-approve', { shotRef: 'shot_1' })
    const ok = await rpc(h, 'job.approve', { jobId: job.jobId, ceiling: { unit: 'usd', amount: 0.5 } })
    expect(ok.ok).toBe(true)
    const sub = ownerCalls(h)
    expect(sub).toHaveLength(1)
    expect(sub[0]!.args).toContain('--max-cost-usd')
    expect(sub[0]!.args[sub[0]!.args.indexOf('--max-cost-usd') + 1]).toBe('0.5')
    expect(sub[0]!.args).toContain('--approve-cost')
    expect(sub[0]!.args).toContain('--run-id')
    expect(sub[0]!.args.join(' ')).not.toContain(PROMPT)
    // temp request files are deleted after submit
    expect(await readdir(path.join(h.data, 'tmp-requests'))).toEqual([])
    const again = await rpc(h, 'job.approve', { jobId: job.jobId, ceiling: { unit: 'usd', amount: 0.5 } })
    expect(again.ok ? 'ok' : again.error.code).toBe('APPROVAL_REQUIRED')
    expect(ownerCalls(h)).toHaveLength(1)

    h.setStatus('succeeded')
    await (h.svc as unknown as { capabilities: { engine: { tick(): Promise<void> } } }).capabilities.engine.tick()
    const got = await rpc(h, 'job.get', { jobId: job.jobId })
    const j = (got as { data: { job: JobRecordV1 } }).data.job
    expect(j.status).toBe('waiting_for_human')
    expect(j.slots[0]).toMatchObject({ status: 'done', sha256: IMG_SHA, mime: 'image/png' })
    expect(j.slots[1]!.status).toBe('skipped')
    expect(j.actualCost).toEqual({ unit: 'usd', amount: 0.35 })

    const rev = await rpc(h, 'job.slot.review', { jobId: job.jobId, slotId: 'slot_1', decision: 'accept', linkToShot: true })
    expect(rev.ok).toBe(true)
    expect((rev as { data: { job: JobRecordV1 } }).data.job.status).toBe('completed')
    const root = path.join(h.dir, '.muweave')
    let bindings = ''
    for (const f of await readdir(root)) if (f.endsWith('.json')) bindings += await readFile(path.join(root, f), 'utf8')
    expect(bindings).toContain('shot_1')
    const budget = await rpc(h, 'budget.status')
    expect((budget as { data: { lines: Array<{ spent: number }> } }).data.lines[0]!.spent).toBeCloseTo(0.35)
  })
})

describe('sonora output read confinement', () => {
  it('accepts only workspace files <= 64 MiB and rejects paths outside the workspace', async () => {
    const { sonoraSfxGenerate } = await import('../packages/dsh-muweave-core/src/capabilities/sonora')
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-son-'))
    const outside = await mkdtemp(path.join(tmpdir(), 'muweave-son-out-'))
    dirs.push(dir, outside)
    await writeFile(path.join(dir, 'a.mp3'), 'audio')
    await writeFile(path.join(outside, 'b.mp3'), 'audio')
    const pollWith = (p: string) => {
      const runner: CliRunner = async () => ({ exitCode: 0, stdout: JSON.stringify({ data: { status: 'done', path: p } }), stderr: '' })
      return sonoraSfxGenerate.poll({ runner, cwd: dir, tmpDir: path.join(dir, 'tmp') }, 'job1', 1)
    }
    expect((await pollWith('a.mp3')).slots[0]!.bytes).toBeDefined()
    const out = await pollWith(path.join(outside, 'b.mp3'))
    expect(out.slots[0]!.status).toBe('failed')
    expect(out.slots[0]!.bytes).toBeUndefined()
  })
})
