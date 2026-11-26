import { appendFile, chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { append, EventLog, type BotEventV1 } from '../packages/dsh-muweave-core/src/bot-task/events'

let dir: string
let file: string
let log: EventLog
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'muweave-events-'))
  file = join(dir, 'events.v1.jsonl')
  log = new EventLog({ pluginDataDir: dir })
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

async function list(payload: Record<string, unknown> = {}, reader = log) {
  const response = await reader.handle('event.list', payload, 7)
  expect(response.generation).toBe(7)
  if (!response.ok) throw new Error(response.error.code)
  return response.data
}

describe('bot event log', () => {
  it('returns an empty page without creating a missing file or directory', async () => {
    const nested = join(dir, 'missing')
    expect(await list({}, new EventLog({ pluginDataDir: nested }))).toEqual({ events: [], nextCursor: null, corruptLines: 0 })
    await expect(stat(nested)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('round-trips the schema, filters by trace and task separately or together, and enforces 0600', async () => {
    const first = { event: 'task.assigned', traceId: 'trace-a', taskId: 'task-1', botId: 'bot-a', sessionId: 'session:1', workspaceId: 'ws_a', status: 'assigned', summary: 'task assigned', ref: 'task-ref', digest: 'sha256:' + 'a'.repeat(64), count: 0 }
    const second = { event: 'job.reconcile_required', traceId: 'trace-a', taskId: 'task-2', jobId: 'job_a', code: 'muweave/unknown_status', durationMs: 0.5 }
    const third = { event: 'job.submitted', traceId: 'trace-b', taskId: 'task-2' }
    await log.append(first)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    await chmod(file, 0o644)
    await log.append(second)
    await log.append(third)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    const reader = new EventLog({ pluginDataDir: dir })
    const page = await list({ traceId: 'trace-a' }, reader)
    expect(page.events).toMatchObject([first, second])
    expect(page.events[0].ts).toBe(new Date(page.events[0].ts).toISOString())
    expect((await list({ taskId: 'task-2' })).events).toMatchObject([second, third])
    expect((await list({ traceId: 'trace-a', taskId: 'task-2' })).events).toMatchObject([second])
  })

  it('writes one content-free rejection per unsafe event, including extra or nested fields', async () => {
    const unsafe: Omit<BotEventV1, 'ts'>[] = [
      ...['/home/test/private', '/Volumes/test', 'C:\\example', 'sk-test', 'trace:ghp_fixture', 'AKIAfixture', 'Bearer example', 'raw prompt with spaces'].map(traceId => ({ event: 'job.submitted', traceId })),
      { event: 'task.assigned', ...{ prompt: 'example prompt' } },
      { event: 'task.assigned', ...{ ownerResponse: { details: 'example response' } } },
      { event: 'task.assigned', ...{ reasoning: 'example reasoning' } },
    ]
    for (const input of unsafe) await expect(log.append(input)).rejects.toThrow('event.rejected_sensitive')
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n')
    expect(lines).toHaveLength(unsafe.length)
    for (const line of lines) {
      expect(JSON.parse(line)).toEqual({ ts: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/), event: 'event.rejected_sensitive' })
    }
    for (const { traceId } of unsafe) if (traceId) expect(lines.join('\n')).not.toContain(traceId)
  })

  it('pages matching records once in append order and counts malformed and unsafe rows once', async () => {
    await writeFile(file, '{bad json\n')
    await log.append({ event: 'task.assigned', traceId: 't', count: 1 })
    await log.append({ event: 'task.assigned', traceId: 'other', count: 2 })
    const unsafe = { event: 'task.assigned', traceId: 't', prompt: 'example prompt', ts: new Date().toISOString() }
    await appendFile(file, JSON.stringify(unsafe) + '\n')
    await log.append({ event: 'task.assigned', traceId: 't', count: 3 })
    const one = await list({ traceId: 't', limit: 1 })
    expect(one.events.map(event => event.count)).toEqual([1])
    expect(one.corruptLines).toBe(2)
    expect(one.nextCursor).toEqual(expect.any(String))
    await appendFile(file, '{torn')
    await log.append({ event: 'task.assigned', traceId: 't', count: 4 })
    const two = await list({ traceId: 't', limit: 1, cursor: one.nextCursor })
    expect(two.events.map(event => event.count)).toEqual([3])
    expect(two.corruptLines).toBe(1)
    const last = await list({ traceId: 't', limit: 1, cursor: two.nextCursor })
    expect(last.events.map(event => event.count)).toEqual([4])
    expect(last).toMatchObject({ nextCursor: null, corruptLines: 0 })
  })

  it('defaults to 50 rows and caps the page at 500', async () => {
    const ts = new Date().toISOString()
    const lines = Array.from({ length: 501 }, (_, count) => JSON.stringify({ ts, event: 'job.submitted', count }))
    await writeFile(file, lines.join('\n') + '\n')
    expect((await list()).events).toHaveLength(50)
    const page = await list({ limit: 1000 })
    expect(page.events).toHaveLength(500)
    expect((await list({ cursor: page.nextCursor })).events.map(event => event.count)).toEqual([500])
    for (const query of [{ cursor: '-1' }, { limit: 0 }, { taskId: ['unexpected'] }]) {
      expect(await log.handle('event.list', query)).toMatchObject({ ok: false })
    }
  })

  it('keeps concurrent appends from distinct instances as complete lines', async () => {
    const other = new EventLog({ pluginDataDir: dir })
    const counts = Array.from({ length: 30 }, (_, n) => n)
    await Promise.all(counts.map(count => (count % 2 ? log : other).append({ event: 'job.submitted', count })))
    const page = await list()
    expect(page.corruptLines).toBe(0)
    expect(page.events.map(e => e.count).sort((a, b) => a! - b!)).toEqual(counts)
  })

  it('uses the DSH host directory for the standalone append and isolates explicit stores', async () => {
    vi.stubEnv('DSH_HOME', dir)
    await append({ event: 'job.submitted', jobId: 'default' })
    await log.append({ event: 'job.submitted', jobId: 'custom' })
    const standard = new EventLog({ pluginDataDir: join(dir, 'plugin-data', 'muweave-dsh') })
    expect((await list({}, standard)).events).toMatchObject([{ jobId: 'default' }])
    expect((await list()).events).toMatchObject([{ jobId: 'custom' }])
    expect(await new EventLog({}).handle('event.list', {})).toMatchObject({ ok: false })
  })
})
