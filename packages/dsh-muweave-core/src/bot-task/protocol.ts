/**
 * Bot roster, task ledger and event trace wire contract (P1).
 * Zero Node.js imports — shared between host half, client half and the kit agent tools.
 *
 * Kept out of protocol.ts / capability-protocol.ts so roster, task and event work can land in
 * separate files without every change touching the host's dispatch switch.
 */

export const BOT_RPC_ACTIONS = ['bot.roster', 'bot.get', 'bot.pause'] as const
export const TASK_RPC_ACTIONS = ['task.create', 'task.list', 'task.get', 'task.cancel', 'task.trace'] as const
export const EVENT_RPC_ACTIONS = ['event.list'] as const

export const BOT_TASK_RPC_ACTIONS = [
  ...BOT_RPC_ACTIONS,
  ...TASK_RPC_ACTIONS,
  ...EVENT_RPC_ACTIONS,
] as const

export type BotRpcAction = (typeof BOT_RPC_ACTIONS)[number]
export type TaskRpcAction = (typeof TASK_RPC_ACTIONS)[number]
export type EventRpcAction = (typeof EVENT_RPC_ACTIONS)[number]
export type BotTaskRpcAction = (typeof BOT_TASK_RPC_ACTIONS)[number]

export function isBotTaskAction(action: string): action is BotTaskRpcAction {
  return (BOT_TASK_RPC_ACTIONS as readonly string[]).includes(action)
}

/** Structured logger supplied by the host, same shape the capability layer and JobEngine use. */
export type BotTaskLogger = (event: string, fields: Record<string, unknown>) => void
