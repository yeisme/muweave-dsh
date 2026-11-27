import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Icon,
  getActiveTheaterRoomId,
  isEditableTarget,
  type JobRecordV1,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
} from '@yeisme/dsh-muweave-core/client'
import { coverDigest, shortTime, versionLabel, versionNumber } from './stage-map'

interface Candidate {
  artifactId: string
  handle?: string
  role?: string
  sha256?: string
}
interface CandidatePayload {
  runId?: string
  candidates?: Candidate[]
}
interface ShotRow {
  shotRef: string
  linkedMedia?: { sha256?: string; elementId?: string; artifactId?: string }[]
}
interface AuditEvent {
  ts: string
  event: string
  taskId?: string
  traceId?: string
  jobId?: string
}

const AXES = [
  { label: '角色一致性', keys: ['character_consistency', 'characterConsistency'] },
  { label: '光影匹配', keys: ['lighting_match', 'lightingMatch'] },
  { label: '构图可用', keys: ['composition', 'composition_usability', 'compositionUsability'] },
] as const

const EVENT_LABELS: Record<string, string> = {
  'task.delegated': '委派任务',
  'task.created': '创建任务',
  'task.cancelled': '取消任务',
  'job.completed': '完成生成',
  'job.failed': '生成失败',
}

function previousVersion(artifact: MuweaveElementSummaryV1, elements: readonly MuweaveElementSummaryV1[]): string {
  const current = versionLabel(artifact)
  const version = versionNumber(current)
  const previous = elements.filter((row) => {
    const other = versionNumber(versionLabel(row))
    return row.elementId !== artifact.elementId && row.kind === artifact.kind && row.sourceOwner === artifact.sourceOwner &&
      row.sourceRef === artifact.sourceRef && version !== undefined && other !== undefined && other < version
  }).sort((a, b) => versionNumber(versionLabel(b))! - versionNumber(versionLabel(a))!)[0]
  if (!previous) return '没有可比较的上一版记录'
  const difference = previous.digest === artifact.digest ? '内容一致' : '内容已更新'
  return [versionLabel(previous), ' → ', current, ' · ', difference].join('')
}

