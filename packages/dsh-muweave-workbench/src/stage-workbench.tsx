/**
 * Overview stage workbench (desk v8): one stage at three densities — L1 the primary artifact, L2 the
 * variants of the job that produced it, L3 the pending queue — plus a version band. Every level shows
 * an honest placeholder when the bundle has no cover, slots or revision; nothing is invented.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  EmptyState,
  Icon,
  StatusTag,
  formatKeyHint,
  getActiveTheaterRoomId,
  isEditableTarget,
  keyBinding,
  matchKey,
  statusLabel,
  useMediaUrl,
  type JobRecordV1,
  type JobSlotV1,
  type MuweaveElementSummaryV1,
  type MuweaveRpcClient,
} from '@yeisme/dsh-muweave-core/client'
import {
  coverDigest,
  elementSubject,
  isPending,
  jobForElement,
  pickPrimary,
  shortTime,
  stageLabel,
  variantSlots,
  variantSubject,
  versionLabel,
  type CompareSubject,
  type StageId,
} from './stage-map'

const OVERVIEW_ROOM_ID = 'muweave-workbench'

/** Pins a compare side; `trigger` is where focus returns when the compare pane closes. */
export type PinCompareHandler = (subject: CompareSubject, trigger?: HTMLElement | null) => void

const COMPARE_KEY = keyBinding('stage-compare')
const REGION_NEXT_KEY = keyBinding('stage-region-next')
const REGION_PREV_KEY = keyBinding('stage-region-prev')
const DISMISS_KEY = keyBinding('stage-dismiss')

/**
 * Desk v8 P2 Tab order: Tab hops between whole regions instead of every button, arrows move inside
 * one. The inspector is the shell's column, found by its existing pane marker.
 */
export const STAGE_REGIONS = ['axis', 'L1', 'L2', 'L3', 'inspector'] as const
export type StageRegion = (typeof STAGE_REGIONS)[number]

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const INSPECTOR = '[data-muweave-pane="inspector"]'

export function stageRegionOf(node: Element | null): StageRegion | undefined {
  if (!node) return undefined
  if (node.closest(INSPECTOR)) return 'inspector'
  const region = node.closest('[data-stage-region]')?.getAttribute('data-stage-region')
  return STAGE_REGIONS.find((r) => r === region)
}

function regionFocusables(scope: ParentNode, region: StageRegion): HTMLElement[] {
  const selector = region === 'inspector' ? INSPECTOR : `[data-stage-region="${region}"]`
  return Array.from(scope.querySelectorAll<HTMLElement>(selector)).flatMap((node) => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)))
}

/** A region is entered on its current item (stage row, chosen variant, selected queue row), else its first. */
function regionEntry(scope: ParentNode, region: StageRegion): HTMLElement | undefined {
  const items = regionFocusables(scope, region)
  return items.find((item) => item.getAttribute('data-current') === 'true') ?? items[0]
}

/** Moves focus to the next / previous region that has something focusable. False leaves Tab native. */
export function focusStageRegion(scope: ParentNode, from: StageRegion, step: 1 | -1): boolean {
  for (let i = STAGE_REGIONS.indexOf(from) + step; i >= 0 && i < STAGE_REGIONS.length; i += step) {
    const target = regionEntry(scope, STAGE_REGIONS[i]!)
    if (target) {
      target.focus()
      return true
    }
  }
  return false
}

const ARROW_STEP: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }

/** Thumbnail with a real image when the media route resolves, else the fill + hairline grid placeholder. */
export function StageThumb({
  rpc,
  sha256,
  alt,
  shape,
  children,
}: {
  rpc: MuweaveRpcClient
  sha256?: string
  alt: string
  shape: 'wide' | 'variant' | 'compare'
  children?: ReactNode
}) {
  const url = useMediaUrl(rpc, sha256)
  return (
    <div className="mw-stage-thumb" data-shape={shape} data-empty={url ? 'false' : 'true'}>
      {url ? <img src={url} alt={alt} loading="lazy" /> : null}
      {children}
    </div>
  )
}

