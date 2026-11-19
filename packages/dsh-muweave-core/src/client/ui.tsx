/**
 * Shared presentational primitives for the five MuWeave DSH plugins.
 * Everything here is styled by MUWEAVE_CORE_CSS classes; no inline colours or lengths.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { statusLabel, statusTone, type MuweaveTone, type MuweaveTranslator } from './i18n'
import type { MuweaveElementSummaryV1 } from '../protocol'
import type { MuweaveRpcClient } from './rpc-client'

const ICON_PATHS = {
  sync: 'M13 3.5v3h-3M3 12.5v-3h3M12.3 6.5A5 5 0 0 0 3.6 5M3.7 9.5a5 5 0 0 0 8.7 1.5',
  panelLeft: 'M2.5 3.5h11v9h-11zM6 3.5v9',
  panelRight: 'M2.5 3.5h11v9h-11zM10 3.5v9',
  splitSingle: 'M2.5 3.5h11v9h-11z',
  splitH: 'M2.5 3.5h11v9h-11zM8 3.5v9',
  splitV: 'M2.5 3.5h11v9h-11zM2.5 8h11',
  expand: 'M4 10l4-4 4 4',
  collapse: 'M4 6l4 4 4-4',
  minimize: 'M4 8h8',
  send: 'M8 13V3.5M4 7.5l4-4 4 4',
  external: 'M9 3h4v4M13 3L7.5 8.5M11.5 9.5v3h-8v-8h3',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  at: 'M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM10.5 8v1a1.75 1.75 0 0 0 3.5 0V8a6 6 0 1 0-2.4 4.8',
  pin: 'M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5',
  check: 'M3.5 8.5l3 3 6-6.5',
  star: 'M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11l-3.4 1.9.7-3.8L2.5 6.5l3.8-.5z',
  link: 'M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.5.5M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.5-.5',
  handoff: 'M2.5 8h9M8.5 5l3 3-3 3M13.5 3.5v9',
  play: 'M5 3.5v9l7-4.5z',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  edit: 'M10 3.5l2.5 2.5L6 12.5H3.5V10z',
  inbox: 'M2.5 9l1.5-5.5h8L13.5 9v3.5h-11zM2.5 9h3l1 1.5h3l1-1.5h3',
  sliders: 'M3 5h6M11 5h2M3 11h2M7 11h6M9 3.5v3M5 9.5v3',
  zoomIn: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.3 10.3L13.5 13.5M5 7h4M7 5v4',
  zoomOut: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.3 10.3L13.5 13.5M5 7h4',
  image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.5h.01',
  warn: 'M8 2.5l6 10.5H2zM8 6.5v3M8 11.2v.01',
  chevronDown: 'M5 6.5l3 3 3-3',
  back: 'M12.5 8h-9M6.5 5l-3 3 3 3',
  theater: 'M2.5 4.5h11v6h-11zM5.5 13h5M8 10.5V13M2.5 4.5l2-2h7l2 2',
  spark: 'M8 2v3.5M8 10.5V14M2 8h3.5M10.5 8H14M4.2 4.2l1.6 1.6M10.2 10.2l1.6 1.6M11.8 4.2l-1.6 1.6M5.8 10.2l-1.6 1.6',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.3 10.3L13.5 13.5',
  filter: 'M2.5 4h11l-4.2 5v3.4l-2.6 1.3V9z',
  command: 'M5.5 2.5A1.5 1.5 0 0 1 7 4v8a1.5 1.5 0 1 1-1.5-1.5h5A1.5 1.5 0 1 1 9 12V4a1.5 1.5 0 1 1 1.5 1.5h-5',
} as const

export type MuweaveIconName = keyof typeof ICON_PATHS

export function Icon({ name }: { name: MuweaveIconName }) {
  return (
    <svg className="mw-ic" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export type ButtonVariant = 'primary' | 'ghost' | 'danger'

export function IconButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
  size,
  variant = 'ghost',
  ...rest
}: {
  icon: MuweaveIconName
  label: string
  onClick?: () => void
  pressed?: boolean
  disabled?: boolean
  size?: 'sm'
  variant?: ButtonVariant
} & Record<`data-${string}`, string | undefined>) {
  return (
    <button
      type="button"
      className="mw-dsh-btn"
      data-icon="true"
      data-variant={variant}
      data-size={size}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  )
}

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  icon?: MuweaveIconName
}

/** Mutually exclusive buttons; icon-only options keep the label as accessible name and tooltip. */
export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: V | undefined
  options: readonly SegmentedOption<V>[]
  onChange: (v: V) => void
}) {
  return (
    <div className="mw-seg" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="mw-dsh-btn"
          data-size="sm"
          data-icon={opt.icon ? 'true' : undefined}
          aria-pressed={value === opt.value}
          aria-label={opt.icon ? opt.label : undefined}
          title={opt.icon ? opt.label : undefined}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon ? <Icon name={opt.icon} /> : opt.label}
        </button>
      ))}
    </div>
  )
}

