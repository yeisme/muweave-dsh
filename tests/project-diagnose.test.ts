import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initBundle, muweaveRoot } from '@yeisme/muweave-bundle'
import { CreatorHostService } from '@yeisme/dsh-muweave-core'
import type { DiagnosisReportV1 } from '@yeisme/dsh-muweave-core'

type ReportsResponse = { reports: DiagnosisReportV1[] }
type ProjectResponse = { project: { id: string; title: string } }

async function makeFixture(prefix: string) {
  const workspace = await mkdtemp(path.join(tmpdir(), prefix))
  const service = new CreatorHostService({
    defaultWorkspaceDir: workspace,
    pluginDataDir: path.join(workspace, 'plugin-data'),
  })
  const listed = await service.handleRpcAction('workspace.list', {})
  if (!listed.ok) throw new Error(`workspace.list failed: ${listed.error.code}`)
  const workspaceId = (listed.data as { workspaces: Array<{ workspaceId: string }> }).workspaces[0]!.workspaceId
  return { workspace, service, workspaceId }
}

async function createProject(service: CreatorHostService, workspace: string, workspaceId: string, withBundle = true) {
  const created = await service.handleRpcAction('project.create', {
    title: '诊断测试项目',
    workspaceIds: [workspaceId],
  })
  if (!created.ok) throw new Error(`project.create failed: ${created.error.code}`)
  const project = (created.data as ProjectResponse).project
  if (withBundle) await initBundle(workspace, { projectId: project.id, title: project.title })
  return project
}

async function diagnose(service: CreatorHostService, projectId?: string): Promise<ReportsResponse> {
  const response = await service.handleRpcAction('project.diagnose', projectId === undefined ? {} : { projectId })
  if (!response.ok) throw new Error(`project.diagnose failed: ${response.error.code}`)
  return response.data as ReportsResponse
}

describe('project.diagnose read-only RPC', () => {
  it('reports a readable project with a bundle as healthy and no findings', async () => {
    const fixture = await makeFixture('muweave-project-diagnose-healthy-')
    try {
      const project = await createProject(fixture.service, fixture.workspace, fixture.workspaceId)
      const result = await diagnose(fixture.service, project.id)
      expect(result.reports).toEqual([{
        projectId: project.id,
        title: '诊断测试项目',
        state: 'healthy',
        findings: [],
      }])
    } finally {
      fixture.service.dispose()
      await rm(fixture.workspace, { recursive: true, force: true })
    }
  })

  it('reports bundle_missing as an error and the project as broken', async () => {
    const fixture = await makeFixture('muweave-project-diagnose-missing-')
    try {
      const project = await createProject(fixture.service, fixture.workspace, fixture.workspaceId, false)
      const result = await diagnose(fixture.service, project.id)
      expect(result.reports[0]).toMatchObject({ projectId: project.id, state: 'broken' })
      expect(result.reports[0]!.findings).toContainEqual(expect.objectContaining({
        code: 'bundle_missing',
        severity: 'error',
      }))
    } finally {
      fixture.service.dispose()
      await rm(fixture.workspace, { recursive: true, force: true })
    }
  })

  it('keeps an unreadable bundle unknown rather than healthy', async () => {
    const fixture = await makeFixture('muweave-project-diagnose-unreadable-')
    try {
      const project = await createProject(fixture.service, fixture.workspace, fixture.workspaceId)
      await writeFile(path.join(muweaveRoot(fixture.workspace), 'bundle.v1.json'), '{ not json\n')
      const result = await diagnose(fixture.service, project.id)
      expect(result.reports[0]).toMatchObject({ projectId: project.id, state: 'unknown', findings: [] })
    } finally {
      fixture.service.dispose()
      await rm(fixture.workspace, { recursive: true, force: true })
    }
  })

  it('returns reports for all projects when projectId is omitted', async () => {
    const fixture = await makeFixture('muweave-project-diagnose-all-')
    try {
      const first = await createProject(fixture.service, fixture.workspace, fixture.workspaceId)
      const second = await createProject(fixture.service, fixture.workspace, fixture.workspaceId, false)
      const result = await diagnose(fixture.service)
      expect(result.reports.map((report) => report.projectId).sort()).toEqual([first.id, second.id].sort())
    } finally {
      fixture.service.dispose()
      await rm(fixture.workspace, { recursive: true, force: true })
    }
  })

  it('reports registry_corrupt without writing during diagnosis', async () => {
    const fixture = await makeFixture('muweave-project-diagnose-registry-')
    let restarted: CreatorHostService | undefined
    try {
      await createProject(fixture.service, fixture.workspace, fixture.workspaceId)
      const registryPath = path.join(fixture.workspace, 'plugin-data', 'projects.v1.json')
      fixture.service.dispose()
      await writeFile(registryPath, '{ broken registry\n')
      restarted = new CreatorHostService({
        defaultWorkspaceDir: fixture.workspace,
        pluginDataDir: path.join(fixture.workspace, 'plugin-data'),
      })
      const before = await stat(registryPath).catch(() => undefined)
      const result = await diagnose(restarted)
      const after = await stat(registryPath).catch(() => undefined)
      expect(result.reports[0]).toMatchObject({ state: 'broken' })
      expect(result.reports[0]!.findings).toContainEqual(expect.objectContaining({
        code: 'registry_corrupt',
        severity: 'error',
      }))
      expect(before).toBeUndefined()
      expect(after).toBeUndefined()

      // A valid registry also remains byte-for-byte and mtime stable across a read-only diagnosis.
      await writeFile(registryPath, `${JSON.stringify({ schema: 'muweave.projects.v1', projects: [], updatedAt: new Date().toISOString() })}\n`)
      const stableBefore = await stat(registryPath)
      const stableBytes = await readFile(registryPath)
      await diagnose(restarted)
      const stableAfter = await stat(registryPath)
      expect(stableAfter.mtimeMs).toBe(stableBefore.mtimeMs)
      expect(await readFile(registryPath)).toEqual(stableBytes)
    } finally {
      restarted?.dispose()
      if (restarted === undefined) fixture.service.dispose()
      await rm(fixture.workspace, { recursive: true, force: true })
    }
  })
})
