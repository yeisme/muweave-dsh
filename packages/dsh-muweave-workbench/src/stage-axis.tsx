/**
 * Overview stage axis (desk v8 §8.2–8.3): five fixed rows, pending count as the primary number and
 * the total as a quiet secondary one. Controlled — the parent owns the current stage.
 */

import { useCallback, useEffect, useRef } from 'react'
import { formatKeyHint, getActiveTheaterRoomId, type MuweaveElementSummaryV1 } from '@yeisme/dsh-muweave-core/client'
// The client entry does not re-export the sequence helpers; core is inlined per plugin bundle anyway.
import { matchKey, useKeySequence, type KeyBinding } from '../../dsh-muweave-core/src/client/keymap'
import { STAGES, pendingCount, stageAtDigit, stageDotState, stepStage, type StageDotState, type StageId } from './stage-map'

const OVERVIEW_ROOM_ID = 'muweave-workbench'

const STAGE_BINDINGS: readonly KeyBinding[] = [
  { id: 'stage-next', keys: ['j'], scope: 'global', labelZh: '下一阶段', labelEn: 'Next stage' },
  { id: 'stage-prev', keys: ['k'], scope: 'global', labelZh: '上一阶段', labelEn: 'Previous stage' },
]

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function StageDot({ state }: { state: StageDotState }) {
  return (
    <svg className="mw-stage-dot" data-state={state} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <circle cx="5" cy="5" r="4.25" />
      {state === 'doing' ? <path className="mw-stage-dot-half" d="M5 .75a4.25 4.25 0 0 1 0 8.5Z" /> : null}
    </svg>
  )
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
  const rootRef = useRef<HTMLElement | null>(null)
  const currentRef = useRef(current)
  currentRef.current = current
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const onSequence = useCallback((sequence: string[]) => {
    const stage = stageAtDigit(sequence[1] ?? '')
    if (stage) onSelectRef.current(stage)
  }, [])
  const feedSequence = useKeySequence(onSequence, 800)

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.isComposing || isEditableTarget(ev.target)) return
      if (ev.target instanceof Element && ev.target.closest('[role="dialog"], [role="menu"]')) return
      // The theater keeps rooms mounted; only the Overview owns j / k / G.
      const room = getActiveTheaterRoomId()
      if (room && room !== OVERVIEW_ROOM_ID) return
      if (!rootRef.current?.isConnected) return
      if (feedSequence(ev)) return
      const [next, prev] = STAGE_BINDINGS
      if (next && matchKey(ev, next)) onSelectRef.current(stepStage(currentRef.current, 1))
      else if (prev && matchKey(ev, prev)) onSelectRef.current(stepStage(currentRef.current, -1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [feedSequence])

  const active = STAGES.filter((s) => (groups[s.id]?.length ?? 0) > 0).length
  const en = lang === 'en'

  return (
    <nav ref={rootRef} className="mw-stage-axis" data-stage-axis="true" aria-label={en ? 'Stages' : '阶段'}>
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
          return (
            <li key={stage.id}>
              <button
                type="button"
                className="mw-stage-row"
                data-stage-axis-row={stage.id}
                data-current={isCurrent ? 'true' : 'false'}
                data-empty={rows.length === 0 ? 'true' : 'false'}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => onSelect(stage.id)}
              >
                <StageDot state={stageDotState(rows)} />
                <span className="mw-stage-name">{en ? stage.labelEn : stage.labelZh}</span>
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
