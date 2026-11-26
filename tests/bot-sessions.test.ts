import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BotTaskService } from '../packages/dsh-muweave-core/src/bot-task/service'

const dirs: string[] = []
const services: BotTaskService[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function makeService(logs: Array<[string, Record<string, unknown>]> = []): Promise<{ service: BotTaskService; dataDir: string }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'muweave-bot-sessions-'))
  dirs.push(dataDir)
  const service = new BotTaskService({ pluginDataDir: dataDir, logger: (event, fields) => logs.push([event, fields]) })
  services.push(service)
  return { service, dataDir }
}

function sessionOf(response: unknown): Record<string, string> | null {
  return (response as { ok: true; data: { session: Record<string, string> | null } }).data.session
}

describe('bot sessions', () => {
  it('returns the binding after bind', async () => {
    const { service } = await makeService()
    const response = await service.handle('bot.session.bind', { botId: 'muweave-manager', workspaceId: 'workspace-a', sessionRef: 'session-a' }, 4)
    expect(response).toEqual(expect.objectContaining({ ok: true, generation: 4 }))
    expect(sessionOf(response)).toEqual(expect.objectContaining({ botId: 'muweave-manager', workspaceId: 'workspace-a', sessionRef: 'session-a' }))
    expect(sessionOf(await service.handle('bot.session.get', { botId: 'muweave-manager', workspaceId: 'workspace-a' }))).toEqual(sessionOf(response))
  })

  it('keeps sessions independent for the same bot in different workspaces', async () => {
    const { service } = await makeService()
    await service.handle('bot.session.bind', { botId: 'muweave-manager', workspaceId: 'workspace-a', sessionRef: 'session-a' })
    await service.handle('bot.session.bind', { botId: 'muweave-manager', workspaceId: 'workspace-b', sessionRef: 'session-b' })
    expect(sessionOf(await service.handle('bot.session.get', { botId: 'muweave-manager', workspaceId: 'workspace-a' }))?.sessionRef).toBe('session-a')
    expect(sessionOf(await service.handle('bot.session.get', { botId: 'muweave-manager', workspaceId: 'workspace-b' }))?.sessionRef).toBe('session-b')
  })

  it('returns null after unbind', async () => {
    const { service } = await makeService()
    await service.sessions.bind('muweave-manager', 'workspace-a', 'session-a')
    await expect(service.sessions.unbind('muweave-manager', 'workspace-a')).resolves.toBe(true)
    expect(sessionOf(await service.handle('bot.session.get', { botId: 'muweave-manager', workspaceId: 'workspace-a' }))).toBeNull()
  })

  it('restores a binding when the service is reconstructed', async () => {
    const { service, dataDir } = await makeService()
    await service.handle('bot.session.bind', { botId: 'muweave-manager', workspaceId: 'workspace-a', sessionRef: 'session-a' })
    service.dispose()
    const restored = new BotTaskService({ pluginDataDir: dataDir })
    services.push(restored)
    expect(sessionOf(await restored.handle('bot.session.get', { botId: 'muweave-manager', workspaceId: 'workspace-a' }))).toEqual(expect.objectContaining({ sessionRef: 'session-a' }))
    expect((await stat(path.join(dataDir, 'bot-sessions.v1.json'))).mode & 0o777).toBe(0o600)
  })

  it('starts with an empty mapping and logs when the file is corrupt', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'muweave-bot-sessions-corrupt-'))
    dirs.push(dataDir)
    await writeFile(path.join(dataDir, 'bot-sessions.v1.json'), '{ definitely not json')
    const logs: Array<[string, Record<string, unknown>]> = []
    const service = new BotTaskService({ pluginDataDir: dataDir, logger: (event, fields) => logs.push([event, fields]) })
    services.push(service)
    expect(sessionOf(await service.handle('bot.session.get', { botId: 'muweave-manager', workspaceId: 'workspace-a' }))).toBeNull()
    expect(logs).toContainEqual(['bot_task.sessions_load_failed', { errorCode: 'SESSIONS_UNREADABLE' }])
  })

  it('rejects bindings for paused bots and never creates a sessionRef', async () => {
    const { service } = await makeService()
    const roster = await service.handle('bot.roster', {})
    const manager = (roster as { ok: true; data: { bots: Array<{ botId: string; revision: number }> } }).data.bots[0]!
    await service.handle('bot.pause', { botId: manager.botId, paused: true, expectedRevision: manager.revision })
    const response = await service.handle('bot.session.bind', { botId: manager.botId, workspaceId: 'workspace-a', sessionRef: 'session-a' })
    expect(response.ok).toBe(false)
    expect((response as { ok: false; error: { code: string } }).error.code).toBe('BOT_SESSION_UNAVAILABLE')
    expect(sessionOf(await service.handle('bot.session.get', { botId: manager.botId, workspaceId: 'workspace-a' }))).toBeNull()
  })
})
