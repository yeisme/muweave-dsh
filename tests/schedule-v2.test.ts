import { describe, expect, it } from 'vitest'
import { readFile, rm, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CreatorHostService } from '@yeisme/dsh-muweave-core'

type ScheduleRow = {
  ref: string
  projectId?: string
  legacy?: true
}

describe('schedule v2 backend ownership and migration', () => {
  it('persists an explicit projectId and does not inherit it when omitted later', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'muweave-schedule-v2-'))
    const pluginDataDir = path.join(workspace, 'plugin-data')
    const file = path.join(pluginDataDir, 'schedule.v1.json')
    const service = new CreatorHostService({ defaultWorkspaceDir: workspace, pluginDataDir })
    try {
      const planned = await service.handleRpcAction('schedule.plan', {
        ref: 'scene:01',
        date: '2026-11-20',
        projectId: 'proj_alpha',
      })
      expect(planned.ok).toBe(true)
      const stored = JSON.parse(await readFile(file, 'utf8')) as { entries: ScheduleRow[] }
      expect(stored.entries[0]).toMatchObject({ ref: 'scene:01', projectId: 'proj_alpha' })

      const movedWithoutProject = await service.handleRpcAction('schedule.plan', {
        ref: 'scene:01',
        date: '2026-11-21',
      })
      expect(movedWithoutProject.ok).toBe(true)
      const movedStored = JSON.parse(await readFile(file, 'utf8')) as { entries: ScheduleRow[] }
      expect(movedStored.entries[0]).not.toHaveProperty('projectId')
      if (!movedWithoutProject.ok) throw new Error('schedule.plan failed')
      const movedBoard = movedWithoutProject.data as { entries: ScheduleRow[] }
      expect(movedBoard.entries[0]!.legacy).toBe(true)
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('persists no projectId when planning a new legacy row and marks it only in list output', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'muweave-schedule-v2-'))
    const pluginDataDir = path.join(workspace, 'plugin-data')
    const file = path.join(pluginDataDir, 'schedule.v1.json')
    const service = new CreatorHostService({ defaultWorkspaceDir: workspace, pluginDataDir })
    try {
      const planned = await service.handleRpcAction('schedule.plan', {
        ref: 'shot:01',
        date: '2026-11-20',
      })
      expect(planned.ok).toBe(true)
      const stored = JSON.parse(await readFile(file, 'utf8')) as { entries: ScheduleRow[] }
      expect(stored.entries[0]).not.toHaveProperty('projectId')
      expect(stored.entries[0]).not.toHaveProperty('legacy')

      const listed = await service.handleRpcAction('schedule.list', {})
      expect(listed.ok).toBe(true)
      if (listed.ok) {
        const board = listed.data as { entries: ScheduleRow[] }
        expect(board.entries[0]!.legacy).toBe(true)
      }
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('loads old JSON without rewriting it and derives legacy on list', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'muweave-schedule-v2-'))
    const pluginDataDir = path.join(workspace, 'plugin-data')
    const file = path.join(pluginDataDir, 'schedule.v1.json')
    const oldJson = `${JSON.stringify({
      schema: 'muweave.schedule.v1',
      entries: [{
        ref: 'scene:legacy',
        label: 'Legacy scene',
        kind: 'element',
        date: '2026-11-20',
        note: 'keep me',
        updatedAt: '2026-11-19T00:00:00.000Z',
      }],
      updatedAt: '2026-11-19T00:00:00.000Z',
    }, null, 2)}\n`
    await mkdir(pluginDataDir, { recursive: true })
    await writeFile(file, oldJson, 'utf8')
    try {
      const service = new CreatorHostService({ defaultWorkspaceDir: workspace, pluginDataDir })
      try {
        const listed = await service.handleRpcAction('schedule.list', {})
        expect(listed.ok).toBe(true)
        if (listed.ok) {
          const board = listed.data as { entries: ScheduleRow[] }
          expect(board.entries[0]).toMatchObject({ ref: 'scene:legacy', legacy: true })
          expect(board.entries[0]).not.toHaveProperty('projectId')
        }
        expect(await readFile(file, 'utf8')).toBe(oldJson)
      } finally {
        service.dispose()
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it.each(['../etc', 'proj_!bad', 42, null, { id: 'proj_object' }])('rejects invalid projectId (%s) through RPC', async (projectId) => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'muweave-schedule-v2-'))
    const service = new CreatorHostService({ defaultWorkspaceDir: workspace, pluginDataDir: path.join(workspace, 'plugin-data') })
    try {
      const result = await service.handleRpcAction('schedule.plan', {
        ref: 'scene:invalid',
        date: '2026-11-20',
        projectId,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('muweave/invalid_schedule_entry')
        expect(result.error.retryable).toBe(false)
      }
    } finally {
      service.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
