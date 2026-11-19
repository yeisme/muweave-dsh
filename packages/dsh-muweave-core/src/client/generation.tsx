/**
 * Generation desk (docs/design/creator-platform-v1.md, 界面): a toolbar pill with an active-job
 * badge and a right drawer with the capability list, the estimate form and the job list. The
 * host owns every rule (paid switch, ceiling, daily cap); this file only shows it and sends the
 * user's explicit approval.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  jobIsActive,
  type BudgetStatusV1,
  type CapabilityCatalogV1,
  type CapabilityDescriptorV1,
  type CapabilityEstimateV1,
  type CapabilityInputFieldV1,
  type CapabilityStage,
  type JobRecordV1,
} from '../protocol'
import { PillButton } from './editorial'
import { getFloatingAgentSnapshot } from './floating-agent'
import { closeGeneration, openGeneration, useGenerationStore } from './generation-store'
import { errText, fmtCost, tr } from './generation-jobs'
import { ToolRunCard } from './tool-run-card'
import type { MuweaveTranslator } from './i18n'
import type { MuweaveRpcClient } from './rpc-client'
import { Callout, EmptyState, Icon, SectionHead } from './ui'

const POLL_MS = 2000
const POLL_CLOSED_MS = 5000

type Wrapped<T> = T | { [k: string]: unknown }

function pick<T>(data: Wrapped<T>, key: string, test: (v: unknown) => boolean): T | undefined {
  if (test(data)) return data as T
  const inner = (data as Record<string, unknown> | undefined)?.[key]
  return test(inner) ? (inner as T) : undefined
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function unwrapJobs(data: unknown): JobRecordV1[] {
  if (Array.isArray(data)) return data as JobRecordV1[]
  const jobs = isObj(data) ? data.jobs : undefined
  return Array.isArray(jobs) ? (jobs as JobRecordV1[]) : []
}

function newKey(): string {
  const c = globalThis.crypto as Crypto | undefined
  return c?.randomUUID ? c.randomUUID() : `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function initialValues(cap: CapabilityDescriptorV1 | undefined, prefill: Record<string, string | number | string[]> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const fields = cap?.inputs ?? []
  // Rooms prefill generic `prompt` / `text`; they land on the first long-text field when the capability names it differently.
  const alias = (['prompt', 'text'] as const).find((k) => prefill?.[k] !== undefined && !fields.some((f) => f.name === k))
  const aliasField = alias ? (fields.find((f) => f.inputType === 'textarea') ?? fields.find((f) => f.inputType === 'text'))?.name : undefined
  for (const f of fields) {
    const pre = prefill?.[f.name] ?? (alias && f.name === aliasField ? prefill?.[alias] : undefined)
    out[f.name] = pre === undefined ? (f.defaultValue ?? '') : Array.isArray(pre) ? pre.join(',') : String(pre)
  }
  return out
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: CapabilityInputFieldV1
  value: string
  onChange: (v: string) => void
}) {
  const known = useMemo(
    () =>
      field.inputType === 'element'
        ? getFloatingAgentSnapshot().knownElements.filter((e) => !field.elementKinds || field.elementKinds.includes(e.kind))
        : [],
    [field],
  )
  const common = { className: 'mw-input', required: field.required, 'data-muweave-field': field.name } as const
  let control
  if (field.inputType === 'textarea') {
    control = <textarea {...common} rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
  } else if (field.inputType === 'enum' || (field.inputType === 'element' && known.length > 0)) {
    const opts = field.inputType === 'enum' ? (field.options ?? []).map((o) => ({ v: o, l: o })) : known.map((e) => ({ v: e.elementId, l: e.title }))
    control = (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" />
        {opts.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    )
  } else {
    control = <input {...common} type={field.inputType === 'number' ? 'number' : 'text'} step="any" value={value} onChange={(e) => onChange(e.target.value)} />
  }
  return (
    <label className="mw-field">
      <span>{field.label}</span>
      {control}
    </label>
  )
}

function GenerationDrawer({
  rpc,
  t,
  stage,
  catalog,
  catalogError,
  budget,
  jobs,
  planLines,
  closeRef,
  onChanged,
}: {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  stage?: CapabilityStage | readonly CapabilityStage[]
  catalog?: CapabilityCatalogV1
  catalogError?: string
  budget?: BudgetStatusV1
  jobs: JobRecordV1[]
  planLines: Map<string, string[]>
  closeRef: MutableRefObject<HTMLButtonElement | null>
  onChanged: () => void
}) {
  const { request, nonce } = useGenerationStore()
  const stages = request?.stage ?? stage
  const stageList = stages === undefined ? undefined : Array.isArray(stages) ? stages : [stages as CapabilityStage]
  const caps = useMemo(
    () => (catalog?.capabilities ?? []).filter((c) => !stageList || stageList.includes(c.stage) || c.capabilityId === request?.capabilityId),
    [catalog, stageList, request?.capabilityId],
  )
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [values, setValues] = useState<Record<string, string>>({})
  const [slots, setSlots] = useState('')
  const [est, setEst] = useState<{ e: CapabilityEstimateV1; key: string } | undefined>(undefined)
  const [busy, setBusy] = useState<'estimate' | 'submit' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [receipt, setReceipt] = useState(false)
  const lang = tr(t, 'langCode')

  const selected = caps.find((c) => c.capabilityId === selectedId)

  // A new open request (or the catalog arriving) picks the capability and applies the prefill once.
  const appliedNonce = useRef(-1)
  useEffect(() => {
    if (caps.length === 0 || appliedNonce.current === nonce) return
    const wanted = caps.find((c) => c.capabilityId === request?.capabilityId) ?? caps.find((c) => c.available) ?? caps[0]
    appliedNonce.current = nonce
    setSelectedId(wanted?.capabilityId)
    setValues(initialValues(wanted, wanted?.capabilityId === request?.capabilityId ? request?.input : undefined))
    setSlots(String(request?.slots ?? wanted?.defaultSlots ?? ''))
    setEst(undefined)
    setReceipt(false)
    setError(undefined)
  }, [caps, nonce, request])

  const choose = (cap: CapabilityDescriptorV1) => {
    setSelectedId(cap.capabilityId)
    setValues(initialValues(cap, undefined))
    setSlots(String(cap.defaultSlots))
    setEst(undefined)
    setReceipt(false)
    setError(undefined)
  }

  const missing = (selected?.inputs ?? []).some((f) => f.required && !(values[f.name] ?? '').trim())
  const slotsNum = Number(slots)

  const doEstimate = async () => {
    if (!selected) return
    setBusy('estimate')
    setError(undefined)
    setReceipt(false)
    const input: Record<string, string | number> = {}
    for (const f of selected.inputs) {
      const v = (values[f.name] ?? '').trim()
      if (v) input[f.name] = f.inputType === 'number' && Number.isFinite(Number(v)) ? Number(v) : v
    }
    const res = await rpc.call<Wrapped<CapabilityEstimateV1>>('capability.estimate', {
      capabilityId: selected.capabilityId,
      input,
      ...(Number.isInteger(slotsNum) && slotsNum > 0 ? { slots: slotsNum } : {}),
      ...(request?.anchor ? { anchor: request.anchor } : {}),
    })
    setBusy(undefined)
    if (!res.ok) return setError(errText(t, res.error))
    const e = pick<CapabilityEstimateV1>(res.data, 'estimate', (v) => isObj(v) && typeof v.estimateId === 'string')
    if (e) setEst({ e, key: newKey() })
    else setError(tr(t, 'genErrGeneric'))
  }

  const doSubmit = async () => {
    if (!est) return
    setBusy('submit')
    setError(undefined)
    const res = await rpc.call<Wrapped<JobRecordV1>>('job.request', {
      estimateId: est.e.estimateId,
      idempotencyKey: est.key,
      requestedBy: 'ui',
    })
    setBusy(undefined)
    if (!res.ok) return setError(errText(t, res.error))
    const job = pick<JobRecordV1>(res.data, 'job', (v) => isObj(v) && typeof v.jobId === 'string')
    if (job) planLines.set(job.jobId, est.e.planLines)
    setEst(undefined)
    setReceipt(true)
    onChanged()
  }

  const capById = useMemo(() => new Map((catalog?.capabilities ?? []).map((c) => [c.capabilityId, c])), [catalog])

  return (
    <div className="mw-gen-body">
      <SectionHead
        title={tr(t, 'genTitle')}
        actions={<button ref={closeRef} type="button" className="mw-dsh-btn" data-icon="true" data-variant="ghost" data-size="sm" aria-label={tr(t, 'genClose')} title={tr(t, 'genClose')} onClick={closeGeneration}><Icon name="close" /></button>}
      />
      {catalogError ? <Callout tone="bad">{catalogError}</Callout> : null}
      <span className="mw-eyebrow">{tr(t, 'genCapabilities')}</span>
      {caps.length === 0 ? (
        <EmptyState>{tr(t, 'genNoCaps')}</EmptyState>
      ) : (
        <ul className="mw-gen-caps" data-muweave-capabilities="true">
          {caps.map((c) => {
            const reason = c.available ? undefined : tr(t, `genReason_${c.unavailableReason ?? ''}`) || c.unavailableReason || tr(t, 'genUnavailable')
            return (
              <li key={c.capabilityId}>
                <button
                  type="button"
                  className="mw-gen-cap"
                  aria-pressed={selectedId === c.capabilityId}
                  disabled={!c.available}
                  data-muweave-capability={c.capabilityId}
                  onClick={() => choose(c)}
                >
                  <span className="mw-title">{c.title}</span>
                  <span className="mw-dsh-muted mw-clamp-2">{reason ? `${tr(t, 'genUnavailable')}：${reason}` : c.summary}</span>
                  <span className="mw-chip">{tr(t, `genCost_${c.costClass}`)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selected ? (
        <form
          className="mw-dsh-card mw-stack"
          data-flat="true"
          data-muweave-generate-form={selected.capabilityId}
          onSubmit={(e) => {
            e.preventDefault()
            void doEstimate()
          }}
          onChange={() => est && setEst(undefined)}
        >
          {selected.inputs.map((f) => (
            <FieldControl key={f.name} field={f} value={values[f.name] ?? ''} onChange={(v) => setValues((cur) => ({ ...cur, [f.name]: v }))} />
          ))}
          {selected.maxSlots > 1 ? (
            <label className="mw-field">
              <span>{tr(t, 'genSlots')}</span>
              <input className="mw-input" type="number" min={1} max={selected.maxSlots} value={slots} onChange={(e) => setSlots(e.target.value)} />
            </label>
          ) : null}
          <div className="mw-row" data-gap="sm">
            <button type="submit" className="mw-dsh-btn" data-variant="quiet" disabled={missing || busy !== undefined} data-muweave-estimate="true">
              {busy === 'estimate' ? tr(t, 'genEstimating') : tr(t, 'genEstimate')}
            </button>
          </div>
          {est ? (
            <div className="mw-stack" data-gap="xs" data-muweave-estimate-result="true">
              <span className="mw-eyebrow">{tr(t, 'genPlan')}</span>
              <ul className="mw-gen-plan">
                {est.e.planLines.map((l, i) => (
                  <li key={`${i}-${l}`}>{l}</li>
                ))}
              </ul>
              <p>
                <b>{tr(t, 'genEstimateIs')}</b> {fmtCost(t, est.e.estimate) ?? tr(t, 'genEstimateNone')} · {tr(t, `genCost_${est.e.costClass}`)}
              </p>
              <div className="mw-row">
                <PillButton variant="primary" disabled={busy !== undefined} onClick={() => void doSubmit()} data-muweave-submit="true">
                  {tr(t, 'genSubmit')}
                </PillButton>
              </div>
            </div>
          ) : null}
          {receipt ? <Callout tone="ok" role="status">{tr(t, 'genRequested')}</Callout> : null}
          {error ? <Callout tone="bad" role="alert">{error}</Callout> : null}
        </form>
      ) : null}
      <span className="mw-eyebrow">{tr(t, 'genJobs')}</span>
      {jobs.length === 0 ? (
        <EmptyState>{tr(t, 'genNoJobs')}</EmptyState>
      ) : (
        <ul className="mw-stack" data-muweave-jobs="true">
          {jobs.slice(0, 20).map((job) => (
            <ToolRunCard
              key={job.jobId}
              rpc={rpc}
              t={t}
              job={job}
              capability={capById.get(job.capabilityId)}
              budget={budget}
              paidEnabled={catalog?.paidEnabled ?? budget?.paidEnabled ?? false}
              planLines={planLines.get(job.jobId)}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Toolbar pill + drawer. Polls `job.list` every 2 s while open, every 5 s while closed and a job is queued or running. */
