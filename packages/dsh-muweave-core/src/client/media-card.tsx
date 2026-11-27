import { useState } from 'react'
import { useMediaUrl } from './media'
import type { MuweaveRpcClient } from './rpc-client'

export type EmptyActionProps = (
  | { label: string; onAction: (trigger: HTMLButtonElement) => void; disabled?: boolean }
  | { progress?: number; etaMs?: number }
) & Record<`data-${string}`, string | undefined>

export function EmptyAction(props: EmptyActionProps) {
  if ('onAction' in props) {
    const { onAction, label, disabled, ...rest } = props
    return (
      <div className="mw-empty-action" data-muweave-empty-action="action">
        <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" disabled={disabled} onClick={(event) => onAction(event.currentTarget)} {...rest}>
          {label}
        </button>
      </div>
    )
  }

  const { progress, etaMs, ...rest } = props
  const percent = typeof progress === 'number' && Number.isFinite(progress) ? Math.round(Math.min(100, Math.max(0, progress))) : undefined
  const seconds = typeof etaMs === 'number' && Number.isFinite(etaMs) && etaMs >= 0 ? Math.ceil(etaMs / 1000) : undefined
  const eta = seconds === undefined ? '预计耗时未提供' : seconds < 60 ? `预计剩余 ${seconds} 秒` : `预计剩余 ${Math.ceil(seconds / 60)} 分钟`
  return (
    <div className="mw-empty-action" data-muweave-empty-action="generating" role="status" {...rest}>
      <strong>生成中</strong>
      <progress aria-label="生成进度" max={100} value={percent} />
      <span>{percent === undefined ? '进度未提供' : `${percent}%`} · {eta}</span>
    </div>
  )
}

export interface MediaThumbnailProps {
  rpc: MuweaveRpcClient
  sha256?: string
  mimeType?: string
  alt: string
  fallback: EmptyActionProps
}

/** Resolves browser-safe short-lived URLs through the existing Range media route. */
export function MediaThumbnail({ rpc, sha256, mimeType, alt, fallback, ...rest }: MediaThumbnailProps & Record<`data-${string}`, string | undefined>) {
  const url = useMediaUrl(rpc, sha256, mimeType)
  const [failedUrl, setFailedUrl] = useState<string>()
  return url && url !== failedUrl ? (
    <img
      className="mw-media-thumbnail"
      data-muweave-media-thumbnail="true"
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailedUrl(url)}
      {...rest}
    />
  ) : (
    <EmptyAction {...fallback} />
  )
}
