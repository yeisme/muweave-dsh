import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  CompanionList,
  EmptyState,
  RoomHero,
  SectionHead,
  StatusTag,
  WorkspaceShell,
  openGeneration,
  registerMuweaveCreatorPlugin,
  shotDescription,
  type DshClientContextLike,
  type LinkedMediaRef,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveRpcClient,
  type MuweaveTranslator,
} from '@yeisme/dsh-muweave-core/client'

export const name = '@yeisme/dsh-muweave-audio'
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const AUDIO_PANEL_ID = 'muweave-audio'
export const AUDIO_COMPANION_ID = 'muweave-audio/companion'
export const AUDIO_LOCALE_NS = 'muweaveAudio'

const zh = {
  panelTitle: '幕织音画台 (Audio Studio)',
  roomTitle: '音画台',
  companionTitle: '配音与音轨动态',
  heroEyebrow: 'MuWeave · 音画台',
  heroLede: '三轨人声 / 配乐 / 音效混音、淡入淡出包络与逐镜台词卡点校对。',
  tabMixer: '多轨混音台',
  tabCues: '台词与字幕卡点',
  statShots: '镜头数',
  statVoiced: '已配音',
  statDriftRisk: '口型预警',
  allEpisodes: '全部集',
  masterGain: '总推子 (Master)',
  trackVoice: '人声对白轨 (Voice)',
  trackMusic: '背景配乐轨 (Music)',
  trackSfx: '环境音效轨 (SFX)',
  mute: '静音',
  solo: '独奏',
  fadeIn: '淡入 (ms)',
  fadeOut: '淡出 (ms)',
  saveMix: '保存混音配置',
  resetMix: '重置混音',
  mixSaved: '混音配置已保存',
  mixReset: '已重置为默认混音',
  missingVoiceTitle: '待补配音镜头',
  genVoiceBtn: '生成配音 (Sonora)',
  cueTimecode: '时码',
  cueShot: '镜头',
  cueDialogue: '台词 / 画面摘要',
  cueStatus: '音频状态',
  cueReady: '已有配音',
  cueMissing: '缺配音',
  lipSyncRisk: '>8s 口型风险',
  exportSrt: '快捷导出 SRT',
  exportVtt: '快捷导出 WebVTT',
  exportDone: '已导出字幕文件',
  noShots: '暂无分镜数据，请先同步 .muweave/。',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: 'MuWeave Audio Studio',
  roomTitle: 'Audio',
  companionTitle: 'Voice & Audio Pulse',
  heroEyebrow: 'MuWeave · Audio Studio',
  heroLede: '3-track voice/music/SFX mixing, fade envelopes, and per-shot dialogue cue alignment.',
  tabMixer: 'Multi-Track Mixer',
  tabCues: 'Dialogue & Subtitle Cues',
  statShots: 'Shots',
  statVoiced: 'Voiced',
  statDriftRisk: 'Lip-Sync Risk',
  allEpisodes: 'All Episodes',
  masterGain: 'Master Gain',
  trackVoice: 'Voice Track',
  trackMusic: 'Music Track',
  trackSfx: 'SFX Track',
  mute: 'Mute',
  solo: 'Solo',
  fadeIn: 'Fade In (ms)',
  fadeOut: 'Fade Out (ms)',
  saveMix: 'Save Mix',
  resetMix: 'Reset Mix',
  mixSaved: 'Audio mix saved',
  mixReset: 'Audio mix reset',
  missingVoiceTitle: 'Shots Missing Voice',
  genVoiceBtn: 'Generate Voice (Sonora)',
  cueTimecode: 'Timecode',
  cueShot: 'Shot',
  cueDialogue: 'Dialogue / Beat',
  cueStatus: 'Audio',
  cueReady: 'Voiced',
  cueMissing: 'Missing Voice',
  lipSyncRisk: '>8s Lip-Sync Risk',
  exportSrt: 'Export SRT',
  exportVtt: 'Export WebVTT',
  exportDone: 'Subtitle exported',
  noShots: 'No storyboard shots yet; sync .muweave/ first.',
}