function assessmentAxes(score: Record<string, unknown> | undefined) {
  const nested = score?.scores as Record<string, unknown> | undefined
  return AXES.map(({ label, keys }) => {
    const value = keys.map((key) => score?.[key] ?? nested?.[key])
      .find((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 100)
    return { label, value }
  })
}

interface ReviewData {
  runId?: string
  candidates: Candidate[]
  candidate?: Candidate
  role: 'character' | 'scene'
  score?: Record<string, unknown>
  shots: string[]
  events: AuditEvent[]
  auditUnavailable: boolean
}

async function readReview(
  rpc: MuweaveRpcClient,
  artifact: MuweaveElementSummaryV1,
  elements: readonly MuweaveElementSummaryV1[],
  jobs: readonly JobRecordV1[] | undefined,
  workspaceId?: string,
  artifactId?: string,
): Promise<ReviewData> {
  const scope = workspaceId ? { workspaceId } : {}
  const readElement = async (elementId: string) => {
    const result = await rpc.call<{ element: MuweaveElementV1 }>('bundle.element.get', { ...scope, elementId })
    return result.ok ? result.data?.element?.payload : undefined
  }
  const full = artifact.kind === 'eikona.candidate_group' ? await readElement(artifact.elementId) as CandidatePayload | undefined : undefined
  const candidates = (full?.candidates ?? []).filter((item) => item.artifactId)
  const cover = coverDigest(artifact)
  const candidate = artifactId
    ? candidates.find((item) => item.artifactId === artifactId)
    : (cover ? candidates.find((item) => item.sha256 === cover) : undefined) ?? (candidates.length === 1 ? candidates[0] : undefined)
  const role = artifact.role === 'scene' || candidate?.role === 'scene' ? 'scene' : 'character'
  const assessmentRef = 'eikona://runs/' + full?.runId + '/assessment'
  const assessment = full?.runId && elements.find((row) => row.kind === 'eikona.assessment_card' && row.sourceRef === assessmentRef)
  const storyboardRows = elements.filter((row) => row.kind === 'drama.storyboard_table' && (!artifact.episodeRef || !row.episodeRef || row.episodeRef === artifact.episodeRef))
  const ownerJobs = jobs?.filter((item) => item.owner === artifact.sourceOwner)
  const mediaDigest = candidate ? candidate.sha256 : cover
  const job = ownerJobs?.find((item) => full?.runId && item.ownerJobRef === full.runId) ??
    ownerJobs?.find((item) => mediaDigest && item.slots.some((slot) => slot.sha256 === mediaDigest))
  const taskId = job?.requester?.taskId
  const [scorecard, boards, task] = await Promise.all([
    assessment ? readElement(assessment.elementId) as Promise<{ scores?: Record<string, unknown>[] } | undefined> : undefined,
    candidate ? Promise.all(storyboardRows.map((row) => readElement(row.elementId) as Promise<{ rows?: ShotRow[] } | undefined>)) : [],
    taskId ? rpc.call<{ task?: { taskId: string; traceId?: string } }>('task.get', { taskId }) : undefined,
  ])
  const score = candidate && scorecard?.scores?.find((row) => row.artifact_id === candidate.artifactId || row.artifactId === candidate.artifactId)
  const shots = new Set(artifact.shotRefs ?? [])
  for (const row of boards.flatMap((board) => board?.rows ?? [])) {
    if (row.linkedMedia?.some((link) => (candidate?.sha256 && link.sha256 === candidate.sha256) ||
      (link.elementId === artifact.elementId && link.artifactId === candidate?.artifactId))) shots.add(row.shotRef)
  }
  const traceId = job?.traceId ?? (task?.ok && task.data.task?.taskId === taskId ? task.data.task?.traceId : undefined)
  let events: AuditEvent[] = []
  let auditUnavailable = false
  if (traceId || taskId) {
    const result = await rpc.call<{ events?: AuditEvent[] }>('event.list', { ...(taskId ? { taskId } : { traceId }), limit: 50 })
    auditUnavailable = !result.ok
    if (result.ok) {
      events = (result.data.events ?? []).filter((event) => (taskId && event.taskId === taskId) ||
        (job?.jobId && event.jobId === job.jobId) || (traceId && event.traceId === traceId))
        .sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 6)
    }
  }
  return { runId: full?.runId, candidates, candidate, role, score, shots: [...shots], events, auditUnavailable }
}

