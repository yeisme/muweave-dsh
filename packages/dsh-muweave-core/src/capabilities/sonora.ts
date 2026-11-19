import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
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
 * Verified with `sonora sfx estimate|generate|job get --help` (no provider was called):
 *   estimate: sonora sfx estimate --text-file <f> [--duration-seconds D] --json
 *   submit:   sonora sfx generate --text-file <f> [--duration-seconds D] --confirm-live --idempotency-key K
 *             --max-cost-usd C [--confirm-unknown-price] --json
 *   poll:     sonora sfx job get <job-id> --json           (no cancel command exists for sfx jobs)
 * The exact JSON field names of the sfx job payload are matched defensively (several candidate keys).
 */

const DONE = new Set(['succeeded', 'completed', 'complete', 'done', 'ready', 'ok'])
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled', 'rejected', 'timeout'])
const COST_KEYS = ['estimated_cost_usd', 'estimated_usd', 'estimate_usd', 'cost_usd', 'total_usd'] as const
const ACTUAL_KEYS = ['actual_cost_usd', 'actual_usd'] as const
const JOB_KEYS = ['job_id', 'jobId', 'job_ref', 'id'] as const

function duration(input: CapabilityInput): string[] {
  const raw = Number(input.durationSeconds ?? input.duration)
  return Number.isFinite(raw) && raw >= 0.5 && raw <= 30 ? ['--duration-seconds', String(raw)] : []
}

/*
 * `sonora sfx generate --help` / `sfx job get --help` expose no output-dir or download flag, so there is no
 * private output directory to read from (unlike Eikona). The only accepted path is one that resolves inside
 * the workspace, is a regular file (lstat, no symlink) and is <= 64 MiB before it is read.
 */
async function readOutput(data: Record<string, unknown>, workspaceDir: string): Promise<SlotUpdate> {
  const sha = deepFind(data, ['sha256', 'digest'], isSha256Digest)
  const mime = deepFind(data, ['mime_type', 'mime'], isNonEmptyString) ?? 'audio/mpeg'
  const filePath = deepFind(data, ['path', 'output_path', 'audio_path'], isNonEmptyString)
  const ownerRef = deepFind(data, ['asset_id', 'asset_ref', 'artifact_id'], isNonEmptyString)
  const base: SlotUpdate = { index: 0, status: 'done', mime, ...(sha ? { sha256: sha } : {}), ...(ownerRef ? { ownerRef } : {}) }
  if (!filePath) return base
  try {
    const root = await realpath(workspaceDir)
    const abs = path.resolve(root, filePath)
    const rel = path.relative(root, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('outside workspace')
    const st = await lstat(abs)
    if (!st.isFile() || st.size > MAX_OUTPUT_BYTES) throw new Error('not an acceptable file')
    if (!(await realpath(abs)).startsWith(root + path.sep)) throw new Error('outside workspace')
    const bytes = await readFile(abs)
    if (sha && sha !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`) {
      return { ...base, status: 'failed', errorCode: 'OWNER_STATUS_UNKNOWN' }
    }
    return { ...base, bytes }
  } catch {
    return { ...base, status: 'failed', errorCode: 'OWNER_STATUS_UNKNOWN' }
  }
}

export const sonoraSfxGenerate: CapabilityAdapter = {
  binary: 'sonora',
  descriptor: {
    capabilityId: 'sonora.sfx.generate',
    owner: 'sonora',
    kind: 'sfx',
    stage: 'sound',
    title: '生成音效',
    summary: '用 Sonora 按文字描述生成一条音效，试听后可关联到镜头。',
    costClass: 'paid',
    costUnit: 'usd',
    defaultSlots: 1,
    maxSlots: 1,
    inputs: [
      { name: 'text', label: '音效描述', inputType: 'textarea', required: true },
      { name: 'durationSeconds', label: '时长（秒，0.5–30）', inputType: 'number', required: false },
    ],
  },
  async estimate(ctx, input) {
    const text = inputText(input, 'text')
    if (!text) return { ok: false, errorCode: 'ESTIMATE_FAILED' }
    const res = await withRequestFile(ctx, text, (file) =>
      ctx.runner('sonora', ['sfx', 'estimate', '--text-file', file, ...duration(input), '--json'], { cwd: ctx.cwd, timeoutMs: 30_000 }),
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
        slots: 1,
        planLines: ['1 × 音效'],
      },
    }
  },
  async submit(ctx, req) {
    const cap = req.ceiling.amount
    if (cap === undefined) return { outcome: 'failed' }
    const res = await withRequestFile(ctx, inputText(req.input, 'text'), (file) =>
      ctx.runner(
        'sonora',
        [
          'sfx', 'generate', '--text-file', file, ...duration(req.input),
          '--confirm-live', '--idempotency-key', req.idempotencyKey,
          '--max-cost-usd', String(cap),
          ...(req.acceptUnknownCost ? ['--confirm-unknown-price'] : []),
          '--json',
        ],
        { cwd: ctx.cwd, timeoutMs: 60_000 },
      ),
    )
    if (wasTimeout(res)) return { outcome: 'ambiguous' }
    // Non-zero stays `failed` (not ambiguous): `sfx job get` takes an owner job id, not the idempotency key,
    // so reconcile has no way to find a job we never got an id for.
    if (res.exitCode !== 0) return { outcome: 'failed' }
    const env = parseOwnerJson(res.stdout)
    const jobRef = env ? deepFind(unwrapData(env), JOB_KEYS, isNonEmptyString) : undefined
    // Accepted by the owner but no job id to poll: never resubmit, hand to reconcile.
    return jobRef ? { outcome: 'submitted', ownerJobRef: jobRef } : { outcome: 'ambiguous' }
  },
  async poll(ctx, ownerJobRef): Promise<PollOutcome> {
    const res = await ctx.runner('sonora', ['sfx', 'job', 'get', ownerJobRef, '--json'], { cwd: ctx.cwd, timeoutMs: 20_000 })
    const env = res.exitCode === 0 ? parseOwnerJson(res.stdout) : undefined
    if (!env) return { state: 'unknown', slots: [] }
    const data = unwrapData(env)
    const status = String(deepFind(data, ['status', 'state'], isNonEmptyString) ?? '').toLowerCase()
    const actualAmount = deepFind(data, ACTUAL_KEYS, isFiniteNumber)
    const actual = actualAmount === undefined ? {} : { actualCost: usd(actualAmount) }
    if (FAILED.has(status)) return { state: 'failed', slots: [], ...actual }
    if (!DONE.has(status)) return { state: 'running', slots: [] }
    return { state: 'done', slots: [await readOutput(data, ctx.cwd)], ...actual }
  },
}

export type { AdapterContext }
