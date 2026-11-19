import {
  mountSharedMuweaveHostRoutes,
  type CreatorHostServiceOptions,
  type DshHostContextLike,
} from '@yeisme/dsh-muweave-core'

export const name = '@yeisme/dsh-muweave-schedule'
export const inject = ['connection']

/** Thin host shell: the schedule RPC (list/plan/clear) lives in the shared `muweave-dsh` bus. */
export function apply(ctx: DshHostContextLike, config: CreatorHostServiceOptions = {}): void {
  mountSharedMuweaveHostRoutes(ctx, 'muweave-schedule', config)
}
