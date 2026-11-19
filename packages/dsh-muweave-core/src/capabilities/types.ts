import { createHash, randomBytes } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CliExecResult, CliRunner } from '@yeisme/muweave-bundle'
import type {
  CapabilityDescriptorV1,
  CapabilityCostClass,
  CostAmountV1,
  JobSlotStatus,
} from '../capability-protocol'

/** Runner result as the host sees it; `timedOut` is optional so older runners still compile. */
export type TimedCliResult = CliExecResult & { timedOut?: boolean }

export function wasTimeout(res: TimedCliResult): boolean {
  return res.timedOut === true || res.exitCode === 124 || res.stderr.includes('ETIMEDOUT')
}

export interface AdapterContext {
  runner: CliRunner
  /** Workspace directory; owner commands always run here. */
  cwd: string
  /** Private scratch directory for owner request files (mode 0600, deleted after submit). */
  tmpDir: string
}

export type CapabilityInput = Record<string, string | number | string[]>

export interface AdapterEstimate {
  costClass: CapabilityCostClass
  estimate: CostAmountV1
  suggestedCeiling: CostAmountV1
  slots: number
  planLines: string[]
}

export type EstimateOutcome = { ok: true; value: AdapterEstimate } | { ok: false; errorCode: 'ESTIMATE_FAILED' | 'CAPABILITY_UNAVAILABLE' }

export interface SubmitRequest {
  jobId: string
  idempotencyKey: string
  input: CapabilityInput
  slots: number
  ceiling: CostAmountV1
  acceptUnknownCost: boolean
}

export interface SubmitOutcome {
  outcome: 'submitted' | 'ambiguous' | 'failed'
  /** Owner run/job id; for ambiguous submits only a deterministic hint the owner can be asked about. */
  ownerJobRef?: string
}

export interface SlotUpdate {
  index: number
  status: JobSlotStatus
  ownerRef?: string
  label?: string
  mime?: string
  /** Bytes read through the owner's official contract; the engine writes them to CAS. */
  bytes?: Uint8Array
  sha256?: string
  errorCode?: string
}

export interface PollOutcome {
  state: 'running' | 'done' | 'failed' | 'unknown'
  slots: SlotUpdate[]
  actualCost?: CostAmountV1
}

export interface ReviewTarget {
  ownerJobRef: string
  slotOwnerRef?: string
  decision: 'accept' | 'reject'
}

export interface CapabilityAdapter {
  descriptor: Omit<CapabilityDescriptorV1, 'available' | 'unavailableReason'>
  binary: string
  /** Stable reason when verified owner flags are missing; the capability is then always unavailable. */
  blockedReason?: string
  estimate(ctx: AdapterContext, input: CapabilityInput, slots: number): Promise<EstimateOutcome>
  submit(ctx: AdapterContext, req: SubmitRequest): Promise<SubmitOutcome>
  poll(ctx: AdapterContext, ownerJobRef: string, slotCount: number): Promise<PollOutcome>
  cancel?(ctx: AdapterContext, ownerJobRef: string): Promise<boolean>
  review?(ctx: AdapterContext, target: ReviewTarget): Promise<boolean>
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Parse the first JSON object in owner output; owners may print a banner before the envelope. */
export function parseOwnerJson(stdout: string): Record<string, unknown> | undefined {
  const start = stdout.indexOf('{')
  if (start < 0) return undefined
  try {
    const parsed = JSON.parse(stdout.slice(start)) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** Owner envelopes wrap their payload under `data`; fall back to the object itself. */
export function unwrapData(env: Record<string, unknown>): Record<string, unknown> {
  const data = env.data
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : env
}

/** Breadth-first lookup of the first value under `keys` that passes `accept`; depth-limited. */
export function deepFind<T>(root: unknown, keys: readonly string[], accept: (v: unknown) => v is T, maxDepth = 5): T | undefined {
  let level: unknown[] = [root]
  for (let depth = 0; depth <= maxDepth && level.length; depth += 1) {
    const next: unknown[] = []
    for (const node of level) {
      if (typeof node !== 'object' || node === null) continue
      const rec = node as Record<string, unknown>
      for (const key of keys) if (accept(rec[key])) return rec[key] as T
      for (const value of Array.isArray(node) ? node : Object.values(rec)) next.push(value)
    }
    level = next
  }
  return undefined
}

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
export const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export function usd(amount?: number): CostAmountV1 {
  return amount === undefined ? { unit: 'usd' } : { unit: 'usd', amount }
}

/** Round up to cents so the ceiling handed to the owner never sits below its own estimate. */
export function ceilingFor(amount: number | undefined): CostAmountV1 {
  return amount === undefined ? { unit: 'usd' } : { unit: 'usd', amount: Math.ceil(amount * 100) / 100 }
}

export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/**
 * Title built only from the capability title, anchor refs and a time; never from prompt/text fields,
 * because titles are persisted and shown in lists.
 */
export function deriveTitle(fallback: string, anchor?: { shotRef?: string; sceneRef?: string }, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const refs = [anchor?.shotRef, anchor?.sceneRef].filter((x): x is string => !!x).map((x) => Array.from(x).slice(0, 16).join(''))
  const tail = refs.length ? refs.join(' · ') : `${pad(now.getHours())}:${pad(now.getMinutes())}`
  return `${fallback} · ${tail}`
}

export function promptDigestOf(input: CapabilityInput): string {
  const body = Object.keys(input).sort().map((k) => `${k}=${JSON.stringify(input[k])}`).join('\n')
  return `sha256:${sha256Hex(body)}`
}

/** Write an owner request file under tmpDir (0600), run `fn`, always delete the file. */
export async function withRequestFile<T>(ctx: AdapterContext, text: string, fn: (file: string) => Promise<T>): Promise<T> {
  await mkdir(ctx.tmpDir, { recursive: true, mode: 0o700 })
  const file = path.join(ctx.tmpDir, `req-${randomBytes(8).toString('hex')}.txt`)
  await writeFile(file, text, { mode: 0o600 })
  try {
    return await fn(file)
  } finally {
    await unlink(file).catch(() => undefined)
  }
}

export function inputText(input: CapabilityInput, key: string): string {
  const v = input[key]
  return typeof v === 'string' ? v.trim() : ''
}