/** Raw owner enum → toned pill with a reader label; the raw value stays in the tooltip. */
export function StatusTag({ status, lang, label }: { status: string | undefined; lang: string; label?: string }) {
  if (!status) return null
  const tone = statusTone(status)
  return (
    <span className="mw-status" data-tone={tone} data-status={status} title={status}>
      <span className="mw-dot" data-live={status === 'running' ? 'true' : undefined} />
      {label ?? statusLabel(status, lang)}
    </span>
  )
}

export function ToneDot({ tone, title }: { tone: MuweaveTone; title?: string }) {
  return <span className="mw-dot" data-tone={tone} title={title} role={title ? 'img' : undefined} aria-label={title} />
}

export function EmptyState({ children, icon = 'inbox' }: { children: ReactNode; icon?: MuweaveIconName }) {
  return (
    <div className="mw-empty">
      <Icon name={icon} />
      <p>{children}</p>
    </div>
  )
}

export function SectionHead({
  title,
  meta,
  actions,
  level = 3,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  level?: 2 | 3 | 4
}) {
  const H = `h${level}` as 'h3'
  return (
    <div className="mw-section-head">
      <H>{title}</H>
      {meta !== undefined && meta !== null && meta !== '' ? <span className="mw-meta">{meta}</span> : null}
      {actions ? <div className="mw-section-actions">{actions}</div> : null}
    </div>
  )
}

export function Callout({ tone = 'warn', children, role }: { tone?: MuweaveTone; children: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <p className="mw-callout" data-tone={tone} role={role}>
      <span className="mw-dot" />
      <span>{children}</span>
    </p>
  )
}

/**
 * Right-sidebar companion: a compact refreshable list of bundle elements for one domain.
 * Shared by the script, drama, eikona and workbench companions.
 */
export function CompanionList({
  rpc,
  coreT,
  title,
  domain,
  companionId,
  extra,
}: {
  rpc: MuweaveRpcClient
  coreT: MuweaveTranslator
  title: string
  domain?: string
  companionId: string
  extra?: ReactNode
}) {
  const [items, setItems] = useState<MuweaveElementSummaryV1[] | undefined>(undefined)
  const lang = coreT('langCode')

  const load = useCallback(async () => {
    const res = await rpc.call<{ elements: MuweaveElementSummaryV1[] }>(
      'bundle.elements.list',
      domain ? { domain } : {},
    )
    setItems(res.ok ? res.data.elements : [])
  }, [rpc, domain])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mw-dsh-companion" data-muweave-companion={companionId}>
      <SectionHead
        title={title}
        meta={items ? String(items.length) : undefined}
        actions={<IconButton icon="sync" size="sm" label={coreT('refreshData')} onClick={() => void load()} />}
      />
      {extra}
      {items === undefined ? (
        <div className="mw-skeleton" aria-label={coreT('loading')} />
      ) : items.length === 0 ? (
        <EmptyState>{coreT('emptyElements')}</EmptyState>
      ) : (
        <div className="mw-stack" data-gap="xs">
          {items.map((el) => (
            <div key={el.elementId} className="mw-dsh-card" data-flat="true">
              <div className="mw-spread">
                <span className="mw-title">{el.title}</span>
                <StatusTag status={el.status} lang={lang} />
              </div>
              {el.subtitle ? <span className="mw-dsh-muted mw-clamp-2">{el.subtitle}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
