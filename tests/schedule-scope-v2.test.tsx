import { describe, expect, it, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createMuweaveRpcClient, type MuweaveTranslator } from '@yeisme/dsh-muweave-core/client'
import { ScheduleMainPage, toDayKey } from '@yeisme/dsh-muweave-schedule/client'
import { classifyScheduleEntry, scopeScheduleEntries, type ScheduleScopeProject } from '../packages/dsh-muweave-schedule/src/project-scope'

/**
 * Schedule v2 ownership: a stored projectId wins, legacy entries may be inferred from a `proj_*`
 * ref prefix (and say so), everything else is unknown. Switching projects must never carry entries over.
 */

const ALPHA: ScheduleScopeProject = { id: 'proj_alpha', title: 'alpha', status: 'preparing', workspaceRefs: ['ws_shared'] }
const BETA: ScheduleScopeProject = { id: 'proj_beta', title: 'beta', status: 'preparing', workspaceRefs: ['ws_shared'] }

describe('classifyScheduleEntry', () => {
  it('uses an explicit projectId over anything the ref says', () => {
    expect(classifyScheduleEntry({ ref: 'scene-1', projectId: 'proj_alpha' }, ALPHA)).toEqual({ ownership: 'mine', basis: 'explicit' })
    expect(classifyScheduleEntry({ ref: 'proj_alpha:scene-1', projectId: 'proj_beta' }, ALPHA)).toEqual({ ownership: 'others', basis: 'explicit' })
  })

  it('infers legacy entries from a ref prefix, or leaves them unknown', () => {
    expect(classifyScheduleEntry({ ref: 'proj_alpha:scene-1', legacy: true }, ALPHA)).toEqual({ ownership: 'mine', basis: 'inferred' })
    expect(classifyScheduleEntry({ ref: 'proj_beta/shot-2', legacy: true }, ALPHA)).toEqual({ ownership: 'others', basis: 'inferred' })
    expect(classifyScheduleEntry({ ref: 'scene-1', legacy: true }, ALPHA)).toEqual({ ownership: 'unknown', basis: 'unknown' })
  })

  it('treats an entry with no projectId and no legacy flag as unknown, even with a prefix', () => {
    expect(classifyScheduleEntry({ ref: 'scene-1' }, ALPHA)).toEqual({ ownership: 'unknown', basis: 'unknown' })
    expect(classifyScheduleEntry({ ref: 'proj_alpha:scene-1' }, ALPHA)).toEqual({ ownership: 'unknown', basis: 'unknown' })
  })

  it('ignores malformed v2 fields instead of trusting them', () => {
    expect(classifyScheduleEntry({ ref: 'scene-1', projectId: 42, legacy: 'yes' }, ALPHA)).toEqual({ ownership: 'unknown', basis: 'unknown' })
    expect(classifyScheduleEntry({ ref: 'scene-1', projectId: '' }, ALPHA)).toEqual({ ownership: 'unknown', basis: 'unknown' })
  })
})

describe('scopeScheduleEntries across a project switch', () => {
  const entries = [
    { ref: 'a1', projectId: 'proj_alpha' },
    { ref: 'b1', projectId: 'proj_beta' },
    { ref: 'proj_alpha:legacy', legacy: true },
    { ref: 'ws-legacy', legacy: true },
  ]
  const refs = (list: { entry: { ref: string } }[]) => list.map((s) => s.entry.ref)

  it('keeps each project to its own entries, even when both bind the same workspace', () => {
    const alpha = scopeScheduleEntries(entries, ALPHA)
    const beta = scopeScheduleEntries(entries, BETA)
    expect(refs(alpha.mine)).toEqual(['a1', 'proj_alpha:legacy'])
    expect(refs(beta.mine)).toEqual(['b1'])
    expect(refs(beta.others)).toEqual(['a1', 'proj_alpha:legacy'])
    // A legacy entry without a prefix is never claimed by either project.
    expect(refs(alpha.unknown)).toEqual(['ws-legacy'])
    expect(refs(beta.unknown)).toEqual(['ws-legacy'])
    expect(alpha.mine.map((s) => s.basis)).toEqual(['explicit', 'inferred'])
  })

  it('does not filter without an active project', () => {
    const none = scopeScheduleEntries(entries, undefined)
    expect(refs(none.mine)).toEqual(entries.map((e) => e.ref))
    expect(none.unknown).toEqual([])
    expect(none.others).toEqual([])
  })
})

