import { useEffect, useState } from 'react'
import type { MuweaveRpcClient } from '@yeisme/dsh-muweave-core/client'

export type DiagnosisState = 'healthy' | 'warning' | 'broken' | 'unknown'
export type DiagnosisSeverity = 'info' | 'warn' | 'error'
export type DiagnosisCode = 'registry_corrupt' | 'bundle_missing' | 'owner_unavailable' | 'revision_conflict' | 'unknown_operation'

export interface DiagnosisFinding {
  code: DiagnosisCode | string
  severity: DiagnosisSeverity
  detail: string
  action?: string
}

/** Mirrors one project.diagnose report; every field is read defensively because the host shape is still moving. */
export interface DiagnosisReport {
  projectId: string
  title: string
  state: DiagnosisState
  findings: DiagnosisFinding[]
}

type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info'

// `unknown` is deliberately neutral: the panel must never let "we could not tell" read as healthy.
export const STATE_META: Record<DiagnosisState, { label: string; tone: Tone }> = {
  healthy: { label: '正常', tone: 'ok' },
  warning: { label: '需注意', tone: 'warn' },
  broken: { label: '异常', tone: 'bad' },
  unknown: { label: '无法判断', tone: 'neutral' },
}

const SEVERITY_TONE: Record<DiagnosisSeverity, Tone> = { info: 'info', warn: 'warn', error: 'bad' }

export interface MigrationCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export interface MigrationReport {
  registrySchema: string
  projectCount: number
  archivedCount: number
  corruptBackupCount: number
  corruptBackups: string[]
  legacyScheduleCount: number
  unclaimedBundleCount: number
  readyForV2: boolean
  checks: MigrationCheck[]
  generatedAt?: string
}

const MIGRATION_CHECK_TONE: Record<MigrationCheck['status'], Tone> = {
  pass: 'ok',
  warn: 'warn',
  fail: 'bad',
}

// project.diagnose / project.migration.report cast keeps compatibility with older host type builds.
const DIAGNOSE = 'project.diagnose' as string as Parameters<MuweaveRpcClient['call']>[0]
const MIGRATION_REPORT = 'project.migration.report' as string as Parameters<MuweaveRpcClient['call']>[0]

/** Strips any directory prefix so corrupt backup filenames never expose host paths. */
export function sanitizeBackupName(raw: string): string {
  const parts = raw.trim().split(/[/\\]/)
  return parts[parts.length - 1] ?? ''
}

/** Reads a project.migration.report payload defensively; returns null for older/mock hosts without migration data. */
export function readMigrationReport(raw: unknown): MigrationReport | null {
  if (!raw || typeof raw !== 'object') return null
  const container = raw as Record<string, unknown>
  const src = (
    container.report && typeof container.report === 'object' ? container.report : container
  ) as Record<string, unknown>
  const registrySchema =
    typeof src.registrySchema === 'string' && src.registrySchema.trim()
      ? src.registrySchema.trim()
      : typeof src.schema === 'string' && src.schema.trim() && src.schema !== 'muweave.migration-report.v1'
        ? src.schema.trim()
        : ''
  if (!registrySchema || typeof src.projectCount !== 'number') return null
  const corruptBackups = Array.isArray(src.corruptBackups)
    ? src.corruptBackups
        .map((item) => (typeof item === 'string' ? sanitizeBackupName(item) : ''))
        .filter(Boolean)
    : []
  const checks: MigrationCheck[] = Array.isArray(src.checks)
    ? src.checks.flatMap((item, index): MigrationCheck[] => {
        if (!item || typeof item !== 'object') return []
        const c = item as Record<string, unknown>
        const label = typeof c.label === 'string' && c.label.trim() ? c.label.trim() : ''
        const detail = typeof c.detail === 'string' ? c.detail.trim() : ''
        if (!label && !detail) return []
        const status: MigrationCheck['status'] =
          c.status === 'pass' || c.status === 'warn' || c.status === 'fail' ? c.status : 'warn'
        const id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `check-${index}`
        return [{ id, label: label || id, status, detail }]
      })
    : []
  const corruptBackupCount =
    typeof src.corruptBackupCount === 'number' ? src.corruptBackupCount : corruptBackups.length
  const archivedCount = typeof src.archivedCount === 'number' ? src.archivedCount : 0
  const legacyScheduleCount = typeof src.legacyScheduleCount === 'number' ? src.legacyScheduleCount : 0
  const unclaimedBundleCount = typeof src.unclaimedBundleCount === 'number' ? src.unclaimedBundleCount : 0
  const readyForV2 =
    typeof src.readyForV2 === 'boolean' ? src.readyForV2 : checks.every((check) => check.status !== 'fail')
  return {
    registrySchema,
    projectCount: src.projectCount,
    archivedCount,
    corruptBackupCount,
    corruptBackups,
    legacyScheduleCount,
    unclaimedBundleCount,
    readyForV2,
    checks,
    ...(typeof src.generatedAt === 'string' ? { generatedAt: src.generatedAt } : {}),
  }
}

