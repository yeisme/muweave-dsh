import { useCallback, useEffect, useRef, useState } from 'react'
import {
  formatKeyHint,
  getActiveTheaterRoomId,
  isEditableTarget,
  keyBinding,
  matchKey,
  useKeySequence,
  type JobRecordV1,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type ScheduleBoardV1,
  type ScheduleEntryViewV1,
} from '@yeisme/dsh-muweave-core/client'
import { SPINE_STAGE_IDS, STAGES, STAGE_IDS, pendingCount, stageDotState, stageLabel, stepAmongStages, type SpineStageId, type StageDotState, type StageId } from './stage-map'
import { stageSpineMetrics, type SpineMetric, type SpineShotRow, type StageSpineGroups } from './stage-spine-data'

const OVERVIEW_ROOM_ID = 'muweave-workbench'

const NEXT_STAGE = keyBinding('stage-next')
const PREV_STAGE = keyBinding('stage-prev')

function StageDot({ state }: { state: StageDotState | 'blocked' }) {
  return (
    <svg className="mw-stage-dot" data-state={state} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <circle cx="5" cy="5" r="4.25" />
      {state === 'doing' ? <path className="mw-stage-dot-half" d="M5 .75a4.25 4.25 0 0 1 0 8.5Z" /> : null}
    </svg>
  )
}

function useStageNavigation<T extends SpineStageId>(stages: readonly T[], current: T, onSelect: (stage: T) => void) {
  const rootRef = useRef<HTMLElement | null>(null)
  const currentRef = useRef(current)
  currentRef.current = current
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const onSequence = useCallback((sequence: string[]) => {
    const digit = sequence[1] ?? ''
    const stage = /^[1-9]$/.test(digit) ? stages[Number(digit) - 1] : undefined
    if (stage) onSelectRef.current(stage)
  }, [stages])
  const feedSequence = useKeySequence(onSequence, 800)

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.isComposing || isEditableTarget(ev.target)) return
      if (ev.target instanceof Element && ev.target.closest('[role="dialog"], [role="menu"]')) return
      const room = getActiveTheaterRoomId()
      if (room && room !== OVERVIEW_ROOM_ID) return
      if (!rootRef.current?.isConnected) return
      if (feedSequence(ev)) return
      if (NEXT_STAGE && matchKey(ev, NEXT_STAGE)) onSelectRef.current(stepAmongStages(stages, currentRef.current, 1))
      else if (PREV_STAGE && matchKey(ev, PREV_STAGE)) onSelectRef.current(stepAmongStages(stages, currentRef.current, -1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [feedSequence, stages])
  return rootRef
}

