import { useState, type FormEvent } from 'react'
import type { MuweaveRpcClient } from '@yeisme/dsh-muweave-core/client'
import { shortTime } from './stage-map'

export type BindingOwner = 'eikona' | 'auctra' | 'scaena' | 'pi'
export type BindingState = 'bound' | 'uninitialized' | 'unavailable' | 'conflict'

/** Mirrors ProjectOwnerBindingV1; every field is read defensively because the host shape is still moving. */
export interface OwnerBindingRow {
  workspaceId: string
  owner: BindingOwner
  refs: string[]
  bindingState: BindingState
  updatedAt?: string
}

const STATE_META: Record<BindingState, { label: string; tone: 'ok' | 'neutral' | 'warn' | 'bad' }> = {
  bound: { label: '已绑定', tone: 'ok' },
  uninitialized: { label: '未初始化', tone: 'neutral' },
  unavailable: { label: '不可用', tone: 'warn' },
  conflict: { label: '冲突', tone: 'bad' },
}

const rowKey = (b: Pick<OwnerBindingRow, 'workspaceId' | 'owner'>) => b.workspaceId + '/' + b.owner
const newKey = (prefix: string) => prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2)

/** Drops malformed rows instead of letting one bad binding blank the inspector. */
function readBindings(raw: unknown): OwnerBindingRow[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const b = (item ?? {}) as Partial<OwnerBindingRow>
    if (typeof b.workspaceId !== 'string' || typeof b.owner !== 'string') return []
    const refs = Array.isArray(b.refs) ? b.refs.filter((r): r is string => typeof r === 'string') : []
    const bindingState = b.bindingState && b.bindingState in STATE_META ? b.bindingState : 'uninitialized'
    return [{ workspaceId: b.workspaceId, owner: b.owner, refs, bindingState, updatedAt: typeof b.updatedAt === 'string' ? b.updatedAt : undefined }]
  })
}

interface RpcError {
  code: string
  message: string
}

/**
 * F1 binding inspector (docs/design/project-features-next.md F1). Reads `ownerBindings` from the
 * project record the caller already holds; writes only through project.bind / project.unbind and
 * then asks the caller to re-read, so the shown state is always what the registry answered.
 */