/** Drops malformed reports and findings instead of letting one bad row blank the panel; a missing state is unknown, never healthy. */
export function readReports(raw: unknown): DiagnosisReport[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const r = (item ?? {}) as Partial<Record<keyof DiagnosisReport, unknown>>
    if (typeof r.projectId !== 'string' || !r.projectId) return []
    const state = typeof r.state === 'string' && r.state in STATE_META ? (r.state as DiagnosisState) : 'unknown'
    const findings = Array.isArray(r.findings)
      ? r.findings.flatMap((f): DiagnosisFinding[] => {
          const x = (f ?? {}) as Partial<Record<keyof DiagnosisFinding, unknown>>
          if (typeof x.detail !== 'string' || !x.detail) return []
          const severity = typeof x.severity === 'string' && x.severity in SEVERITY_TONE ? (x.severity as DiagnosisSeverity) : 'warn'
          const action = typeof x.action === 'string' && x.action.trim() ? x.action.trim() : undefined
          return [{ code: typeof x.code === 'string' ? x.code : 'unknown', severity, detail: x.detail, ...(action ? { action } : {}) }]
        })
      : []
    return [{ projectId: r.projectId, title: typeof r.title === 'string' && r.title ? r.title : r.projectId, state, findings }]
  })
}

/** Worst first: a broken project outranks a warning, and any unknown keeps the summary off "全部正常". */
const ORDER: DiagnosisState[] = ['broken', 'warning', 'unknown']

export function summarize(reports: DiagnosisReport[]): { state: DiagnosisState; text: string } {
  if (reports.length === 0) return { state: 'unknown', text: '没有可诊断的项目' }
  const parts = ORDER.flatMap((state) => {
    const n = reports.filter((r) => r.state === state).length
    return n ? [n + ' 项' + STATE_META[state].label] : []
  })
  if (parts.length === 0) return { state: 'healthy', text: '全部正常' }
  return { state: ORDER.find((state) => reports.some((r) => r.state === state)) ?? 'unknown', text: parts.join(' · ') }
}

type Result = { ok: true; reports: DiagnosisReport[] } | { ok: false; message: string }

/**
 * F3 project diagnosis (docs/design/project-features-next.md F3). Folded to one summary line; the
 * first expand is what calls project.diagnose, and each later expand re-reads. Read-only: an
 * action only navigates through `onNavigate`, the fix itself stays with the owning surface.
 */
