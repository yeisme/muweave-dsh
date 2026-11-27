import {
  mountSharedMuweaveHostRoutes,
  type CreatorHostServiceOptions,
  type DshHostContextLike,
} from '@yeisme/dsh-muweave-core'

export const name = '@yeisme/dsh-muweave-stage3d'
export const inject = ['connection']

/** Thin host shell: the 3D Stage RPC (`stage3d.scene.*`, `stage3d.snapshot.save`) lives in the shared `muweave-dsh` bus. */
export function apply(ctx: DshHostContextLike, config: CreatorHostServiceOptions = {}): void {
  mountSharedMuweaveHostRoutes(ctx, 'muweave-stage3d', config)
}
