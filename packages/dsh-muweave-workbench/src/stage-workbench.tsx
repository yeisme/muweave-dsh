/**
 * Overview stage workbench (desk v8): one stage at three densities — L1 the primary artifact, L2 the
 * variants of the job that produced it, L3 the pending queue — plus a version band. Every level shows
 * an honest placeholder when the bundle has no cover, slots or revision; nothing is invented.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  EmptyState,
  Icon,
  StatusTag,
  formatKeyHint,
  statusLabel,
  useMediaUrl,
  type JobRecordV1,
  type JobSlotV1,
  type MuweaveElementSummaryV1,
  type MuweaveRpcClient,
} from '@yeisme/dsh-muweave-core/client'
import { isPending, jobForElement, pickPrimary, shortTime, stageLabel, variantSlots, versionLabel, type StageId } from './stage-map'

function coverDigest(el: MuweaveElementSummaryV1): string | undefined {
  const blobs = Array.isArray(el.mediaBlobs) ? el.mediaBlobs : []
  return blobs.find((b) => typeof b?.mimeType === 'string' && b.mimeType.startsWith('image/') && b.blobDigest)?.blobDigest
}

/** Thumbnail with a real image when the media route resolves, else the fill + hairline grid placeholder. */
function StageThumb({ rpc, sha256, alt, shape, children }: { rpc: MuweaveRpcClient; sha256?: string; alt: string; shape: 'wide' | 'variant'; children?: ReactNode }) {
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

function VariantBand({ rpc, job, slots, version, lang }: { rpc: MuweaveRpcClient; job: JobRecordV1; slots: JobSlotV1[]; version?: string; lang: string }) {
  const accepted = slots.find((s) => s.review === 'accepted')?.slotId
  const [chosen, setChosen] = useState<string | undefined>(accepted)
  const en = lang === 'en'
  return (
    <section className="mw-stage-level" data-level="L2">
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
            <li key={slot.slotId}>
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
}: {
  rpc: MuweaveRpcClient
  stage: StageId
  rows: readonly MuweaveElementSummaryV1[]
  lang: string
  selectedId?: string
  onSelect: (elementId: string) => void
  onPinCompare: (node: ReactNode) => void
}) {
  const jobs = useJobs(rpc)
  const en = lang === 'en'
  const primary = pickPrimary(rows, selectedId)
  const pending = rows.filter(isPending)
  const others = rows.filter((el) => !isPending(el) && el.elementId !== primary?.elementId)
  const job = primary ? jobForElement(primary, jobs) : undefined
  const slots = variantSlots(job)
  const version = versionLabel(primary)

  const pinBaseline = (el: MuweaveElementSummaryV1) =>
    onPinCompare(
      <div className="mw-stack" data-gap="xs">
        <span className="mw-title">{el.title}</span>
        <span className="mw-dsh-muted">
          {el.sourceOwner} · {el.kind} · {el.sourceRef}
          {version ? ` · ${version}` : ''}
        </span>
        <code className="mw-dsh-code">{el.digest}</code>
      </div>,
    )

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
      <span className="mw-stage-work-hints">
        <kbd>{formatKeyHint('j')}</kbd>
        <kbd>{formatKeyHint('k')}</kbd>
        <span>{en ? 'switch stage' : '切换阶段'}</span>
      </span>
    </header>
  )

  if (!primary) {
    return (
      <div className="mw-stage-work" data-stage-workbench="true" data-stage={stage}>
        {head}
        <EmptyState>
          {stage === 'sound'
            ? en
              ? 'No owner produces sound elements yet; this stage lights up once one does.'
              : '还没有 owner 产出声音元件，接入数据后这一阶段才会亮起。'
            : en
              ? 'No elements in this stage yet.'
              : '这个阶段还没有元件。'}
        </EmptyState>
      </div>
    )
  }

  const cover = coverDigest(primary)

  return (
    <div className="mw-stage-work" data-stage-workbench="true" data-stage={stage}>
      {head}
      <div className="mw-stage-top">
        <section className="mw-stage-level" data-level="L1">
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
                <button type="button" className="mw-dsh-btn" data-size="sm" onClick={() => pinBaseline(primary)}>
                  {en ? 'Compare baseline' : '对比基线'}
                </button>
              </span>
              <span className="mw-stage-primary-status">
                <StatusTag status={primary.stale ? 'stale' : primary.status} lang={lang} />
                {primary.subtitle ? <span className="mw-clamp-2">{primary.subtitle}</span> : null}
              </span>
            </div>
          </article>
        </section>
        <div className="mw-stage-side">
          {slots.length > 1 && job ? <VariantBand key={job.jobId} rpc={rpc} job={job} slots={slots} version={version} lang={lang} /> : null}
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
      <section className="mw-stage-level" data-level="L3">
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
      <footer className="mw-stage-versions" data-level="versions">
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
          <button type="button" className="mw-dsh-btn" data-size="sm" onClick={() => pinBaseline(primary)}>
            {en ? 'Side by side' : '并排对比'}
          </button>
        </span>
      </footer>
    </div>
  )
}
