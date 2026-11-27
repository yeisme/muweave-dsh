import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import {
  applyEpisodeCut,
  buildDramaExportPackage,
  CreatorHostService,
  createMuweaveMcpServer,
  DramaCutInputError,
  DramaCutStore,
  runMuweaveCli,
  seedDemoWorkspace,
  type DramaExportResultV1,
  type EpisodeCutOverrideV1,
} from '@yeisme/dsh-muweave-core'

const SHA_1 = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SHA_2 = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

async function execCli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await runMuweaveCli(argv, {
    stdout: (s) => { stdout += s },
    stderr: (s) => { stderr += s },
  })
  return { code, stdout, stderr }
}

describe('v7 DramaCutStore, Multi-Episode Export (FCPXML 1.10 / Jianying Draft) & Portable Bundle', () => {
  it('DramaCutStore enforces optimistic lock, duration bounds, 0600 atomic persist, and .corrupt-* recovery', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-cut-store-'))
    const file = path.join(dir, 'drama-cuts.v1.json')
    try {
      const store = new DramaCutStore(file)
      const cut1 = store.set('ws_1', {
        episodeRef: 'ep_01',
        shotOrder: ['shot_02', 'shot_01'],
        omittedShotRefs: ['shot_03'],
        durationOverridesMicros: { shot_02: 4_500_000 },
        transitions: { shot_02: 'crossfade' },
        expectedRevision: 0,
      })
      expect(cut1.revision).toBe(1)
      expect((await stat(file)).mode & 0o777).toBe(0o600)

      // Optimistic lock conflict
      let conflictErr: unknown
      try {
        store.set('ws_1', { episodeRef: 'ep_01', shotOrder: ['shot_01'], expectedRevision: 0 })
      } catch (e) {
        conflictErr = e
      }
      expect(conflictErr).toBeInstanceOf(DramaCutInputError)
      expect((conflictErr as DramaCutInputError).code).toBe('muweave/cut_revision_conflict')
      expect((conflictErr as DramaCutInputError).details).toEqual({ currentRevision: 1 })

      // Out-of-range duration rejected
      expect(() =>
        store.set('ws_1', { episodeRef: 'ep_01', durationOverridesMicros: { shot_01: 50_000 } }),
      ).toThrowError(DramaCutInputError)

      // Pure applyEpisodeCut
      const applied = applyEpisodeCut(
        [
          { shotRef: 'shot_01', order: 1, plannedDurationMicros: 3_000_000 },
          { shotRef: 'shot_02', order: 2, plannedDurationMicros: 2_000_000 },
          { shotRef: 'shot_03', order: 3, plannedDurationMicros: 1_500_000 },
        ],
        cut1,
      )
      expect(applied.map((r) => r.shotRef)).toEqual(['shot_02', 'shot_01'])
      expect(applied[0]?.plannedDurationMicros).toBe(4_500_000)
      expect(applied[0]?.transition).toBe('crossfade')

      // Reset removes override
      expect(store.reset('ws_1', 'ep_01')).toBe(true)
      expect(store.get('ws_1', 'ep_01')).toBeUndefined()

      // Corrupt JSON recovery
      await writeFile(file, '{bad', 'utf8')
      const recovered = new DramaCutStore(file)
      expect(recovered.list()).toEqual([])
      expect(recovered.corruptFile).toContain('drama-cuts.v1.corrupt-')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('compiles fcpxml_1_10 and jianying_draft_v1 with cutOverride and zero host paths', () => {
    const cut: EpisodeCutOverrideV1 = {
      workspaceId: 'ws_1',
      episodeRef: 'ep_01',
      shotOrder: ['shot_02', 'shot_01'],
      omittedShotRefs: ['shot_03'],
      durationOverridesMicros: { shot_02: 4_000_000 },
      transitions: { shot_02: 'dip_to_black' },
      revision: 1,
      updatedAt: '2026-11-27T00:00:00.000Z',
    }
    const shots = [
      { order: 1, episodeRef: 'ep_01', sceneRef: 'scene_01', shotRef: 'shot_01', plannedDurationMicros: 3_000_000, linkedMedia: [{ role: 'keyframe' as const, sha256: SHA_1, mime: 'image/png' }] },
      { order: 2, episodeRef: 'ep_01', sceneRef: 'scene_01', shotRef: 'shot_02', plannedDurationMicros: 2_000_000, linkedMedia: [{ role: 'keyframe' as const, sha256: SHA_2, mime: 'image/png' }] },
      { order: 3, episodeRef: 'ep_01', sceneRef: 'scene_01', shotRef: 'shot_03', plannedDurationMicros: 2_000_000 },
    ]

    const fcpxml = buildDramaExportPackage({
      format: 'fcpxml_1_10',
      projectId: 'proj_v7',
      title: 'Rain Watch EP01',
      fps: 24,
      aspectRatio: '9:16',
      episodeRef: 'ep_01',
      cutOverride: cut,
      shots,
    })
    expect(fcpxml.mimeType).toBe('application/xml')
    expect(fcpxml.filename).toMatch(/\.fcpxml$/)
    expect(fcpxml.shotCount).toBe(2)
    expect(fcpxml.totalDurationMs).toBe(7000)
    expect(fcpxml.content).toContain('<fcpxml version="1.10">')
    expect(fcpxml.content).toContain('media/bbbbbbbbbbbb.png')
    expect(fcpxml.content).toContain('transition=dip_to_black')
    expect(fcpxml.content).not.toContain('shot_03')
    expect(containsHostPath(fcpxml)).toBe(false)
    expect(findPlaintextCredential(fcpxml)).toBeUndefined()

    const jianying = buildDramaExportPackage({
      format: 'jianying_draft_v1',
      projectId: 'proj_v7',
      title: 'Rain Watch EP01',
      fps: 24,
      aspectRatio: '9:16',
      episodeRef: 'ep_01',
      cutOverride: cut,
      shots,
    })
    expect(jianying.mimeType).toBe('application/json')
    expect(jianying.filename).toBe('draft_content.json')
    expect(jianying.shotCount).toBe(2)
    const draft = JSON.parse(jianying.content) as {
      schema: string
      duration: number
      materials: { videos: Array<{ path: string; material_name: string }> }
    }
    expect(draft.schema).toBe('muweave.jianying-draft.v1')
    expect(draft.duration).toBe(7_000_000)
    expect(draft.materials.videos.map((v) => v.material_name)).toEqual(['shot_02', 'shot_01'])
    expect(draft.materials.videos[0]?.path).toBe('media/bbbbbbbbbbbb.png')
    expect(containsHostPath(jianying)).toBe(false)
  })

  it('supports 2-episode demo seed, CLI cut + portable --bundle-dir export, and MCP muweave_drama_cut_manage', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-v7-portable-'))
    const dataDir = path.join(ws, 'plugin-data')
    const bundleDir = path.join(ws, 'handoff-bundle')
    const baseFlags = ['--workspace', ws, '--data-dir', dataDir]
    try {
      const seeded = await seedDemoWorkspace(ws, { pluginDataDir: dataDir, episodes: 2 })
      expect(seeded.episodeCount).toBe(2)
      expect(seeded.shotCount).toBe(8)

      // CLI cut reorder + omit + trim
      const reord = await execCli(['cut', 'reorder', 'episode:01', 'shot_02,shot_01', ...baseFlags, '--json'])
      expect(reord.code).toBe(0)
      const trim = await execCli(['cut', 'trim', 'episode:01', 'shot_02', '4.5', ...baseFlags, '--json'])
      expect(trim.code).toBe(0)
      const omit = await execCli(['cut', 'omit', 'episode:01', 'shot_06', ...baseFlags, '--json'])
      expect(omit.code).toBe(0)

      // CLI export fcpxml_1_10 --episode episode:01 --bundle-dir
      const exp = await execCli([
        'export', 'fcpxml_1_10', '--episode', 'episode:01', '--bundle-dir', bundleDir, ...baseFlags, '--json',
      ])
      expect(exp.code).toBe(0)
      const expJson = JSON.parse(exp.stdout) as { ok: boolean; shotCount: number; copiedMediaFiles: string[]; filename: string }
      expect(expJson.ok).toBe(true)
      expect(expJson.shotCount).toBe(5) // 6 shots minus omitted shot_06
      expect(expJson.copiedMediaFiles.length).toBeGreaterThanOrEqual(3)
      expect(existsSync(path.join(bundleDir, expJson.filename))).toBe(true)
      expect(existsSync(path.join(bundleDir, 'README.txt'))).toBe(true)
      for (const rel of expJson.copiedMediaFiles) {
        expect(existsSync(path.join(bundleDir, rel))).toBe(true)
      }
      const readmeText = await readFile(path.join(bundleDir, 'README.txt'), 'utf8')
      expect(containsHostPath(readmeText)).toBe(false)

      // MCP muweave_drama_cut_manage get & reset + host export for episode:02
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: dataDir })
      const mcp = createMuweaveMcpServer({ host: svc })
      const getCut = await mcp.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'muweave_drama_cut_manage', arguments: { action: 'get', episodeRef: 'episode:01' } },
      })
      const getCutText = (getCut?.result as { content: Array<{ text: string }> }).content[0]!.text
      expect(JSON.parse(getCutText).cut.omittedShotRefs).toEqual(['shot_06'])

      const ep2Exp = await svc.handleRpcAction('drama.export.manifest', {
        format: 'jianying_draft_v1',
        episodeRef: 'episode:02',
      })
      expect(ep2Exp.ok).toBe(true)
      expect((ep2Exp as { ok: true; data: DramaExportResultV1 }).data.shotCount).toBe(2)

      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
