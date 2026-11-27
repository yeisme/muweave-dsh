import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { casBlobPath, muweaveRoot, readBundleManifestFromDisk } from '@yeisme/muweave-bundle'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import {
  AudioMixInputError,
  AudioMixStore,
  CanvasBoardInputError,
  CanvasBoardStore,
  compileStage3dPrompt,
  CreatorHostService,
  createMuweaveMcpServer,
  detectAxisCrossing,
  exportCanvasMermaid,
  runMuweaveCli,
  seedDemoWorkspace,
  Stage3dInputError,
  Stage3dStore,
  WorkspaceTabsInputError,
  WorkspaceTabsStore,
  type Stage3dSnapshotSaveResultV1,
} from '@yeisme/dsh-muweave-core'

const VALID_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

async function execCli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await runMuweaveCli(argv, {
    stdout: (s) => { stdout += s },
    stderr: (s) => { stderr += s },
  })
  return { code, stdout, stderr }
}

describe('v9 Modular Studio Stores, Stage3D Snapshot CAS Binding, CLI & MCP', () => {
  it('WorkspaceTabsStore & CanvasBoardStore enforce optimistic locks, 0600 writes, corrupt backups, and Mermaid export', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-v9-stores-'))
    try {
      // 1. WorkspaceTabsStore
      const tabs = new WorkspaceTabsStore(dir)
      const t1 = tabs.save('ws_1', { presetId: 'director', expectedRevision: '0' })
      expect(t1.revision).toBe('1')
      expect(t1.pinnedRoomIds).toContain('muweave-stage3d')
      expect((await stat(path.join(dir, 'workspace-tabs.v1.json'))).mode & 0o777).toBe(0o600)

      expect(() => tabs.save('ws_1', { presetId: 'writer', expectedRevision: '0' })).toThrowError(WorkspaceTabsInputError)
      await writeFile(path.join(dir, 'workspace-tabs.v1.json'), '{bad', 'utf8')
      const tabsRecovered = new WorkspaceTabsStore(dir)
      expect(tabsRecovered.corruptFile).toContain('workspace-tabs.v1.corrupt-')

      // 2. CanvasBoardStore + exportCanvasMermaid
      const canvas = new CanvasBoardStore(dir)
      const b1 = canvas.save('ws_1', {
        nodes: [
          { id: 'n1', kind: 'character', title: '林深', x: 100, y: 120 },
          { id: 'n2', kind: 'scene', title: '钟表铺', x: 320, y: 120 },
        ],
        edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '前往', kind: 'flow' }],
        expectedRevision: '0',
      })
      expect(b1.revision).toBe('1')
      expect((await stat(path.join(dir, 'canvas-board.v1.json'))).mode & 0o777).toBe(0o600)
      expect(() => canvas.save('ws_1', { nodes: [], expectedRevision: '0' })).toThrowError(CanvasBoardInputError)

      const mermaid = exportCanvasMermaid(b1)
      expect(mermaid).toContain('flowchart LR')
      expect(mermaid).toContain('n_n1["[character] 林深"]')
      expect(mermaid).toContain('n_n1 -->|"前往"| n_n2')
      expect(containsHostPath(mermaid)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('Stage3dStore compiles prompts, detects 180-degree axis crossing, and AudioMixStore clamps gains/fades', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-v9-stage-audio-'))
    try {
      const stage = new Stage3dStore(dir)
      const s1 = stage.saveScene('ws_1', {
        shotRef: 'shot_01',
        camera: { x: 0, y: 1.6, z: 3, targetX: 0, targetY: 1.4, targetZ: 0, fovMm: 50 },
        actors: [
          { id: 'a1', name: '林深', x: -1, y: 0, z: 0, yawDeg: 90 },
          { id: 'a2', name: '顾岚', x: 1, y: 0, z: 0, yawDeg: -90 },
        ],
        lights: [{ id: 'l1', kind: 'key', x: 2, y: 3, z: 2, intensityPct: 120 }],
        expectedRevision: '0',
      })
      expect(s1.scenes.revision).toBe('1')
      expect(() =>
        stage.saveScene('ws_1', { shotRef: 'shot_02', camera: s1.scene.camera, expectedRevision: '0' }),
      ).toThrowError(Stage3dInputError)

      const prompt = compileStage3dPrompt(s1.scene)
      expect(prompt.shotScale).toBe('CU')
      expect(prompt.zh).toContain('50mm')
      expect(prompt.en).toContain('50mm lens')

      // Opposite side of actor axis (z = -3 vs z = +3) -> axis crossing!
      const s2 = stage.saveScene('ws_1', {
        shotRef: 'shot_02',
        camera: { x: 0, y: 1.6, z: -3, targetX: 0, targetY: 1.4, targetZ: 0, fovMm: 50 },
        actors: s1.scene.actors,
        expectedRevision: '1',
      })
      expect(detectAxisCrossing(s1.scene, s2.scene).crossed).toBe(true)
      expect(detectAxisCrossing(s1.scene, s1.scene).crossed).toBe(false)

      // AudioMixStore clamping
      const audio = new AudioMixStore(dir)
      const m1 = audio.save('ws_1', {
        episodeRef: 'episode:01',
        masterGainPct: 240, // clamped to 150
        tracks: {
          voice: { gainPct: -20, fadeInMs: 50_000, fadeOutMs: -10, muted: true },
        },
        expectedRevision: '0',
      })
      expect(m1.masterGainPct).toBe(150)
      expect(m1.tracks.voice.gainPct).toBe(0)
      expect(m1.tracks.voice.fadeInMs).toBe(10_000)
      expect(m1.tracks.voice.fadeOutMs).toBe(0)
      expect(m1.tracks.voice.muted).toBe(true)
      expect(() => audio.save('ws_1', { episodeRef: 'episode:01', masterGainPct: 100, expectedRevision: '0' })).toThrowError(AudioMixInputError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('wires stage3d.snapshot.save PNG magic validation + CAS/shot binding, CLI commands, and MCP tools', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-v9-rpc-'))
    const dataDir = path.join(ws, 'plugin-data')
    const baseFlags = ['--workspace', ws, '--data-dir', dataDir]
    try {
      await seedDemoWorkspace(ws, { pluginDataDir: dataDir })
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: dataDir })

      // Reject non-PNG dataUrl
      const badSnap = await svc.handleRpcAction('stage3d.snapshot.save', {
        shotRef: 'shot_01',
        dataUrl: 'data:text/plain;base64,aGVsbG8=',
      })
      expect(badSnap.ok).toBe(false)

      // Save scene first, then save valid PNG snapshot bound to shot_01
      const sceneSave = await svc.handleRpcAction('stage3d.scene.save', {
        shotRef: 'shot_01',
        camera: { x: 0, y: 1.6, z: 3, targetX: 0, targetY: 1.4, targetZ: 0, fovMm: 35 },
        actors: [{ id: 'a1', name: '林深', x: 0, y: 0, z: 0, yawDeg: 0 }],
      })
      expect(sceneSave.ok).toBe(true)

      const snapRes = await svc.handleRpcAction('stage3d.snapshot.save', {
        shotRef: 'shot_01',
        dataUrl: VALID_PNG_DATA_URL,
        label: '3d-blocking-shot-01',
      })
      expect(snapRes.ok).toBe(true)
      const snap = (snapRes as { ok: true; data: Stage3dSnapshotSaveResultV1 }).data
      expect(snap.mime).toBe('image/png')
      expect(snap.boundShotRef).toBe('shot_01')
      expect(existsSync(casBlobPath(muweaveRoot(ws), snap.sha256))).toBe(true)

      const manifest = await readBundleManifestFromDisk(ws)
      expect(manifest.bindings.shotMedia.some((m) => m.shotRef === 'shot_01' && m.role === 'reference' && m.sha256 === snap.sha256)).toBe(true)

      // CLI smoke for tabs, canvas, stage3d, audio
      const tabsPreset = await execCli(['tabs', 'preset', 'director', ...baseFlags, '--json'])
      expect(tabsPreset.code).toBe(0)
      expect(JSON.parse(tabsPreset.stdout).config.presetId).toBe('director')

      const canvasMermaid = await execCli(['canvas', 'export-mermaid', ...baseFlags, '--json'])
      expect(canvasMermaid.code).toBe(0)
      expect(JSON.parse(canvasMermaid.stdout).mermaid).toContain('flowchart LR')

      const stagePrompts = await execCli(['stage3d', 'export-prompts', ...baseFlags, '--json'])
      expect(stagePrompts.code).toBe(0)
      expect(JSON.parse(stagePrompts.stdout).prompts).toHaveLength(1)

      const audioShow = await execCli(['audio', 'show', ...baseFlags, '--json'])
      expect(audioShow.code).toBe(0)
      expect(JSON.parse(audioShow.stdout).mix.masterGainPct).toBe(100)

      // MCP v9 tools
      const mcp = createMuweaveMcpServer({ host: svc })
      for (const toolName of ['muweave_workspace_tabs', 'muweave_canvas_board', 'muweave_stage3d_scene', 'muweave_audio_mix']) {
        const res = await mcp.handleJsonRpc({
          jsonrpc: '2.0',
          id: toolName,
          method: 'tools/call',
          params: { name: toolName, arguments: { action: 'get' } },
        })
        const txt = (res?.result as { content: Array<{ text: string }> }).content[0]!.text
        expect(containsHostPath(txt)).toBe(false)
        expect(findPlaintextCredential(txt)).toBeUndefined()
      }
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
