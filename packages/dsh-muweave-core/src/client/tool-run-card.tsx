import { useState } from 'react'
import type { CapabilityCatalogV1, JobRecordV1, JobSlotV1 } from '../protocol'
import type { MuweaveTranslator } from './i18n'
import type { MuweaveRpcClient } from './rpc-client'
import { MediaPreview } from './media'
import { PillButton } from './editorial'
import { errText, tr } from './generation-jobs'
import { Icon, StatusTag, ToneDot } from './ui'
import { toolCatalogFromCapabilityCatalog, toolOwnerLabel } from './tool-catalog'

export interface ToolRunCardProps {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  job: JobRecordV1
  catalog?: CapabilityCatalogV1
  onOpenRoom?: (target: { roomId?: string; ref?: string }) => void
}

function mediaPreview(rpc: MuweaveRpcClient, slot: JobSlotV1) {
  if (!slot.sha256 || !slot.mime?.startsWith('image/')) return null
  return <MediaPreview rpc={rpc} sha256={slot.sha256} alt={slot.label ?? slot.slotId} pendingLabel="" emptyLabel="" />
}

function resultSummary(job: JobRecordV1, t: MuweaveTranslator): string {
  if (job.errorCode) return job.errorCode + ' · ' + (tr(t, 'genErr_' + job.errorCode) || job.errorCode)
  const done = job.slots.filter((slot) => slot.status === 'done').length
  return done > 0 ? done + '/' + job.slots.length + ' ' + tr(t, 'genSlot_done') : (tr(t, 'genStatus_' + job.status) || job.status)
}

function slotTone(status: JobSlotV1['status']): 'neutral' | 'info' | 'ok' | 'bad' | 'warn' {
  if (status === 'done') return 'ok'
  if (status === 'failed') return 'bad'
  if (status === 'running') return 'info'
  if (status === 'pending') return 'neutral'
  return 'warn'
}

export function ToolRunCard({ rpc, t, job, catalog, onOpenRoom }: ToolRunCardProps) {
  const entry = toolCatalogFromCapabilityCatalog(catalog).find((item) => item.id === job.capabilityId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const canCancel = job.status === 'waiting_approval' || job.status === 'queued' || job.status === 'running' || job.status === 'reconcile_required'
  const firstDone = job.slots.find((slot) => slot.status === 'done')
  const cancel = async () => {
    setBusy(true)
    const result = await rpc.call('job.cancel', { jobId: job.jobId })
    setBusy(false)
    if (!result.ok) setError(errText(t, result.error))
  }
  return (
    <li className="mw-dsh-card mw-gen-job" data-flat="true" data-muweave-tool-run={job.jobId} data-status={job.status}>
      <div className="mw-spread">
        <div className="mw-row" data-gap="xs">
          <ToneDot tone={job.status === 'failed' ? 'bad' : job.status === 'completed' ? 'ok' : job.status === 'reconcile_required' ? 'warn' : 'info'} title={job.status} />
          <span className="mw-title">{job.title}</span>
        </div>
        <StatusTag status={job.status} lang={t('langCode')} label={tr(t, 'genStatus_' + job.status) || job.status} />
      </div>
      <div className="mw-row" data-gap="xs">
        <span className="mw-chip">{toolOwnerLabel(entry?.owner ?? job.owner)}</span>
        <span className="mw-dsh-muted">{resultSummary(job, t)}</span>
      </div>
      {job.slots.length > 0 ? <div className="mw-row" data-gap="xs" aria-label={job.status}>{job.slots.map((slot) => <ToneDot key={slot.slotId} tone={slotTone(slot.status)} title={slot.status} />)}</div> : null}
      {job.errorCode ? <p className="mw-callout" role="alert">{job.errorCode} · {toolOwnerLabel(entry?.owner ?? job.owner)} · {tr(t, 'genErr_' + job.errorCode) || job.errorCode}</p> : null}
      {firstDone ? (
        <div className="mw-row" data-gap="sm">
          {mediaPreview(rpc, firstDone)}
          {entry?.opensRoom || job.anchor?.shotRef ? <button type="button" className="mw-dsh-btn" data-variant="ghost" data-size="sm" onClick={() => onOpenRoom?.({ roomId: entry?.opensRoom, ref: job.anchor?.shotRef })}><Icon name="external" /><span>{t('sessionLocate')}</span></button> : null}
        </div>
      ) : null}
      {canCancel ? <PillButton disabled={busy} onClick={() => void cancel()} data-muweave-tool-cancel={job.jobId}>{t('genCancel')}</PillButton> : null}
      {error ? <p className="mw-callout" role="alert">{error}</p> : null}
    </li>
  )
}
