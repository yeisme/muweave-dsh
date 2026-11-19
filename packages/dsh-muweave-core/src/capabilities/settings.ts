import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { BudgetLineV1, BudgetStatusV1, CostUnit, JobRecordV1 } from '../capability-protocol'

export interface HostSettingsV1 {
  paidEnabled?: boolean
  dailyCap?: { usd?: number; credits?: number }
}

/** Read settings.v1.json on every call (tiny file); env MUWEAVE_DSH_PAID=1 also enables paid jobs. */
export function readSettings(pluginDataDir: string, env: NodeJS.ProcessEnv = process.env): HostSettingsV1 & { paidEnabled: boolean } {
  let file: HostSettingsV1 = {}
  try {
    const parsed = JSON.parse(readFileSync(path.join(pluginDataDir, 'settings.v1.json'), 'utf8')) as HostSettingsV1
    if (typeof parsed === 'object' && parsed !== null) file = parsed
  } catch {
    /* absent or unreadable settings mean defaults */
  }
  const cap = file.dailyCap
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  const dailyCap = cap ? { ...(num(cap.usd) === undefined ? {} : { usd: num(cap.usd)! }), ...(num(cap.credits) === undefined ? {} : { credits: num(cap.credits)! }) } : undefined
  return { paidEnabled: file.paidEnabled === true || env.MUWEAVE_DSH_PAID === '1', ...(dailyCap ? { dailyCap } : {}) }
}

export function localDay(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** committed = approved ceilings of every job that reached the owner without a reported cost; spent = reported actual cost, both for today. */
export function computeBudget(jobs: readonly JobRecordV1[], settings: ReturnType<typeof readSettings>, now: Date = new Date()): BudgetStatusV1 {
  const day = localDay(now)
  const totals = new Map<CostUnit, { committed: number; spent: number }>([['usd', { committed: 0, spent: 0 }], ['credits', { committed: 0, spent: 0 }]])
  let unknownCostJobs = 0
  for (const job of jobs) {
    if (!job.approvedAt || localDay(new Date(job.approvedAt)) !== day) continue
    // A definite submit rejection never got an owner run id, so nothing could have been billed.
    if (job.status === 'failed' && job.errorCode === 'OWNER_SUBMIT_FAILED' && !job.ownerJobRef) continue
    const unit = job.actualCost?.unit ?? job.approvedCeiling?.unit
    const line = unit ? totals.get(unit) : undefined
    if (!line) continue
    if (job.actualCost?.amount !== undefined) line.spent += job.actualCost.amount
    else {
      // Reached the owner and no owner-reported cost yet: the ceiling stays committed whatever the status
      // (a failed/cancelled/abandoned job may still have been billed). It is also an unknown-cost job.
      unknownCostJobs += 1
      if (job.approvedCeiling?.amount !== undefined) line.committed += job.approvedCeiling.amount
    }
  }
  const lines: BudgetLineV1[] = []
  for (const [unit, t] of totals) {
    const cap = unit === 'usd' ? settings.dailyCap?.usd : settings.dailyCap?.credits
    if (unit === 'usd' || t.committed || t.spent || cap !== undefined) lines.push({ unit, ...t, ...(cap === undefined ? {} : { dailyCap: cap }) })
  }
  return { paidEnabled: settings.paidEnabled, day, lines, unknownCostJobs }
}
