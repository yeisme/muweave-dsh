import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import {
  buildDramaExportPackage,
  CreatorHostService,
  createMuweaveMcpServer,
  DramaReviewStore,
  runEpisodeQc,
  runMuweaveCli,
  seedDemoWorkspace,
  type EpisodeQcReportV1,
  type ShotReviewImportResultV1,
} from '@yeisme/dsh-muweave-core'

const SHA_1 = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
const SHA_2 = 'sha256:2222222222222222222222222222222222222222222222222222222222222222'

async function execCli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await runMuweaveCli(argv, {
    stdout: (s) => { stdout += s },
    stderr: (s) => { stderr += s },
  })
  return { code, stdout, stderr }
}

describe('v8 Episode QC Gate, Subtitles (SRT/WebVTT), Offline Review Deck & Safe Feedback Import', () => {
  it('runEpisodeQc evaluates all 5 pillars, clamps score, and marks clean delivery ready', () => {
    // 1. Failing episode with blockers & warnings
    const bad = runEpisodeQc({
      episodeRef: 'episode:01',
      shots: [
        {
          order: 1,
          episodeRef: 'episode:01',
          sceneRef: 'scene_01',
          shotRef: 'shot_01',
          plannedDurationMicros: 9_000_000, // > 3.5s hook warning + > 8s voice lipsync warning
          linkedMedia: [
            { role: 'keyframe', sha256: SHA_1, mime: 'image/png' },
            { role: 'voice', sha256: SHA_2, mime: 'audio/mpeg' },
          ],
        },
        {
          order: 2,
          episodeRef: 'episode:01',
          sceneRef: 'scene_01',
          shotRef: 'shot_02',
          plannedDurationMicros: 3_000_000, // missing visual blocker + missing audio warning + draft blocker
        },
      ],
      reviews: [
        { workspaceId: 'ws', shotRef: 'shot_01', status: 'needs_revision', tags: [], revision: 1, updatedAt: '2026-11-27T00:00:00Z' },
      ],
      assets: [
        { assetRef: 'asset:darkroom', axes: { currentUsability: 'blocked' } },
      ],
      hasCasBlob: (sha) => sha === SHA_1, // SHA_2 missing -> blocker
    })
    expect(bad.readyForDelivery).toBe(false)
    const codes = bad.findings.map((f) => f.code)
    expect(codes).toContain('qc_opening_hook_slow')
    expect(codes).toContain('qc_shot_lipsync_risk')
    expect(codes).toContain('qc_shot_missing_visual')
    expect(codes).toContain('qc_shot_missing_audio')
    expect(codes).toContain('qc_cas_blob_missing')
    expect(codes).toContain('qc_asset_axis_blocked')
    expect(codes).toContain('qc_shot_needs_revision')
    expect(codes).toContain('qc_shot_unapproved')
    expect(codes).toContain('qc_missing_compliance_disclosure')

    // 2. Clean episode -> 100/100 readyForDelivery: true
    const clean = runEpisodeQc({
      episodeRef: 'episode:01',
      shots: [
        {
          order: 1,
          episodeRef: 'episode:01',
          sceneRef: 'scene_01',
          shotRef: 'shot_01',
          plannedDurationMicros: 3_000_000,
          linkedMedia: [
            { role: 'keyframe', sha256: SHA_1, mime: 'image/png' },
            { role: 'voice', sha256: SHA_2, mime: 'audio/mpeg' },
          ],
        },
        {
          order: 2,
          episodeRef: 'episode:01',
          sceneRef: 'scene_01',
          shotRef: 'shot_02',
          plannedDurationMicros: 3_000_000,
          linkedMedia: [
            { role: 'keyframe', sha256: SHA_1, mime: 'image/png' },
            { role: 'sfx', sha256: SHA_2, mime: 'audio/wav' },
          ],
        },
      ],
      reviews: [
        { workspaceId: 'ws', shotRef: 'shot_01', status: 'locked', tags: [], revision: 1, updatedAt: '2026-11-27T00:00:00Z' },
        { workspaceId: 'ws', shotRef: 'shot_02', status: 'approved', tags: [], revision: 1, updatedAt: '2026-11-27T00:00:00Z' },
      ],
      bible: {
        schema: 'muweave.continuity-bible.v1',
        workspaceId: 'ws',
        visualGrammar: { aspectRatio: '9:16', lensStyle: '', lightingRule: '', styleDirective: '' },
        colorPalette: [],
        characterAnchors: [],
        negativeGuardrails: [],
        complianceDisclosure: 'AI 辅助生成',
        revision: '1',
        updatedAt: '2026-11-27T00:00:00Z',
      },
      hasCasBlob: () => true,
    })
    expect(clean.readyForDelivery).toBe(true)
    expect(clean.score).toBe(100)
    expect(clean.counts.blocker).toBe(0)
    expect(clean.counts.warning).toBe(0)
    expect(clean.counts.pass).toBe(5)
  })

  it('DramaReviewStore.importFeedback skips locked shots by default and blocks credentials/paths', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-import-fb-'))
    try {
      const store = new DramaReviewStore(path.join(dir, 'drama-reviews.v1.json'))
      store.set('ws_1', { shotRef: 'shot_01', status: 'locked', note: '导演已锁' })
      store.set('ws_1', { shotRef: 'shot_02', status: 'in_review' })

      const res = store.importFeedback('ws_1', [
        { shotRef: 'shot_01', status: 'needs_revision', note: '外部意见' },
        { shotRef: 'shot_02', status: 'approved', note: '客户确认通过' },
        { shotRef: 'shot_03', status: 'approved', note: 'leak /Users/alice/secret.png' },
      ])
      expect(res.importedCount).toBe(1)
      expect(res.skippedLockedCount).toBe(1)
      expect(res.invalidCount).toBe(1)
      expect(res.results[0]).toMatchObject({ shotRef: 'shot_01', action: 'skipped_locked', reason: 'locked_by_director' })
      expect(store.get('ws_1', 'shot_01')?.status).toBe('locked')
      expect(store.get('ws_1', 'shot_02')?.status).toBe('approved')

      // With allowLocked: true, locked shot can be updated
      const forceRes = store.importFeedback(
        'ws_1',
        [{ shotRef: 'shot_01', status: 'needs_revision', note: '解锁复审' }],
        { allowLocked: true },
      )
      expect(forceRes.importedCount).toBe(1)
      expect(store.get('ws_1', 'shot_01')?.status).toBe('needs_revision')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('compiles SRT, WebVTT, and XSS-safe offline review_deck_html with zero external CDNs', () => {
    const shots = [
      {
        order: 1,
        sceneRef: 'scene_01',
        shotRef: 'shot_01',
        plannedDurationMicros: 3_500_000,
        dialogue: '这块怀表</script><script>alert(1)</script>三年前就停了',
        linkedMedia: [{ role: 'keyframe' as const, sha256: SHA_1, mime: 'image/png' }],
      },
    ]

    const srt = buildDramaExportPackage({
      format: 'srt_subtitles',
      projectId: 'proj_1',
      title: 'Test Ep1',
      shots,
    })
    expect(srt.mimeType).toBe('application/x-subrip')
    expect(srt.content).toContain('00:00:00,000 --> 00:00:03,500')

    const vtt = buildDramaExportPackage({
      format: 'webvtt_subtitles',
      projectId: 'proj_1',
      title: 'Test Ep1',
      shots,
    })
    expect(vtt.mimeType).toBe('text/vtt')
    expect(vtt.content.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt.content).toContain('00:00:00.000 --> 00:00:03.500')

    const deck = buildDramaExportPackage({
      format: 'review_deck_html',
      projectId: 'proj_1',
      title: 'Test <Ep1>',
      complianceDisclosure: '本片由 AI 辅助生成',
      shots,
    })
    expect(deck.mimeType).toBe('text/html')
    expect(deck.filename).toMatch(/-review-deck\.html$/)
    expect(deck.content).not.toContain('</script><script>alert(1)')
    expect(deck.content).toContain('\\u003c/script\\u003e')
    expect(deck.content).toContain('本片由 AI 辅助生成')
    expect(deck.content).not.toMatch(/https?:\/\/cdn|fonts\.googleapis/i)
    expect(containsHostPath(deck)).toBe(false)
    expect(findPlaintextCredential(deck)).toBeUndefined()
  })

  it('runs end-to-end CLI qc, review_deck_html --bundle-dir (with subtitles.srt), review import, and MCP QC', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-v8-e2e-'))
    const dataDir = path.join(ws, 'plugin-data')
    const bundleDir = path.join(ws, 'client-review-deck')
    const baseFlags = ['--workspace', ws, '--data-dir', dataDir]
    try {
      await seedDemoWorkspace(ws, { pluginDataDir: dataDir, episodes: 2 })

      // 1. CLI qc --strict fails on demo (has missing keyframes & draft/needs_revision shots)
      const qcStrict = await execCli(['qc', '--episode', 'episode:01', '--strict', ...baseFlags, '--json'])
      expect(qcStrict.code).toBe(1)
      const qcJson = JSON.parse(qcStrict.stdout) as EpisodeQcReportV1
      expect(qcJson.schema).toBe('muweave.episode-qc.v1')
      expect(qcJson.readyForDelivery).toBe(false)

      // 2. CLI export review_deck_html --bundle-dir writes HTML, subtitles.srt, media/, README.txt
      const deckRes = await execCli([
        'export', 'review_deck_html', '--episode', 'episode:01', '--bundle-dir', bundleDir, ...baseFlags, '--json',
      ])
      expect(deckRes.code).toBe(0)
      const deckJson = JSON.parse(deckRes.stdout) as { filename: string; subtitlesFile: string; copiedMediaFiles: string[] }
      expect(deckJson.subtitlesFile).toBe('subtitles.srt')
      expect(existsSync(path.join(bundleDir, deckJson.filename))).toBe(true)
      expect(existsSync(path.join(bundleDir, 'subtitles.srt'))).toBe(true)
      expect(existsSync(path.join(bundleDir, 'README.txt'))).toBe(true)
      const srtText = await readFile(path.join(bundleDir, 'subtitles.srt'), 'utf8')
      expect(srtText).toContain('这块怀表，三年前就该停了。')
      expect(containsHostPath(srtText)).toBe(false)

      // 3. CLI review import respects locked shot_01
      const fbFile = path.join(ws, 'review-feedback.json')
      await writeFile(
        fbFile,
        JSON.stringify([
          { shotRef: 'shot_01', status: 'needs_revision', note: '试图改已锁定镜头' },
          { shotRef: 'shot_03', status: 'approved', note: '审片通过' },
        ]),
        'utf8',
      )
      const impRes = await execCli(['review', 'import', fbFile, ...baseFlags, '--json'])
      expect(impRes.code).toBe(0)
      const impJson = JSON.parse(impRes.stdout) as ShotReviewImportResultV1
      expect(impJson.importedCount).toBe(1)
      expect(impJson.skippedLockedCount).toBe(1)

      // 4. MCP muweave_drama_qc_report & muweave://drama/qc
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: dataDir })
      const mcp = createMuweaveMcpServer({ host: svc })
      const mcpQc = await mcp.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'muweave_drama_qc_report', arguments: { episodeRef: 'episode:01' } },
      })
      const mcpQcText = (mcpQc?.result as { content: Array<{ text: string }> }).content[0]!.text
      expect(JSON.parse(mcpQcText).schema).toBe('muweave.episode-qc.v1')
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
