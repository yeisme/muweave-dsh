import { rpcFail } from '../protocol'
import type { RpcEnvelope } from '../protocol'
import type { BotTaskLogger } from './protocol'

/**
 * Roster: which bots exist, what they may do, whether the user paused them.
 *
 * Owned by its own worktree during P1: implement here, do not edit the sibling files.
 */
export interface BotRosterDeps {
  /** Absolute path of the plugin data directory. Ledgers live here, never in .muweave/. */
  pluginDataDir: string
  logger?: BotTaskLogger
}

export class BotRoster {
  constructor(private readonly deps: BotRosterDeps) {}

  async handle(action: string, _payload: Record<string, unknown>, generation = 0): Promise<RpcEnvelope<unknown>> {
    this.deps.logger?.('bot_task.roster_not_implemented', { action })
    return rpcFail(generation, 'muweave/not_implemented', `${action} is not implemented yet`)
  }

  dispose(): void {}
}