export function AudioIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <path d="M2.5 9.5v-3M5.5 12V4M8.5 13.5v-11M11.5 11V5M14 9v-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

type TrackKind = 'voice' | 'music' | 'sfx'

interface TrackMixState {
  track: TrackKind
  gainPct: number
  muted: boolean
  solo: boolean
  fadeInMs: number
  fadeOutMs: number
}

interface AudioShotRow {
  episodeRef: string
  sceneRef: string
  shotRef: string
  order: number
  plannedDurationMicros: number
  cells: Record<string, unknown>
  restrictedFields: string[]
  linkedMedia: LinkedMediaRef[]
}

const DEFAULT_TRACKS: readonly TrackMixState[] = [
  { track: 'voice', gainPct: 100, muted: false, solo: false, fadeInMs: 80, fadeOutMs: 120 },
  { track: 'music', gainPct: 65, muted: false, solo: false, fadeInMs: 500, fadeOutMs: 800 },
  { track: 'sfx', gainPct: 85, muted: false, solo: false, fadeInMs: 40, fadeOutMs: 100 },
]

const AUDIO_MIX_GET = 'audio.mix.get' as string as Parameters<MuweaveRpcClient['call']>[0]
const AUDIO_MIX_SAVE = 'audio.mix.save' as string as Parameters<MuweaveRpcClient['call']>[0]
const AUDIO_MIX_RESET = 'audio.mix.reset' as string as Parameters<MuweaveRpcClient['call']>[0]

function formatTimecode(ms: number): string {
  const totalSec = Math.max(0, ms) / 1000
  const mins = Math.floor(totalSec / 60)
  const secs = (totalSec % 60).toFixed(1).padStart(4, '0')
  return `${String(mins).padStart(2, '0')}:${secs}`
}

