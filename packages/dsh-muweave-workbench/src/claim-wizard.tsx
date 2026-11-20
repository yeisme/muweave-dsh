import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { MuweaveRpcClient } from '@yeisme/dsh-muweave-core/client'

type ClaimStatus = 'preparing' | 'in_production' | 'ready_to_publish' | 'published'
const CLAIM_STATUSES: ReadonlyArray<{ value: ClaimStatus; label: string }> = [
  { value: 'preparing', label: '准备中' },
  { value: 'in_production', label: '制作中' },
  { value: 'ready_to_publish', label: '待发布' },
  { value: 'published', label: '已发布' },
]

/** A bundle whose manifest names a projectId that the project registry does not know yet. */
export interface ClaimCandidate {
  workspaceId: string
  label: string
  projectId: string
  /** Manifest/index title; undefined when the host did not project it. */
  title?: string
  revision?: number
  /** Undefined when neither index.counts.total nor index.elements is readable. */
  elementCount?: number
  /** The same projectId sits in more than one unclaimed workspace: never merged, the user picks one. */
  conflict: boolean
}

export type ClaimDiscovery = { ok: true; candidates: ClaimCandidate[] } | { ok: false; message: string }

/** The registry row project.claim hands back, already shape-checked. */
export interface ClaimedProject {
  id: string
  title: string
  status: string
  archived: boolean
  workspaceRefs: string[]
  updatedAt: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
/** project.claim is added to the host allowlist by the backend lane; the client sends any action as-is. */
const CLAIM_ACTION = 'project.claim' as Parameters<MuweaveRpcClient['call']>[0]
const newKey = (prefix: string) => prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2)

/** Keeps both ends of an opaque id visible: `proj_2026…a91f` reads better than a cut-off tail. */
export function truncateId(id: string, max = 18): string {
  if (id.length <= max) return id
  const head = Math.ceil((max - 1) / 2)
  return id.slice(0, head) + '…' + id.slice(id.length - (max - 1 - head))
}

function elementCountOf(index: Record<string, unknown>): number | undefined {
  const counts = index.counts
  if (isRecord(counts) && typeof counts.total === 'number' && Number.isFinite(counts.total)) return counts.total
  return Array.isArray(index.elements) ? index.elements.length : undefined
}

/**
 * F2 discovery (docs/design/project-features-next.md F2): workspace.list, then bundle.status per
 * workspace, minus every projectId the registry already holds (archived included).
 *
 * This costs one bundle.status per workspace, so it is never run at startup: callers only invoke it
 * when the user opens the claim entry (the project popover or the fallback notice's button).
 *
 * Anything unreadable is skipped rather than guessed: a workspace whose status call fails, that is
 * not initialized, or whose index has no string projectId is not a candidate (read failures belong to
 * F3 diagnostics). If the registry itself cannot be listed, nothing is offered, because a candidate
 * computed against an unknown registry could collide with an existing project.
 */
export async function discoverClaimCandidates(rpc: MuweaveRpcClient): Promise<ClaimDiscovery> {
  const [projectRes, workspaceRes] = await Promise.all([
    rpc.call<{ projects?: unknown }>('project.list', { includeArchived: true }),
    rpc.call<{ workspaces?: unknown }>('workspace.list', {}),
  ])
  const projects: unknown = projectRes?.ok ? projectRes.data?.projects : undefined
  if (!Array.isArray(projects)) return { ok: false, message: '读不到项目列表，暂时无法判断哪些 bundle 待认领。' }
  if (!workspaceRes?.ok) return { ok: false, message: '读不到 workspace 列表。' }
  const registered = new Set(projects.flatMap((p) => (isRecord(p) && nonEmpty(p.id) ? [p.id] : [])))
  const rawWorkspaces: unknown = workspaceRes.data?.workspaces
  const workspaces = (Array.isArray(rawWorkspaces) ? rawWorkspaces : []).flatMap((w) =>
    // hasBundle=false is a definite "nothing here"; a missing flag still gets asked.
    isRecord(w) && nonEmpty(w.workspaceId) && w.hasBundle !== false ? [{ workspaceId: w.workspaceId, label: nonEmpty(w.label) ? w.label : w.workspaceId }] : [],
  )
  const found = await Promise.all(
    workspaces.map(async (workspace): Promise<Omit<ClaimCandidate, 'conflict'> | null> => {
      try {
        const res = await rpc.call<{ initialized?: unknown; index?: unknown }>('bundle.status', { workspaceId: workspace.workspaceId })
        if (!res?.ok || res.data?.initialized !== true || !isRecord(res.data.index)) return null
        const index = res.data.index
        if (!nonEmpty(index.projectId) || registered.has(index.projectId)) return null
        return {
          ...workspace,
          projectId: index.projectId,
          title: nonEmpty(index.title) ? index.title : undefined,
          revision: typeof index.revision === 'number' ? index.revision : undefined,
          elementCount: elementCountOf(index),
        }
      } catch {
        return null
      }
    }),
  )
  const rows = found.filter((row): row is Omit<ClaimCandidate, 'conflict'> => row !== null)
  const seen = new Map<string, number>()
  for (const row of rows) seen.set(row.projectId, (seen.get(row.projectId) ?? 0) + 1)
  return { ok: true, candidates: rows.map((row) => ({ ...row, conflict: (seen.get(row.projectId) ?? 0) > 1 })) }
}

