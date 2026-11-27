import {
  mountSharedMuweaveHostRoutes,
  type CreatorHostServiceOptions,
  type DshHostContextLike,
} from '@yeisme/dsh-muweave-core'

export const name = '@yeisme/dsh-muweave-assets'
export const inject = ['connection']

/** Thin host shell: element & bible RPCs live in the shared `muweave-dsh` bus. */
export function apply(ctx: DshHostContextLike, config: CreatorHostServiceOptions = {}): void {
  mountSharedMuweaveHostRoutes(ctx, 'muweave-assets', config)
}
