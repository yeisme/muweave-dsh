import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initBundle } from '@yeisme/muweave-bundle'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import { CreatorHostService, type ProjectMigrationReportV1 } from '@yeisme/dsh-muweave-core'
import { ProjectStore } from '../packages/dsh-muweave-core/src/project-store'

describe('ProjectStore.migrationReport & project.migration.report RPC', () => {
  it('reports corrupt backup basenames only without leaking host paths', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-mig-store-'))
    try {
      await writeFile(path.join(dir, 'projects.v1.corrupt-1700000001.json'), '{bad', 'utf8')
      await writeFile(path.join(dir, 'projects.v1.corrupt-1700000002.json'), '{bad', 'utf8')

      const store = new ProjectStore(path.join(dir, 'projects.v1.json'))
      const report = store.migrationReport({ legacyScheduleCount: 0, unclaimedBundleCount: 0 })

      expect(report.schema).toBe('muweave.migration-report.v1')
      expect(report.registrySchema).toBe('muweave.projects.v1')
      expect(report.corruptBackupCount).toBe(2)
      expect(report.corruptBackups).toEqual([
        'projects.v1.corrupt-1700000002.json',
        'projects.v1.corrupt-1700000001.json',
      ])
      expect(report.readyForV2).toBe(false)
      expect(containsHostPath(report)).toBe(false)
      expect(findPlaintextCredential(report)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('aggregates legacy schedule entries and unclaimed bundles via project.migration.report RPC', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-mig-rpc-'))
    const pluginDataDir = path.join(ws, 'plugin-data')
    try {
      await initBundle(ws, { projectId: 'proj_mig_01', title: 'Migration Demo' })
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir })

      const wsList = await svc.handleRpcAction('workspace.list', {})
      if (!wsList.ok) throw new Error('workspace.list failed')
      const workspaceId = (wsList.data as { workspaces: Array<{ workspaceId: string }> }).workspaces[0]!.workspaceId

      // Add a legacy schedule entry (no projectId).
      const planRes = await svc.handleRpcAction('schedule.plan', {
        ref: 'shot_01',
        date: '2026-12-01',
        label: 'Shot 01',
      })
      expect(planRes.ok).toBe(true)

      const rep1 = await svc.handleRpcAction('project.migration.report', {})
      expect(rep1.ok).toBe(true)
      if (!rep1.ok) throw new Error('migration report failed')
      const data1 = rep1.data as ProjectMigrationReportV1
      expect(data1.legacyScheduleCount).toBe(1)
      expect(data1.unclaimedBundleCount).toBe(1)
      expect(data1.readyForV2).toBe(false)
      expect(containsHostPath(data1)).toBe(false)

      // Claim the bundle and assign projectId to the schedule entry -> readyForV2 becomes true.
      const claimRes = await svc.handleRpcAction('project.claim', {
        workspaceId,
        projectId: 'proj_mig_01',
        title: 'Migration Demo',
        idempotencyKey: 'claim_mig_01',
      })
      expect(claimRes.ok).toBe(true)

      const rePlan = await svc.handleRpcAction('schedule.plan', {
        ref: 'shot_01',
        date: '2026-12-01',
        projectId: 'proj_mig_01',
      })
      expect(rePlan.ok).toBe(true)

      const rep2 = await svc.handleRpcAction('project.migration.report', {})
      expect(rep2.ok).toBe(true)
      if (!rep2.ok) throw new Error('migration report 2 failed')
      const data2 = rep2.data as ProjectMigrationReportV1
      expect(data2.legacyScheduleCount).toBe(0)
      expect(data2.unclaimedBundleCount).toBe(0)
      expect(data2.projectCount).toBe(1)
      expect(data2.readyForV2).toBe(true)
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
