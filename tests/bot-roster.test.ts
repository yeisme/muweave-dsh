import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BotTaskService } from '../packages/dsh-muweave-core/src/bot-task/service'

const dirs: string[] = []
const services: BotTaskService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function service(logs: Array<[string, Record<string, unknown>]> = []): Promise<{ service: BotTaskService; dataDir: string }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'muweave-bot-roster-'))
  dirs.push(dataDir)
  const instance = new BotTaskService({ pluginDataDir: dataDir, logger: (event, fields) => logs.push([event, fields]) })
  services.push(instance)
  return { service: instance, dataDir }
}

type Bot = { botId: string; role: string; state: string; revision: number }
type RosterResponse = { ok: true; data: { bots: Bot[] } }
type BotResponse = { ok: true; data: { bot: Bot } }

function rosterOf(response: unknown): Bot[] {
  return (response as RosterResponse).data.bots
}
function botOf(response: unknown): Bot {
  return (response as BotResponse).data.bot
}

describe('bot roster', () => {
  it('bootstraps one manager on the first roster read', async () => {
    const { service: instance, dataDir } = await service()
    const response = await instance.handle('bot.roster', {}, 7)
    expect(response.ok).toBe(true)
    expect(rosterOf(response)).toEqual([expect.objectContaining({ botId: 'muweave-manager', role: 'manager', state: 'active', revision: 1 })])
    expect((await stat(path.join(dataDir, 'bots.v1.json'))).mode & 0o777).toBe(0o600)
  })

  it('pauses and resumes a bot through the reversible action', async () => {
    const { service: instance } = await service()
    const first = await instance.handle('bot.roster', {})
    const manager = rosterOf(first)[0]!
    const paused = await instance.handle('bot.pause', { botId: manager.botId, paused: true, expectedRevision: manager.revision })
    expect(botOf(paused).state).toBe('paused')
    expect(rosterOf(await instance.handle('bot.roster', {}))[0]!.state).toBe('paused')
    const resumed = await instance.handle('bot.pause', { botId: manager.botId, paused: false, expectedRevision: botOf(paused).revision })
    expect(botOf(resumed).state).toBe('active')
  })

  it('keeps the roster after constructing a new service', async () => {
    const { service: first, dataDir } = await service()
    const manager = rosterOf(await first.handle('bot.roster', {}))[0]!
    const paused = await first.handle('bot.pause', { botId: manager.botId, paused: true, expectedRevision: manager.revision })
    const pausedRevision = botOf(paused).revision
    first.dispose()
    const second = new BotTaskService({ pluginDataDir: dataDir })
    services.push(second)
    const restored = rosterOf(await second.handle('bot.roster', {}))[0]!
    expect(restored).toEqual(expect.objectContaining({ botId: manager.botId, state: 'paused', revision: pausedRevision }))
    expect((await readFile(path.join(dataDir, 'bots.v1.json'), 'utf8'))).not.toContain(dataDir)
  })

  it('starts with an empty roster and logs when the persisted file is corrupt', async () => {
    const logs: Array<[string, Record<string, unknown>]> = []
    const { service: instance, dataDir } = await service(logs)
    await writeFile(path.join(dataDir, 'bots.v1.json'), '{ definitely not json')
    const response = await instance.handle('bot.roster', {})
    expect(response.ok).toBe(true)
    expect(rosterOf(response)).toEqual([])
    expect(logs).toContainEqual(['bot_task.roster_load_failed', { errorCode: 'ROSTER_UNREADABLE' }])
  })
})
