import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CreatorHostService } from '@yeisme/dsh-muweave-core'
import { MAX_SCHEDULE_ENTRIES, ScheduleStore, isValidScheduleDate } from '../packages/dsh-muweave-core/src/schedule-store'

describe('schedule store: publishing board over .muweave/ references', () => {
  it('accepts only real calendar days in YYYY-MM-DD form', () => {
    expect(isValidScheduleDate('2026-11-18')).toBe(true)
    expect(isValidScheduleDate('2026-02-28')).toBe(true)
    expect(isValidScheduleDate('2024-02-29')).toBe(true)
    expect(isValidScheduleDate('2026-02-31')).toBe(false)
    expect(isValidScheduleDate('2026-13-01')).toBe(false)
    expect(isValidScheduleDate('2026-1-08')).toBe(false)
    expect(isValidScheduleDate('18-11-2026')).toBe(false)
    expect(isValidScheduleDate('')).toBe(false)
  })

  it('keeps one row per ref, moves it on re-plan, and sorts by date', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-sched-'))
    try {
      const store = new ScheduleStore(path.join(dir, 'schedule.v1.json'))
      store.plan({ ref: 'scene:ep01:s02', date: '2026-11-20', label: '第二场', kind: 'auctra.scene_card' })
      store.plan({ ref: 'shot:ep01:s01:01', date: '2026-11-19', label: '镜头 01', kind: 'drama.shot' })
      // Same ref, new day: a move, not a second row.
      const moved = store.plan({ ref: 'shot:ep01:s01:01', date: '2026-11-21', note: '改到周六' })

      expect(moved.entries).toHaveLength(2)
      expect(moved.entries.map((e) => e.ref)).toEqual(['scene:ep01:s02', 'shot:ep01:s01:01'])
      const shot = moved.entries.find((e) => e.ref === 'shot:ep01:s01:01')!
      expect(shot.date).toBe('2026-11-21')
      expect(shot.note).toBe('改到周六')
      expect(shot.kind).toBe('drama.shot')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a malformed ref or day instead of writing it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-sched-'))
    try {
      const store = new ScheduleStore(path.join(dir, 'schedule.v1.json'))
      expect(() => store.plan({ ref: '   ', date: '2026-11-20' })).toThrowError(/ref is required/)
      expect(() => store.plan({ ref: 'scene:ep01:s01', date: '2026-02-31' })).toThrowError(/YYYY-MM-DD/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('clears one ref, persists atomically and reloads from disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-sched-'))
    const file = path.join(dir, 'schedule.v1.json')
    try {
      const store = new ScheduleStore(file)
      store.plan({ ref: 'a', date: '2026-11-18' })
      store.plan({ ref: 'b', date: '2026-11-19' })
      const afterClear = store.clear('a')
      expect(afterClear.entries.map((e) => e.ref)).toEqual(['b'])

      const raw = JSON.parse(await readFile(file, 'utf8')) as { schema: string; entries: Array<{ ref: string }> }
      expect(raw.schema).toBe('muweave.schedule.v1')
      expect(raw.entries.map((e) => e.ref)).toEqual(['b'])

      const reloaded = new ScheduleStore(file)
      expect(reloaded.list().entries.map((e) => e.ref)).toEqual(['b'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('renames a corrupt board aside instead of dropping it silently', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-sched-'))
    const file = path.join(dir, 'schedule.v1.json')
    try {
      await writeFile(file, '{not json', 'utf8')
      const store = new ScheduleStore(file)
      expect(store.list().entries).toEqual([])
      expect(store.corruptFile).toContain('schedule.v1.corrupt-')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('caps the board so a runaway agent cannot grow the file forever', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-sched-'))
    try {
      const store = new ScheduleStore(path.join(dir, 'schedule.v1.json'))
      for (let i = 0; i < MAX_SCHEDULE_ENTRIES + 12; i += 1) {
        store.plan({ ref: `ref-${i}`, date: '2026-11-18' })
      }
      expect(store.list().entries).toHaveLength(MAX_SCHEDULE_ENTRIES)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('schedule RPC: the board survives a host restart', () => {
  it('plans, lists and clears through the shared rpc bus', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-sched-rpc-'))
    const pluginDataDir = path.join(ws, 'plugin-data')
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir })

      const empty = await svc.handleRpcAction('schedule.list', {})
      if (!empty.ok) throw new Error('schedule.list failed')
      expect((empty.data as { entries: unknown[] }).entries).toEqual([])

      const planned = await svc.handleRpcAction('schedule.plan', {
        ref: 'scene:ep01:s01',
        date: '2026-11-20',
        label: '霓虹街口重逢',
        kind: 'auctra.scene_card',
        note: '首发',
      })
      if (!planned.ok) throw new Error(`schedule.plan failed: ${planned.error.code}`)
      expect((planned.data as { entries: Array<{ date: string }> }).entries[0]!.date).toBe('2026-11-20')

      const badDate = await svc.handleRpcAction('schedule.plan', { ref: 'scene:ep01:s01', date: '2026-02-31' })
      expect(badDate.ok).toBe(false)
      expect((badDate as { error: { code: string } }).error.code).toBe('muweave/invalid_date')

      const missingRef = await svc.handleRpcAction('schedule.plan', { ref: '  ', date: '2026-11-21' })
      expect(missingRef.ok).toBe(false)
      expect((missingRef as { error: { code: string } }).error.code).toBe('muweave/invalid_ref')

      // A second host on the same data dir reads the same board: the file is the source of truth.
      const restarted = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir })
      const afterRestart = await restarted.handleRpcAction('schedule.list', {})
      if (!afterRestart.ok) throw new Error('schedule.list failed after restart')
      expect((afterRestart.data as { entries: Array<{ ref: string }> }).entries.map((e) => e.ref)).toEqual(['scene:ep01:s01'])

      const cleared = await restarted.handleRpcAction('schedule.clear', { ref: 'scene:ep01:s01' })
      if (!cleared.ok) throw new Error('schedule.clear failed')
      expect((cleared.data as { entries: unknown[] }).entries).toEqual([])

      restarted.dispose()
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('rejects a day-shaped request from a caller that skips validation', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-sched-rpc2-'))
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'pdata') })
      const env = await svc.handleRpcAction('schedule.plan', { ref: 'x', date: '2026-11-32' })
      expect(env.ok).toBe(false)
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})

describe('project.clone copies metadata only', () => {
  it('creates a new project and never carries bindings, elements or schedule rows', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-clone-'))
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'pdata') })
      const created = await svc.handleRpcAction('project.create', { title: '原项目', status: 'in_production' })
      if (!created.ok) throw new Error('create failed')
      const source = (created.data as { project: { id: string } }).project

      const cloned = await svc.handleRpcAction('project.clone', {
        sourceProjectId: source.id,
        title: '原项目 副本',
      })
      if (!cloned.ok) throw new Error(`clone failed: ${cloned.error.code}`)
      const payload = cloned.data as {
        project: { id: string; title: string; status: string; ownerBindings: unknown[]; archived: boolean }
        copied: Record<string, boolean>
      }

      expect(payload.project.id).not.toBe(source.id)
      expect(payload.project.title).toBe('原项目 副本')
      // Status is copied; bindings are explicitly not.
      expect(payload.project.status).toBe('in_production')
      expect(payload.project.ownerBindings).toEqual([])
      expect(payload.project.archived).toBe(false)
      expect(payload.copied).toEqual({
        title: true,
        status: true,
        bindings: false,
        elements: false,
        schedule: false,
      })

      // Both projects are listed afterwards.
      const listed = await svc.handleRpcAction('project.list', {})
      if (!listed.ok) throw new Error('list failed')
      const rows = (listed.data as { projects: Array<{ id: string }> }).projects
      expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([source.id, payload.project.id]))
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('clones an archived project as a healthy preparing one', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-clone2-'))
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'pdata') })
      const created = await svc.handleRpcAction('project.create', { title: '旧项目', status: 'published' })
      if (!created.ok) throw new Error('create failed')
      const source = (created.data as { project: { id: string } }).project
      await svc.handleRpcAction('project.archive', { projectId: source.id })

      const cloned = await svc.handleRpcAction('project.clone', { sourceProjectId: source.id, title: '旧项目 副本' })
      if (!cloned.ok) throw new Error('clone failed')
      const project = (cloned.data as { project: { status: string; archived: boolean } }).project
      // A clone of an archived project must not be born archived.
      expect(project.archived).toBe(false)
      expect(project.status).toBe('preparing')
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})

describe('project bind writes durable owner bindings', () => {
  it('activates the new project on create and persists bindings to disk', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-bind-'))
    try {
      const dataDir = path.join(ws, 'pdata')
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: dataDir })

      const created = await svc.handleRpcAction('project.create', { title: 'x' })
      if (!created.ok) throw new Error('create failed')
      const project = (created.data as { project: { id: string } }).project

      const listed = await svc.handleRpcAction('project.list', {})
      if (!listed.ok) throw new Error('list failed')
      expect((listed.data as { activeProjectId?: string }).activeProjectId).toBe(project.id)

      await mkdir(path.join(ws, 'ws-alpha'), { recursive: true })
      const registered = await svc.handleRpcAction('workspace.register', {
        workspaceDir: path.join(ws, 'ws-alpha'),
        label: 'alpha',
      })
      if (!registered.ok) throw new Error('register failed: ' + registered.error.code)
      const alphaId = (registered.data as { workspace: { workspaceId: string } }).workspace.workspaceId

      const bound = await svc.handleRpcAction('project.bind', {
        projectId: project.id,
        workspaceId: alphaId,
        owner: 'eikona',
        refs: ['run_0001'],
      })
      if (!bound.ok) throw new Error('bind failed: ' + bound.error.code)

      const registryPath = path.join(dataDir, 'projects.v1.json')
      const onDisk = JSON.parse(await readFile(registryPath, 'utf8')) as {
        projects: Array<{
          id: string
          ownerBindings: Array<{ owner: string; refs: string[]; workspaceId: string }>
          workspaceRefs: string[]
        }>
      }
      const stored = onDisk.projects.find((row) => row.id === project.id)
      expect(stored).toBeTruthy()
      expect(stored?.ownerBindings).toHaveLength(1)
      expect(stored?.ownerBindings[0]).toMatchObject({ owner: 'eikona', workspaceId: alphaId, refs: ['run_0001'] })
      expect(stored?.workspaceRefs).toContain(alphaId)
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('replaces the same workspace+owner instead of appending duplicates', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-bind2-'))
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'pdata') })
      const created = await svc.handleRpcAction('project.create', { title: 'y' })
      if (!created.ok) throw new Error('create failed')
      const projectId = (created.data as { project: { id: string } }).project.id

      await mkdir(path.join(ws, 'ws-a'), { recursive: true })
      const reg = await svc.handleRpcAction('workspace.register', { workspaceDir: path.join(ws, 'ws-a'), label: 'a' })
      if (!reg.ok) throw new Error('register failed: ' + reg.error.code)
      const wsA = (reg.data as { workspace: { workspaceId: string } }).workspace.workspaceId
      await svc.handleRpcAction('project.bind', { projectId, workspaceId: wsA, owner: 'auctra', refs: ['ep01'] })
      const second = await svc.handleRpcAction('project.bind', { projectId, workspaceId: wsA, owner: 'auctra', refs: ['ep02'] })
      if (!second.ok) throw new Error('second bind failed')
      expect((second.data as { project: { ownerBindings: unknown[] } }).project.ownerBindings).toHaveLength(1)
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('refuses to bind into an archived project', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-bind3-'))
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'pdata') })
      const created = await svc.handleRpcAction('project.create', { title: 'z' })
      if (!created.ok) throw new Error('create failed')
      const projectId = (created.data as { project: { id: string } }).project.id
      await svc.handleRpcAction('project.archive', { projectId })

      const bound = await svc.handleRpcAction('project.bind', {
        projectId,
        workspaceId: 'ws_a',
        owner: 'scaena',
        refs: ['breakdown_01'],
      })
      expect(bound.ok).toBe(false)
      if (!bound.ok) expect(bound.error.code).toBe('muweave/project_archived')
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
