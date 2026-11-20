import { describe, expect, it } from 'vitest'
import { readFile, rm, stat } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initBundle, muweaveRoot } from '@yeisme/muweave-bundle'
import { CreatorHostService } from '@yeisme/dsh-muweave-core'

type ClaimResult = {
  project: {
    id: string
    workspaceRefs: string[]
  }
  workspaceRefs: string[]
  claimed: true
}

async function makeClaimFixture(prefix: string) {
  const workspace = await mkdtemp(path.join(tmpdir(), prefix))
  await initBundle(workspace, { projectId: 'proj_legacy', title: '旧 bundle 标题' })
  const service = new CreatorHostService({
    defaultWorkspaceDir: workspace,
    pluginDataDir: path.join(workspace, 'plugin-data'),
  })
  const listed = await service.handleRpcAction('workspace.list', {})
  if (!listed.ok) throw new Error(`workspace.list failed: ${listed.error.code}`)
  const workspaceId = (listed.data as { workspaces: Array<{ workspaceId: string }> }).workspaces[0]!.workspaceId
  return { service, workspace, workspaceId }
}

describe('project.claim backend contract', () => {
  it('claims the bundle project id, persists the project, and leaves the bundle unchanged', async () => {
    const { service, workspace, workspaceId } = await makeClaimFixture('muweave-project-claim-success-')
    try {
      const bundlePath = path.join(muweaveRoot(workspace), 'bundle.v1.json')
      const before = await readFile(bundlePath)
      const beforeStat = await stat(bundlePath)

      const response = await service.handleRpcAction('project.claim', {
        workspaceId,
        projectId: 'proj_legacy',
        title: '已认领项目',
        status: 'preparing',
        idempotencyKey: 'claim-001',
      })
      expect(response.ok).toBe(true)
      if (response.ok) {
        const result = response.data as ClaimResult
        expect(result.claimed).toBe(true)
        expect(result.project.id).toBe('proj_legacy')
        expect(result.project.workspaceRefs).toContain(workspaceId)
        expect(result.workspaceRefs).toContain(workspaceId)
      }

      const registry = JSON.parse(await readFile(path.join(workspace, 'plugin-data', 'projects.v1.json'), 'utf8')) as {
        projects: Array<{ id: string; workspaceRefs: string[] }>
      }
      expect(registry.projects).toHaveLength(1)
      expect(registry.projects[0]).toMatchObject({ id: 'proj_legacy', workspaceRefs: [workspaceId] })
      expect(await readFile(bundlePath)).toEqual(before)
      expect((await stat(bundlePath)).mtimeMs).toBe(beforeStat.mtimeMs)
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('returns project_exists for a different claim after the id is registered', async () => {
    const { service, workspace, workspaceId } = await makeClaimFixture('muweave-project-claim-exists-')
    try {
      const first = await service.handleRpcAction('project.claim', {
        workspaceId,
        projectId: 'proj_legacy',
        title: '首次认领',
        idempotencyKey: 'claim-first',
      })
      expect(first.ok).toBe(true)

      const duplicate = await service.handleRpcAction('project.claim', {
        workspaceId,
        projectId: 'proj_legacy',
        title: '重复认领',
        idempotencyKey: 'claim-second',
      })
      expect(duplicate.ok).toBe(false)
      if (!duplicate.ok) expect(duplicate.error.code).toBe('muweave/project_exists')
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('replays the existing project for the same idempotency key', async () => {
    const { service, workspace, workspaceId } = await makeClaimFixture('muweave-project-claim-idempotent-')
    try {
      const input = {
        workspaceId,
        projectId: 'proj_legacy',
        title: '幂等认领',
        idempotencyKey: 'claim-replay',
      }
      const first = await service.handleRpcAction('project.claim', input)
      const replay = await service.handleRpcAction('project.claim', input)
      expect(first.ok).toBe(true)
      expect(replay.ok).toBe(true)
      if (first.ok && replay.ok) expect(replay.data).toEqual(first.data)
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects an unregistered workspace', async () => {
    const { service, workspace } = await makeClaimFixture('muweave-project-claim-workspace-')
    try {
      const response = await service.handleRpcAction('project.claim', {
        workspaceId: 'ws_unknown',
        projectId: 'proj_legacy',
        title: '旧项目',
        idempotencyKey: 'claim-unknown-workspace',
      })
      expect(response.ok).toBe(false)
      if (!response.ok) expect(response.error.code).toBe('muweave/workspace_unknown')
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects an empty title', async () => {
    const { service, workspace, workspaceId } = await makeClaimFixture('muweave-project-claim-title-')
    try {
      const response = await service.handleRpcAction('project.claim', {
        workspaceId,
        projectId: 'proj_legacy',
        title: '   ',
        idempotencyKey: 'claim-invalid-title',
      })
      expect(response.ok).toBe(false)
      if (!response.ok) expect(response.error.code).toBe('muweave/invalid_project_title')
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
