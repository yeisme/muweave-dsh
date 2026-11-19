import { useCallback, useEffect, useState } from 'react'
import type { TimingProjectionSnapshotV1, TimingSpanProjectionV1 } from '../protocol'
import type { MuweaveTranslator } from './i18n'
import type { MuweaveRpcClient } from './rpc-client'

function statusShapePrefix(status: TimingSpanProjectionV1['status']): string {
  switch (status) {
    case 'running':
    case 'queued':
      return '●'
    case 'waiting_approval':
    case 'waiting_for_human':
      return '⏸'
    case 'reconcile_required':
    case 'unknown':
      return '⚠'
    case 'completed':
      return '✓'
    case 'failed':
    case 'timeout':
      return '✕'
    default:
      return '○'
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export interface ProgressStripProps {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  refreshTrigger?: number
  onReconciled?: () => void
}

/**
 * Read-only drama-process-timing compliant progress strip.
 * Never creates a fake countdown timer; distinguishes system execution, human wait, and
 * unknown outcomes (which expose reconcile-only and block duplicate submission).
 */
export function ProgressStrip({ rpc, t, refreshTrigger = 0, onReconciled }: ProgressStripProps) {
  const [snapshot, setSnapshot] = useState<TimingProjectionSnapshotV1 | undefined>(undefined)
  const [reconcilingRef, setReconcilingRef] = useState<string | undefined>(undefined)
  const [announceSeq, setAnnounceSeq] = useState(0)
  const [announceText, setAnnounceText] = useState('')

  const load = useCallback(async () => {
    const res = await rpc.call<TimingProjectionSnapshotV1>('timing.projection', {})
    if (res.ok) setSnapshot(res.data)
  }, [rpc])

  useEffect(() => {
    void load()
  }, [load, refreshTrigger])

  const handleReconcile = async (operationRef: string) => {
    setReconcilingRef(operationRef)
    const res = await rpc.call<{ operation: { status: string } }>('operation.reconcile', { operationRef })
    setReconcilingRef(undefined)
    await load()
    if (res.ok) {
      setAnnounceSeq((n) => n + 1)
      setAnnounceText(`${operationRef}: ${res.data.operation.status}`)
      onReconciled?.()
    }
  }

  const spans = snapshot?.spans ?? []
  const reconcileSpans = spans.filter((s) => s.status === 'reconcile_required' || s.status === 'unknown')
  const waitingSpans = spans.filter((s) => s.status === 'waiting_approval' || s.status === 'waiting_for_human')
  const runningSpans = spans.filter((s) => s.status === 'running' || s.status === 'queued')

  const state: 'reconcile_required' | 'waiting_human' | 'running' | 'idle' =
    reconcileSpans.length > 0
      ? 'reconcile_required'
      : waitingSpans.length > 0
        ? 'waiting_human'
        : runningSpans.length > 0
          ? 'running'
          : 'idle'
  const tone = state === 'reconcile_required' ? 'bad' : state === 'waiting_human' ? 'warn' : state === 'running' ? 'info' : 'neutral'
  const headline =
    state === 'reconcile_required'
      ? `${t('progressReconcile')} (${reconcileSpans.length})`
      : state === 'waiting_human'
        ? `${t('progressWaitingHuman')} (${waitingSpans.length})`
        : state === 'running'
          ? `${t('progressRunning')} (${runningSpans.length})`
          : t('progressIdle')

  return (
    <div
      className="mw-dsh-progress-strip"
      role="region"
      aria-label="Drama Process Timing"
      data-state={state}
      data-tone={tone}
    >
      <span className="mw-row" data-gap="xs" data-timing-state={state}>
        <span className="mw-dot" data-live={state === 'running' ? 'true' : undefined} />
        <span>{headline}</span>
      </span>

      {spans.slice(-3).map((span) => (
        <span key={span.spanId} className="mw-span" data-span-status={span.status}>
          <span aria-hidden="true">{statusShapePrefix(span.status)}</span>
          <span>
            {span.owner}:{span.stageLabel} · {formatElapsed(span.elapsedMs)}
          </span>
          {span.nextAction === 'reconcile_original' ? (
            <button
              type="button"
              className="mw-dsh-btn"
              data-size="sm"
              disabled={reconcilingRef === span.operationRef}
              onClick={() => void handleReconcile(span.operationRef)}
            >
              {t('reconcileAction')}
            </button>
          ) : null}
        </span>
      ))}

      {/* Keyed live region node so repeated identical announcements are still read by screen readers */}
      {announceText ? (
        <span key={announceSeq} role="status" aria-live="polite" className="mw-dsh-muted">
          {announceText}
        </span>
      ) : null}
    </div>
  )
}
