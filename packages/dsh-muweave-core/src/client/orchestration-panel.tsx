/**
 * Orchestration & Circuit-Breaker Control Panel inside GenerationDrawer.
 * Visualizes `bot.roster` (with `bot.pause` circuit-breaker toggle + optimistic lock),
 * `task.list` (with `orphanedCount` warning), `task.trace`, and `task.cancel` cascade receipts.
 */

import { useCallback, useEffect, useState } from 'react'
import type { MuweaveTranslator } from './i18n'
import { tr } from './generation-jobs'
import type { MuweaveRpcClient } from './rpc-client'
import { Callout, EmptyState, SectionHead, StatusTag } from './ui'

interface RosterBotItem {
  botId: string
  role: 'manager' | 'worker' | string
  state: 'active' | 'paused' | 'retired' | string
  capabilityGrants?: readonly string[]
  budgetEnvelope?: { unit?: string; amount?: number }
  revision?: number
}

interface TaskListItem {
  taskId: string
  workspaceId?: string
  parentTaskRef?: string
  rootTaskId?: string
  assignedTo?: { botId?: string }
  goal?: string
  status: string
  depth?: number
  traceId?: string
  revision?: number
}

interface TaskTraceData {
  jobs?: ReadonlyArray<{ jobId?: string; capabilityId?: string; status?: string }>
  events?: ReadonlyArray<{ event?: string; status?: string; ts?: string }>
  task?: { traceId?: string; payloadDigest?: string; status?: string }
}

const TERMINAL_TASK_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])

