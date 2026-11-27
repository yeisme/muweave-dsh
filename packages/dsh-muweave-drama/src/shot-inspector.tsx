import { useEffect, useState } from 'react'
import {
  Callout,
  IconButton,
  SHOT_MEDIA_ROLE_LIST,
  ShotGenerateButton,
  StatusTag,
  ToneDot,
  mediaForRole,
  shotDescription,
  stageItemToFloatingAgent,
  type LinkedMediaRef,
  type MuweaveRpcClient,
  type MuweaveTone,
  type MuweaveTranslator,
  type ShotReviewRecordV1,
  type ShotReviewStatus,
} from '@yeisme/dsh-muweave-core/client'

export interface StoryboardRow {
  sceneRef: string
  shotRef: string
  order: number
  plannedDurationMicros: number
  cells: Record<string, unknown>
  restrictedFields: string[]
  /** Keyframe first; written by the host from `shotMedia` links. */
  linkedMedia?: LinkedMediaRef[]
}

export interface AssetRow {
  assetRef: string
  role: string
  parsedVersion: number
  axes: {
    scaenaAdmission: string
    subjectFreeze: string
    productionAcceptance: string
    currentUsability: string
  }
}

export interface EikonaBindableItem {
  id: string
  label: string
  sha256?: string
  elementId: string
  artifactId?: string
  handle?: string
  sourceRef?: string
  kind: 'candidate' | 'master'
}

export const REVIEW_STATUSES: readonly ShotReviewStatus[] = [
  'draft',
  'in_review',
  'needs_revision',
  'approved',
  'locked',
] as const