export function DiagnosisPanel({
  rpc,
  projectId,
  onNavigate,
}: {
  rpc: MuweaveRpcClient
  /** Narrows the query to one project; omitted, the host diagnoses every registered project. */
  projectId?: string
  onNavigate?: (report: DiagnosisReport, finding: DiagnosisFinding) => void
}) {
  const [open, setOpen] = useState(false)
  /** null while a query is in flight or before the first expand. */
  const [result, setResult] = useState<Result | null>(null)
  const [migration, setMigration] = useState<MigrationReport | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!open) return
    let live = true
    setResult(null)
    setMigration(null)
    void rpc
      .call<{ reports?: unknown }>(DIAGNOSE, projectId ? { projectId } : {})
      .then((res) => {
        if (!live) return
        if (res?.ok) setResult({ ok: true, reports: readReports(res.data?.reports) })
        else setResult({ ok: false, message: res?.error?.message ?? '诊断没有完成' })
      })
      .catch((err: unknown) => { if (live) setResult({ ok: false, message: err instanceof Error ? err.message : String(err) }) })
    void rpc
      .call<unknown>(MIGRATION_REPORT, {})
      .then((res) => {
        if (!live) return
        if (res?.ok) setMigration(readMigrationReport(res.data))
      })
      .catch(() => {
        if (live) setMigration(null)
      })
    return () => { live = false }
  }, [open, nonce, projectId, rpc])

  const summary = result === null
    ? { state: 'unknown' as const, text: open ? '正在诊断' : '展开后检查' }
    : result.ok
      ? summarize(result.reports)
      : { state: 'unknown' as const, text: '诊断失败，无法判断' }
  const flagged = result?.ok ? result.reports.filter((r) => r.state !== 'healthy' || r.findings.length > 0) : []

  return (
    <section className="mw-diag" data-diagnosis-panel="true" data-diag-open={open ? 'true' : 'false'} aria-label="诊断">
      <button
        type="button"
        className="mw-diag-toggle"
        aria-expanded={open}
        data-diag-state={result === null ? undefined : summary.state}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mw-dot" data-tone={result === null ? 'neutral' : STATE_META[summary.state].tone} data-hollow={result === null || summary.state === 'unknown' ? 'true' : undefined} />
        <span className="mw-diag-title">诊断</span>
        <span className="mw-diag-summary" data-diag-summary="true">· {summary.text}</span>
        <span className="mw-diag-caret" aria-hidden="true" />
      </button>
      {open ? (
        <div className="mw-diag-body">
          {result === null ? (
            <p className="mw-dsh-muted mw-diag-empty">正在读取项目诊断</p>
          ) : !result.ok ? (
            <div className="mw-diag-error" role="alert" data-diag-error="true">
              <span>{result.message}。在重新诊断成功前，项目状态无法判断。</span>
              <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => setNonce((n) => n + 1)}>
                重新诊断
              </button>
            </div>
          ) : result.reports.length === 0 ? (
            <p className="mw-dsh-muted mw-diag-empty" data-diag-empty="none">没有可诊断的项目</p>
          ) : flagged.length === 0 ? (
            <p className="mw-diag-empty mw-diag-allok" data-diag-empty="healthy">所有项目正常</p>
          ) : (
            <ul className="mw-diag-list">
              {flagged.map((report) => {
                const meta = STATE_META[report.state]
                return (
                  <li key={report.projectId} className="mw-diag-project" data-diag-project={report.projectId} data-diag-state={report.state}>
                    <div className="mw-diag-line">
                      <span className="mw-diag-name" title={report.title}>{report.title}</span>
                      <span className="mw-status mw-diag-state" data-tone={meta.tone} data-diag-state={report.state}>
                        <span className="mw-dot" data-hollow={report.state === 'unknown' ? 'true' : undefined} />
                        {meta.label}
                      </span>
                    </div>
                    {report.findings.length === 0 ? (
                      <p className="mw-dsh-muted mw-diag-nofinding">
                        {report.state === 'unknown' ? '没有足够的观察证据，状态待核对' : '宿主没有给出具体问题'}
                      </p>
                    ) : (
                      <ul className="mw-diag-findings">
                        {report.findings.map((finding, i) => (
                          <li
                            key={finding.code + '-' + i}
                            className="mw-diag-finding"
                            data-tone={SEVERITY_TONE[finding.severity]}
                            data-diag-finding={finding.code}
                            data-diag-severity={finding.severity}
                          >
                            <span className="mw-diag-detail">{finding.detail}</span>
                            {finding.action ? (
                              onNavigate ? (
                                <button type="button" className="mw-diag-action" data-diag-action={finding.code} onClick={() => onNavigate(report, finding)}>
                                  {finding.action}
                                </button>
                              ) : (
                                <span className="mw-diag-action" data-diag-action={finding.code}>{finding.action}</span>
                              )
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {migration !== null ? (
            <section className="mw-migration-report" data-migration-report="true" aria-label="注册表迁移报告">
              <div className="mw-diag-line">
                <span className="mw-eyebrow">注册表迁移报告</span>
                <span
                  className="mw-status"
                  data-tone={migration.readyForV2 ? 'ok' : 'warn'}
                  data-migration-ready={migration.readyForV2 ? 'true' : 'false'}
                >
                  <span className="mw-dot" />
                  {migration.readyForV2 ? 'v1 → v2 就绪' : 'v1 → v2 待处理'}
                </span>
              </div>
              <div className="mw-migration-metrics">
                <span className="mw-chip" data-mono="true" data-migration-schema="true">
                  Schema: {migration.registrySchema}
                </span>
                <span className="mw-chip" data-migration-projects="true">
                  项目: {migration.projectCount}
                  {migration.archivedCount > 0 ? `（归档 ${migration.archivedCount}）` : ''}
                </span>
                <span className="mw-chip" data-migration-corrupt="true">
                  损坏备份: {migration.corruptBackupCount}
                </span>
                <span className="mw-chip" data-migration-unclaimed="true">
                  未认领 Bundle: {migration.unclaimedBundleCount}
                </span>
                <span className="mw-chip" data-migration-legacy-schedule="true">
                  旧排期: {migration.legacyScheduleCount}
                </span>
              </div>
              {migration.corruptBackups.length > 0 ? (
                <div className="mw-migration-backups" data-migration-backups="true">
                  <span className="mw-dsh-muted">备份文件：</span>
                  {migration.corruptBackups.map((file) => (
                    <span key={file} className="mw-chip" data-mono="true">
                      {file}
                    </span>
                  ))}
                </div>
              ) : null}
              {migration.checks.length > 0 ? (
                <ul className="mw-migration-checks" data-migration-checks="true">
                  {migration.checks.map((check) => (
                    <li
                      key={check.id}
                      className="mw-migration-check"
                      data-tone={MIGRATION_CHECK_TONE[check.status]}
                      data-migration-check={check.id}
                      data-migration-check-status={check.status}
                    >
                      <span className="mw-dot" data-tone={MIGRATION_CHECK_TONE[check.status]} />
                      <span className="mw-diag-detail">
                        <strong>{check.label}</strong>
                        {check.detail ? ` · ${check.detail}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {result !== null && result.ok ? (
            <div className="mw-diag-foot">
              <button type="button" className="mw-dsh-btn" data-variant="ghost" data-size="sm" onClick={() => setNonce((n) => n + 1)}>
                重新诊断
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