export function BindingInspector({
  rpc,
  project,
  onChanged,
}: {
  rpc: MuweaveRpcClient
  project: { id: string; ownerBindings?: unknown }
  onChanged: () => void | Promise<void>
}) {
  const bindings = readBindings(project.ownerBindings)
  /** One open replace form at a time: which row, which ref, and the draft value. */
  const [replacing, setReplacing] = useState<{ key: string; oldRef: string; value: string } | null>(null)
  const [confirmUnbind, setConfirmUnbind] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<RpcError | null>(null)

  const run = async (action: 'project.bind' | 'project.unbind', payload: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await rpc.call<{ project?: unknown; removed?: boolean }>(action, payload)
      if (!res?.ok) {
        setError({ code: res?.error?.code ?? 'muweave/unknown', message: res?.error?.message ?? '操作没有完成' })
        return false
      }
      await onChanged()
      return true
    } catch (err) {
      setError({ code: 'muweave/unknown', message: err instanceof Error ? err.message : String(err) })
      return false
    } finally {
      setBusy(false)
    }
  }

  /** Swaps exactly one ref and submits the full list once; the server never merges refs for us. */
  const submitReplace = async (event: FormEvent, binding: OwnerBindingRow) => {
    event.preventDefault()
    const next = replacing?.value.trim()
    if (!replacing || !next || next === replacing.oldRef) return
    const refs = [...new Set(binding.refs.map((ref) => (ref === replacing.oldRef ? next : ref)))]
    const ok = await run('project.bind', {
      projectId: project.id,
      workspaceId: binding.workspaceId,
      owner: binding.owner,
      refs,
      idempotencyKey: newKey('rebind-' + project.id),
    })
    // On failure the draft stays, so a revision conflict can be retried without retyping.
    if (ok) setReplacing(null)
  }

  const submitUnbind = async (binding: OwnerBindingRow) => {
    const ok = await run('project.unbind', {
      projectId: project.id,
      workspaceId: binding.workspaceId,
      owner: binding.owner,
      refs: binding.refs,
      idempotencyKey: newKey('unbind-' + project.id),
    })
    if (ok) setConfirmUnbind(null)
  }

  const conflict = error ? /revision_conflict$/.test(error.code) : false

  return (
    <section className="mw-bind" data-binding-inspector="true" aria-label="绑定">
      <div className="mw-bind-head">
        <span className="mw-eyebrow">绑定</span>
        <span className="mw-bind-count">{bindings.length}</span>
      </div>
      {bindings.length === 0 ? (
        <p className="mw-dsh-muted mw-bind-empty" data-binding-empty="true">
          这个项目还没有绑定 owner
        </p>
      ) : (
        <ul className="mw-bind-list">
          {bindings.map((binding) => {
            const key = rowKey(binding)
            const meta = STATE_META[binding.bindingState]
            return (
              <li key={key} className="mw-bind-row" data-binding-row={key} data-binding-owner={binding.owner}>
                <div className="mw-bind-line">
                  <span className="mw-status mw-bind-state" data-tone={meta.tone} data-binding-state={binding.bindingState}>
                    <span className="mw-dot" />
                    {meta.label}
                  </span>
                  <span className="mw-bind-ws" title={binding.workspaceId}>
                    {binding.workspaceId}
                  </span>
                  {binding.updatedAt ? <span className="mw-bind-time">{shortTime(binding.updatedAt)}</span> : null}
                  <span className="mw-chip mw-bind-owner">{binding.owner}</span>
                </div>
                {binding.refs.length === 0 ? (
                  <p className="mw-dsh-muted mw-bind-norefs">没有 ref</p>
                ) : (
                  <ul className="mw-bind-refs">
                    {binding.refs.map((ref) =>
                      replacing?.key === key && replacing.oldRef === ref ? (
                        <li key={ref} className="mw-bind-ref">
                          <form className="mw-bind-form" onSubmit={(event) => void submitReplace(event, binding)}>
                            <input
                              className="mw-input"
                              aria-label={'替换 ' + ref}
                              value={replacing.value}
                              onChange={(event) => setReplacing({ ...replacing, value: event.target.value })}
                              autoFocus
                            />
                            <button
                              type="submit"
                              className="mw-dsh-btn"
                              data-variant="primary"
                              data-size="sm"
                              disabled={busy || !replacing.value.trim() || replacing.value.trim() === ref}
                            >
                              确认替换
                            </button>
                            <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => setReplacing(null)}>
                              取消
                            </button>
                          </form>
                        </li>
                      ) : (
                        <li key={ref} className="mw-bind-ref">
                          <code className="mw-bind-ref-text" title={ref}>
                            {ref}
                          </code>
                          <button
                            type="button"
                            className="mw-dsh-btn"
                            data-variant="ghost"
                            data-size="sm"
                            disabled={busy}
                            onClick={() => {
                              setConfirmUnbind(null)
                              setReplacing({ key, oldRef: ref, value: ref })
                            }}
                          >
                            替换
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                )}
                {confirmUnbind === key ? (
                  <div className="mw-bind-confirm" role="alertdialog" aria-label="确认解绑">
                    <span className="mw-dsh-muted">将移除 {binding.refs.length} 个 ref，不会删除 owner 原件。</span>
                    <span className="mw-row" data-gap="xs">
                      <button type="button" className="mw-dsh-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void submitUnbind(binding)}>
                        确认解绑
                      </button>
                      <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => setConfirmUnbind(null)}>
                        取消
                      </button>
                    </span>
                  </div>
                ) : binding.refs.length > 0 ? (
                  <div className="mw-bind-actions">
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-variant="quiet"
                      data-size="sm"
                      disabled={busy}
                      onClick={() => {
                        setReplacing(null)
                        setConfirmUnbind(key)
                      }}
                    >
                      解绑
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {error ? (
        <div className="mw-bind-error" role="alert" data-binding-error={error.code}>
          <span>{conflict ? 'bundle 已被其他操作更新，你的输入已保留。' : error.message}</span>
          {conflict ? (
            <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => void Promise.resolve(onChanged()).then(() => setError(null))}>
              重新读取并重试
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