export function StageAxis({
  groups,
  current,
  onSelect,
  lang,
}: {
  groups: Record<StageId, readonly MuweaveElementSummaryV1[]>
  current: StageId
  onSelect: (stage: StageId) => void
  lang: string
}) {
  const rootRef = useStageNavigation(STAGE_IDS, current, onSelect)
  const active = STAGES.filter((s) => (groups[s.id]?.length ?? 0) > 0).length
  const en = lang === 'en'

  return (
    <nav ref={rootRef} className="mw-stage-axis" data-stage-axis="true" data-stage-region="axis" aria-label={en ? 'Stages' : '阶段'}>
      <div className="mw-stage-axis-head">
        <span>{en ? 'Stages' : '阶段'}</span>
        <span className="mw-stage-num">
          {active} / {STAGES.length}
        </span>
      </div>
      <ul className="mw-stage-axis-list">
        {STAGES.map((stage) => {
          const rows = groups[stage.id] ?? []
          const pending = pendingCount(rows)
          const isCurrent = stage.id === current
          const label = en ? stage.labelEn : stage.labelZh
          return (
            <li key={stage.id}>
              <button
                type="button"
                className="mw-stage-row"
                data-stage-axis-row={stage.id}
                data-current={isCurrent ? 'true' : 'false'}
                data-empty={rows.length === 0 ? 'true' : 'false'}
                aria-current={isCurrent ? 'step' : undefined}
                // The 9rem axis at 64rem can clip the name; the tooltip carries it in full.
                title={label}
                // One Tab stop for the whole axis (desk v8 P2); arrows and j / k move between rows.
                tabIndex={isCurrent ? 0 : -1}
                onClick={() => onSelect(stage.id)}
              >
                <StageDot state={stageDotState(rows)} />
                <span className="mw-stage-name">{label}</span>
                <span className="mw-stage-pending" data-zero={pending === 0 ? 'true' : 'false'} title={en ? 'Pending' : '待处理'}>
                  {rows.length === 0 ? '—' : pending}
                </span>
                <span className="mw-stage-total" title={en ? 'Total' : '总数'}>
                  {rows.length}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {(groups.sound?.length ?? 0) === 0 ? (
        <p className="mw-stage-axis-note">{en ? 'No sound owner ships elements yet.' : '声音暂无真实产物，接入数据后启用。'}</p>
      ) : null}
      <dl className="mw-stage-axis-keys">
        <dt>
          <kbd>{formatKeyHint('j')}</kbd>
        </dt>
        <dd>{en ? 'Next stage' : '下一阶段'}</dd>
        <dt>
          <kbd>{formatKeyHint('k')}</kbd>
        </dt>
        <dd>{en ? 'Previous stage' : '上一阶段'}</dd>
        <dt>
          <kbd>G 1–{STAGES.length}</kbd>
        </dt>
        <dd>{en ? 'Jump to stage N' : '跳到第 N 阶段'}</dd>
      </dl>
    </nav>
  )
}

export function useStageSpineJobs(rpc: MuweaveRpcClient, workspaceId?: string, refreshKey?: unknown): JobRecordV1[] | undefined {
  const [snapshot, setSnapshot] = useState<{ rpc: MuweaveRpcClient; workspaceId?: string; jobs?: JobRecordV1[] }>()
  useEffect(() => {
    const abort = new AbortController()
    const request = async () => {
      let jobs: JobRecordV1[] | undefined
      try {
        const response = await rpc.call<{ jobs?: JobRecordV1[] } | JobRecordV1[]>('job.list', workspaceId ? { workspaceId } : {}, abort.signal)
        if (response.ok) {
          const { data } = response
          const list = Array.isArray(data) ? data : data?.jobs
          if (Array.isArray(list)) jobs = list
        }
      } finally {
        if (!abort.signal.aborted) setSnapshot({ rpc, workspaceId, jobs })
      }
    }
    void request().catch(() => undefined)
    return () => abort.abort()
  }, [rpc, workspaceId, refreshKey])
  return snapshot?.rpc === rpc && snapshot.workspaceId === workspaceId ? snapshot.jobs : undefined
}

const METRICS: readonly { id: SpineMetric; label: string; short: string; en: string; enShort: string }[] = [
  { id: 'total', label: '产物件数', short: '件', en: 'Artifacts', enShort: 'All' },
  { id: 'review', label: '待审件数', short: '审', en: 'Waiting review', enShort: 'Rev' },
  { id: 'stale', label: '基线过期', short: '旧', en: 'Stale baselines', enShort: 'Old' },
  { id: 'shots', label: '关联镜头', short: '镜', en: 'Shot references', enShort: 'Shot' },
  { id: 'overdue', label: '排期逾期', short: '逾', en: 'Overdue schedule entries', enShort: 'Due' },
]

export function StageSpine({
  rpc,
  groups,
  current,
  onSelect,
  lang,
  projectId,
  workspaceId,
  refreshKey,
  jobs,
  bundleAvailable = true,
}: {
  rpc: MuweaveRpcClient
  groups: StageSpineGroups
  current: SpineStageId
  onSelect: (stage: SpineStageId) => void
  lang: string
  projectId?: string
  workspaceId?: string
  refreshKey?: unknown
  jobs?: readonly JobRecordV1[]
  bundleAvailable?: boolean
}) {
  const rootRef = useStageNavigation(SPINE_STAGE_IDS, current, onSelect)
  const [board, setBoard] = useState<{ rpc: MuweaveRpcClient; entries?: ScheduleEntryViewV1[] }>()
  const [shots, setShots] = useState<{ rpc: MuweaveRpcClient; matches: StageSpineGroups['storyboard']; workspaceId?: string; rows?: SpineShotRow[] }>()
  useEffect(() => {
    const abort = new AbortController()
    const request = async () => {
      let entries: ScheduleEntryViewV1[] | undefined
      try {
        const response = await rpc.call<ScheduleBoardV1>('schedule.list', {}, abort.signal)
        if (response.ok && Array.isArray(response.data?.entries)) entries = response.data.entries
      } finally {
        if (!abort.signal.aborted) setBoard({ rpc, entries })
      }
    }
    void request().catch(() => undefined)
    return () => abort.abort()
  }, [rpc, projectId, refreshKey])

  const tables = groups.storyboard
  useEffect(() => {
    const ids = tables.filter((el) => el.kind === 'drama.storyboard_table').map((el) => el.elementId)
    if (!ids.length) return undefined
    const abort = new AbortController()
    const load = async () => {
      const replies = await Promise.all(ids.map((elementId) => rpc.call<{ element: MuweaveElementV1<{ rows?: SpineShotRow[] }> }>(
        'bundle.element.get', { elementId, ...(workspaceId ? { workspaceId } : {}) }, abort.signal,
      )))
      const results = replies.map((response) => response.ok ? response.data?.element?.payload?.rows : undefined)
      const rows = results.every(Array.isArray) ? results.flatMap((result) => (result ?? []).filter((row) => row && typeof row.shotRef === 'string' && row.shotRef)) : undefined
      if (!abort.signal.aborted) setShots({ rpc, matches: tables, workspaceId, rows })
    }
    void load().catch(() => undefined)
    return () => abort.abort()
  }, [rpc, tables, workspaceId])

  const en = lang === 'en'
  const metrics = stageSpineMetrics({
    groups,
    jobs,
    projectId,
    entries: board?.rpc === rpc ? board.entries : undefined,
    storyboardRows: shots?.rpc === rpc && shots.matches === tables && shots.workspaceId === workspaceId ? shots.rows : undefined,
  })
  return (
    <nav ref={rootRef} className="mw-stage-axis" data-stage-axis="true" data-stage-spine="true" data-stage-region="axis" aria-label={en ? 'Stages' : '制作阶段'}>
      <div className="mw-stage-axis-head">
        <span>{en ? 'Production stages' : '制作阶段'}</span>
        <kbd aria-label={en ? 'Press G and a stage number' : '按 G 和阶段序号跳转'}>G 1–6</kbd>
      </div>
      <ul className="mw-stage-axis-list">
        {SPINE_STAGE_IDS.map((stage) => {
          const count = metrics[stage]
          const available = stage === 'sound' || bundleAvailable
          const blocked = available && Boolean(count.stale || count.overdue)
          const state = blocked ? 'blocked' : available && count.review ? 'doing' : available && count.total ? 'done' : 'empty'
          const isCurrent = stage === current
          const label = stageLabel(stage, lang)
          return (
            <li key={stage}>
              <button
                type="button"
                className="mw-stage-row"
                data-stage-axis-row={stage}
                data-stage-blocked={blocked ? 'true' : undefined}
                data-current={isCurrent ? 'true' : 'false'}
                data-empty={available && count.total === 0 ? 'true' : 'false'}
                aria-current={isCurrent ? 'step' : undefined}
                title={label}
                tabIndex={isCurrent ? 0 : -1}
                onClick={() => onSelect(stage)}
              >
                <StageDot state={state} />
                <span className="mw-stage-name">{label}</span>
                <span className="mw-stage-spine-metrics">
                  {METRICS.map(({ id, label: zhLabel, short, en: enLabel, enShort }) => {
                    const value = available ? count[id] : undefined
                    const caption = en ? enLabel : zhLabel
                    const description = value ?? (en ? 'Unavailable' : '未提供')
                    return (
                      <span key={id} className="mw-stage-spine-metric" data-stage-metric={id} data-tone={id !== 'total' && id !== 'shots' && value ? 'warn' : undefined} title={caption} aria-label={[caption, description].join(' ')}>
                        <span aria-hidden="true">{en ? enShort : short}</span>
                        <b className="mw-stage-num" aria-hidden="true">{value ?? '—'}</b>
                      </span>
                    )
                  })}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
