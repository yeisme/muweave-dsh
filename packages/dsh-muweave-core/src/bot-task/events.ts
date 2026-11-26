import { rpcFail } from '../protocol'
import type { RpcEnvelope } from '../protocol'
import type { BotTaskLogger } from './protocol'

/**
 * Event trace: what happened behind a task, without prompts, credentials or absolute paths.
 *
 * Owned by its own worktree during P1: implement here, do not edit the sibling files.
 */
export interface EventLogDeps {
  /** Absolute path of the plugin data directory. Ledgers live here, never in .muweave/. */
  pluginDataDir: string
  logger?: BotTaskLogger
}

export class EventLog {
  constructor(private readonly deps: EventLogDeps) {}

  async handle(action: string, _payload: Record<string, unknown>, generation = 0): Promise<RpcEnvelope<unknown>> {
    this.deps.logger?.('bot_task.events_not_implemented', { action })
    return rpcFail(generation, 'muweave/not_implemented', `${action} is not implemented yet`)
  }

  dispose(): void {}
}