const QUICK_TAG_KEYS = [
  'tagPacing',
  'tagFraming',
  'tagLipsync',
  'tagLighting',
  'tagVoice',
  'tagVfx',
] as const

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDurationSec(micros: number): string {
  return (micros / 1_000_000).toFixed(1)
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function reviewStatusTone(status: ShotReviewStatus | undefined): MuweaveTone {
  switch (status) {
    case 'approved':
    case 'locked':
      return 'ok'
    case 'in_review':
      return 'info'
    case 'needs_revision':
      return 'bad'
    case 'draft':
    default:
      return 'warn'
  }
}

export function reviewStatusLabel(status: ShotReviewStatus | undefined, t: (k: string) => string): string {
  switch (status) {
    case 'in_review':
      return t('reviewStatusInReview')
    case 'needs_revision':
      return t('reviewStatusNeedsRevision')
    case 'approved':
      return t('reviewStatusApproved')
    case 'locked':
      return t('reviewStatusLocked')
    case 'draft':
    default:
      return t('reviewStatusDraft')
  }
}

function defaultMimeForRole(role: string): string {
  if (role === 'video') return 'video/mp4'
  if (role === 'voice' || role === 'music' || role === 'sfx') return 'audio/mpeg'
  return 'image/png'
}

function useRoleMediaUrl(
  rpc: MuweaveRpcClient,
  sha256: string | undefined,
  mime: string | undefined,
  role: string,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    setUrl(undefined)
    if (!sha256) return
    let cancelled = false
    void rpc.resolveMediaUrl(sha256, mime ?? defaultMimeForRole(role)).then((resolved) => {
      if (!cancelled) setUrl(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [rpc, sha256, mime, role])
  return url
}

function SlotMediaPreview({
  rpc,
  item,
  role,
  shotRef,
  busy,
  onUnlink,
  t,
}: {
  rpc: MuweaveRpcClient
  item: LinkedMediaRef
  role: string
  shotRef: string
  busy: boolean
  onUnlink: (item: LinkedMediaRef) => void
  t: (k: string) => string
}) {
  const url = useRoleMediaUrl(rpc, item.sha256, item.mime, role)
  const isVideo = role === 'video' || Boolean(item.mime?.startsWith('video/'))
  const isAudio = role === 'voice' || role === 'music' || role === 'sfx' || Boolean(item.mime?.startsWith('audio/'))
  const refLabel = item.artifactId ?? item.elementId ?? (item.sha256 ? `${item.sha256.slice(0, 16)}…` : role)

  return (
    <div className="mw-dsh-card mw-stack" data-flat="true" data-gap="xs" data-slot-media-item={role}>
      {url ? (
        isVideo ? (
          <video className="mw-shot-img" src={url} controls playsInline preload="metadata" />
        ) : isAudio ? (
          <audio src={url} controls preload="metadata" />
        ) : (
          <img className="mw-shot-img" src={url} alt={`${shotRef} ${role}`} loading="lazy" />
        )
      ) : null}
      <div className="mw-spread">
        <span className="mw-dsh-code mw-dsh-muted" title={item.sha256 ?? item.elementId ?? role}>
          {refLabel}
        </span>
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="ghost"
          data-size="sm"
          data-shot-media-unlink={role}
          disabled={busy}
          onClick={() => onUnlink(item)}
        >
          {t('unlinkMedia')}
        </button>
      </div>
    </div>
  )
}

export interface ShotInspectorProps {
  rpc: MuweaveRpcClient
  shot: StoryboardRow
  storyboardElementId?: string
  episodeRef?: string
  review?: ShotReviewRecordV1
  eikonaItems: readonly EikonaBindableItem[]
  onClose: () => void
  onPrevShot?: () => void
  onNextShot?: () => void
  hasPrev?: boolean
  hasNext?: boolean
  allShots?: readonly StoryboardRow[]
  allReviews?: Readonly<Record<string, ShotReviewRecordV1>>
  onSelectShot?: (shotRef: string) => void
  onReviewSaved: (record: ShotReviewRecordV1) => void
  onReloadReviews: () => Promise<void>
  onMediaChanged: () => Promise<void>
  t: (k: string) => string
  coreT: MuweaveTranslator
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function ShotInspector({
  rpc,
  shot,
  storyboardElementId,
  episodeRef,
  review,
  eikonaItems,
  onClose,
  onPrevShot,
  onNextShot,
  hasPrev,
  hasNext,
  allShots,
  allReviews,
  onSelectShot,
  onReviewSaved,
  onReloadReviews,
  onMediaChanged,
  t,
  coreT,
}: ShotInspectorProps) {
  const [status, setStatus] = useState<ShotReviewStatus>(review?.status ?? 'draft')
  const [note, setNote] = useState<string>(review?.note ?? '')
  const [tags, setTags] = useState<string[]>(review?.tags ?? [])
  const [savingReview, setSavingReview] = useState(false)
  const [reviewSavedMsg, setReviewSavedMsg] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<{ code: string; message: string; conflict?: boolean } | null>(null)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [selectedBindByRole, setSelectedBindByRole] = useState<Record<string, string>>({})

  useEffect(() => {
    setStatus(review?.status ?? 'draft')
    setNote(review?.note ?? '')
    setTags(review?.tags ?? [])
    setReviewError(null)
    setReviewSavedMsg(null)
  }, [shot.shotRef, review?.revision, review?.status, review?.note])

  const lang = coreT('langCode')
  const visibleCells = Object.entries(shot.cells).filter(([k]) => !shot.restrictedFields.includes(k))
  const promptText = shotDescription(shot.cells, shot.restrictedFields)

  const toggleTag = (tagText: string) => {
    setTags((prev) => {
      if (prev.includes(tagText)) return prev.filter((item) => item !== tagText)
      if (prev.length >= 8) return prev
      return [...prev, tagText]
    })
  }

  const saveReviewWithStatus = async (targetStatus: ShotReviewStatus) => {
    setSavingReview(true)
    setReviewError(null)
    setReviewSavedMsg(null)
    try {
      const res = await rpc.call<{ review: ShotReviewRecordV1 }>('drama.shot.review.set', {
        shotRef: shot.shotRef,
        sceneRef: shot.sceneRef,
        ...(episodeRef ? { episodeRef } : {}),
        status: targetStatus,
        note: note.trim() || undefined,
        tags,
        expectedRevision: review?.revision ?? 0,
      })
      if (!res.ok) {
        setReviewError({
          code: res.error.code,
          message: res.error.message,
          conflict: res.error.code === 'muweave/review_revision_conflict',
        })
        return
      }
      onReviewSaved(res.data.review)
      setReviewSavedMsg(t('reviewSaved'))
    } finally {
      setSavingReview(false)
    }
  }

  const handleSaveReview = async () => {
    await saveReviewWithStatus(status)
  }

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.isComposing || ev.metaKey || ev.ctrlKey || ev.altKey) return
      if (isEditableElement(ev.target)) return
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onClose()
      } else if (ev.key === 'ArrowLeft' || ev.key === 'k' || ev.key === 'K') {
        if (onPrevShot) {
          ev.preventDefault()
          onPrevShot()
        }
      } else if (ev.key === 'ArrowRight' || ev.key === 'j' || ev.key === 'J') {
        if (onNextShot) {
          ev.preventDefault()
          onNextShot()
        }
      } else if (ev.key === 'a' || ev.key === 'A') {
        ev.preventDefault()
        setStatus('approved')
        void saveReviewWithStatus('approved')
      } else if (ev.key === 'r' || ev.key === 'R') {
        ev.preventDefault()
        setStatus('needs_revision')
        void saveReviewWithStatus('needs_revision')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const handleReloadConflict = async () => {
    setReviewError(null)
    await onReloadReviews()
  }

  const handleUnlink = async (role: string, item: LinkedMediaRef) => {
    setMediaBusy(true)
    setMediaError(null)
    try {
      const res = await rpc.call<{ ok: true }>('shot.media.unlink', {
        shotRef: shot.shotRef,
        role,
        ...(item.sha256 ? { sha256: item.sha256 } : {}),
        ...(item.elementId ? { elementId: item.elementId } : {}),
      })
      if (!res.ok) {
        setMediaError(res.error.message)
        return
      }
      await onMediaChanged()
    } finally {
      setMediaBusy(false)
    }
  }

  const handleBindEikona = async (role: string) => {
    const pickedId = selectedBindByRole[role] || eikonaItems[0]?.id
    const picked = eikonaItems.find((item) => item.id === pickedId)
    if (!picked) return
    setMediaBusy(true)
    setMediaError(null)
    try {
      const res = await rpc.call<{ ok: true }>('shot.media.link', {
        shotRef: shot.shotRef,
        sceneRef: shot.sceneRef,
        ...(episodeRef ? { episodeRef } : {}),
        role,
        ...(picked.sha256 ? { sha256: picked.sha256 } : { elementId: picked.elementId }),
        ...(picked.artifactId ? { artifactId: picked.artifactId } : {}),
      })
      if (!res.ok) {
        setMediaError(res.error.message)
        return
      }
      await onMediaChanged()
    } finally {
      setMediaBusy(false)
    }
  }

  return (
    <section
      className="dr-inspector mw-stack"
      data-gap="md"
      data-muweave-shot-inspector={shot.shotRef}
      aria-label={t('inspectorTitle')}
    >
      <header className="dr-inspector-head mw-spread">
        <div className="mw-stack" data-gap="xs">
          <span className="mw-eyebrow">
            {pad2(shot.order)} · {formatDurationSec(shot.plannedDurationMicros)} {t('seconds')}
          </span>
          <h3 className="mw-title mw-dsh-code">{shot.shotRef}</h3>
          <span className="mw-dsh-muted">{shot.sceneRef}</span>
        </div>
        <div className="mw-row" data-gap="xs">
          <IconButton
            icon="at"
            size="sm"
            label={coreT('insertRefChip')}
            onClick={() =>
              stageItemToFloatingAgent({
                kind: 'element',
                ref: `${storyboardElementId ?? 'drama'}:${shot.shotRef}`,
                label: `${shot.sceneRef}/${shot.shotRef}`,
                serializedLine: `[ScaenaShot breakdown=${episodeRef ?? 'drama'} scene=${shot.sceneRef} shot=${shot.shotRef}]`,
              })
            }
          />
          <IconButton icon="close" size="sm" label={t('closeInspector')} onClick={onClose} />
        </div>
      </header>

      <div className="dr-kbd-hints mw-row" data-gap="xs" data-inspector-kbd-hints="true">
        {hasPrev || hasNext ? (
          <span>
            <kbd>←</kbd>/<kbd>→</kbd> {t('kbdSwitchShot')}
          </span>
        ) : null}
        <span>
          <kbd>a</kbd> {t('kbdApprove')}
        </span>
        <span>
          <kbd>r</kbd> {t('kbdRevision')}
        </span>
        <span>
          <kbd>Esc</kbd> {t('kbdClose')}
        </span>
      </div>

      {visibleCells.length > 0 ? (
        <div className="mw-row" data-gap="xs">
          {visibleCells.map(([k, v]) => (
            <span key={k} className="mw-chip" title={k}>
              {formatCell(v)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="dr-inspector-section mw-stack" data-gap="sm" data-review-panel="true">
        <div className="mw-spread">
          <span className="mw-eyebrow">{t('reviewSectionTitle')}</span>
          <StatusTag
            status={status}
            lang={lang}
            label={reviewStatusLabel(status, t)}
          />
        </div>

        <div className="dr-review-statuses mw-row" data-gap="xs" role="group" aria-label={t('reviewStatusLabel')}>
          {REVIEW_STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              className="mw-dsh-btn"
              data-size="sm"
              data-variant="ghost"
              data-review-status-option={st}
              aria-pressed={status === st}
              onClick={() => setStatus(st)}
            >
              {reviewStatusLabel(st, t)}
            </button>
          ))}
        </div>

        <div className="dr-review-tags mw-row" data-gap="xs" role="group" aria-label={t('reviewTagsLabel')}>
          {QUICK_TAG_KEYS.map((tagKey) => {
            const label = t(tagKey)
            const active = tags.includes(label)
            return (
              <button
                key={tagKey}
                type="button"
                className="mw-dsh-btn"
                data-size="sm"
                data-variant="ghost"
                data-review-tag={label}
                aria-pressed={active}
                onClick={() => toggleTag(label)}
              >
                {label}
              </button>
            )
          })}
        </div>

        <label className="mw-stack" data-gap="xs">
          <span className="mw-dsh-muted">{t('reviewNoteLabel')}</span>
          <textarea
            className="dr-review-note mw-dsh-input"
            rows={3}
            maxLength={500}
            aria-label={t('reviewNoteLabel')}
            placeholder={t('reviewNotePlaceholder')}
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
          />
        </label>

        {reviewError ? (
          <div className="mw-stack" data-gap="xs" data-review-conflict={reviewError.conflict ? 'true' : undefined}>
            <Callout tone={reviewError.conflict ? 'warn' : 'bad'} role="alert">
              {reviewError.conflict ? t('reviewConflictMsg') : reviewError.message}
            </Callout>
            {reviewError.conflict ? (
              <button
                type="button"
                className="mw-dsh-btn"
                data-size="sm"
                data-review-conflict-reload="true"
                onClick={() => void handleReloadConflict()}
              >
                {t('reviewConflictReload')}
              </button>
            ) : null}
          </div>
        ) : null}

        {reviewSavedMsg ? (
          <p className="mw-dsh-muted" role="status" data-review-saved="true">
            {reviewSavedMsg} (v{review?.revision ?? 1})
          </p>
        ) : null}

        <div className="mw-spread">
          <span className="mw-dsh-muted">v{review?.revision ?? 0}</span>
          <button
            type="button"
            className="mw-dsh-btn"
            data-variant="primary"
            data-size="sm"
            data-review-save="true"
            disabled={savingReview}
            onClick={() => void handleSaveReview()}
          >
            {savingReview ? t('savingReview') : t('saveReview')}
          </button>
        </div>
      </div>

      <div className="dr-inspector-section dr-media-slots mw-stack" data-gap="sm" data-media-slots-panel="true">
        <span className="mw-eyebrow">{t('mediaSlotsTitle')}</span>
        {mediaError ? (
          <Callout tone="bad" role="alert">
            {mediaError}
          </Callout>
        ) : null}

        {SHOT_MEDIA_ROLE_LIST.map((role) => {
          const items = mediaForRole(shot.linkedMedia, role)
          const isVisualRole = role === 'keyframe' || role === 'reference'
          const isAudioRole = role === 'sfx' || role === 'voice' || role === 'music'
          const roleLabel = t(`role_${role}`)
          const selectedBind = selectedBindByRole[role] ?? eikonaItems[0]?.id ?? ''

          return (
            <div key={role} className="dr-media-slot mw-dsh-card mw-stack" data-flat="true" data-gap="xs" data-media-slot={role}>
              <div className="mw-spread">
                <span className="mw-title">{roleLabel}</span>
                <span className="mw-dsh-muted">{items.length > 0 ? `${items.length}` : t('slotEmpty')}</span>
              </div>

              {items.map((item, idx) => (
                <SlotMediaPreview
                  key={`${role}-${item.sha256 ?? item.elementId ?? idx}`}
                  rpc={rpc}
                  item={item}
                  role={role}
                  shotRef={shot.shotRef}
                  busy={mediaBusy}
                  onUnlink={(target) => void handleUnlink(role, target)}
                  t={t}
                />
              ))}

              {eikonaItems.length > 0 && isVisualRole ? (
                <div className="mw-row" data-gap="xs">
                  <select
                    className="mw-dsh-input"
                    aria-label={`${t('bindEikonaSelect')} (${roleLabel})`}
                    data-bind-select={role}
                    value={selectedBind}
                    onChange={(ev) =>
                      setSelectedBindByRole((prev) => ({
                        ...prev,
                        [role]: ev.target.value,
                      }))
                    }
                  >
                    {eikonaItems.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="mw-dsh-btn"
                    data-size="sm"
                    data-variant="quiet"
                    data-shot-media-bind={role}
                    disabled={mediaBusy || !selectedBind}
                    onClick={() => void handleBindEikona(role)}
                  >
                    {t('bindMedia')}
                  </button>
                </div>
              ) : null}

              {items.length === 0 && isVisualRole ? (
                <ShotGenerateButton
                  t={coreT}
                  shotRef={shot.shotRef}
                  prompt={promptText}
                  anchor={{ ...(episodeRef ? { episodeRef } : {}), sceneRef: shot.sceneRef }}
                  capabilityId="eikona.image.generate"
                  stage={['visual', 'storyboard']}
                  label={t('genVisualForRole')}
                />
              ) : null}

              {items.length === 0 && isAudioRole ? (
                <ShotGenerateButton
                  t={coreT}
                  shotRef={shot.shotRef}
                  prompt={promptText}
                  anchor={{ ...(episodeRef ? { episodeRef } : {}), sceneRef: shot.sceneRef }}
                  capabilityId="sonora.sfx.generate"
                  stage={['sound', 'storyboard']}
                  label={t('genAudioForRole')}
                />
              ) : null}
            </div>
          )
        })}
      </div>

      {allShots && allShots.length > 0 && onSelectShot ? (
        <nav
          className="dr-filmstrip"
          data-inspector-filmstrip="true"
          aria-label={t('filmstripLabel')}
        >
          {allShots.map((s) => {
            const st = allReviews?.[s.shotRef]?.status
            const isCurrent = s.shotRef === shot.shotRef
            return (
              <button
                key={s.shotRef}
                type="button"
                className="dr-filmstrip-item"
                data-filmstrip-shot={s.shotRef}
                aria-current={isCurrent ? 'true' : undefined}
                title={`${pad2(s.order)} · ${s.shotRef} (${reviewStatusLabel(st, t)})`}
                onClick={() => onSelectShot(s.shotRef)}
              >
                <span>{pad2(s.order)}</span>
                <ToneDot tone={reviewStatusTone(st)} />
              </button>
            )
          })}
        </nav>
      ) : null}
    </section>
  )
}
