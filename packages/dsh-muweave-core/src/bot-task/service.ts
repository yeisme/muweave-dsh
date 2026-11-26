import { isBotTaskAction } from './protocol'
import { rpcFail } from '../protocol'
import { BotRoster } from './roster'
import { TaskLedger } from './tasks'
import { EventLog } from './events'
import type { BotTaskLogger } from './protocol'
import type { RpcEnvelope } from '../protocol'

/**
 * Dispatch for the bot/task/event RPC families.
 *
 * Mirrors CapabilityService: the host keeps one short-circuit line in dispatchRpcAction and this
 * class owns the routing. Keeping it here is what lets roster, task and event land in parallel
 * worktrees — each owns its own file and only this file is shared (trivial to rebase).
 */
export interface BotTaskServiceDeps {
  /** Absolute path of the plugin data directory; ledgers live under it, never in .muweave/. */
  pluginDataDir: string
  logger?: BotTaskLogger
}

export class BotTaskService {
  readonly roster: BotRoster
  readonly tasks: TaskLedger
  readonly events: EventLog

  constructor(private readonly deps: BotTaskServiceDeps) {
    this.roster = new BotRoster({ pluginDataDir: deps.pluginDataDir, logger: deps.logger })
    this.tasks = new TaskLedger({ pluginDataDir: deps.pluginDataDir, logger: deps.logger })
    this.events = new EventLog({ pluginDataDir: deps.pluginDataDir, logger: deps.logger })
  }

  isBotTaskAction(action: string): boolean {
    return isBotTaskAction(action)
  }

  async handle(action: string, payload: Record<string, unknown>, generation = 0): Promise<RpcEnvelope<unknown>> {
    if (action.startsWith('bot.')) return this.roster.handle(action, payload, generation)
    if (action.startsWith('task.')) return this.tasks.handle(action, payload, generation)
    if (action.startsWith('event.')) return this.events.handle(action, payload, generation)
    return rpcFail(generation, 'muweave/unknown_action', `${action} is not a bot/task/event action`)
  }

  dispose(): void {
    this.roster.dispose()
    this.tasks.dispose()
    this.events.dispose()
  }
}