function useJobs(rpc: MuweaveRpcClient): JobRecordV1[] {
  const [jobs, setJobs] = useState<JobRecordV1[]>([])
  useEffect(() => {
    let cancelled = false
    void rpc
      .call<{ jobs?: JobRecordV1[] } | JobRecordV1[]>('job.list', {})
      .then((res) => {
        if (cancelled || !res.ok) return
        const data = res.data as { jobs?: JobRecordV1[] } | JobRecordV1[] | undefined
        const list = Array.isArray(data) ? data : data?.jobs
        setJobs(Array.isArray(list) ? list : [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [rpc])
  return jobs
}

function VariantBand({
  rpc,
  job,
  slots,
  version,
  lang,
  onPinVariant,
}: {
  rpc: MuweaveRpcClient
  job: JobRecordV1
  slots: JobSlotV1[]
  version?: string
  lang: string
  onPinVariant?: PinCompareHandler
}) {
  const accepted = slots.find((s) => s.review === 'accepted')?.slotId
  const [chosen, setChosen] = useState<string | undefined>(accepted)
  const en = lang === 'en'
  return (
    <section className="mw-stage-level" data-level="L2" data-stage-region="L2">
      <div className="mw-stage-eyebrow">
        <span>{en ? 'Variants' : '变体'}</span>
        <span className="mw-stage-num">{slots.length}</span>
        <span className="mw-stage-eyebrow-end">{job.title}</span>
      </div>
      <ul className="mw-stage-variants">
        {slots.map((slot) => {
          const letter = String.fromCharCode(97 + (slot.index % 26))
          const tag = version ? `${version}·${letter}` : letter
          const isImage = typeof slot.mime === 'string' && slot.mime.startsWith('image/')
          return (
            <li key={slot.slotId} className="mw-stage-variant-cell">
              <button
                type="button"
                className="mw-stage-variant"
                data-current={chosen === slot.slotId ? 'true' : 'false'}
                data-review={slot.review}
                aria-label={`${tag} · ${slot.label ?? slot.status}`}
                onClick={() => setChosen(slot.slotId)}
              >
                <StageThumb rpc={rpc} sha256={isImage ? slot.sha256 : undefined} alt={tag} shape="variant">
                  <span className="mw-stage-variant-tag">{tag}</span>
                </StageThumb>
                <span className="mw-stage-variant-cap">
                  {slot.review === 'accepted' ? (en ? 'Accepted' : '已采用') : slot.label ?? statusLabel(slot.status, lang)}
                </span>
              </button>
              {onPinVariant ? (
                <button
                  type="button"
                  className="mw-compare-pin"
                  data-compare-pin="true"
                  aria-label={en ? `Compare ${tag}` : `并排对比 ${tag}`}
                  title={en ? 'Compare side by side' : '并排对比'}
                  onClick={(ev) => {
                    setChosen(slot.slotId)
                    onPinVariant(variantSubject(job, slot, version), ev.currentTarget)
                  }}
                >
                  <Icon name="pin" />
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function QueueRow({ el, lang, selected, onOpen }: { el: MuweaveElementSummaryV1; lang: string; selected: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="mw-stage-queue-row" data-current={selected ? 'true' : 'false'} onClick={onOpen}>
        <span className="mw-stage-queue-icon" data-tone={el.stale ? 'warn' : isPending(el) ? 'neutral' : 'ok'}>
          <Icon name={el.stale ? 'warn' : isPending(el) ? 'edit' : 'check'} />
        </span>
        <span className="mw-stage-queue-name">
          {el.title}
          <small>{el.stale ? statusLabel('stale', lang) : statusLabel(el.status, lang)}</small>
        </span>
        <span className="mw-stage-owner">{el.sourceOwner}</span>
        <time className="mw-stage-num" dateTime={el.updatedAt}>
          {shortTime(el.updatedAt)}
        </time>
        <span className="mw-stage-queue-go">
          <Icon name="chevronDown" />
        </span>
      </button>
    </li>
  )
}

export function StageWorkbench({
  rpc,
  stage,
  rows,
  lang,
  selectedId,
  onSelect,
  onPinCompare,
  onPinVariant,
  onDismiss,
  onSync,
}: {
  rpc: MuweaveRpcClient
  stage: StageId
  rows: readonly MuweaveElementSummaryV1[]
  lang: string
  selectedId?: string
  onSelect: (elementId: string) => void
  onPinCompare: PinCompareHandler
  /** Variant band corner pin; the caller also switches the layout to compare. Absent hides the pins. */
  onPinVariant?: PinCompareHandler
  /** Esc with an element selected and no compare open: closes its inspector detail (the inspector × does the same). */
  onDismiss?: () => void
  /** The empty stage's 「去同步」; absent hides the button. */
  onSync?: () => void
}) {
  const jobs = useJobs(rpc)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const baselineBtnRef = useRef<HTMLButtonElement | null>(null)
  const en = lang === 'en'
  const primary = pickPrimary(rows, selectedId)
  const pending = rows.filter(isPending)
  const others = rows.filter((el) => !isPending(el) && el.elementId !== primary?.elementId)
  const job = primary ? jobForElement(primary, jobs) : undefined
  const slots = variantSlots(job)
  const version = versionLabel(primary)

  const pinBaseline = (el: MuweaveElementSummaryV1, trigger?: HTMLElement | null) => onPinCompare(elementSubject(el), trigger)

  // Design §4: c = 「对比基线」 on the L1 primary, as if the button were pressed (focus returns there).
  const pinRef = useRef<() => void>(() => undefined)
  pinRef.current = () => {
    if (primary) pinBaseline(primary, baselineBtnRef.current)
  }
  const dismissRef = useRef<(() => void) | undefined>(undefined)
  dismissRef.current = selectedId ? onDismiss : undefined
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.isComposing || isEditableTarget(ev.target)) return
      if (ev.target instanceof Element && ev.target.closest('[role="dialog"], [role="menu"]')) return
      const room = getActiveTheaterRoomId()
      if (room && room !== OVERVIEW_ROOM_ID) return
      const root = rootRef.current
      if (!root?.isConnected) return
      const scope: ParentNode = root.closest('[data-muweave-workspace-root="true"]') ?? root.ownerDocument
      if (COMPARE_KEY && matchKey(ev, COMPARE_KEY)) {
        ev.preventDefault()
        pinRef.current()
        return
      }
      if (DISMISS_KEY && matchKey(ev, DISMISS_KEY)) {
        // Compare pane and shell popovers take Escape first; this only closes the inspector detail.
        if (!dismissRef.current || scope.querySelector('[data-popover="true"]')) return
        ev.preventDefault()
        dismissRef.current()
        return
      }
      const active = root.ownerDocument.activeElement
      const from = active instanceof HTMLElement && scope.contains(active) ? stageRegionOf(active) : undefined
      if (!from) return
      const forward = REGION_NEXT_KEY && matchKey(ev, REGION_NEXT_KEY)
      if (forward || (REGION_PREV_KEY && matchKey(ev, REGION_PREV_KEY))) {
        if (focusStageRegion(scope, from, forward ? 1 : -1)) ev.preventDefault()
        return
      }
      const step = ARROW_STEP[ev.key]
      if (step === undefined || from === 'inspector' || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return
      const items = regionFocusables(scope, from)
      const next = items[items.indexOf(active as HTMLElement) + step]
      if (next) {
        ev.preventDefault()
        next.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const head = (
    <header className="mw-stage-work-head">
      <h2>{stageLabel(stage, lang)}</h2>
      <span className="mw-stage-work-meta">
        <span>
          <b className="mw-stage-num">{rows.length}</b> {en ? 'elements' : '个元件'}
        </span>
        <span className="mw-stage-sep" aria-hidden="true" />
        <span>
          <b className="mw-stage-num">{pending.length}</b> {en ? 'pending' : '待处理'}
        </span>
      </span>
      <span className="mw-stage-work-hints" aria-hidden="true">
        <kbd>{formatKeyHint('j')}</kbd>
        <kbd>{formatKeyHint('k')}</kbd>
        <span>{en ? 'switch stage' : '切换阶段'}</span>
        <kbd>Tab</kbd>
        <span>{en ? 'next region' : '切换区块'}</span>
      </span>
    </header>
  )

  if (!primary) {
    return (
      <div ref={rootRef} className="mw-stage-work" data-stage-workbench="true" data-stage={stage}>
        {head}
        <div className="mw-stage-empty" data-stage-region="L1" data-stage-empty="true">
          <EmptyState>
            {en ? 'Nothing produced in this stage yet.' : '本阶段还没有产物'}
            {stage === 'sound' ? (
              <small>{en ? 'No owner produces sound elements yet; this stage lights up once one does.' : '还没有 owner 产出声音元件，接入数据后这一阶段才会亮起。'}</small>
            ) : null}
          </EmptyState>
          {/* Sound has no owner to collect from, so a sync there would promise something it cannot do. */}
          {onSync && stage !== 'sound' ? (
            <button type="button" className="mw-dsh-btn" data-size="sm" data-stage-sync="true" onClick={onSync}>
              <Icon name="sync" />
              {en ? 'Go sync' : '去同步'}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const cover = coverDigest(primary)

  return (
    <div ref={rootRef} className="mw-stage-work" data-stage-workbench="true" data-stage={stage}>
      {head}
      <div className="mw-stage-top">
        <section className="mw-stage-level" data-level="L1" data-stage-region="L1">
          <div className="mw-stage-eyebrow">
            <span>{en ? 'Primary' : '主产物'}</span>
          </div>
          <article className="mw-stage-primary" data-current={selectedId === primary.elementId ? 'true' : 'false'} data-element-id={primary.elementId}>
            <StageThumb rpc={rpc} sha256={cover} alt={primary.title} shape="wide">
              {cover ? null : <span className="mw-stage-thumb-note">{en ? 'No cover' : '暂无封面'}</span>}
            </StageThumb>
            <div className="mw-stage-primary-body">
              <span className="mw-stage-primary-title">{primary.title}</span>
              <span className="mw-stage-primary-actions">
                <button type="button" className="mw-dsh-btn" data-variant="primary" data-size="sm" onClick={() => onSelect(primary.elementId)}>
                  {en ? 'Review' : '审阅'}
                </button>
                <button
                  ref={baselineBtnRef}
                  type="button"
                  className="mw-dsh-btn"
                  data-size="sm"
                  aria-keyshortcuts="c"
                  title={`${en ? 'Compare baseline' : '对比基线'} (${formatKeyHint('c')})`}
                  onClick={(ev) => pinBaseline(primary, ev.currentTarget)}
                >
                  {en ? 'Compare baseline' : '对比基线'}
                </button>
                {/* Outside the button so its name stays the label; aria-keyshortcuts carries the key. */}
                <kbd className="mw-key-hint" aria-hidden="true">
                  {formatKeyHint('c')}
                </kbd>
              </span>
              <span className="mw-stage-primary-status">
                <StatusTag status={primary.stale ? 'stale' : primary.status} lang={lang} />
                {primary.subtitle ? <span className="mw-clamp-2">{primary.subtitle}</span> : null}
              </span>
            </div>
          </article>
        </section>
        <div className="mw-stage-side">
          {slots.length > 1 && job ? <VariantBand key={job.jobId} rpc={rpc} job={job} slots={slots} version={version} lang={lang} onPinVariant={onPinVariant} /> : null}
          <dl className="mw-stage-kv">
            <div>
              <dt>owner</dt>
              <dd>
                <span className="mw-stage-owner">{primary.sourceOwner}</span>
              </dd>
            </div>
            <div>
              <dt>{en ? 'Kind' : '类型'}</dt>
              <dd className="mw-dsh-code">{primary.kind}</dd>
            </div>
            <div>
              <dt>{en ? 'Status' : '状态'}</dt>
              <dd>{statusLabel(primary.stale ? 'stale' : primary.status, lang)}</dd>
            </div>
            <div>
              <dt>{en ? 'Source' : '依据'}</dt>
              <dd className="mw-dsh-code" title={primary.sourceRef}>
                {primary.sourceRef}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <section className="mw-stage-level" data-level="L3" data-stage-region="L3">
        <div className="mw-stage-eyebrow">
          <span>{en ? 'Pending' : '待办'}</span>
          <span className="mw-stage-num">{pending.length}</span>
          <span className="mw-stage-eyebrow-end">{en ? 'waiting review · draft · stale' : '待审阅 · 草稿 · 基线过期'}</span>
        </div>
        {pending.length === 0 ? (
          <p className="mw-stage-quiet">{en ? 'Nothing waits for you in this stage.' : '这个阶段没有等你处理的事项。'}</p>
        ) : (
          <ul className="mw-stage-queue">
            {pending.map((el) => (
              <QueueRow key={el.elementId} el={el} lang={lang} selected={selectedId === el.elementId} onOpen={() => onSelect(el.elementId)} />
            ))}
          </ul>
        )}
        {others.length > 0 ? (
          <>
            <div className="mw-stage-eyebrow">
              <span>{en ? 'Other elements' : '本阶段其他元件'}</span>
              <span className="mw-stage-num">{others.length}</span>
            </div>
            <ul className="mw-stage-queue">
              {others.map((el) => (
                <QueueRow key={el.elementId} el={el} lang={lang} selected={selectedId === el.elementId} onOpen={() => onSelect(el.elementId)} />
              ))}
            </ul>
          </>
        ) : null}
      </section>
      <footer className="mw-stage-versions" data-level="versions" data-stage-region="L3">
        <span className="mw-stage-quiet">{en ? 'Version' : '版本'}</span>
        {version ? (
          <>
            <span className="mw-stage-version-chip" data-current="true">
              {version}
            </span>
            <span>
              {en ? 'Current baseline' : '当前基线'} <b className="mw-stage-num">{version}</b>
            </span>
          </>
        ) : (
          <span className="mw-stage-quiet">{en ? 'The owner reports no revision for this element.' : 'owner 未提供该元件的修订号。'}</span>
        )}
        {primary.stale ? (
          <span className="mw-stage-badge" data-tone="warn">
            <Icon name="warn" />
            {en ? 'Baseline behind' : '基线落后'}
          </span>
        ) : null}
        <span className="mw-stage-versions-end">
          <button type="button" className="mw-dsh-btn" data-size="sm" onClick={(ev) => pinBaseline(primary, ev.currentTarget)}>
            {en ? 'Side by side' : '并排对比'}
          </button>
        </span>
      </footer>
    </div>
  )
}
