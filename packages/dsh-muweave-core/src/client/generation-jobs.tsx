/** Job rows, slot tiles and the approval card of the generation desk (docs/design/creator-platform-v1.md). */

import { useEffect, useState } from 'react'
import type {
  BudgetStatusV1,
  CapabilityDescriptorV1,
  CostAmountV1,
  JobRecordV1,
  JobSlotV1,
  RpcErrorShape,
} from '../protocol'
import { Callout, Icon, StatusTag, ToneDot } from './ui'
import type { MuweaveDictKey, MuweaveTranslator } from './i18n'
import { MediaPreview } from './media'
import type { MuweaveRpcClient } from './rpc-client'
import { PillButton } from './editorial'
import { notifyShotMediaChanged } from './generation-store'

export function tr(t: MuweaveTranslator, key: string, vars?: Record<string, string>): string {
  let out = t(key as MuweaveDictKey) || ''
  if (out === key) out = ''
  for (const [k, v] of Object.entries(vars ?? {})) out = out.replace(`{${k}}`, v)
  return out
}

export function errText(t: MuweaveTranslator, err: RpcErrorShape): string {
  const code = err.code.split('/').pop() ?? err.code
  return tr(t, `genErr_${code}`) || `${tr(t, 'genErrGeneric')}: ${err.message}`
}

export function fmtCost(t: MuweaveTranslator, c: CostAmountV1 | undefined): string | undefined {
  if (!c || c.amount === undefined || c.unit === 'none') return undefined
  const n = Number(c.amount.toFixed(4))
  return c.unit === 'usd' ? `$${n}` : `${n} ${tr(t, `genUnit_${c.unit}`)}`
}

function slotTone(status: JobSlotV1['status']): 'neutral' | 'info' | 'ok' | 'bad' | 'warn' {
  if (status === 'done') return 'ok'
  if (status === 'failed') return 'bad'
  if (status === 'running') return 'info'
  if (status === 'pending') return 'neutral'
  return 'warn'
}

/** One slot's media: image via the media route, audio with controls, anything else as its label. */
function SlotMedia({ rpc, t, slot }: { rpc: MuweaveRpcClient; t: MuweaveTranslator; slot: JobSlotV1 }) {
  const isAudio = slot.mime?.startsWith('audio/') === true
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!isAudio || !slot.sha256) return undefined
    let cancelled = false
    void rpc.resolveMediaUrl(slot.sha256, slot.mime).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [rpc, isAudio, slot.sha256, slot.mime])
  if (isAudio) return url ? <audio controls src={url} data-muweave-slot-audio="true" /> : <span className="mw-dsh-muted">{tr(t, 'genSlot_running')}</span>
  if (slot.sha256 && (!slot.mime || slot.mime.startsWith('image/'))) {
    return <MediaPreview rpc={rpc} sha256={slot.sha256} alt={slot.label ?? slot.slotId} pendingLabel={tr(t, 'genSlot_running')} emptyLabel={tr(t, 'genSlot_done')} />
  }
  return <span className="mw-dsh-muted mw-clamp-2">{slot.label ?? slot.ownerRef ?? tr(t, 'genSlot_done')}</span>
}

function SlotTile({
  rpc,
  t,
  job,
  slot,
  onReview,
}: {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  job: JobRecordV1
  slot: JobSlotV1
  onReview: (slot: JobSlotV1, decision: 'accept' | 'reject') => void
}) {
  return (
    <li className="mw-gen-slot" data-status={slot.status} data-review={slot.review} data-muweave-slot={slot.slotId}>
      <div className="mw-gen-slot-body">
        {slot.status === 'done' ? (
          <SlotMedia rpc={rpc} t={t} slot={slot} />
        ) : (
          <span className="mw-dsh-muted">
            {slot.status === 'failed' && slot.errorCode ? `${tr(t, 'genSlot_failed')} · ${slot.errorCode}` : tr(t, `genSlot_${slot.status}`)}
          </span>
        )}
      </div>
      {slot.status === 'done' ? (
        slot.review === 'unreviewed' ? (
          <div className="mw-row" data-gap="xs">
            <PillButton variant="primary" onClick={() => onReview(slot, 'accept')} data-muweave-slot-accept={slot.slotId}>
              {tr(t, 'genAccept')}
            </PillButton>
            <PillButton onClick={() => onReview(slot, 'reject')} data-muweave-slot-reject={slot.slotId}>
              {tr(t, 'genReject')}
            </PillButton>
          </div>
        ) : (
          <span className="mw-dsh-muted">{tr(t, slot.review === 'accepted' ? 'genAccepted' : 'genRejected')}</span>
        )
      ) : null}
      <span className="mw-sr-only">{`${job.title} ${slot.index + 1}`}</span>
    </li>
  )
}

