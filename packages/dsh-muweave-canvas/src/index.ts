import {
  mountSharedMuweaveHostRoutes,
  type CreatorHostServiceOptions,
  type DshHostContextLike,
} from '@yeisme/dsh-muweave-core'

export const name = '@yeisme/dsh-muweave-canvas'
export const inject = ['connection']

/** Thin host shell: the canvas board RPC (`canvas.board.*`) lives in the shared `muweave-dsh` bus. */
export function apply(ctx: DshHostContextLike, config: CreatorHostServiceOptions = {}): void {
  mountSharedMuweaveHostRoutes(ctx, 'muweave-canvas', config)
}
