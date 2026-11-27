/**
 * Editorial v2 primitives (docs/design/editorial-v2.md): a work-first page is a serif hero with
 * real covers, then cards. Monochrome ink actions, glass pills, no brand colour.
 */

import type { CSSProperties, ReactNode } from 'react'
import type { ProjectCover } from './media'
import { MediaThumbnail, type MediaThumbnailProps } from './media-card'
import { Icon, StatusTag, type MuweaveIconName } from './ui'

export function PillButton({
  children,
  icon,
  variant = 'quiet',
  onClick,
  disabled,
  ...rest
}: {
  children: ReactNode
  icon?: MuweaveIconName
  variant?: 'primary' | 'quiet'
  onClick?: () => void
  disabled?: boolean
} & Record<`data-${string}`, string | undefined>) {
  return (
    <button type="button" className="mw-dsh-btn" data-variant={variant} disabled={disabled} onClick={onClick} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

export interface HeroStatItem {
  icon?: MuweaveIconName
  value: ReactNode
  label: string
}

export function HeroStat({ icon, value, label }: HeroStatItem) {
  return (
    <li className="mw-hero-stat">
      {icon ? <Icon name={icon} /> : null}
      <b>{value}</b>
      <span>{label}</span>
    </li>
  )
}

/** Room hero: serif title, a lede, icon + number stats, pill actions and a cover on the right. */
export function RoomHero({
  eyebrow,
  title,
  lede,
  stats,
  actions,
  cover,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lede?: ReactNode
  stats?: readonly HeroStatItem[]
  actions?: ReactNode
  cover?: ReactNode
}) {
  return (
    <header className="mw-hero" data-muweave-hero="true">
      <div className="mw-hero-main">
        {eyebrow ? <p className="mw-hero-eyebrow">{eyebrow}</p> : null}
        <h2 className="mw-hero-title">{title}</h2>
        {lede ? <p className="mw-hero-lede">{lede}</p> : null}
        {stats && stats.length > 0 ? (
          <ul className="mw-hero-stats">
            {stats.map((s) => (
              <HeroStat key={s.label} {...s} />
            ))}
          </ul>
        ) : null}
        {actions ? <div className="mw-hero-actions">{actions}</div> : null}
      </div>
      {cover}
    </header>
  )
}

/** Up to three tilted real covers; with none, one typographic poster instead of fake art. */
export function CoverCollage({
  covers,
  posterTitle,
  posterMeta,
}: {
  covers: readonly ProjectCover[] | undefined
  posterTitle: ReactNode
  posterMeta?: ReactNode
}) {
  const shown = (covers ?? []).slice(0, 3)
  if (shown.length === 0) {
    return (
      <div className="mw-collage" data-count="1" data-muweave-cover="poster" aria-hidden="true">
        <figure className="mw-collage-tile">
          <Poster title={posterTitle} meta={posterMeta} />
        </figure>
      </div>
    )
  }
  return (
    <div className="mw-collage" data-count={String(shown.length)} data-muweave-cover="images">
      {shown.map((c) => (
        <figure key={c.sha256} className="mw-collage-tile">
          <img src={c.url} alt={c.alt} />
        </figure>
      ))}
    </div>
  )
}

export function Poster({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mw-poster">
      <b>{title}</b>
      {meta ? <span>{meta}</span> : null}
    </div>
  )
}

/** Media-first card: inset media, glass round actions on hover/focus, title and meta below. */
export function MediaCard({
  media,
  image,
  actions,
  title,
  meta,
  children,
  ratio,
  version,
  review,
  shotCount,
  stale,
  selected,
  lang,
  ...rest
}: {
  media?: ReactNode
  image?: MediaThumbnailProps & Record<`data-${string}`, string | undefined>
  actions?: ReactNode
  title?: ReactNode
  meta?: ReactNode
  children?: ReactNode
  ratio?: string
  version?: string
  review?: string
  shotCount?: number
  stale?: boolean
  selected?: boolean
  lang?: string
} & Record<`data-${string}`, string | undefined>) {
  const hasBadges = Boolean(version || review || shotCount !== undefined || stale)
  return (
    <article
      className="mw-dsh-card mw-media-card"
      data-interactive="true"
      data-selected={selected ? 'true' : undefined}
      data-p0-media-card={image ? 'true' : undefined}
      style={{ '--mw-media-ratio': ratio ?? '4 / 3' } as CSSProperties}
      {...rest}
    >
      {image || media ? (
        <div className="mw-media-card-media">{image ? <MediaThumbnail {...image} /> : media}</div>
      ) : null}
      {actions ? <div className="mw-media-card-actions">{actions}</div> : null}
      {title || meta || hasBadges || children ? (
        <div className="mw-media-card-body">
          {title ? <h3 className="mw-media-card-title">{title}</h3> : null}
          {meta ? <p className="mw-media-card-meta">{meta}</p> : null}
          {hasBadges ? (
            <div className="mw-media-card-badges">
              {version ? <span className="mw-chip mw-num" data-media-version={version}>{version}</span> : null}
              {review ? <StatusTag status={review === 'unreviewed' ? 'waiting_review' : review} lang={lang ?? 'zh'} /> : null}
              {shotCount !== undefined ? <span className="mw-chip mw-num" data-media-shots={shotCount}>绑定 {shotCount} 镜</span> : null}
              {stale ? <StatusTag status="stale" lang={lang ?? 'zh'} /> : null}
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </article>
  )
}

export function NoteCard({
  eyebrow,
  title,
  children,
  ink,
  ...rest
}: {
  eyebrow?: ReactNode
  title?: ReactNode
  children?: ReactNode
  ink?: boolean
} & Record<`data-${string}`, string | undefined>) {
  return (
    <article className="mw-dsh-card" data-ink={ink ? 'true' : undefined} {...rest}>
      {eyebrow ? <p className="mw-eyebrow">{eyebrow}</p> : null}
      {title ? <h3 className="mw-card-title">{title}</h3> : null}
      {children}
    </article>
  )
}

export function QuoteCard({ children, cite }: { children: ReactNode; cite?: ReactNode }) {
  return (
    <figure className="mw-dsh-card mw-quote-card">
      <blockquote className="mw-read-quote">{children}</blockquote>
      {cite ? <figcaption className="mw-dsh-muted">{cite}</figcaption> : null}
    </figure>
  )
}

/** CSS-columns masonry; `min` is the narrowest column. */
export function Masonry({
  children,
  min,
  ...rest
}: { children: ReactNode; min?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <div className="mw-masonry" style={{ '--mw-card-min': min ?? '15rem' } as CSSProperties} {...rest}>
      {children}
    </div>
  )
}

export function AmbientBackdrop() {
  return (
    <div className="mw-ambient" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  )
}
