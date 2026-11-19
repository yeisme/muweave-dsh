import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { isSha256Digest } from '@yeisme/muweave-bundle'
import {
  MAX_OUTPUT_BYTES,
  ceilingFor,
  deepFind,
  inputText,
  isFiniteNumber,
  isNonEmptyString,
  parseOwnerJson,
  sha256Hex,
  unwrapData,
  usd,
  wasTimeout,
  withRequestFile,
  type AdapterContext,
  type CapabilityAdapter,
  type CapabilityInput,
  type PollOutcome,
  type SlotUpdate,
} from './types'

/*
 * Verified with `eikona generate --help`, `eikona status --help`, `eikona cancel --help`,
 * `eikona feedback accept --help` (no provider was called):
 *   estimate: eikona generate --input <file> --count N [--aspect A] [--model M] --dry-run --json
 *   submit:   eikona generate --input <file> --count N --max-cost-usd C --approval-cost-usd C --approve-cost
 *             --background --run-id <derived from idempotency key> --json   (+ --allow-unknown-cost)
 *   poll:     eikona status <run> --json  → data.status, data.artifacts[{artifact_id,sha256,mime_type,path}], data.cost
 *   cancel:   eikona cancel <run> --json
 *   review:   eikona feedback accept|reject <run> --artifact <id> --reason composition --json
 * eikona has no dedicated idempotency flag; `--run-id` (evidence id for a new run) is derived from the key.
 */

const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,80}$/
const DONE = new Set(['succeeded', 'completed', 'complete', 'done', 'ok', 'ready', 'waiting_review'])
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled', 'rejected', 'timeout'])

export function eikonaRunId(idempotencyKey: string): string {
  return `dsh-${sha256Hex(idempotencyKey).slice(0, 16)}`
}

function generateArgs(file: string, input: CapabilityInput, slots: number): string[] {
  const args = ['generate', '--input', file, '--count', String(slots)]
  const aspect = inputText(input, 'aspect')
  if (ASPECTS.includes(aspect)) args.push('--aspect', aspect)
  const model = inputText(input, 'model')
  if (MODEL_RE.test(model)) args.push('--model', model)
  return args
}

const COST_KEYS = ['estimated_usd', 'estimated_cost_usd', 'estimate_usd', 'cost_usd', 'total_usd'] as const

/**
 * Owner copies finished artifacts into this private plugin-data directory via `--output-dir`, so the
 * host never reads Eikona's own evidence root (`.eikona/**`). One directory per run id.
 */
export function eikonaOutputDir(ctx: AdapterContext, runId: string): string {
  return path.join(path.dirname(ctx.tmpDir), 'owner-out', runId)
}

/** Bytes come only from the run's output dir, matched to the owner-reported sha256 (or file name). */
async function readArtifact(update: SlotUpdate, filePath: unknown, outDir: string): Promise<SlotUpdate> {
  let names: string[]
  try {
    names = (await readdir(outDir)).sort()
  } catch {
    return { ...update, status: 'failed', errorCode: 'OWNER_STATUS_UNKNOWN' }
  }
  const reportedName = isNonEmptyString(filePath) ? path.basename(filePath) : undefined
  const candidates = reportedName && names.includes(reportedName) ? [reportedName] : update.sha256 ? names : []
  for (const name of candidates) {
    try {
      const full = path.join(outDir, name)
      const st = await lstat(full)
      if (!st.isFile() || st.size > MAX_OUTPUT_BYTES) continue
      const bytes = await readFile(full)
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
      if (update.sha256 && update.sha256 !== digest) continue
      return { ...update, sha256: digest, bytes }
    } catch {
      continue
    }
  }
  return { ...update, status: 'failed', errorCode: 'OWNER_STATUS_UNKNOWN' }
}

