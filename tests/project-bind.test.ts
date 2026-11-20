import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CreatorHostService } from '@yeisme/dsh-muweave-core'

type Project = {
  id: string
  workspaceRefs: string[]
  ownerBindings: Array<{
    workspaceId: string
    owner: string
    refs: string[]
  }>
  lastObservedRevisions?: Record<string, string>
}

type ProjectResponse = { project: Project }

async function makeService(prefix: string) {
  const workspace = await mkdtemp(path.join(tmpdir(), prefix))
  const service = new CreatorHostService({
    defaultWorkspaceDir: workspace,
    pluginDataDir: path.join(workspace, 'plugin-data'),
  })
  const listed = await service.handleRpcAction('workspace.list', {})
  if (!listed.ok) throw new Error('workspace.list failed')
  const workspaceId = (listed.data as { workspaces: Array<{ workspaceId: string }> }).workspaces[0]!.workspaceId
  return { service, workspace, workspaceId }
}

async function createProject(service: CreatorHostService): Promise<Project> {
  const created = await service.handleRpcAction('project.create', { title: '绑定合同测试项目' })
  if (!created.ok) throw new Error(`project.create failed: ${created.error.code}`)
  return (created.data as ProjectResponse).project
}

async function getProject(service: CreatorHostService, projectId: string): Promise<Project> {
  const listed = await service.handleRpcAction('project.list', { includeArchived: true })
  if (!listed.ok) throw new Error(`project.list failed: ${listed.error.code}`)
  const project = (listed.data as { projects: Project[] }).projects.find((item) => item.id === projectId)
  if (!project) throw new Error(`project ${projectId} not found`)
  return project
}

describe('project.bind and project.unbind backend contract', () => {
  it('accepts a matching expectedRevision and persists the new observed revision', async () => {
    const { service, workspace, workspaceId } = await makeService('muweave-project-bind-revision-match-')
    try {
      const project = await createProject(service)
      const registryPath = path.join(workspace, 'plugin-data', 'projects.v1.json')
      const registry = JSON.parse(await readFile(registryPath, 'utf8')) as {
        projects: Project[]
        schema: string
        updatedAt: string
      }
      registry.projects[0]!.lastObservedRevisions = {
        [`${workspaceId}/eikona`]: 'revision-1',
      }
      await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n')
      service.dispose()

      const restarted = new CreatorHostService({
        defaultWorkspaceDir: workspace,
        pluginDataDir: path.join(workspace, 'plugin-data'),
      })
      try {
        const bound = await restarted.handleRpcAction('project.bind', {
          projectId: project.id,
          workspaceId,
          owner: 'eikona',
          refs: ['run_0002'],
          expectedRevision: 'revision-1',
        })
        if (!bound.ok) throw new Error(`bind failed: ${JSON.stringify(bound)}`)
        if (bound.ok) {
          expect((bound.data as ProjectResponse).project.lastObservedRevisions).toEqual({
            [`${workspaceId}/eikona`]: 'revision-1',
          })
        }
      } finally {
        restarted.dispose()
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects a mismatched expectedRevision without modifying the project', async () => {
    const { service, workspace, workspaceId } = await makeService('muweave-project-bind-conflict-')
    try {
      const project = await createProject(service)
      const initial = await service.handleRpcAction('project.bind', {
        projectId: project.id,
        workspaceId,
        owner: 'eikona',
        refs: ['run_0001'],
      })
      expect(initial.ok).toBe(true)
      const before = await getProject(service, project.id)

      const conflict = await service.handleRpcAction('project.bind', {
        projectId: project.id,
        workspaceId,
        owner: 'eikona',
        refs: ['run_0002'],
        expectedRevision: 'stale-revision',
      })
      expect(conflict.ok).toBe(false)
      if (!conflict.ok) {
        expect(conflict.error.code).toBe('muweave/revision_conflict')
        expect(conflict.error.details).toEqual({ expected: 'stale-revision', actual: null })
      }
      await expect(getProject(service, project.id)).resolves.toEqual(before)
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('removes an existing binding idempotently and leaves workspaceRefs unchanged', async () => {
    const { service, workspace, workspaceId } = await makeService('muweave-project-unbind-')
    try {
      const project = await createProject(service)
      const bound = await service.handleRpcAction('project.bind', {
        projectId: project.id,
        workspaceId,
        owner: 'eikona',
        refs: ['run_0001'],
      })
      expect(bound.ok).toBe(true)
      const before = await getProject(service, project.id)

      const removed = await service.handleRpcAction('project.unbind', {
        projectId: project.id,
        workspaceId,
        owner: 'eikona',
      })
      expect(removed.ok).toBe(true)
      if (removed.ok) {
        expect(removed.data).toMatchObject({ removed: true })
        expect((removed.data as ProjectResponse).project.ownerBindings).toEqual([])
        expect((removed.data as ProjectResponse).project.workspaceRefs).toEqual(before.workspaceRefs)
      }

      const repeated = await service.handleRpcAction('project.unbind', {
        projectId: project.id,
        workspaceId,
        owner: 'eikona',
      })
      expect(repeated.ok).toBe(true)
      if (repeated.ok) expect(repeated.data).toMatchObject({ removed: false })
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects a bind to an unregistered workspace', async () => {
    const { service, workspace } = await makeService('muweave-project-bind-workspace-')
    try {
      const project = await createProject(service)
      const result = await service.handleRpcAction('project.bind', {
        projectId: project.id,
        workspaceId: 'ws_unknown',
        owner: 'eikona',
        refs: ['run_0001'],
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('muweave/workspace_unknown')
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects binding an archived project', async () => {
    const { service, workspace, workspaceId } = await makeService('muweave-project-bind-archived-')
    try {
      const project = await createProject(service)
      const archived = await service.handleRpcAction('project.archive', { projectId: project.id })
      expect(archived.ok).toBe(true)

      const result = await service.handleRpcAction('project.bind', {
        projectId: project.id,
        workspaceId,
        owner: 'eikona',
        refs: ['run_0001'],
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('muweave/project_archived')
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