export function GenerationLauncher({
  rpc,
  t,
  stage,
}: {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  stage?: CapabilityStage | readonly CapabilityStage[]
}) {
  const { open, opener } = useGenerationStore()
  const openerRef = useRef(opener)
  openerRef.current = opener
  const pillRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const openRef = useRef(open)
  const wasOpen = useRef(false)
  const planLines = useRef(new Map<string, string[]>()).current
  const [jobs, setJobs] = useState<JobRecordV1[]>([])
  const [catalog, setCatalog] = useState<CapabilityCatalogV1 | undefined>(undefined)
  const [catalogError, setCatalogError] = useState<string | undefined>(undefined)
  const [budget, setBudget] = useState<BudgetStatusV1 | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  openRef.current = open

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const res = await rpc.call<unknown>('job.list', {})
      if (cancelled) return
      const list = res.ok ? unwrapJobs(res.data) : []
      if (res.ok) setJobs([...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)))
      // Open drawer: 2 s. Closed: 5 s, and only while a job is queued or running (not for approval/reconcile waits).
      if (openRef.current) timer = setTimeout(() => void poll(), POLL_MS)
      else if (list.some((j) => j.status === 'queued' || j.status === 'running')) timer = setTimeout(() => void poll(), POLL_CLOSED_MS)
    }
    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [rpc, open, tick])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    void Promise.all([rpc.call<CapabilityCatalogV1>('capability.catalog', {}), rpc.call<BudgetStatusV1>('budget.status', {})]).then(([cat, bud]) => {
      if (cancelled) return
      if (cat.ok) {
        setCatalog(cat.data)
        setCatalogError(undefined)
      } else setCatalogError(`${tr(t, 'genLoadFailed')}: ${errText(t, cat.error)}`)
      if (bud.ok) setBudget(bud.data)
    })
    return () => {
      cancelled = true
    }
  }, [rpc, open, tick, t])

  useEffect(() => {
    if (open) {
      wasOpen.current = true
      closeRef.current?.focus()
      const onKey = (ev: KeyboardEvent) => {
        if (ev.isComposing || ev.keyCode === 229) return
        if (ev.key === 'Escape') closeGeneration()
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
    if (wasOpen.current) {
      wasOpen.current = false
      const from = openerRef.current
      ;(from && from.isConnected ? from : pillRef.current)?.focus()
    }
    return undefined
  }, [open])

  const active = jobs.filter((j) => jobIsActive(j.status)).length
  return (
    <>
      <button
        ref={pillRef}
        type="button"
        className="mw-dsh-btn"
        data-variant="quiet"
        data-muweave-generate-open="true"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={tr(t, 'genOpenTitle')}
        onClick={() => (open ? closeGeneration() : openGeneration())}
      >
        <Icon name="spark" />
        <span>{tr(t, 'genOpen')}</span>
        {active > 0 ? (
          <span className="mw-gen-badge" data-muweave-generate-count={String(active)} aria-label={`${active} ${tr(t, 'genActiveJobs')}`}>
            {active}
          </span>
        ) : null}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <aside className="mw-gen-drawer" role="dialog" aria-modal="false" aria-label={tr(t, 'genTitle')} data-muweave-generation-drawer="true">
              <GenerationDrawer
                rpc={rpc}
                t={t}
                stage={stage}
                catalog={catalog}
                catalogError={catalogError}
                budget={budget}
                jobs={jobs}
                planLines={planLines}
                closeRef={closeRef}
                onChanged={refresh}
              />
            </aside>,
            document.body,
          )
        : null}
    </>
  )
}