/* ---------------------------------- room ---------------------------------- */

const ELEMENT = {
  elementId: 'scene-new',
  domain: 'script',
  kind: 'script.scene_card',
  title: 'new scene',
  sourceOwner: 'auctra',
  sourceRef: 'scene:new',
  status: 'draft',
  digest: `sha256:${'1'.repeat(64)}`,
  updatedAt: '2026-11-19T00:00:00Z',
}

type Reply = { ok: true; data: unknown } | { ok: false }
type Handler = (payload: Record<string, unknown>) => Reply

function createRpc(handlers: Record<string, Handler>) {
  return createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
    const handler = handlers[body.action]
    const reply = handler ? handler(body.payload ?? {}) : ({ ok: true, data: {} } as Reply)
    return Response.json(
      reply.ok
        ? { ok: true, generation: 1, data: reply.data }
        : { ok: false, generation: 1, error: { code: 'muweave/test_failure', message: 'failed' } },
    )
  })
}

const keyEcho = ((key: string) => key) as unknown as MuweaveTranslator
const today = toDayKey(new Date())

function board(entries: unknown[]) {
  return { ok: true as const, data: { schema: 'muweave.schedule.v1', entries, updatedAt: '' } }
}

function handlers(project: ScheduleScopeProject | undefined, entries: unknown[], planned: Record<string, unknown>[] = []) {
  return {
    'project.list': () =>
      project
        ? { ok: true as const, data: { projects: [ALPHA, BETA], activeProjectId: project.id } }
        : { ok: true as const, data: { projects: [], activeProjectId: undefined } },
    'schedule.list': () => board(entries),
    'schedule.plan': (payload: Record<string, unknown>) => {
      planned.push(payload)
      return board([...entries, { ref: payload.ref, label: payload.label, kind: payload.kind, date: payload.date, updatedAt: '', projectId: payload.projectId }])
    },
    'bundle.elements.list': () => ({ ok: true as const, data: { elements: [ELEMENT] } }),
  } satisfies Record<string, Handler>
}

const room = (rpc: ReturnType<typeof createRpc>) => <ScheduleMainPage rpc={rpc as never} t={(k: string) => k} coreT={keyEcho} />
const chip = (label: string) => [...document.querySelectorAll<HTMLElement>('.mw-sched-chip')].find((c) => c.textContent?.includes(label))

beforeEach(() => {
  cleanup()
  globalThis.localStorage?.clear()
})

