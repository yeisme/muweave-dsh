import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CliRunner } from '@yeisme/muweave-bundle'
import { CreatorHostService } from '@yeisme/dsh-muweave-core'
import { TaskLedger, TASKS_SCHEMA, type TaskRecordV1 } from '../packages/dsh-muweave-core/src/bot-task/tasks'
import { computeBudget } from '../packages/dsh-muweave-core/src/capabilities/settings'
import type { JobRecordV1 } from '../packages/dsh-muweave-core/src/capability-protocol'

const FAKE_RUNNER: CliRunner = async (cmd, args) => {
  if (cmd === 'eikona' && args.includes('--version')) {
    return { exitCode: 0, stdout: 'eikona 1.0.0', stderr: '' }
  }
  if (cmd === 'eikona' && args.includes('generate') && args.includes('--dry-run')) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ data: { estimated_usd: 0.04 } }),
      stderr: '',
    }
  }
  return { exitCode: 1, stdout: '', stderr: 'not mocked' }
}

describe('P3 orchestration reliability: orphanedCount and cascade job cancel', () => {
  it('TaskLedger.list() reports orphanedCount for the workspace even when status filter is applied', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-p3-orphan-'))
    try {
      const ledger1 = new TaskLedger({ pluginDataDir: dir })
      const created = await ledger1.handle('task.create', {
        workspaceId: 'ws_1',
        idempotencyKey: 'idem_1',
        goal: 'Render episode 1',
      })
      expect(created.ok).toBe(true)
      const taskId = ((created as { ok: true; data: { task: TaskRecordV1 } }).data).task.taskId
      ledger1.dispose()

      // Simulate an in-flight running task left behind before process restart.
      const tasksFile = path.join(dir, 'tasks.v1.json')
      const stored = JSON.parse(await readFile(tasksFile, 'utf8')) as {
        schema: typeof TASKS_SCHEMA
        tasks: TaskRecordV1[]
      }
      stored.tasks[0]!.status = 'running'
      await writeFile(tasksFile, JSON.stringify(stored, null, 2), 'utf8')

      // Reload marks the non-terminal task as orphaned.
      const ledger2 = new TaskLedger({ pluginDataDir: dir })
      const listed = await ledger2.handle('task.list', { workspaceId: 'ws_1' })
      expect(listed.ok).toBe(true)
      const data = (listed as { ok: true; data: { tasks: TaskRecordV1[]; orphanedCount: number } }).data
      expect(data.orphanedCount).toBe(1)
      expect(data.tasks[0]?.status).toBe('orphaned')

      // Even when filtering to a different status, orphanedCount still reports workspace orphans.
      const filtered = await ledger2.handle('task.list', { workspaceId: 'ws_1', status: 'proposed' })
      expect(filtered.ok).toBe(true)
      const filteredData = (filtered as { ok: true; data: { tasks: TaskRecordV1[]; orphanedCount: number } }).data
      expect(filteredData.tasks).toHaveLength(0)
      expect(filteredData.orphanedCount).toBe(1)
      expect(taskId).toBeTruthy()
      ledger2.dispose()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('task.cancel cascades cancellation to active CapabilityService jobs linked to the cancelled task tree', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-p3-cascade-'))
    const pluginDataDir = path.join(ws, 'plugin-data')
    try {
      const svc = new CreatorHostService({
        defaultWorkspaceDir: ws,
        pluginDataDir,
        runner: FAKE_RUNNER,
      })

      const wsList = await svc.handleRpcAction('workspace.list', {})
      if (!wsList.ok) throw new Error('workspace.list failed')
      const workspaceId = (wsList.data as { workspaces: Array<{ workspaceId: string }> }).workspaces[0]!.workspaceId

      // Create root task + child task + unrelated task.
      const rootRes = await svc.handleRpcAction('task.create', {
        workspaceId,
        idempotencyKey: 'root_1',
        goal: 'Produce scene 01',
      })
      if (!rootRes.ok) throw new Error('root task create failed')
      const rootTaskId = (rootRes.data as { task: TaskRecordV1 }).task.taskId

      const childRes = await svc.handleRpcAction('task.create', {
        workspaceId,
        parentTaskRef: rootTaskId,
        idempotencyKey: 'child_1',
        goal: 'Generate keyframe for shot 01',
      })
      if (!childRes.ok) throw new Error('child task create failed')
      const childTaskId = (childRes.data as { task: TaskRecordV1 }).task.taskId

      const otherRes = await svc.handleRpcAction('task.create', {
        workspaceId,
        idempotencyKey: 'other_1',
        goal: 'Unrelated task',
      })
      if (!otherRes.ok) throw new Error('other task create failed')
      const otherTaskId = (otherRes.data as { task: TaskRecordV1 }).task.taskId

      // Create 3 waiting_approval jobs linked to root, child, and unrelated tasks.
      const makeJob = async (taskId: string, idem: string): Promise<string> => {
        const est = await svc.handleRpcAction('capability.estimate', {
          workspaceId,
          capabilityId: 'eikona.image.generate',
          input: { prompt: `shot visual for ${idem}` },
        })
        if (!est.ok) throw new Error(`estimate failed: ${est.error.code} ${est.error.message}`)
        const estimateId = (est.data as { estimate: { estimateId: string } }).estimate.estimateId
        const req = await svc.handleRpcAction('job.request', {
          workspaceId,
          estimateId,
          idempotencyKey: idem,
          requestedBy: 'agent',
          requester: { taskId, botId: 'worker_1' },
        })
        if (!req.ok) throw new Error(`job.request failed: ${req.error.code}`)
        return (req.data as { job: JobRecordV1 }).job.jobId
      }

      const rootJobId = await makeJob(rootTaskId, 'job_root')
      const childJobId = await makeJob(childTaskId, 'job_child')
      const otherJobId = await makeJob(otherTaskId, 'job_other')

      // Cancel root task -> should cascade to childTaskId AND both rootJobId & childJobId.
      const cancelRes = await svc.handleRpcAction('task.cancel', { taskId: rootTaskId })
      expect(cancelRes.ok).toBe(true)
      if (!cancelRes.ok) throw new Error('task.cancel failed')
      const cancelData = cancelRes.data as {
        task: TaskRecordV1
        cancelledTaskIds: string[]
        cancelledJobIds: string[]
      }
      expect(cancelData.cancelledTaskIds).toEqual(expect.arrayContaining([rootTaskId, childTaskId]))
      expect(cancelData.cancelledJobIds).toEqual(expect.arrayContaining([rootJobId, childJobId]))
      expect(cancelData.cancelledJobIds).not.toContain(otherJobId)

      // Verify job states in CapabilityService.
      const jobsRes = await svc.handleRpcAction('job.list', { workspaceId })
      if (!jobsRes.ok) throw new Error('job.list failed')
      const jobs = (jobsRes.data as { jobs: JobRecordV1[] }).jobs
      const byId = new Map(jobs.map((j) => [j.jobId, j]))
      expect(byId.get(rootJobId)?.status).toBe('cancelled')
      expect(byId.get(childJobId)?.status).toBe('cancelled')
      expect(byId.get(otherJobId)?.status).toBe('waiting_approval')

      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('computeBudget populates windowSummaries (last7Days and allTime) without changing today lines', () => {
    const now = new Date('2026-11-27T12:00:00.000Z')
    const makeJobRecord = (id: string, approvedAt: string, spent: number): JobRecordV1 => ({
      jobId: id,
      workspaceId: 'ws_1',
      capabilityId: 'eikona.image.generate',
      owner: 'eikona',
      kind: 'image',
      title: id,
      promptDigest: 'sha256:00',
      requestedBy: 'ui',
      status: 'completed',
      estimate: { unit: 'usd', amount: spent },
      approvedCeiling: { unit: 'usd', amount: spent },
      actualCost: { unit: 'usd', amount: spent },
      idempotencyKey: id,
      slots: [],
      createdAt: approvedAt,
      updatedAt: approvedAt,
      approvedAt,
      nextAction: 'none',
    })

    const jobs: JobRecordV1[] = [
      makeJobRecord('job_today', '2026-11-27T08:00:00.000Z', 1.25),
      makeJobRecord('job_3d_ago', '2026-11-24T08:00:00.000Z', 2.5),
      makeJobRecord('job_20d_ago', '2026-11-07T08:00:00.000Z', 10.0),
    ]

    const status = computeBudget(jobs, { paidEnabled: true, dailyCap: { usd: 5 } }, now)
    expect(status.lines).toEqual([{ unit: 'usd', committed: 0, spent: 1.25, dailyCap: 5 }])
    expect(status.windowSummaries?.last7Days).toEqual([{ unit: 'usd', committed: 0, spent: 3.75 }])
    expect(status.windowSummaries?.allTime).toEqual([{ unit: 'usd', committed: 0, spent: 13.75 }])
  })
})
