import { rpcFail } from '../protocol'
import type { RpcEnvelope } from '../protocol'
import type { BotTaskLogger } from './protocol'

/**
 * Task ledger: the unit of orchestration. A task owns 0..N jobs and outlives any single job.
 *
 * Owned by its own worktree during P1: implement here, do not edit the sibling files.
 */
export interface TaskLedgerDeps {
  logger?: BotTaskLogger
}

export class TaskLedger {
  constructor(private readonly deps: TaskLedgerDeps = {}) {}

  async handle(action: string, _payload: Record<string, unknown>, generation = 0): Promise<RpcEnvelope<unknown>> {
    this.deps.logger?.('bot_task.tasks_not_implemented', { action })
    return rpcFail(generation, 'muweave/not_implemented', `${action} is not implemented yet`)
  }

  dispose(): void {}
}
