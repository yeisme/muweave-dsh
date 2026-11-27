import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validateBundleOnDisk } from '@yeisme/muweave-bundle'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import { DemoSeedError, runMuweaveCli, seedDemoWorkspace } from '@yeisme/dsh-muweave-core'

async function execCli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await runMuweaveCli(argv, {
    stdout: (s) => { stdout += s },
    stderr: (s) => { stderr += s },
  })
  return { code, stdout, stderr }
}

describe('demo-seed & muweave Creator CLI', () => {
  it('seeds a valid demo workspace, refuses overwrite without force, and passes validateBundleOnDisk()', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-demo-seed-'))
    const dataDir = path.join(ws, 'plugin-data')
    try {
      const first = await seedDemoWorkspace(ws, { pluginDataDir: dataDir })
      expect(first.ok).toBe(true)
      expect(first.projectId).toBe('proj_rain_watch_ep01')
      expect(first.shotCount).toBe(6)
      expect(first.reviewCount).toBe(4)
      expect(first.scheduleCount).toBe(2)
      expect(first.validationOk).toBe(true)
      expect(containsHostPath(first)).toBe(false)

      const report = await validateBundleOnDisk(ws)
      expect(report.ok).toBe(true)

      // Refuses overwrite without force: true
      await expect(seedDemoWorkspace(ws, { pluginDataDir: dataDir })).rejects.toThrowError(DemoSeedError)

      // Succeeds with force: true
      const forced = await seedDemoWorkspace(ws, { force: true, pluginDataDir: dataDir })
      expect(forced.validationOk).toBe(true)
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('supports demo seed, status, shots list, review set/batch, export, schedule, diagnose, migrate report in --json and --agent modes', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-cli-e2e-'))
    const dataDir = path.join(ws, 'plugin-data')
    const baseFlags = ['--workspace', ws, '--data-dir', dataDir]
    try {
      // 1. demo seed --agent
      const demoAgent = await execCli(['demo', 'seed', ...baseFlags, '--agent'])
      expect(demoAgent.code).toBe(0)
      expect(demoAgent.stdout).toContain('spec_version=1.0')
      expect(demoAgent.stdout).toContain('mode=agent')
      expect(demoAgent.stdout).toContain('fact.projectId=proj_rain_watch_ep01')
      expect(containsHostPath(demoAgent.stdout)).toBe(false)

      // 2. status --json
      const statusRes = await execCli(['status', ...baseFlags, '--json'])
      expect(statusRes.code).toBe(0)
      const statusJson = JSON.parse(statusRes.stdout) as { ok: boolean; initialized: boolean; index?: { projectId: string } }
      expect(statusJson.ok).toBe(true)
      expect(statusJson.initialized).toBe(true)
      expect(statusJson.index?.projectId).toBe('proj_rain_watch_ep01')
      expect(containsHostPath(statusJson)).toBe(false)

      // 3. shots list --missing keyframe --json
      const missingRes = await execCli(['shots', 'list', '--missing', 'keyframe', ...baseFlags, '--json'])
      expect(missingRes.code).toBe(0)
      const missingJson = JSON.parse(missingRes.stdout) as { total: number; shots: Array<{ shotRef: string }> }
      expect(missingJson.total).toBe(2)
      expect(missingJson.shots.map((s) => s.shotRef)).toEqual(['shot_05', 'shot_06'])

      // 4. review set
      const revSet = await execCli([
        'review', 'set', 'shot_05', '--status', 'approved', '--note', '暗格特写通过', '--tags', '特写,悬念', '--expected-revision', '0',
        ...baseFlags, '--json',
      ])
      expect(revSet.code).toBe(0)
      const revSetJson = JSON.parse(revSet.stdout) as { review: { shotRef: string; status: string; revision: number } }
      expect(revSetJson.review).toMatchObject({ shotRef: 'shot_05', status: 'approved', revision: 1 })

      // 5. review batch
      const revBatch = await execCli([
        'review', 'batch', '--items', JSON.stringify([
          { shotRef: 'shot_06', status: 'in_review', note: '集尾定格待审' },
          { shotRef: 'shot_05', status: 'draft', expectedRevision: 0 }, // conflict
        ]),
        ...baseFlags, '--json',
      ])
      expect(revBatch.code).toBe(0)
      const revBatchJson = JSON.parse(revBatch.stdout) as { succeededCount: number; failedCount: number }
      expect(revBatchJson.succeededCount).toBe(1)
      expect(revBatchJson.failedCount).toBe(1)

      // 6. export cmx3600_edl --out
      const edlFile = path.join(ws, 'roughcut.edl')
      const expRes = await execCli(['export', 'cmx3600_edl', '--fps', '24', '--out', edlFile, ...baseFlags, '--json'])
      expect(expRes.code).toBe(0)
      const expJson = JSON.parse(expRes.stdout) as { shotCount: number; written: boolean }
      expect(expJson.shotCount).toBe(6)
      expect(expJson.written).toBe(true)
      const edlText = await readFile(edlFile, 'utf8')
      expect(edlText).toContain('FCM: NON-DROP FRAME')
      expect(containsHostPath(edlText)).toBe(false)
      expect(findPlaintextCredential(edlText)).toBeUndefined()

      // 7. schedule plan / list / clear
      const schedPlan = await execCli(['schedule', 'plan', 'shot_05', '2026-12-05', '--label', '预告片', ...baseFlags, '--json'])
      expect(schedPlan.code).toBe(0)
      const schedClear = await execCli(['schedule', 'clear', 'shot_05', ...baseFlags, '--json'])
      expect(schedClear.code).toBe(0)

      // 8. diagnose & migrate report
      const diagRes = await execCli(['diagnose', ...baseFlags, '--json'])
      expect(diagRes.code).toBe(0)
      const migRes = await execCli(['migrate', 'report', ...baseFlags, '--json'])
      expect(migRes.code).toBe(0)
      const migJson = JSON.parse(migRes.stdout) as { schema: string; unclaimedBundleCount: number }
      expect(migJson.schema).toBe('muweave.migration-report.v1')
      expect(migJson.unclaimedBundleCount).toBe(1)

      // 9. mcp --transport http non-loopback without auth token fails fast
      const badMcp = await execCli(['mcp', '--transport', 'http', '--host', '0.0.0.0', ...baseFlags, '--json'])
      expect(badMcp.code).toBe(1)
      expect(badMcp.stdout).toContain('REMOTE_AUTH_TOKEN_REQUIRED')
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