export function AudioMainPage({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  const [shots, setShots] = useState<AudioShotRow[]>([])
  const [episodeFilter, setEpisodeFilter] = useState<string>('all')
  const [masterGainPct, setMasterGainPct] = useState<number>(100)
  const [tracks, setTracks] = useState<TrackMixState[]>([...DEFAULT_TRACKS])
  const [revision, setRevision] = useState<string>('')
  const [receipt, setReceipt] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const loadAll = useCallback(async () => {
    const [sbListRes, mixRes] = await Promise.all([
      rpc.call<{ elements?: MuweaveElementSummaryV1[] }>('bundle.elements.list', { kind: 'drama.storyboard_table' }),
      rpc
        .call<{ mix?: { masterGainPct?: number; tracks?: Record<TrackKind, TrackMixState> | TrackMixState[]; revision?: string } }>(
          AUDIO_MIX_GET,
          {},
        )
        .catch(() => ({ ok: false as const })),
    ])

    if (mixRes.ok && mixRes.data?.mix) {
      const m = mixRes.data.mix
      if (typeof m.masterGainPct === 'number') setMasterGainPct(m.masterGainPct)
      if (Array.isArray(m.tracks) && m.tracks.length > 0) {
        setTracks(m.tracks)
      } else if (m.tracks && typeof m.tracks === 'object') {
        const rec = m.tracks as Partial<Record<TrackKind, TrackMixState>>
        setTracks(
          DEFAULT_TRACKS.map((def) => ({
            ...def,
            ...(rec[def.track] ?? {}),
            track: def.track,
          })),
        )
      }
      if (typeof m.revision === 'string') setRevision(m.revision)
    }

    if (sbListRes.ok && Array.isArray(sbListRes.data?.elements)) {
      const collected: AudioShotRow[] = []
      const details = await Promise.all(
        sbListRes.data.elements.slice(0, 8).map(async (el) => {
          const d = await rpc.call<{ element?: MuweaveElementV1 }>('bundle.element.get', { elementId: el.elementId })
          return d.ok && d.data?.element ? { summary: el, element: d.data.element } : undefined
        }),
      )
      for (const item of details) {
        if (!item) continue
        const payload = (item.element.payload ?? {}) as { episodeRef?: string; rows?: Array<Record<string, unknown>> }
        const ep = String(payload.episodeRef ?? item.summary.episodeRef ?? item.summary.sourceRef ?? 'episode:01')
        const rows = Array.isArray(payload.rows) ? payload.rows : []
        for (const r of rows) {
          collected.push({
            episodeRef: ep,
            sceneRef: String(r.sceneRef ?? ''),
            shotRef: String(r.shotRef ?? ''),
            order: Number(r.order ?? 0),
            plannedDurationMicros: Number(r.plannedDurationMicros ?? 3_000_000),
            cells: (r.cells && typeof r.cells === 'object' ? r.cells : {}) as Record<string, unknown>,
            restrictedFields: Array.isArray(r.restrictedFields) ? (r.restrictedFields as string[]) : [],
            linkedMedia: Array.isArray(r.linkedMedia) ? (r.linkedMedia as LinkedMediaRef[]) : [],
          })
        }
      }
      setShots(collected)
    }
  }, [rpc])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const episodes = useMemo(() => [...new Set(shots.map((s) => s.episodeRef))].sort(), [shots])
  const visibleShots = useMemo(
    () => (episodeFilter === 'all' ? shots : shots.filter((s) => s.episodeRef === episodeFilter)),
    [shots, episodeFilter],
  )

  const totalDurationMs = useMemo(
    () => Math.max(1000, visibleShots.reduce((acc, s) => acc + Math.round(s.plannedDurationMicros / 1000), 0)),
    [visibleShots],
  )

  const voicedCount = useMemo(
    () => visibleShots.filter((s) => s.linkedMedia.some((m) => m.role === 'voice')).length,
    [visibleShots],
  )

  const driftRiskCount = useMemo(
    () =>
      visibleShots.filter(
        (s) => s.plannedDurationMicros > 8_000_000 && s.linkedMedia.some((m) => m.role === 'voice'),
      ).length,
    [visibleShots],
  )

  const missingVoiceShots = useMemo(
    () => visibleShots.filter((s) => !s.linkedMedia.some((m) => m.role === 'voice')),
    [visibleShots],
  )

  const updateTrack = (kind: TrackKind, patch: Partial<TrackMixState>) => {
    setTracks((prev) => prev.map((tr) => (tr.track === kind ? { ...tr, ...patch } : tr)))
  }

  const handleSaveMix = async () => {
    setSaving(true)
    setReceipt(null)
    try {
      const tracksRecord = Object.fromEntries(tracks.map((tr) => [tr.track, tr])) as Record<TrackKind, TrackMixState>
      const res = await rpc.call<{ mix?: { revision?: string } }>(AUDIO_MIX_SAVE, {
        ...(episodeFilter !== 'all' ? { episodeRef: episodeFilter } : {}),
        masterGainPct,
        tracks: tracksRecord,
        ...(revision ? { expectedRevision: revision } : {}),
      })
      if (!res?.ok) {
        setReceipt({ tone: 'bad', text: res?.error?.message ?? '保存失败' })
        return
      }
      if (typeof res.data?.mix?.revision === 'string') setRevision(res.data.mix.revision)
      setReceipt({ tone: 'ok', text: t('mixSaved') })
    } finally {
      setSaving(false)
    }
  }

  const handleResetMix = async () => {
    const res = await rpc.call(AUDIO_MIX_RESET, {
      ...(episodeFilter !== 'all' ? { episodeRef: episodeFilter } : {}),
    })
    if (res?.ok) {
      setMasterGainPct(100)
      setTracks([...DEFAULT_TRACKS])
      setRevision('')
      setReceipt({ tone: 'ok', text: t('mixReset') })
    }
  }

  const handleExportSubtitles = async (format: 'srt_subtitles' | 'webvtt_subtitles') => {
    const res = await rpc.call<{ filename?: string }>('drama.export.manifest', {
      format,
      ...(episodeFilter !== 'all' ? { episodeRef: episodeFilter } : {}),
    })
    if (res?.ok) {
      setReceipt({ tone: 'ok', text: `${t('exportDone')} (${res.data?.filename ?? format})` })
    }
  }

  const trackLabel = (kind: TrackKind) =>
    kind === 'voice' ? t('trackVoice') : kind === 'music' ? t('trackMusic') : t('trackSfx')

  const shotTimelineClips = useMemo(() => {
    let cursorMs = 0
    return visibleShots.map((shot) => {
      const durMs = Math.max(500, Math.round(shot.plannedDurationMicros / 1000))
      const startPct = (cursorMs / totalDurationMs) * 100
      const lenPct = (durMs / totalDurationMs) * 100
      const startMs = cursorMs
      cursorMs += durMs
      return { shot, startMs, durMs, startPct, lenPct }
    })
  }, [visibleShots, totalDurationMs])

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      rpc={rpc}
      t={coreT}
      stage="sound"
      onSyncRequested={loadAll}
      hero={
        <RoomHero
          eyebrow={t('heroEyebrow')}
          title={t('panelTitle')}
          lede={t('heroLede')}
          stats={[
            { icon: 'play', value: visibleShots.length, label: t('statShots') },
            { icon: 'check', value: voicedCount, label: t('statVoiced') },
            { icon: 'warn', value: driftRiskCount, label: t('statDriftRisk') },
          ]}
        />
      }
      stageTabs={[
        {
          id: 'mixer',
          label: () => t('tabMixer'),
          render: () => (
            <div className="mw-aud-shell mw-stack" data-gap="md" data-audio-mixer="true">
              {episodes.length > 1 ? (
                <div className="dr-episode-bar mw-row" data-gap="xs" role="group">
                  <button
                    type="button"
                    className="dr-episode-pill mw-dsh-btn"
                    data-size="sm"
                    data-variant="ghost"
                    aria-pressed={episodeFilter === 'all'}
                    onClick={() => setEpisodeFilter('all')}
                  >
                    {t('allEpisodes')}
                  </button>
                  {episodes.map((ep) => (
                    <button
                      key={ep}
                      type="button"
                      className="dr-episode-pill mw-dsh-btn"
                      data-size="sm"
                      data-variant="ghost"
                      aria-pressed={episodeFilter === ep}
                      onClick={() => setEpisodeFilter(ep)}
                    >
                      {ep}
                    </button>
                  ))}
                </div>
              ) : null}

              <section className="mw-dsh-card mw-stack" data-flat="true" data-gap="sm">
                <div className="mw-spread">
                  <label className="mw-row" data-gap="sm">
                    <span className="mw-title">{t('masterGain')}</span>
                    <input
                      type="range"
                      min={0}
                      max={150}
                      value={masterGainPct}
                      data-audio-master-gain="true"
                      onChange={(e) => setMasterGainPct(Number(e.target.value))}
                    />
                    <span className="mw-chip" data-mono="true">
                      {masterGainPct}%
                    </span>
                  </label>
                  <div className="mw-row" data-gap="xs">
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-variant="primary"
                      data-size="sm"
                      disabled={saving}
                      data-audio-save="true"
                      onClick={() => void handleSaveMix()}
                    >
                      {t('saveMix')}
                    </button>
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-variant="quiet"
                      data-size="sm"
                      data-audio-reset="true"
                      onClick={() => void handleResetMix()}
                    >
                      {t('resetMix')}
                    </button>
                  </div>
                </div>
                {receipt ? (
                  <span className="mw-status" role="status" data-tone={receipt.tone} data-audio-receipt="true">
                    <span className="mw-dot" />
                    {receipt.text}
                  </span>
                ) : null}
              </section>

              <div className="mw-aud-tracks mw-stack" data-gap="sm">
                {tracks.map((tr) => (
                  <article key={tr.track} className="mw-aud-track mw-dsh-card mw-stack" data-flat="true" data-gap="xs" data-audio-track={tr.track}>
                    <div className="mw-aud-track-head mw-spread">
                      <span className="mw-title">{trackLabel(tr.track)}</span>
                      <div className="mw-aud-track-controls mw-row" data-gap="xs">
                        <button
                          type="button"
                          className="mw-dsh-btn"
                          data-size="sm"
                          data-variant={tr.muted ? 'primary' : 'quiet'}
                          aria-pressed={tr.muted}
                          data-audio-mute={tr.track}
                          onClick={() => updateTrack(tr.track, { muted: !tr.muted })}
                        >
                          {t('mute')}
                        </button>
                        <button
                          type="button"
                          className="mw-dsh-btn"
                          data-size="sm"
                          data-variant={tr.solo ? 'primary' : 'quiet'}
                          aria-pressed={tr.solo}
                          data-audio-solo={tr.track}
                          onClick={() => updateTrack(tr.track, { solo: !tr.solo })}
                        >
                          {t('solo')}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={150}
                          aria-label={`${trackLabel(tr.track)} gain`}
                          data-audio-gain={tr.track}
                          value={tr.gainPct}
                          onChange={(e) => updateTrack(tr.track, { gainPct: Number(e.target.value) })}
                        />
                        <span className="mw-chip" data-mono="true">
                          {tr.gainPct}%
                        </span>
                      </div>
                    </div>
                    <div className="mw-row" data-gap="sm">
                      <label className="mw-row" data-gap="xs">
                        <span className="mw-dsh-muted">{t('fadeIn')}</span>
                        <input
                          type="number"
                          className="mw-input"
                          min={0}
                          max={10000}
                          data-audio-fade-in={tr.track}
                          value={tr.fadeInMs}
                          onChange={(e) => updateTrack(tr.track, { fadeInMs: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      </label>
                      <label className="mw-row" data-gap="xs">
                        <span className="mw-dsh-muted">{t('fadeOut')}</span>
                        <input
                          type="number"
                          className="mw-input"
                          min={0}
                          max={10000}
                          data-audio-fade-out={tr.track}
                          value={tr.fadeOutMs}
                          onChange={(e) => updateTrack(tr.track, { fadeOutMs: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      </label>
                    </div>
                    <div className="mw-aud-lane" data-track-lane={tr.track}>
                      {shotTimelineClips.map(({ shot, startPct, lenPct }) => {
                        const hasRole = shot.linkedMedia.some((m) => m.role === tr.track)
                        return (
                          <span
                            key={`${tr.track}-${shot.shotRef}`}
                            className="mw-aud-clip"
                            data-filled={hasRole ? 'true' : 'false'}
                            style={
                              {
                                '--mw-start': `${startPct.toFixed(2)}%`,
                                '--mw-len': `${lenPct.toFixed(2)}%`,
                                '--mw-level': `${tr.muted ? 0 : tr.gainPct}%`,
                              } as CSSProperties
                            }
                            title={shot.shotRef}
                          >
                            {String(shot.order).padStart(2, '0')}
                          </span>
                        )
                      })}
                    </div>
                  </article>
                ))}
              </div>

              {missingVoiceShots.length > 0 ? (
                <section className="mw-dsh-card mw-stack" data-flat="true" data-gap="xs">
                  <SectionHead title={t('missingVoiceTitle')} meta={`${missingVoiceShots.length}`} />
                  <div className="mw-row" data-gap="xs">
                    {missingVoiceShots.slice(0, 6).map((shot) => (
                      <button
                        key={shot.shotRef}
                        type="button"
                        className="mw-dsh-btn"
                        data-variant="quiet"
                        data-size="sm"
                        data-audio-gen-voice={shot.shotRef}
                        onClick={() =>
                          openGeneration({
                            capabilityId: 'sonora.voice.tts',
                            input: { text: shotDescription(shot.cells, shot.restrictedFields) },
                            anchor: { episodeRef: shot.episodeRef, sceneRef: shot.sceneRef, shotRef: shot.shotRef },
                            stage: 'sound',
                          })
                        }
                      >
                        {`${shot.shotRef} · ${t('genVoiceBtn')}`}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ),
        },
        {
          id: 'cues',
          label: () => t('tabCues'),
          render: () => (
            <div className="mw-aud-cues mw-stack" data-gap="md" data-audio-cues="true">
              <div className="mw-row" data-gap="xs">
                <button
                  type="button"
                  className="mw-dsh-btn"
                  data-variant="quiet"
                  data-size="sm"
                  data-audio-export-srt="true"
                  onClick={() => void handleExportSubtitles('srt_subtitles')}
                >
                  {t('exportSrt')}
                </button>
                <button
                  type="button"
                  className="mw-dsh-btn"
                  data-variant="quiet"
                  data-size="sm"
                  data-audio-export-vtt="true"
                  onClick={() => void handleExportSubtitles('webvtt_subtitles')}
                >
                  {t('exportVtt')}
                </button>
                {receipt ? (
                  <span className="mw-status" role="status" data-tone={receipt.tone} data-audio-receipt="true">
                    <span className="mw-dot" />
                    {receipt.text}
                  </span>
                ) : null}
              </div>

              {shotTimelineClips.length === 0 ? (
                <EmptyState>{t('noShots')}</EmptyState>
              ) : (
                <ul className="mw-stack" data-gap="xs">
                  {shotTimelineClips.map(({ shot, startMs, durMs }) => {
                    const hasVoice = shot.linkedMedia.some((m) => m.role === 'voice')
                    const driftRisk = durMs > 8000
                    return (
                      <li key={shot.shotRef} className="mw-dsh-card mw-spread" data-flat="true" data-audio-cue={shot.shotRef}>
                        <div className="mw-stack" data-gap="xs">
                          <div className="mw-row" data-gap="xs">
                            <span className="mw-chip" data-mono="true">
                              {`${formatTimecode(startMs)} – ${formatTimecode(startMs + durMs)}`}
                            </span>
                            <span className="mw-dsh-code">{shot.shotRef}</span>
                            {driftRisk ? (
                              <span className="mw-status" data-tone="warn" data-audio-lipsync-warn="true">
                                <span className="mw-dot" />
                                {t('lipSyncRisk')}
                              </span>
                            ) : null}
                          </div>
                          <span className="mw-dsh-muted">
                            {shotDescription(shot.cells, shot.restrictedFields) || shot.sceneRef}
                          </span>
                        </div>
                        <StatusTag status={hasVoice ? 'ready' : 'draft'} lang={coreT('langCode')} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ),
        },
      ]}
    />
  )
}

export function AudioCompanionPane({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  return <CompanionList rpc={rpc} coreT={coreT} title={t('companionTitle')} companionId="audio" domain="drama" />
}

export function apply(ctx: DshClientContextLike): void {
  const tFn = () => ctx.locale.bind(AUDIO_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: AUDIO_LOCALE_NS,
    dictionaries: { zh, en },
    pane: {
      pluginId: 'muweave-audio',
      panelId: AUDIO_PANEL_ID,
      order: 44.8,
      group: 'studio',
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: ['drama'],
      companionId: AUDIO_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: AudioIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    } as Parameters<typeof registerMuweaveCreatorPlugin>[1]['pane'],
    MainComponent: AudioMainPage,
    CompanionComponent: AudioCompanionPane,
  })
}
