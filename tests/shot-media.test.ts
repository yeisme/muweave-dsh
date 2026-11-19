import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  addShotMediaLink,
  defaultCliRunner,
  initBundle,
  muweaveRoot,
  parseBundleManifest,
  putCasBlob,
  readElementFromDisk,
  removeShotMediaLink,
  syncBundle,
  validateBundleOnDisk,
  validateShotMediaEntry,
} from '@yeisme/muweave-bundle'

const D1 = `sha256:${'a'.repeat(64)}`
const D2 = `sha256:${'b'.repeat(64)}`

async function withWs<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'muweave-shotmedia-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('shot media bindings', () => {
  it('rejects bad inputs', async () => {
    const ok = { shotRef: 'shot:1', role: 'keyframe', sha256: D1, linkedAt: new Date().toISOString() }
    expect(validateShotMediaEntry(ok).ok).toBe(true)
    const bad: Array<Record<string, unknown>> = [
      { ...ok, shotRef: '' },
      { ...ok, shotRef: 'a/b' },
      { ...ok, shotRef: '/home/user/x' },
      { ...ok, role: 'banner' },
      { ...ok, sha256: 'sha256:xyz' },
      { ...ok, elementId: 'el-1' },
      { shotRef: 'shot:1', role: 'video', linkedAt: ok.linkedAt },
      { ...ok, mime: 'text/html' },
      { ...ok, sceneRef: '../x' },
    ]
    for (const b of bad) expect(validateShotMediaEntry(b).ok, JSON.stringify(b)).toBe(false)
    await withWs(async (dir) => {
      await expect(addShotMediaLink(dir, { shotRef: 'shot:1', role: 'keyframe' } as never)).rejects.toThrow(/Invalid shot media/)
    })
  })

  it('adds, dedupes (newest first), removes', async () => {
    await withWs(async (dir) => {
      await addShotMediaLink(dir, { shotRef: 'shot:1', role: 'keyframe', sha256: D1 })
      await addShotMediaLink(dir, { shotRef: 'shot:1', role: 'video', elementId: 'el-9' })
      let b = await addShotMediaLink(dir, { shotRef: 'shot:1', role: 'keyframe', sha256: D1, mime: 'image/png' })
      expect(b.shotMedia).toHaveLength(2)
      expect(b.shotMedia[0]).toMatchObject({ role: 'keyframe', mime: 'image/png' })
      await addShotMediaLink(dir, { shotRef: 'shot:1', role: 'keyframe', sha256: D2 })
      b = await removeShotMediaLink(dir, { shotRef: 'shot:1', sha256: D1 })
      expect(b.shotMedia.map((e) => e.sha256 ?? e.elementId)).toEqual([D2, 'el-9'])
      b = await removeShotMediaLink(dir, { shotRef: 'shot:1', elementId: 'el-9' })
      expect(b.shotMedia).toHaveLength(1)
      const raw = JSON.parse(await readFile(path.join(muweaveRoot(dir), 'bundle.v1.json'), 'utf8'))
      expect(raw.bindings.shotMedia).toHaveLength(1)
    })
  })

  it('loads old bundles without shotMedia', async () => {
    await withWs(async (dir) => {
      const m = await initBundle(dir)
      const old = { ...m, bindings: { ...m.bindings } } as Record<string, unknown> & { bindings: Record<string, unknown> }
      delete old.bindings.shotMedia
      await writeFile(path.join(muweaveRoot(dir), 'bundle.v1.json'), JSON.stringify(old))
      const parsed = parseBundleManifest(JSON.parse(await readFile(path.join(muweaveRoot(dir), 'bundle.v1.json'), 'utf8')))
      expect(parsed.ok && parsed.value.bindings.shotMedia).toEqual([])
      const b = await addShotMediaLink(dir, { shotRef: 'shot:2', role: 'sfx', elementId: 'e' })
      expect(b.shotMedia).toHaveLength(1)
    })
  })

  it('sync attaches linkedMedia to matching rows and keeps CAS blobs', async () => {
    await withWs(async (dir) => {
      const png = Buffer.from('fake-png-bytes')
      const blob = await putCasBlob(dir, png, 'image/png')
      await addShotMediaLink(dir, { shotRef: 'shot:1', role: 'video', elementId: 'el-v' })
      await addShotMediaLink(dir, { shotRef: 'shot:1', role: 'keyframe', sha256: blob.blobDigest, mime: 'image/png' })
      await addShotMediaLink(dir, { shotRef: 'shot:2', role: 'keyframe', sha256: D2, mime: 'image/png' })
      await syncBundle({
        workspaceDir: dir,
        runner: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
        upstreamPayloads: {
          scaena: [{
            schema_version: 'scaena.storyboard_table_view.v1alpha1',
            breakdown_ref: 'breakdown:ep01',
            rows: [
              { shot_ref: 'shot:1', scene_ref: 'scene:a', order: 1 },
              { shot_ref: 'shot:2', scene_ref: 'scene:a', order: 2 },
              { shot_ref: 'shot:3', scene_ref: 'scene:a', order: 3 },
            ],
          }],
        },
      })
      const el = await readElementFromDisk(dir, 'drama-storyboard-breakdown_ep01')
      const rows = (el.payload as { rows: Array<{ shotRef: string; linkedMedia: Array<Record<string, unknown>> }> }).rows
      expect(rows[0]?.linkedMedia.map((m) => m.role)).toEqual(['keyframe', 'video'])
      expect(rows[0]?.linkedMedia[0]).toMatchObject({ sha256: blob.blobDigest, mime: 'image/png' })
      expect(rows[1]?.linkedMedia).toHaveLength(1)
      expect(rows[2]?.linkedMedia).toEqual([])
      expect(el.mediaBlobs?.map((b) => b.blobDigest)).toEqual([blob.blobDigest])
      expect(el.shotRefs).toEqual(['shot:1', 'shot:2', 'shot:3'])
      expect(el.sceneRef).toBe('scene:a')
      expect((await validateBundleOnDisk(dir)).ok).toBe(true)
    })
  })

  it('CAS ingest enforces MIME allowlist and size cap', async () => {
    await withWs(async (dir) => {
      await expect(putCasBlob(dir, Buffer.from('x'), 'text/html')).rejects.toThrow(/allowlisted/)
      await expect(putCasBlob(dir, { byteLength: 65 * 1024 * 1024 } as Uint8Array, 'image/png')).rejects.toThrow(/exceeds/)
      const ok = await putCasBlob(dir, Buffer.from('x'), 'audio/ogg')
      expect(ok.blobDigest).toMatch(/^sha256:/)
    })
  })

  it('default runner reports timeout as 124/timedOut', async () => {
    const res = await defaultCliRunner(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], { cwd: tmpdir(), timeoutMs: 200 })
    expect(res.exitCode).toBe(124)
    expect(res.timedOut).toBe(true)
    const fail = await defaultCliRunner(process.execPath, ['-e', 'process.exit(3)'], { cwd: tmpdir() })
    expect(fail.exitCode).toBe(3)
    expect(fail.timedOut).toBeUndefined()
  })
})

describe('default runner signal handling', () => {
  it('treats a child killed by a signal (not only timeout) as timedOut/124', async () => {
    const res = await defaultCliRunner(process.execPath, ['-e', "process.kill(process.pid, 'SIGKILL')"], { cwd: tmpdir() })
    expect(res.exitCode).toBe(124)
    expect(res.timedOut).toBe(true)
  })
})
