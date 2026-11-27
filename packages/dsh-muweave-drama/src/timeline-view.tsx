import { useState, type CSSProperties } from 'react'
import {
  Callout,
  EmptyState,
  SHOT_MEDIA_ROLE_LIST,
  SectionHead,
  mediaForRole,
  shotReadinessSummary,
  type DramaExportFormat,
  type DramaExportResultV1,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  type ShotReviewRecordV1,
  type WorkspaceNotice,
} from '@yeisme/dsh-muweave-core/client'
import { formatDurationSec, pad2, reviewStatusLabel, type StoryboardRow } from './shot-inspector'

interface EditClipPayload {
  clip_ref?: string
  shot_ref?: string
  shotRef?: string
  in_ms?: number
  out_ms?: number
}

interface TimelineClipItem {
  id: string
  label: string
  shotRef: string
  inMs: number
  outMs: number
  shot?: StoryboardRow
}

function triggerSafeDownload(filename: string, content: string, mimeType: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return
  if (typeof URL.createObjectURL !== 'function') return
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
  }
}

function buildTimelineClips(
  rawClips: readonly EditClipPayload[],
  shotRows: readonly StoryboardRow[],
): TimelineClipItem[] {
  const shotByRef = new Map(shotRows.map((row) => [row.shotRef, row]))

  if (rawClips.length > 0) {
    return rawClips.map((clip, idx) => {
      const inMs = clip.in_ms ?? 0
      const outMs = clip.out_ms ?? inMs
      const label = clip.clip_ref ?? `clip_${idx + 1}`
      const candidateRef = clip.shotRef ?? clip.shot_ref ?? clip.clip_ref ?? ''
      const matched = shotByRef.get(candidateRef) ?? shotRows[idx]
      return {
        id: `${label}-${idx}`,
        label,
        shotRef: matched?.shotRef ?? candidateRef,
        inMs,
        outMs,
        shot: matched,
      }
    })
  }

  let cursor = 0
  return shotRows.map((row, idx) => {
    const durMs = Math.max(100, Math.round(row.plannedDurationMicros / 1000))
    const inMs = cursor
    const outMs = cursor + durMs
    cursor = outMs
    return {
      id: `${row.shotRef}-${idx}`,
      label: row.shotRef,
      shotRef: row.shotRef,
      inMs,
      outMs,
      shot: row,
    }
  })
}

async function copyTextSafe(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to execCommand fallback
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', 'true')
      document.body.appendChild(ta)
      ta.select()
      const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : true
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
  return true
}

function buildReviewSummaryMarkdown(
  shotRows: readonly StoryboardRow[],
  reviewsByShot: Record<string, ShotReviewRecordV1>,
  t: (k: string) => string,
): string {
  const totalMicros = shotRows.reduce((sum, r) => sum + r.plannedDurationMicros, 0)
  const approvedCount = shotRows.filter((r) => {
    const st = reviewsByShot[r.shotRef]?.status
    return st === 'approved' || st === 'locked'
  }).length
  const needsRevCount = shotRows.filter((r) => reviewsByShot[r.shotRef]?.status === 'needs_revision').length
  const lines: string[] = [
    `# ${t('mdSummaryTitle')}`,
    '',
    `- ${t('shotCount')}: ${shotRows.length} | ${t('statDuration')}: ${formatDurationSec(totalMicros)}s | ${t('statApproved')}: ${approvedCount}/${shotRows.length} | ${t('reviewStatusNeedsRevision')}: ${needsRevCount}`,
    '',
  ]
  for (const row of shotRows) {
    const rev = reviewsByShot[row.shotRef]
    const statusText = reviewStatusLabel(rev?.status, t)
    const readiness = shotReadinessSummary(row.linkedMedia)
    const missingRoles = SHOT_MEDIA_ROLE_LIST.filter((role) => !readiness.rolesPresent.has(role))
    const rolesPart =
      missingRoles.length === 0 ? t('mdAllRolesReady') : `${t('mdMissingRoles')}: ${missingRoles.join(', ')}`
    const cleanNote = rev?.note ? rev.note.replace(/\s+/g, ' ').trim() : ''
    lines.push(
      `- **#${pad2(row.order)} ${row.shotRef}** (${row.sceneRef}, ${formatDurationSec(row.plannedDurationMicros)}s) — [${statusText}] · ${rolesPart}${cleanNote ? ` · ${cleanNote}` : ''}`,
    )
  }
  return lines.join('\n')
}

