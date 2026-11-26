import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteJson, findPlaintextCredential } from '@yeisme/muweave-bundle'
import { rpcFail, rpcOk, type RpcEnvelope } from '../protocol'
import type { BotTaskLogger } from './protocol'

export interface BotRosterDeps {
  /** Absolute path of the plugin data directory. Ledgers live here, never in .muweave/. */
  pluginDataDir: string
  logger?: BotTaskLogger
}

const ref = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/).refine(value => !findPlaintextCredential(value))
const revision = z.int().positive()
const botRecord = z.object({
  botId: ref,
  role: z.enum(['manager', 'worker']),
  presetRef: ref,
  capabilityGrants: z.array(ref),
  ownerScopes: z.array(ref),
  workspaceScopes: z.array(z.union([ref, z.literal('*')])),
  budgetEnvelope: z.object({ unit: z.enum(['none', 'usd', 'credits']), amount: z.number().nonnegative().optional() }),
  parentBotId: ref.optional(),
  sessionRef: ref.optional(),
  state: z.enum(['active', 'paused', 'retired']),
  revision,
})

const pauseReceipt = z.object({
  digest: z.hash('sha256'),
  state: z.enum(['active', 'paused']),
  revision,
})
const ledgerSchema = z.object({
  schema: z.literal('muweave.bots.v1'),
  bots: z.array(botRecord).max(7).refine(bots =>
    bots.filter(bot => bot.role === 'manager').length === 1 && new Set(bots.map(bot => bot.botId)).size === bots.length),
  pauses: z.record(z.hash('sha256'), pauseReceipt).default({}),
})
type Ledger = z.infer<typeof ledgerSchema>
const manager: z.infer<typeof botRecord> = {
  botId: 'muweave-manager', role: 'manager', presetRef: 'muweave-creator',
  capabilityGrants: [], ownerScopes: [], workspaceScopes: ['*'], budgetEnvelope: { unit: 'none' },
  state: 'active', revision: 1,
}

const pauseParams = z.object({
  paused: z.boolean().optional(),
  expectedRevision: revision.optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
})
function digest(values: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}

// Host services sharing a data directory must check revisions and publish their writes in order.
const transactions = new Map<string, Promise<RpcEnvelope<unknown>>>()

export class BotRoster {
  private readonly file: string

  constructor(private readonly deps: BotRosterDeps) {
    this.file = path.resolve(deps.pluginDataDir, 'bots.v1.json')
  }

  private async load(): Promise<Ledger> {
    const empty: Ledger = { schema: 'muweave.bots.v1', bots: [], pauses: {} }
    try {
      return ledgerSchema.parse(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const initial = { ...empty, bots: [manager] }
        try {
          await atomicWriteJson(this.file, initial)
          return initial
        } catch {
          this.deps.logger?.('bot_task.roster_load_failed', { errorCode: 'BOOTSTRAP_FAILED' })
        }
      } else {
        this.deps.logger?.('bot_task.roster_load_failed', { errorCode: 'ROSTER_UNREADABLE' })
      }
      return empty
    }
  }

  async handle(action: string, payload: Record<string, unknown>, generation = 0): Promise<RpcEnvelope<unknown>> {
    const previous = transactions.get(this.file) ?? Promise.resolve()
    const run = previous.then(() => this.dispatch(action, payload, generation))
      .catch(() => rpcFail(generation, 'muweave/roster_store_failed', 'Could not access the bot roster', { retryable: true }))
    transactions.set(this.file, run)
    try {
      return await run
    } finally {
      if (transactions.get(this.file) === run) transactions.delete(this.file)
    }
  }

  private async dispatch(action: string, payload: Record<string, unknown>, generation: number): Promise<RpcEnvelope<unknown>> {
    if (action !== 'bot.roster' && action !== 'bot.get' && action !== 'bot.pause') {
      return rpcFail(generation, 'muweave/unknown_action', 'Unknown bot action')
    }
    const workspace = ref.optional().safeParse(payload.workspaceId)
    if (!workspace.success) return rpcFail(generation, 'muweave/invalid_workspace', 'Expected a workspace identifier')

    const ledger = await this.load()
    // Without a workspace ID only globally scoped bots can be addressed.
    const bots = ledger.bots.filter(bot => bot.workspaceScopes.includes('*') ||
      (workspace.data !== undefined && bot.workspaceScopes.includes(workspace.data)))
    if (action === 'bot.roster') return rpcOk(generation, { bots: bots.filter(bot => bot.state !== 'retired') })

    if (!ref.safeParse(payload.botId).success) return rpcFail(generation, 'muweave/invalid_bot', 'Expected a bot identifier')
    const bot = bots.find(item => item.botId === payload.botId)
    if (!bot) return rpcFail(generation, 'BOT_NOT_FOUND', 'Bot not found in this workspace')
    if (action === 'bot.get') return rpcOk(generation, { bot })

    const params = pauseParams.safeParse(payload)
    if (!params.success) return rpcFail(generation, 'muweave/invalid_pause', 'Invalid pause request')
    const { paused, expectedRevision, idempotencyKey } = params.data
    const key = idempotencyKey && digest([workspace.data, idempotencyKey])
    const requestDigest = digest([bot.botId, paused, expectedRevision])
    if (key && ledger.pauses[key]) {
      const receipt = ledger.pauses[key]
      if (receipt.digest !== requestDigest) return rpcFail(generation, 'IDEMPOTENCY_CONFLICT', 'Key already used for another request')
      return rpcOk(generation, { bot: { ...bot, state: receipt.state, revision: receipt.revision } })
    }
    if (expectedRevision !== undefined && bot.revision !== expectedRevision) {
      return rpcFail(generation, 'muweave/revision_conflict', 'Bot revision changed', { details: { currentRevision: bot.revision } })
    }
    if (bot.state === 'retired') return rpcFail(generation, 'BOT_RETIRED', 'A retired bot cannot be paused or resumed')

    const shouldPause = paused ?? (bot.state === 'active')
    const state = shouldPause ? 'paused' : 'active'
    if (state === bot.state && !key) return rpcOk(generation, { bot })
    if (state !== bot.state) {
      if (!Number.isSafeInteger(bot.revision + 1)) return rpcFail(generation, 'muweave/revision_exhausted', 'Revision limit reached')
      bot.state = state
      bot.revision += 1
    }
    if (key) ledger.pauses[key] = { digest: requestDigest, state, revision: bot.revision }
    await atomicWriteJson(this.file, ledger)
    return rpcOk(generation, { bot })
  }

  dispose(): void {}
}