function readClaimedProject(raw: unknown): ClaimedProject | null {
  if (!isRecord(raw) || !nonEmpty(raw.id)) return null
  return {
    id: raw.id,
    title: nonEmpty(raw.title) ? raw.title : raw.id,
    status: nonEmpty(raw.status) ? raw.status : 'preparing',
    archived: raw.archived === true,
    workspaceRefs: Array.isArray(raw.workspaceRefs) ? raw.workspaceRefs.filter(nonEmpty) : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  }
}

const ERROR_TEXT: Record<string, string> = {
  'muweave/workspace_unknown': '这个 workspace 已不在注册表里，重新读取后再试。',
  'muweave/project_exists': '已有同 ID 的项目，认领不会再建第二条记录。重新读取后它会从待认领中消失。',
  'muweave/invalid_project_title': '标题需要 1–120 个字符。',
}

interface ClaimError {
  code: string
  message: string
}

/**
 * F2 claim wizard, at most two steps: pick a bundle, then confirm the registry title and status.
 * It only writes through project.claim, which registers the bundle's own projectId; the bundle is
 * never rewritten. Discovery is the caller's (it also feeds the entry's count), so `candidates` is
 * null while that read is in flight.
 */
export function ClaimWizard({
  rpc,
  candidates,
  error,
  initialWorkspaceId,
  onClaimed,
  onCancel,
  onReload,
}: {
  rpc: MuweaveRpcClient
  candidates: ClaimCandidate[] | null
  /** Discovery failure, shown instead of the list. */
  error?: string
  /** Opened from a specific bundle: jump straight to step 2 when it (or the only candidate) is found. */
  initialWorkspaceId?: string
  onClaimed: (project: ClaimedProject) => void | Promise<void>
  onCancel: () => void
  onReload: () => void
}) {
  const [picked, setPicked] = useState<ClaimCandidate | null>(null)
  const [jumped, setJumped] = useState(false)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<ClaimStatus>('preparing')
  /** One key per distinct submission: an identical retry reuses it, any edit mints a new one. */
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [busy, setBusy] = useState(false)
  /** A double click must not reach the host twice, even before `busy` has re-rendered. */
  const inflight = useRef(false)
  const [failure, setFailure] = useState<ClaimError | null>(null)

  const pick = (candidate: ClaimCandidate) => {
    setPicked(candidate)
    setTitle(candidate.label || candidate.title || candidate.projectId)
    setStatus('preparing')
    setIdempotencyKey(newKey('claim-' + candidate.projectId))
    setFailure(null)
  }

  useEffect(() => {
    if (jumped || candidates === null || initialWorkspaceId === undefined) return
    setJumped(true)
    const target = candidates.find((c) => c.workspaceId === initialWorkspaceId) ?? (candidates.length === 1 ? candidates[0] : undefined)
    if (target) pick(target)
  }, [candidates, initialWorkspaceId, jumped])

  // A reload can drop the picked bundle (claimed elsewhere); fall back to the list rather than submit a stale one.
  useEffect(() => {
    if (picked && candidates && !candidates.some((c) => c.workspaceId === picked.workspaceId)) setPicked(null)
  }, [candidates, picked])

  const edit = (apply: () => void) => {
    apply()
    setIdempotencyKey(newKey('claim-' + (picked?.projectId ?? '')))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!picked || !trimmed || inflight.current) return
    inflight.current = true
    setBusy(true)
    setFailure(null)
    try {
      const res = await rpc.call<{ project?: unknown; claimed?: unknown }>(CLAIM_ACTION, {
        workspaceId: picked.workspaceId,
        projectId: picked.projectId,
        title: trimmed,
        status,
        idempotencyKey,
      })
      if (!res?.ok) {
        setFailure({ code: res?.error?.code ?? 'muweave/unknown', message: res?.error?.message ?? '认领没有完成' })
        return
      }
      const project = readClaimedProject(res.data?.project)
      // ok without a usable project row is an unknown outcome: do not pretend it succeeded.
      if (!project || res.data?.claimed === false) {
        setFailure({ code: 'muweave/claim_unknown', message: '宿主没有返回认领结果，请重新读取确认是否已登记。' })
        return
      }
      await onClaimed(project)
    } catch (err) {
      setFailure({ code: 'muweave/unknown', message: err instanceof Error ? err.message : String(err) })
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }

  const step = picked ? 2 : 1
  const reloadable = failure ? /(workspace_unknown|project_exists|claim_unknown)$/.test(failure.code) : false

  return (
    <section className="mw-claim" data-claim-wizard="true" data-claim-step={String(step)} aria-label="认领旧 bundle">
      <header className="mw-claim-head">
        <span className="mw-eyebrow">认领旧 bundle</span>
        <ol className="mw-claim-steps" aria-label={'第 ' + step + ' 步，共 2 步'}>
          <li className="mw-claim-step" data-current={step === 1 ? 'true' : 'false'} aria-current={step === 1 ? 'step' : undefined}>
            选择
          </li>
          <li className="mw-claim-step" data-current={step === 2 ? 'true' : 'false'} aria-current={step === 2 ? 'step' : undefined}>
            确认
          </li>
        </ol>
      </header>

      {/* Re-keyed per step so each step fades in once. */}
      <div key={step} className="mw-claim-body">
        {picked ? (
          <form className="mw-claim-form" onSubmit={(event) => void submit(event)}>
            <dl className="mw-claim-facts">
              <dt>Workspace</dt>
              <dd title={picked.workspaceId}>{picked.label}</dd>
              <dt>bundle projectId</dt>
              <dd>
                <code className="mw-claim-id" data-claim-project-id={picked.projectId} title={picked.projectId}>
                  {picked.projectId}
                </code>
              </dd>
              {picked.revision !== undefined ? (
                <>
                  <dt>revision</dt>
                  <dd className="mw-claim-num">{picked.revision}</dd>
                </>
              ) : null}
            </dl>
            <label className="mw-field">
              <span>项目标题</span>
              <input
                className="mw-input"
                value={title}
                maxLength={120}
                autoFocus
                onChange={(event) => edit(() => setTitle(event.target.value))}
              />
            </label>
            <label className="mw-field">
              <span>状态</span>
              <select className="mw-input" value={status} onChange={(event) => edit(() => setStatus(event.target.value as ClaimStatus))}>
                {CLAIM_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mw-claim-note" data-claim-note="true">
              认领只登记，不会修改 bundle 里的 projectId；标题只写项目注册表，不改 bundle 内容。
            </p>
            {picked.conflict ? (
              <p className="mw-claim-note" data-claim-conflict="true">
                同一 projectId 还出现在其他 workspace，不会自动合并；只登记当前这一个。
              </p>
            ) : null}
            {failure ? (
              <div className="mw-claim-error" role="alert" data-claim-error={failure.code}>
                <span>{ERROR_TEXT[failure.code] ?? failure.message}</span>
                {reloadable ? (
                  <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={onReload}>
                    重新读取
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="mw-claim-actions">
              <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => setPicked(null)}>
                上一步
              </button>
              <span className="mw-spacer" />
              <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={onCancel}>
                取消
              </button>
              <button type="submit" className="mw-dsh-btn" data-variant="primary" data-size="sm" data-claim-submit="true" disabled={busy || !title.trim()}>
                认领并进入
              </button>
            </div>
          </form>
        ) : (
          <>
            {error ? (
              <div className="mw-claim-error" role="alert" data-claim-error="discovery">
                <span>{error}</span>
                <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={onReload}>
                  重新读取
                </button>
              </div>
            ) : candidates === null ? (
              <p className="mw-dsh-muted mw-claim-empty" data-claim-loading="true">
                正在检查工作区…
              </p>
            ) : candidates.length === 0 ? (
              <p className="mw-dsh-muted mw-claim-empty" data-claim-empty="true">
                没有待认领的 bundle
              </p>
            ) : (
              <ul className="mw-claim-list">
                {candidates.map((candidate, i) => (
                  <li key={candidate.workspaceId}>
                    <button
                      type="button"
                      className="mw-claim-item"
                      data-claim-item={candidate.workspaceId}
                      autoFocus={i === 0}
                      onClick={() => pick(candidate)}
                    >
                      <span className="mw-claim-item-label">{candidate.label}</span>
                      <code className="mw-claim-id" title={candidate.projectId}>
                        {truncateId(candidate.projectId)}
                      </code>
                      {candidate.conflict ? <span className="mw-chip">多 workspace 冲突</span> : null}
                      <span className="mw-claim-num">{candidate.elementCount === undefined ? '元件数未知' : candidate.elementCount + ' 个元件'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mw-claim-actions">
              <span className="mw-spacer" />
              <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={onCancel}>
                取消
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