export const eikonaImageGenerate: CapabilityAdapter = {
  binary: 'eikona',
  descriptor: {
    capabilityId: 'eikona.image.generate',
    owner: 'eikona',
    kind: 'image',
    stage: 'visual',
    title: '生成图片候选',
    summary: '用 Eikona 一次生成多张候选图，逐格审阅后可关联到镜头。',
    costClass: 'paid',
    costUnit: 'usd',
    defaultSlots: 4,
    maxSlots: 8,
    inputs: [
      { name: 'prompt', label: '画面描述', inputType: 'textarea', required: true },
      { name: 'aspect', label: '画幅', inputType: 'enum', required: false, options: ASPECTS, defaultValue: '2:3' },
      { name: 'model', label: '模型（可留空）', inputType: 'text', required: false },
    ],
  },
  async estimate(ctx, input, slots) {
    if (!inputText(input, 'prompt')) return { ok: false, errorCode: 'ESTIMATE_FAILED' }
    const res = await withRequestFile(ctx, inputText(input, 'prompt'), (file) =>
      ctx.runner('eikona', [...generateArgs(file, input, slots), '--dry-run', '--json'], { cwd: ctx.cwd, timeoutMs: 30_000 }),
    )
    const env = res.exitCode === 0 ? parseOwnerJson(res.stdout) : undefined
    if (!env) return { ok: false, errorCode: 'ESTIMATE_FAILED' }
    const amount = deepFind(unwrapData(env), COST_KEYS, isFiniteNumber)
    return {
      ok: true,
      value: {
        costClass: amount === undefined ? 'unknown' : 'paid',
        estimate: usd(amount),
        suggestedCeiling: ceilingFor(amount),
        slots,
        planLines: [`${slots} × 图片候选${inputText(input, 'aspect') ? ` ${inputText(input, 'aspect')}` : ''}`],
      },
    }
  },
  async submit(ctx, req) {
    const runId = eikonaRunId(req.idempotencyKey)
    const cap = req.ceiling.amount
    if (cap === undefined) return { outcome: 'failed' }
    const res = await withRequestFile(ctx, inputText(req.input, 'prompt'), (file) =>
      ctx.runner(
        'eikona',
        [
          ...generateArgs(file, req.input, req.slots),
          '--max-cost-usd', String(cap),
          '--approval-cost-usd', String(cap),
          '--approve-cost',
          '--background',
          '--run-id', runId,
          '--output-dir', eikonaOutputDir(ctx, runId),
          ...(req.acceptUnknownCost ? ['--allow-unknown-cost'] : []),
          '--json',
        ],
        { cwd: ctx.cwd, timeoutMs: 60_000 },
      ),
    )
    // Any non-zero exit after the submit call is ambiguous: `--background` may already have queued the
    // run under the derived run id, and a status check is cheap. Reconcile decides.
    if (wasTimeout(res) || res.exitCode !== 0) return { outcome: 'ambiguous', ownerJobRef: runId }
    const env = parseOwnerJson(res.stdout)
    const reported = env ? deepFind(unwrapData(env), ['run_id'], isNonEmptyString) : undefined
    return { outcome: 'submitted', ownerJobRef: reported ?? runId }
  },
  async poll(ctx, ownerJobRef, slotCount): Promise<PollOutcome> {
    const res = await ctx.runner('eikona', ['status', ownerJobRef, '--json'], { cwd: ctx.cwd, timeoutMs: 20_000 })
    const env = res.exitCode === 0 ? parseOwnerJson(res.stdout) : undefined
    if (!env) return { state: 'unknown', slots: [] }
    const data = unwrapData(env)
    const status = String(data.status ?? '').toLowerCase()
    const cost = typeof data.cost === 'object' && data.cost !== null ? (data.cost as Record<string, unknown>) : {}
    const actual = isFiniteNumber(cost.actual_usd) ? usd(cost.actual_usd) : undefined
    if (FAILED.has(status)) return { state: 'failed', slots: [], ...(actual ? { actualCost: actual } : {}) }
    if (!DONE.has(status)) return { state: 'running', slots: [] }
    const artifacts = Array.isArray(data.artifacts) ? data.artifacts : []
    const slots: SlotUpdate[] = []
    for (const [index, raw] of artifacts.slice(0, slotCount).entries()) {
      const a = (raw ?? {}) as Record<string, unknown>
      const sha = isSha256Digest(a.sha256) ? a.sha256 : undefined
      if (!isNonEmptyString(a.artifact_id)) {
        // Without an artifact id the slot can never be reviewed through the owner: fail it explicitly.
        slots.push({ index, status: 'failed', errorCode: 'OWNER_STATUS_UNKNOWN' })
        continue
      }
      slots.push(
        await readArtifact(
          {
            index,
            status: 'done',
            ...(isNonEmptyString(a.artifact_id) ? { ownerRef: a.artifact_id } : {}),
            mime: isNonEmptyString(a.mime_type) ? a.mime_type : 'image/png',
            ...(sha ? { sha256: sha } : {}),
          },
          a.path,
          eikonaOutputDir(ctx, ownerJobRef),
        ),
      )
    }
    return { state: 'done', slots, ...(actual ? { actualCost: actual } : {}) }
  },
  async cancel(ctx, ownerJobRef) {
    const res = await ctx.runner('eikona', ['cancel', ownerJobRef, '--json'], { cwd: ctx.cwd, timeoutMs: 20_000 })
    return res.exitCode === 0
  },
  async review(ctx, target) {
    if (!target.slotOwnerRef) return false
    const res = await ctx.runner(
      'eikona',
      ['feedback', target.decision, target.ownerJobRef, '--artifact', target.slotOwnerRef, '--reason', 'composition', '--json'],
      { cwd: ctx.cwd, timeoutMs: 20_000 },
    )
    return res.exitCode === 0
  },
}