function makeIdempotencyKey(prefix: string): string {
  const c = globalThis.crypto as Crypto | undefined
  return c?.randomUUID ? `${prefix}-${c.randomUUID()}` : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function formatBudgetEnvelope(env: RosterBotItem['budgetEnvelope'], isEn: boolean): string {
  if (!env || !env.unit || env.unit === 'none') return isEn ? 'No spend cap' : '无费用限额'
  if (env.amount === undefined) return env.unit.toUpperCase()
  return env.unit === 'usd' ? `$${env.amount}` : `${env.amount} ${env.unit}`
}

export function OrchestrationPanel({
  rpc,
  t,
}: {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
}) {
  const lang = tr(t, 'langCode') === 'en' ? 'en' : 'zh'
  const isEn = lang === 'en'

  const [bots, setBots] = useState<RosterBotItem[]>([])
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [orphanedCount, setOrphanedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [receipt, setReceipt] = useState<string | undefined>(undefined)
  const [traces, setTraces] = useState<Record<string, TaskTraceData>>({})
  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(() => new Set())

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [rosterRes, tasksRes] = await Promise.allSettled([
      rpc.call<{ bots?: RosterBotItem[] }>('bot.roster', {}),
      rpc.call<{ tasks?: TaskListItem[]; orphanedCount?: number }>('task.list', {}),
    ])
    if (rosterRes.status === 'fulfilled' && rosterRes.value?.ok && Array.isArray(rosterRes.value.data?.bots)) {
      setBots(rosterRes.value.data.bots)
    } else {
      setBots([])
    }
    if (tasksRes.status === 'fulfilled' && tasksRes.value?.ok && tasksRes.value.data) {
      const list = Array.isArray(tasksRes.value.data.tasks) ? tasksRes.value.data.tasks : []
      setTasks(list)
      const oc =
        typeof tasksRes.value.data.orphanedCount === 'number' && Number.isFinite(tasksRes.value.data.orphanedCount)
          ? Math.max(0, tasksRes.value.data.orphanedCount)
          : list.filter((item) => item.status === 'orphaned').length
      setOrphanedCount(oc)
    } else {
      setTasks([])
      setOrphanedCount(0)
    }
    setLoading(false)
  }, [rpc])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const handleTogglePause = async (bot: RosterBotItem) => {
    setBusyId(bot.botId)
    setError(undefined)
    setReceipt(undefined)
    const nextPaused = bot.state !== 'paused'
    const res = await rpc.call<{ bot?: RosterBotItem }>('bot.pause', {
      botId: bot.botId,
      paused: nextPaused,
      ...(typeof bot.revision === 'number' ? { expectedRevision: bot.revision } : {}),
      idempotencyKey: makeIdempotencyKey(`pause-${bot.botId}`),
    })
    setBusyId(undefined)
    if (!res.ok) {
      setError(res.error.message || res.error.code)
      return
    }
    setReceipt(
      isEn
        ? `${bot.botId} is now ${nextPaused ? 'paused' : 'active'}.`
        : `${bot.botId} 已切换为${nextPaused ? '暂停（断路器触发）' : '运行中'}。`,
    )
    await loadAll()
  }

  const handleToggleTrace = async (taskId: string) => {
    if (expandedTraces.has(taskId)) {
      setExpandedTraces((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
      return
    }
    setBusyId(`trace:${taskId}`)
    setError(undefined)
    const res = await rpc.call<TaskTraceData>('task.trace', { taskId })
    setBusyId(undefined)
    if (!res.ok) {
      setError(res.error.message || res.error.code)
      return
    }
    setTraces((prev) => ({ ...prev, [taskId]: res.data ?? {} }))
    setExpandedTraces((prev) => new Set(prev).add(taskId))
  }

  const handleCascadeCancel = async (taskId: string) => {
    setBusyId(`cancel:${taskId}`)
    setError(undefined)
    setReceipt(undefined)
    const res = await rpc.call<{ cancelledTaskIds?: string[]; cancelledJobIds?: string[] }>('task.cancel', { taskId })
    setBusyId(undefined)
    if (!res.ok) {
      setError(res.error.message || res.error.code)
      return
    }
    const cancelledTasks = res.data?.cancelledTaskIds ?? []
    const cancelledJobs = res.data?.cancelledJobIds ?? []
    setReceipt(
      isEn
        ? `Cascade cancelled ${cancelledTasks.length} task(s) and ${cancelledJobs.length} active job(s).`
        : `已级联取消 ${cancelledTasks.length} 个任务与 ${cancelledJobs.length} 个活跃生成作业。`,
    )
    await loadAll()
  }

  const pausedCount = bots.filter((b) => b.state === 'paused').length

  return (
    <div className="mw-orch-panel" data-muweave-orchestration-panel="true">
      {error ? (
        <Callout tone="bad" role="alert">
          {error}
        </Callout>
      ) : null}
      {receipt ? (
        <Callout tone="ok" role="status">
          <span data-orchestration-receipt="true">{receipt}</span>
        </Callout>
      ) : null}

      <section className="mw-stack" data-gap="xs" data-orchestration-bots="true">
        <SectionHead
          title={isEn ? 'Bots & Circuit Breaker' : 'Bot 与断路器'}
          meta={
            pausedCount > 0
              ? isEn
                ? `${pausedCount} paused`
                : `${pausedCount} 已暂停`
              : String(bots.length)
          }
          actions={
            <button
              type="button"
              className="mw-dsh-btn"
              data-variant="ghost"
              data-size="sm"
              disabled={loading}
              onClick={() => void loadAll()}
            >
              {isEn ? 'Refresh' : '刷新'}
            </button>
          }
        />
        {bots.length === 0 ? (
          <EmptyState>{isEn ? 'No bots registered in roster.' : '当前花名册暂无 Bot。'}</EmptyState>
        ) : (
          <ul className="mw-stack" data-gap="xs">
            {bots.map((bot) => {
              const isPaused = bot.state === 'paused'
              const capCount = bot.capabilityGrants?.length ?? 0
              return (
                <li key={bot.botId} className="mw-orch-bot-row" data-bot-id={bot.botId} data-bot-state={bot.state}>
                  <div className="mw-spread">
                    <div className="mw-row" data-gap="xs">
                      <span className="mw-title">{bot.botId}</span>
                      <span className="mw-chip">{bot.role}</span>
                      <StatusTag
                        status={bot.state}
                        lang={lang}
                        label={
                          isPaused
                            ? isEn
                              ? 'Paused'
                              : '已暂停'
                            : bot.state === 'active'
                              ? isEn
                                ? 'Active'
                                : '运行中'
                              : bot.state
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-variant={isPaused ? 'primary' : 'quiet'}
                      data-size="sm"
                      disabled={busyId === bot.botId || bot.state === 'retired'}
                      data-bot-toggle-pause={bot.botId}
                      onClick={() => void handleTogglePause(bot)}
                    >
                      {isPaused ? (isEn ? 'Resume' : '恢复') : isEn ? 'Pause breaker' : '暂停断路器'}
                    </button>
                  </div>
                  <div className="mw-row" data-gap="xs">
                    <span className="mw-dsh-muted">
                      {isEn ? `Capabilities: ${capCount}` : `授权能力：${capCount}`}
                    </span>
                    <span className="mw-dsh-muted">·</span>
                    <span className="mw-dsh-muted">{formatBudgetEnvelope(bot.budgetEnvelope, isEn)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="mw-stack" data-gap="xs" data-orchestration-tasks="true">
        <SectionHead
          title={isEn ? 'Delegated Task Trees & Trace' : '委派任务树与轨迹'}
          meta={String(tasks.length)}
        />
        {orphanedCount > 0 ? (
          <div data-orphaned-task-count={String(orphanedCount)}>
            <Callout tone="warn" role="status">
              {isEn
                ? `${orphanedCount} orphaned task(s) detected; inspect trace or cascade cancel.`
                : `检测到 ${orphanedCount} 个孤儿任务（orphaned），请查看轨迹或级联取消。`}
            </Callout>
          </div>
        ) : null}
        {tasks.length === 0 ? (
          <EmptyState>{isEn ? 'No delegated tasks recorded.' : '暂无委派任务记录。'}</EmptyState>
        ) : (
          <ul className="mw-stack" data-gap="xs">
            {tasks.map((task) => {
              const isTerminal = TERMINAL_TASK_STATUSES.has(task.status)
              const traceOpen = expandedTraces.has(task.taskId)
              const trace = traces[task.taskId]
              return (
                <li key={task.taskId} className="mw-orch-task-row" data-task-id={task.taskId} data-task-status={task.status}>
                  <div className="mw-spread">
                    <div className="mw-row" data-gap="xs">
                      <span className="mw-chip" data-mono="true">
                        {`D${task.depth ?? 0}`}
                      </span>
                      <span className="mw-title">{task.goal || task.taskId}</span>
                    </div>
                    <StatusTag status={task.status} lang={lang} />
                  </div>
                  <div className="mw-spread">
                    <div className="mw-row" data-gap="xs">
                      <span className="mw-dsh-code">{task.taskId}</span>
                      {task.assignedTo?.botId ? <span className="mw-chip">{task.assignedTo.botId}</span> : null}
                    </div>
                    <div className="mw-row" data-gap="xs">
                      <button
                        type="button"
                        className="mw-dsh-btn"
                        data-variant="ghost"
                        data-size="sm"
                        disabled={busyId === `trace:${task.taskId}`}
                        data-task-trace-btn={task.taskId}
                        aria-expanded={traceOpen}
                        onClick={() => void handleToggleTrace(task.taskId)}
                      >
                        {isEn ? 'Trace' : '查看轨迹'}
                      </button>
                      {!isTerminal ? (
                        <button
                          type="button"
                          className="mw-dsh-btn"
                          data-variant="danger"
                          data-size="sm"
                          disabled={busyId === `cancel:${task.taskId}`}
                          data-task-cancel-btn={task.taskId}
                          onClick={() => void handleCascadeCancel(task.taskId)}
                        >
                          {isEn ? 'Cascade cancel' : '级联取消'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {traceOpen && trace ? (
                    <div className="mw-orch-trace" data-task-trace-panel={task.taskId}>
                      <div className="mw-row" data-gap="xs">
                        <span className="mw-chip">
                          {isEn ? `Jobs: ${trace.jobs?.length ?? 0}` : `关联作业：${trace.jobs?.length ?? 0}`}
                        </span>
                        <span className="mw-chip">
                          {isEn ? `Events: ${trace.events?.length ?? 0}` : `事件数：${trace.events?.length ?? 0}`}
                        </span>
                        {trace.task?.traceId ? (
                          <span className="mw-dsh-code">{trace.task.traceId}</span>
                        ) : null}
                      </div>
                      {trace.jobs && trace.jobs.length > 0 ? (
                        <ul className="mw-stack" data-gap="xs">
                          {trace.jobs.map((j, idx) => (
                            <li key={j.jobId ?? idx} className="mw-dsh-muted">
                              {`${j.jobId ?? 'job'} · ${j.capabilityId ?? ''} · ${j.status ?? ''}`}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mw-dsh-muted">
                          {isEn ? 'No linked jobs recorded in trace.' : '轨迹中暂无关联生成作业。'}
                        </p>
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