export interface TimelineViewProps {
  rpc: MuweaveRpcClient
  editTimelines: readonly MuweaveElementSummaryV1[]
  details: Record<string, MuweaveElementV1>
  shotRows: readonly StoryboardRow[]
  reviewsByShot: Record<string, ShotReviewRecordV1>
  episodeRef?: string
  onInspectShot: (shotRef: string) => void
  onNotice?: (notice: WorkspaceNotice) => void
  t: (k: string) => string
  coreT: MuweaveTranslator
}

export function TimelineView({
  rpc,
  editTimelines,
  details,
  shotRows,
  reviewsByShot,
  episodeRef,
  onInspectShot,
  onNotice,
  t,
  coreT,
}: TimelineViewProps) {
  const [exportingFormat, setExportingFormat] = useState<DramaExportFormat | null>(null)
  const [exportReceipt, setExportReceipt] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [mdCopied, setMdCopied] = useState(false)

  const handleCopyReviewMarkdown = async () => {
    const md = buildReviewSummaryMarkdown(shotRows, reviewsByShot, t)
    await copyTextSafe(md)
    setMdCopied(true)
    const msg = t('reviewMdCopied')
    setExportReceipt(msg)
    onNotice?.({ tone: 'ok', text: msg })
  }

  const handleExport = async (format: DramaExportFormat, fps: number, aspectRatio: string) => {
    setExportingFormat(format)
    setExportError(null)
    setExportReceipt(null)
    try {
      const res = await rpc.call<{ export: DramaExportResultV1 } | DramaExportResultV1>('drama.export.manifest', {
        format,
        fps,
        aspectRatio,
        ...(episodeRef ? { episodeRef } : {}),
      })
      if (!res.ok) {
        setExportError(res.error.message)
        onNotice?.({ tone: 'bad', text: res.error.message })
        return
      }
      const pkg = 'export' in res.data && res.data.export ? res.data.export : (res.data as DramaExportResultV1)
      triggerSafeDownload(pkg.filename, pkg.content, pkg.mimeType)
      const msg = `${t('exportDone')}: ${pkg.filename}`
      setExportReceipt(msg)
      onNotice?.({ tone: 'ok', text: msg })
    } finally {
      setExportingFormat(null)
    }
  }

  if (editTimelines.length === 0 && shotRows.length === 0) {
    return <EmptyState>{coreT('emptyElements')}</EmptyState>
  }

  const timelineSections =
    editTimelines.length > 0
      ? editTimelines.map((et) => {
          const pl = (details[et.elementId]?.payload ?? {}) as {
            aspectRatio?: string
            fps?: number
            clips?: EditClipPayload[]
          }
          return {
            id: et.elementId,
            title: et.title,
            subtitle: et.subtitle ?? '',
            aspectRatio: pl.aspectRatio ?? '9:16',
            fps: pl.fps ?? 24,
            clips: buildTimelineClips(pl.clips ?? [], shotRows),
          }
        })
      : [
          {
            id: 'storyboard-derived-timeline',
            title: t('tabTimeline'),
            subtitle: `${shotRows.length} ${t('shotCount')}`,
            aspectRatio: '9:16',
            fps: 24,
            clips: buildTimelineClips([], shotRows),
          },
        ]

  const primaryFps = timelineSections[0]?.fps ?? 24
  const primaryAspect = timelineSections[0]?.aspectRatio ?? '9:16'

  return (
    <div className="mw-stack" data-gap="lg" data-drama-timeline-view="true">
      <div className="dr-export-bar mw-spread" data-drama-export-bar="true">
        <span className="mw-dsh-muted">
          {t('aspect')} {primaryAspect} · {primaryFps} fps
        </span>
        <div className="mw-row" data-gap="xs">
          <button
            type="button"
            className="mw-dsh-btn"
            data-size="sm"
            data-variant="quiet"
            data-export-format="cmx3600_edl"
            disabled={exportingFormat !== null}
            onClick={() => void handleExport('cmx3600_edl', primaryFps, primaryAspect)}
          >
            {t('exportEdl')}
          </button>
          <button
            type="button"
            className="mw-dsh-btn"
            data-size="sm"
            data-variant="quiet"
            data-export-format="cut_manifest_v1"
            disabled={exportingFormat !== null}
            onClick={() => void handleExport('cut_manifest_v1', primaryFps, primaryAspect)}
          >
            {t('exportCutManifest')}
          </button>
          <button
            type="button"
            className="mw-dsh-btn"
            data-size="sm"
            data-variant="quiet"
            data-export-format="shotlist_csv"
            disabled={exportingFormat !== null}
            onClick={() => void handleExport('shotlist_csv', primaryFps, primaryAspect)}
          >
            {t('exportShotlistCsv')}
          </button>
          <button
            type="button"
            className="mw-dsh-btn"
            data-size="sm"
            data-variant="quiet"
            data-export-format="fcpxml_1_10"
            data-drama-export-fcpxml="true"
            disabled={exportingFormat !== null}
            onClick={() => void handleExport('fcpxml_1_10', primaryFps, primaryAspect)}
          >
            {t('exportFcpxml')}
          </button>
          <button
            type="button"
            className="mw-dsh-btn"
            data-size="sm"
            data-variant="quiet"
            data-export-format="jianying_draft_v1"
            data-drama-export-jianying="true"
            disabled={exportingFormat !== null}
            onClick={() => void handleExport('jianying_draft_v1', primaryFps, primaryAspect)}
          >
            {t('exportJianying')}
          </button>
          <button
            type="button"
            className="mw-dsh-btn"
            data-size="sm"
            data-variant="quiet"
            data-drama-copy-review-md="true"
            onClick={() => void handleCopyReviewMarkdown()}
          >
            {t('copyReviewMarkdown')}
          </button>
        </div>
      </div>

      {mdCopied ? (
        <p className="mw-dsh-muted" role="status" data-drama-md-copied="true">
          {t('reviewMdCopied')}
        </p>
      ) : null}

      {exportError ? (
        <Callout tone="bad" role="alert">
          {exportError}
        </Callout>
      ) : null}

      {exportReceipt ? (
        <p className="mw-dsh-muted" role="status" data-export-receipt="true">
          {exportReceipt}
        </p>
      ) : null}

      {timelineSections.map((sec) => {
        const total = Math.max(1, ...sec.clips.map((c) => c.outMs))
        const midMs = Math.round(total / 2)
        const voiceClips = sec.clips.filter((c) => mediaForRole(c.shot?.linkedMedia, 'voice').length > 0)
        const sfxMusicClips = sec.clips.filter(
          (c) =>
            mediaForRole(c.shot?.linkedMedia, 'sfx').length > 0 ||
            mediaForRole(c.shot?.linkedMedia, 'music').length > 0,
        )

        return (
          <section key={sec.id} className="mw-stack" data-gap="sm">
            <SectionHead
              title={sec.title}
              meta={`${t('aspect')} ${sec.aspectRatio} · ${sec.fps} fps${sec.subtitle ? ` · ${sec.subtitle}` : ''}`}
            />

            {sec.clips.length > 0 ? (
              <div className="dr-multitrack mw-stack" data-gap="xs" data-multitrack="true">
                <div className="dr-ruler mw-spread mw-dsh-muted" data-timeline-ruler="true">
                  <span>0.0s</span>
                  <span>{(midMs / 1000).toFixed(1)}s</span>
                  <span>{(total / 1000).toFixed(1)}s</span>
                </div>

                <div className="dr-track-row mw-stack" data-gap="xs" data-track-lane="visual">
                  <span className="dr-track-label mw-eyebrow">{t('trackVisual')}</span>
                  <div className="dr-track" role="list" aria-label={t('trackVisual')}>
                    {sec.clips.map((clip) => {
                      const rev = reviewsByShot[clip.shotRef]
                      const title = `${clip.label} · ${clip.inMs}ms → ${clip.outMs}ms${rev ? ` · ${reviewStatusLabel(rev.status, t)}` : ''}`
                      return (
                        <button
                          key={clip.id}
                          type="button"
                          role="listitem"
                          className="dr-clip"
                          data-track="visual"
                          data-timeline-clip={clip.shotRef}
                          title={title}
                          onClick={() => clip.shotRef && onInspectShot(clip.shotRef)}
                          style={
                            {
                              '--dr-start': `${(clip.inMs / total) * 100}%`,
                              '--dr-len': `${Math.max(1, ((clip.outMs - clip.inMs) / total) * 100)}%`,
                            } as CSSProperties
                          }
                        >
                          {clip.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="dr-track-row mw-stack" data-gap="xs" data-track-lane="voice">
                  <span className="dr-track-label mw-eyebrow">{t('trackVoice')}</span>
                  <div className="dr-track" role="list" aria-label={t('trackVoice')}>
                    {voiceClips.map((clip) => (
                      <button
                        key={`voice-${clip.id}`}
                        type="button"
                        role="listitem"
                        className="dr-clip"
                        data-track="voice"
                        data-timeline-clip-voice={clip.shotRef}
                        title={`${clip.label} · ${t('role_voice')}`}
                        onClick={() => clip.shotRef && onInspectShot(clip.shotRef)}
                        style={
                          {
                            '--dr-start': `${(clip.inMs / total) * 100}%`,
                            '--dr-len': `${Math.max(1, ((clip.outMs - clip.inMs) / total) * 100)}%`,
                          } as CSSProperties
                        }
                      >
                        {clip.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="dr-track-row mw-stack" data-gap="xs" data-track-lane="sfx">
                  <span className="dr-track-label mw-eyebrow">{t('trackSfxMusic')}</span>
                  <div className="dr-track" role="list" aria-label={t('trackSfxMusic')}>
                    {sfxMusicClips.map((clip) => (
                      <button
                        key={`sfx-${clip.id}`}
                        type="button"
                        role="listitem"
                        className="dr-clip"
                        data-track="sfx"
                        data-timeline-clip-sfx={clip.shotRef}
                        title={`${clip.label} · ${t('trackSfxMusic')}`}
                        onClick={() => clip.shotRef && onInspectShot(clip.shotRef)}
                        style={
                          {
                            '--dr-start': `${(clip.inMs / total) * 100}%`,
                            '--dr-len': `${Math.max(1, ((clip.outMs - clip.inMs) / total) * 100)}%`,
                          } as CSSProperties
                        }
                      >
                        {clip.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mw-table-wrap">
              <table className="mw-table">
                <thead>
                  <tr>
                    <th>{t('clipCount')}</th>
                    <th data-num="true">in</th>
                    <th data-num="true">out</th>
                    <th aria-label={t('inspectShot')} />
                  </tr>
                </thead>
                <tbody>
                  {sec.clips.map((clip) => (
                    <tr key={clip.id}>
                      <td className="mw-dsh-code">{clip.label}</td>
                      <td data-num="true">{clip.inMs}ms</td>
                      <td data-num="true">{clip.outMs}ms</td>
                      <td>
                        {clip.shotRef ? (
                          <button
                            type="button"
                            className="mw-dsh-btn"
                            data-size="sm"
                            data-variant="ghost"
                            onClick={() => onInspectShot(clip.shotRef)}
                          >
                            {t('inspectShot')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}
