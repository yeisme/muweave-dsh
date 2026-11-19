/**
 * Compare pane (desk v8 P1, docs/design/desk-v8-p1-compare.md): the current primary and the pinned
 * side as two same-size thumbnails, with a one-line summary of the three facts the data can back.
 * The shell slot receives a bound <ComparePaneSlot />; the subjects themselves travel as plain data
 * through context, so the pane always renders the live current side and never stale markup.
 */

import { useEffect, useRef } from 'react'
import { Icon, formatKeyHint, isEditableTarget, type MuweaveRpcClient } from '@yeisme/dsh-muweave-core/client'
import { StageThumb } from './stage-workbench'
import { compareSummary, shortTime, type CompareSubject, type CompareSummary } from './stage-map'

export interface ComparePaneProps {
  rpc: MuweaveRpcClient
  lang: string
  /** The live L1 primary (or selected element); absent when nothing is on stage. */
  current?: CompareSubject
  /** The pinned side; absent renders the empty state. */
  compare?: CompareSubject
  /** Clears the pinned side and returns focus to the trigger. The shell split is reset here. */
  onClose: () => void
}

/** What the room hands to the shell's compareSecondary slot. Props-only on purpose: a React context
 *  here would ship an extra react import into the lazy-CJS bundle and trip the purity test. */
export function ComparePaneSlot(props: ComparePaneProps & { onMountedChange?: (mounted: boolean) => void }) {
  const { onMountedChange, ...rest } = props
  useEffect(() => {
    onMountedChange?.(true)
    return () => onMountedChange?.(false)
  }, [onMountedChange])
  return <ComparePane {...rest} />
}

interface Badge {
  key: 'version' | 'digest' | 'time'
  tone: 'warn' | 'ok' | 'neutral'
  text: string
}

/** Assertions only: a missing fact yields no badge, never a guess, and never a better/worse verdict. */
export function summaryBadges(summary: CompareSummary, compareKind: CompareSubject['kind'], lang: string): Badge[] {
  const en = lang === 'en'
  const role = compareKind === 'variant' ? (en ? 'Variant' : '候选') : en ? 'Baseline' : '基线'
  const n = summary.versionsApart ?? 0
  const out: Badge[] = []
  if (summary.versionDiff === 'older') {
    out.push({ key: 'version', tone: 'warn', text: en ? `${role} ${n} behind` : `${role}落后 ${n} 版` })
  } else if (summary.versionDiff === 'newer') {
    out.push({ key: 'version', tone: 'neutral', text: en ? `${role} ${n} ahead` : `${role}领先 ${n} 版` })
  } else if (summary.versionDiff === 'same') {
    out.push({ key: 'version', tone: 'neutral', text: en ? 'Same version' : '同一版本' })
  }
  if (summary.digestDiff === 'same') out.push({ key: 'digest', tone: 'ok', text: en ? 'Identical content' : '内容一致' })
  else if (summary.digestDiff === 'different') out.push({ key: 'digest', tone: 'neutral', text: en ? 'Content differs' : '内容不同' })
  if (summary.hoursApart !== undefined) {
    const h = summary.hoursApart
    out.push({
      key: 'time',
      tone: 'neutral',
      text: h === 0 ? (en ? 'Under 1 hour apart' : '相隔不到 1 小时') : en ? `${h} h apart` : `相隔 ${h} 小时`,
    })
  }
  return out
}

function CompareSideCard({
  rpc,
  lang,
  side,
  subject,
}: {
  rpc: MuweaveRpcClient
  lang: string
  side: 'current' | 'compare'
  subject?: CompareSubject
}) {
  const en = lang === 'en'
  const role =
    side === 'current' ? (en ? 'Current' : '当前') : subject?.kind === 'variant' ? (en ? 'Variant' : '候选') : en ? 'Baseline' : '基线'
  const time = shortTime(subject?.updatedAt)
  return (
    <figure className="mw-compare-side" data-compare-side={side}>
      <StageThumb rpc={rpc} sha256={subject?.sha256} alt={subject?.title ?? role} shape="compare">
        {subject?.sha256 ? null : <span className="mw-stage-thumb-note">{en ? 'No image' : '暂无图像'}</span>}
      </StageThumb>
      <figcaption className="mw-compare-meta">
        <span className="mw-compare-role">
          {role}
          {subject?.version ? <b className="mw-stage-num">{subject.version}</b> : null}
          {subject?.owner ? <span className="mw-stage-owner">{subject.owner}</span> : null}
        </span>
        <span className="mw-compare-title" title={subject?.title}>
          {subject?.title ?? (en ? 'Nothing on stage' : '当前阶段没有主产物')}
        </span>
        {time ? (
          <time className="mw-compare-time mw-stage-num" dateTime={subject?.updatedAt}>
            {time}
          </time>
        ) : null}
      </figcaption>
    </figure>
  )
}

export function ComparePane({ rpc, lang, current, compare, onClose }: ComparePaneProps) {
  const en = lang === 'en'
  const rootRef = useRef<HTMLElement | null>(null)
  const summary = compare ? compareSummary(current, compare) : undefined
  const badges = summary && compare ? summaryBadges(summary, compare.kind, lang) : []

  const close = () => {
    // The shell owns the split. Its own × (visually replaced by this header) clears compareSecondary
    // and returns to single, so pressing it keeps the slot contract untouched.
    const slot = rootRef.current?.closest('[data-muweave-compare-secondary="true"]')
    slot?.querySelector<HTMLButtonElement>(':scope > .mw-spread button')?.click()
    onClose()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing) return
      if (isEditableTarget(ev.target)) return
      if (ev.target instanceof Element && ev.target.closest('[role="dialog"], [role="menu"]')) return
      const root = rootRef.current
      if (!root?.isConnected) return
      // An open view / filter popover takes Escape first.
      if (root.closest('[data-muweave-workspace-root="true"]')?.querySelector('[data-popover="true"]')) return
      ev.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <section ref={rootRef} className="mw-compare" data-compare-pane="true" aria-label={en ? 'Compare' : '对比'}>
      <header className="mw-compare-head">
        <span className="mw-compare-label">{en ? 'Compare' : '对比'}</span>
        <span className="mw-compare-badges" role="status">
          {badges.map((b) => (
            <span key={b.key} className="mw-compare-badge" data-tone={b.tone} data-compare-badge={b.key}>
              {b.text}
            </span>
          ))}
        </span>
        <kbd className="mw-key-hint" aria-hidden="true">
          {formatKeyHint('Escape')}
        </kbd>
        <button
          type="button"
          className="mw-compare-close"
          data-compare-close="true"
          aria-label={en ? 'Close compare (Esc)' : '关闭对比（Esc）'}
          title={en ? 'Close compare (Esc)' : '关闭对比（Esc）'}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      {compare ? (
        <div className="mw-compare-grid">
          <CompareSideCard rpc={rpc} lang={lang} side="current" subject={current} />
          <CompareSideCard rpc={rpc} lang={lang} side="compare" subject={compare} />
        </div>
      ) : (
        <p className="mw-compare-empty" data-compare-empty="true">
          <Icon name="pin" />
          {en ? 'Pick a variant or a baseline to compare side by side' : '选一个候选或基线来并排对比'}
        </p>
      )}
    </section>
  )
}