describe('schedule room v2: basis on chips', () => {
  const entries = [
    { ref: 'a1', label: 'alpha-explicit', kind: 'scene', date: today, updatedAt: '', projectId: 'proj_alpha' },
    { ref: 'proj_alpha:old', label: 'alpha-inferred', kind: 'scene', date: today, updatedAt: '', legacy: true },
    { ref: 'old-bare', label: 'bare-legacy', kind: 'scene', date: today, updatedAt: '', legacy: true },
  ]

  it('marks inferred chips quietly and keeps explicit chips plain', async () => {
    render(room(createRpc(handlers(ALPHA, entries))))
    await waitFor(() => expect(chip('alpha-inferred')?.getAttribute('data-basis')).toBe('inferred'))
    expect(chip('alpha-inferred')?.querySelector('.mw-sched-chip-basis')?.textContent).toBe('inferredChipMark')
    // Inferred is not an error: it carries the same tone as a confirmed chip.
    expect(chip('alpha-inferred')?.getAttribute('data-tone')).toBe(chip('alpha-explicit')?.getAttribute('data-tone'))
    expect(chip('alpha-explicit')?.getAttribute('data-basis')).toBe('explicit')
    expect(chip('alpha-explicit')?.querySelector('.mw-sched-chip-basis')).toBeNull()
    expect(chip('bare-legacy')?.getAttribute('data-ownership')).toBe('unknown')
    expect(chip('bare-legacy')?.getAttribute('data-basis')).toBe('unknown')
  })

  it('counts legacy entries above the backlog', async () => {
    render(room(createRpc(handlers(ALPHA, entries))))
    await waitFor(() => expect(document.querySelector('[data-muweave-schedule-legacy]')?.getAttribute('data-muweave-schedule-legacy')).toBe('2'))
  })

  it('shows no legacy line when there are no legacy entries', async () => {
    render(room(createRpc(handlers(ALPHA, [entries[0]]))))
    await waitFor(() => expect(chip('alpha-explicit')).toBeDefined())
    expect(document.querySelector('[data-muweave-schedule-legacy]')).toBeNull()
  })

  it('does not carry entries over when the active project changes', async () => {
    const both = [...entries, { ref: 'b1', label: 'beta-explicit', kind: 'scene', date: today, updatedAt: '', projectId: 'proj_beta' }]
    const view = render(room(createRpc(handlers(ALPHA, both))))
    await waitFor(() => expect(chip('alpha-explicit')).toBeDefined())
    expect(chip('beta-explicit')).toBeUndefined()

    view.rerender(room(createRpc(handlers(BETA, both))))
    await waitFor(() => expect(chip('beta-explicit')?.getAttribute('data-ownership')).toBe('mine'))
    expect(chip('alpha-explicit')).toBeUndefined()
    expect(chip('alpha-inferred')).toBeUndefined()
    // Unprefixed legacy entries stay visible as unknown in every project, never as mine.
    expect(chip('bare-legacy')?.getAttribute('data-ownership')).toBe('unknown')
  })
})

describe('schedule room v2: planning carries the project', () => {
  async function planNewRow(project: ScheduleScopeProject | undefined) {
    const planned: Record<string, unknown>[] = []
    render(room(createRpc(handlers(project, [], planned))))
    await waitFor(() => expect(document.querySelector('[data-muweave-schedule-project]')?.getAttribute('data-muweave-schedule-project')).toBe(project?.id ?? 'none'))
    const row = await waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.mw-sched-row')].find((r) => r.textContent?.includes('new scene'))
      expect(el).toBeDefined()
      return el!
    })
    fireEvent.click(row)
    const cell = document.querySelector<HTMLElement>(`[data-day="${today}"]`)
    expect(cell).not.toBeNull()
    fireEvent.click(cell!)
    await waitFor(() => expect(planned.length).toBe(1))
    return planned[0]!
  }

  it('sends the active projectId', async () => {
    const payload = await planNewRow(ALPHA)
    expect(payload.projectId).toBe('proj_alpha')
    expect(payload.ref).toBe('scene-new')
  })

  it('sends no projectId when no project is active', async () => {
    const payload = await planNewRow(undefined)
    expect('projectId' in payload).toBe(false)
  })

  it('undoing a clear restores the entry without claiming it for the active project', async () => {
    const planned: Record<string, unknown>[] = []
    const legacy = { ref: 'old-bare', label: 'bare-legacy', kind: 'scene', date: today, updatedAt: '', legacy: true }
    const rpc = createRpc({
      ...handlers(ALPHA, [legacy], planned),
      'schedule.clear': () => board([]),
    })
    render(room(rpc))
    const target = await waitFor(() => {
      const el = chip('bare-legacy')
      expect(el).toBeDefined()
      return el!
    })
    fireEvent.click(target)
    const undo = await waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.includes('undoAction'))
      expect(el).toBeDefined()
      return el!
    })
    fireEvent.click(undo)
    await waitFor(() => expect(planned.length).toBe(1))
    expect('projectId' in planned[0]!).toBe(false)
  })
})