export function ApprovalCard({
  rpc,
  t,
  job,
  capability,
  budget,
  paidEnabled,
  planLines,
  onChanged,
}: {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  job: JobRecordV1
  capability?: CapabilityDescriptorV1
  budget?: BudgetStatusV1
  paidEnabled: boolean
  planLines?: readonly string[]
  onChanged: () => void
}) {
  const unit = job.estimate.unit
  const unknown = job.estimate.amount === undefined && job.estimate.unit !== 'none'
  const free = capability?.costClass === 'free'
  const [ceiling, setCeiling] = useState(job.estimate.amount === undefined ? '' : String(Number(job.estimate.amount.toFixed(4))))
  const [acceptUnknown, setAcceptUnknown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const line = budget?.lines.find((l) => l.unit === unit)
  const ceilingNum = ceiling.trim() === '' ? undefined : Number(ceiling)
  const ceilingBad = ceilingNum !== undefined && (!Number.isFinite(ceilingNum) || ceilingNum <= 0)
  const belowEstimate = ceilingNum !== undefined && !ceilingBad && job.estimate.amount !== undefined && ceilingNum < job.estimate.amount
  const needsCeiling = unit !== 'none' && ceilingNum === undefined
  const ceilingHint = ceilingBad || needsCeiling ? tr(t, 'genCeilingNeeded') : belowEstimate ? tr(t, 'genCeilingBelowHint', { estimate: fmtCost(t, job.estimate) ?? '' }) : undefined
  const ceilingAmount: CostAmountV1 = { unit, ...(ceilingNum !== undefined && !ceilingBad ? { amount: ceilingNum } : {}) }
  const blockedByPaid = !paidEnabled && !free
  const disabled = busy || blockedByPaid || ceilingBad || belowEstimate || needsCeiling || (unknown && !acceptUnknown)
  const ceilingText = fmtCost(t, ceilingAmount)

  const run = async (action: 'job.approve' | 'job.cancel') => {
    setBusy(true)
    setError(undefined)
    const res = await rpc.call(
      action,
      action === 'job.approve'
        ? { jobId: job.jobId, ceiling: ceilingAmount, ...(unknown ? { acceptUnknownCost: acceptUnknown } : {}) }
        : { jobId: job.jobId },
    )
    setBusy(false)
    if (!res.ok) setError(errText(t, res.error))
    onChanged()
  }

  return (
    <section className="mw-gen-approval" aria-label={tr(t, 'genApproval')} data-muweave-approval={job.jobId}>
      <dl className="mw-dl">
        <dt>{tr(t, 'genOwner')}</dt>
        <dd>{job.owner}</dd>
        <dt>{tr(t, 'genEstimateIs')}</dt>
        <dd data-muweave-approval-estimate="true">{fmtCost(t, job.estimate) ?? tr(t, 'genEstimateNone')}</dd>
      </dl>
      {planLines && planLines.length > 0 ? (
        <ul className="mw-gen-plan">
          {planLines.map((l, i) => (
            <li key={`${i}-${l}`}>{l}</li>
          ))}
        </ul>
      ) : null}
      <label className="mw-field">
        <span>{`${tr(t, 'genCeiling')}${unit === 'none' ? '' : ` (${tr(t, `genUnit_${unit}`)})`}`}</span>
        <input
          className="mw-input"
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={ceiling}
          aria-invalid={ceilingBad || belowEstimate || needsCeiling}
          onChange={(e) => setCeiling(e.target.value)}
          data-muweave-ceiling="true"
        />
      </label>
      {ceilingHint ? <p className="mw-dsh-muted" role="status" data-muweave-ceiling-hint="true">{ceilingHint}</p> : null}
      {line ? (
        <p className="mw-dsh-muted" data-muweave-budget="true">
          {tr(t, 'genToday', { committed: fmtCost(t, { unit, amount: line.committed }) ?? '0', spent: line.spent > 0 ? (fmtCost(t, { unit, amount: line.spent }) ?? '0') : (budget?.unknownCostJobs ?? 0) > 0 ? tr(t, 'genSpentUnreported') : (fmtCost(t, { unit, amount: 0 }) ?? '0') })}
          {line.dailyCap !== undefined ? ` · ${tr(t, 'genDailyCap', { cap: fmtCost(t, { unit, amount: line.dailyCap }) ?? '' })}` : ''}
          {(budget?.unknownCostJobs ?? 0) > 0 ? ` · ${tr(t, 'genUnknownCostJobs', { n: String(budget?.unknownCostJobs) })}` : ''}
        </p>
      ) : null}
      {unknown ? (
        <label className="mw-gen-check">
          <input type="checkbox" checked={acceptUnknown} onChange={(e) => setAcceptUnknown(e.target.checked)} data-muweave-accept-unknown="true" />
          <span>{tr(t, 'genAcceptUnknown')}</span>
        </label>
      ) : null}
      {blockedByPaid ? <Callout tone="warn">{tr(t, 'genPaidOff')}</Callout> : null}
      {error ? <Callout tone="bad" role="alert">{error}</Callout> : null}
      <div className="mw-row" data-gap="sm">
        <PillButton variant="primary" disabled={disabled} onClick={() => void run('job.approve')} data-muweave-approve={job.jobId}>
          {ceilingText ? tr(t, 'genApprove', { cost: ceilingText }) : tr(t, 'genApproveUnknown')}
        </PillButton>
        <PillButton disabled={busy} onClick={() => void run('job.cancel')} data-muweave-cancel={job.jobId}>
          {tr(t, 'genCancel')}
        </PillButton>
      </div>
    </section>
  )
}

export function ReconcileCard({ rpc, t, job, onChanged }: { rpc: MuweaveRpcClient; t: MuweaveTranslator; job: JobRecordV1; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const run = async (action: 'job.reconcile' | 'job.cancel') => {
    setBusy(true)
    setError(undefined)
    const res = await rpc.call(action, { jobId: job.jobId })
    setBusy(false)
    setConfirming(false)
    if (!res.ok) setError(errText(t, res.error))
    onChanged()
  }
  return (
    <section className="mw-gen-approval" aria-label={tr(t, 'genStatus_reconcile_required')} data-muweave-reconcile={job.jobId}>
      <p className="mw-dsh-muted">{tr(t, 'genReconcileHint')}</p>
      {confirming ? <Callout tone="warn" role="alert">{tr(t, 'genAbandonWarn')}</Callout> : null}
      {error ? <Callout tone="bad" role="alert">{error}</Callout> : null}
      <div className="mw-row" data-gap="sm" onBlur={() => setConfirming(false)}>
        <PillButton variant="primary" disabled={busy} onClick={() => void run('job.reconcile')} data-muweave-reconcile-run={job.jobId}>
          {tr(t, 'genReconcile')}
        </PillButton>
        <PillButton
          disabled={busy}
          onClick={() => (confirming ? void run('job.cancel') : setConfirming(true))}
          data-muweave-abandon={job.jobId}
          data-confirming={confirming ? 'true' : undefined}
        >
          {tr(t, confirming ? 'genAbandonConfirm' : 'genAbandon')}
        </PillButton>
      </div>
    </section>
  )
}

export function JobRow({
  rpc,
  t,
  job,
  capability,
  budget,
  paidEnabled,
  planLines,
  lang,
  onChanged,
  dataAttribute = 'job',
}: {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  job: JobRecordV1
  capability?: CapabilityDescriptorV1
  budget?: BudgetStatusV1
  paidEnabled: boolean
  planLines?: readonly string[]
  lang: string
  onChanged: () => void
  dataAttribute?: 'job' | 'tool-run'
}) {
  const [error, setError] = useState<string | undefined>(undefined)
  const [cancelBusy, setCancelBusy] = useState(false)
  const review = async (slot: JobSlotV1, decision: 'accept' | 'reject') => {
    setError(undefined)
    const res = await rpc.call('job.slot.review', {
      jobId: job.jobId,
      slotId: slot.slotId,
      decision,
      linkToShot: decision === 'accept' && Boolean(job.anchor?.shotRef),
    })
    if (!res.ok) setError(errText(t, res.error))
    else if (decision === 'accept' && job.anchor?.shotRef) notifyShotMediaChanged()
    onChanged()
  }
  const cancel = async () => {
    setCancelBusy(true)
    setError(undefined)
    const res = await rpc.call('job.cancel', { jobId: job.jobId })
    setCancelBusy(false)
    if (!res.ok) setError(errText(t, res.error))
    onChanged()
  }
  const finished = job.status === 'waiting_for_human' || job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed'
  const actual = fmtCost(t, job.actualCost)
  const anchor = [job.anchor?.episodeRef, job.anchor?.sceneRef, job.anchor?.shotRef].filter(Boolean).join(' / ')
  const doneSlots = job.slots.filter((slot) => slot.status === 'done').length
  const summary = job.errorCode
    ? job.errorCode
    : doneSlots > 0
      ? `${doneSlots}/${job.slots.length} ${tr(t, 'genSlot_done')}`
      : tr(t, `genStatus_${job.status}`) || job.status
  return (
    <li className="mw-dsh-card mw-gen-job" data-flat="true" {...(dataAttribute === 'tool-run' ? { 'data-muweave-tool-run': job.jobId } : { 'data-muweave-job': job.jobId })} data-status={job.status}>
      <div className="mw-spread">
        <div className="mw-row" data-gap="xs"><ToneDot tone={job.status === 'failed' ? 'bad' : job.status === 'completed' ? 'ok' : job.status === 'reconcile_required' ? 'warn' : 'info'} title={job.status} /><span className="mw-title">{job.title}</span></div>
        <StatusTag status={job.status} lang={lang} label={tr(t, `genStatus_${job.status}`) || job.status} />
      </div>
      <div className="mw-row" data-gap="xs">
        <span className="mw-chip" title={job.owner}>{job.requester?.botId ?? job.owner}</span>
        <span className="mw-dsh-muted">{summary}</span>
        {anchor ? <span className="mw-chip" data-mono="true" title={tr(t, 'genAnchor')}>{anchor}</span> : null}
        {job.errorCode ? <span className="mw-chip" data-mono="true">{job.errorCode}</span> : null}
      </div>
      {job.status === 'waiting_approval' ? (
        <ApprovalCard rpc={rpc} t={t} job={job} capability={capability} budget={budget} paidEnabled={paidEnabled} planLines={planLines} onChanged={onChanged} />
      ) : null}
      {job.status === 'queued' || job.status === 'running' ? <PillButton disabled={cancelBusy} onClick={() => void cancel()} data-muweave-tool-cancel={job.jobId}>{tr(t, 'genCancel')}</PillButton> : null}
      {job.status === 'reconcile_required' ? <ReconcileCard rpc={rpc} t={t} job={job} onChanged={onChanged} /> : null}
      {job.errorCode ? <Callout tone="bad">{errText(t, { code: job.errorCode, message: job.errorCode })}</Callout> : null}
      {job.slots.length > 0 ? <div className="mw-row" data-gap="xs" aria-label={job.status}>{job.slots.map((slot) => <ToneDot key={slot.slotId} tone={slotTone(slot.status)} title={slot.status} />)}</div> : null}
      {job.slots.length > 0 && job.status !== 'waiting_approval' ? (
        <ul className="mw-gen-slots" data-muweave-slots="true">
          {job.slots.map((slot) => (
            <SlotTile key={slot.slotId} rpc={rpc} t={t} job={job} slot={slot} onReview={(s, d) => void review(s, d)} />
          ))}
        </ul>
      ) : null}
      {finished ? (
        <p className="mw-dsh-muted" data-muweave-actual="true">
          <Icon name="check" /> {tr(t, 'genActual')}: {actual ?? tr(t, 'genActualUnreported')}
        </p>
      ) : null}
      {error ? <Callout tone="bad" role="alert">{error}</Callout> : null}
    </li>
  )
}