export function VerdictPanel({ rpc, artifact, elements, jobs, workspaceId, onChanged, children }: {
  rpc: MuweaveRpcClient
  artifact: MuweaveElementSummaryV1 | undefined
  elements: readonly MuweaveElementSummaryV1[]
  jobs?: readonly JobRecordV1[]
  workspaceId?: string
  onChanged: () => Promise<void>
  children?: ReactNode
}) {
  const [review, setReview] = useState<ReviewData | undefined>()
  const [readFailed, setReadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [chosenArtifactId, setChosenArtifactId] = useState<string>()
  const [message, setMessage] = useState('')
  const [complete, setComplete] = useState(false)
  const inFlight = useRef(false)
  const acceptRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!artifact) return
    let cancelled = false
    setReadFailed(false)
    void readReview(rpc, artifact, elements, jobs, workspaceId, chosenArtifactId).then((value) => {
      if (!cancelled) setReview(value)
    }).catch(() => { if (!cancelled) setReadFailed(true) })
    return () => { cancelled = true }
  }, [rpc, artifact, elements, jobs, workspaceId, chosenArtifactId])

  const ready = Boolean(review?.runId && review.candidate?.artifactId && review.candidate.handle &&
    !readFailed && (!chosenArtifactId || review.candidate.artifactId === chosenArtifactId))

  const apply = async () => {
    if (inFlight.current || complete || !ready || !review?.runId || !review.candidate?.handle) return
    const { runId, candidate, role } = review
    inFlight.current = true
    setBusy(true)
    setMessage('')
    let accepted = false
    try {
      const scope = workspaceId ? { workspaceId } : {}
      const verb = await rpc.call<{ operation?: { status: string } }>('eikona.feedback.decide', {
        ...scope, runId, artifactId: candidate.artifactId, decision: 'accept', reason: 'composition',
        idempotencyKey: ['eikona-accept', runId, candidate.artifactId].join('-'),
      })
      accepted = verb.ok && verb.data.operation?.status === 'completed'
      if (!accepted) {
        setMessage('采纳未完成，请查看原操作回执。')
        return
      }
      const binding = await rpc.call<{ operation?: { status: string } }>('eikona.asset.bind', {
        ...scope, handle: candidate.handle, role, idempotencyKey: ['muweave-verdict-bind', role, candidate.handle].join('-'),
      })
      if (!binding.ok || binding.data.operation?.status !== 'completed') {
        setMessage('已采纳，母版绑定未完成。')
        await onChanged().catch(() => undefined)
        return
      }
      setComplete(true)
      setMessage('已通过并绑定母版。')
      await onChanged().catch(() => setMessage('已通过并绑定母版，工作台刷新失败。'))
    } catch {
      setMessage(accepted ? '已采纳，母版绑定结果待核对。' : '采纳结果待核对。')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || isEditableTarget(event.target) ||
        !event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.key !== 'Enter') return
      const room = getActiveTheaterRoomId()
      if (room && room !== 'muweave-workbench') return
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"], [data-popover]')) return
      const button = acceptRef.current
      if (!button || button.disabled) return
      const workspace = button.closest('[data-muweave-workspace-root]')
      const targetWorkspace = event.target instanceof Element ? event.target.closest('[data-muweave-workspace-root]') : null
      if (targetWorkspace && targetWorkspace !== workspace) return
      event.preventDefault()
      button.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const shots = review?.shots ?? artifact?.shotRefs ?? []
  return (
    <section className="mw-verdict" data-verdict-panel="true" aria-label="判定面板">
      <header className="mw-verdict-head"><h2>判定面板</h2>{artifact ? <span>{versionLabel(artifact)}</span> : null}</header>
      {review && review.candidates.length > 1 ? (
        <label className="mw-field">
          <span>审阅候选</span>
          <select className="mw-input" value={chosenArtifactId ?? review.candidate?.artifactId ?? ''} disabled={busy} onChange={(event) => {
            setChosenArtifactId(event.currentTarget.value || undefined)
            setMessage('')
            setComplete(false)
          }}>
            <option value="" disabled>选择候选</option>
            {review.candidates.map((item, index) => <option key={item.artifactId} value={item.artifactId}>候选 {index + 1}</option>)}
          </select>
        </label>
      ) : null}
      <section className="mw-verdict-section" aria-label="质量三轴">
        <h3>质量三轴</h3>
        <dl className="mw-verdict-axes">
          {assessmentAxes(review?.score).map(({ label, value }) => (
            <div key={label}><dt>{label}</dt><dd>{value ?? '未评估'}</dd></div>
          ))}
        </dl>
      </section>
      <section className="mw-verdict-section"><h3>与上一版的差异</h3><p>{artifact ? previousVersion(artifact, elements) : '等待选择产物'}</p></section>
      <section className="mw-verdict-section">
        <h3>绑定镜头</h3>
        {shots.length ? <ul className="mw-verdict-shots">{shots.map((ref) => <li key={ref} className="mw-chip">{ref}</li>)}</ul> : <p>没有绑定记录</p>}
      </section>
      <section className="mw-verdict-section">
        <h3>审计时间线</h3>
        {review?.events.length ? (
          <ol className="mw-verdict-events">
            {review.events.map((event, index) => <li key={event.ts + event.event + index}><span title={event.event}>{EVENT_LABELS[event.event] ?? '更新记录'}</span><time dateTime={event.ts}>{shortTime(event.ts)}</time></li>)}
          </ol>
        ) : <p>{review?.auditUnavailable ? '审计记录暂不可读' : '没有关联的审计事件'}</p>}
      </section>
      <div className="mw-verdict-footer">
        <button ref={acceptRef} type="button" className="mw-dsh-btn" data-variant="primary" aria-keyshortcuts="Meta+Enter" disabled={!ready || busy || complete} onClick={() => void apply()}>
          <Icon name="check" />通过并绑定<kbd aria-hidden="true">⌘↵</kbd>
        </button>
        {message ? <p role="status">{message}</p> : !ready ? <p>{readFailed ? '判定数据暂不可读' : '等待可绑定的视觉候选'}</p> : null}
      </div>
      {children ? <details className="mw-verdict-details"><summary>更多详情</summary>{children}</details> : null}
    </section>
  )
}
