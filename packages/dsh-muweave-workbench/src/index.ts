import {
  mountSharedMuweaveHostRoutes,
  type CreatorHostServiceOptions,
  type DshHostContextLike,
} from '@yeisme/dsh-muweave-core'

export const name = '@yeisme/dsh-muweave-workbench'
export const inject = ['connection']

export function apply(ctx: DshHostContextLike, config: CreatorHostServiceOptions = {}): void {
  const service = mountSharedMuweaveHostRoutes(ctx, 'muweave-workbench', config)

  // Optional model tool registration in sub-fiber when tools service exists
  ctx.inject?.(['tools'], (sub) => {
    const toolsSvc = sub.tools as
      | {
          register(def: Record<string, unknown>): () => void
        }
      | undefined
    if (!toolsSvc?.register) return
    const disposeTool = toolsSvc.register({
      name: 'muweave_bundle_overview',
      description:
        'Read the current .muweave/ materialized drama workspace bundle summary (Eikona visual elements, Auctra script elements, Scaena storyboard elements, and Pi/DSH artifacts). Read-only.',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: ['eikona', 'script', 'drama', 'harness'],
            description: 'Optional domain filter',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            revision: { type: 'number' },
            totalElements: { type: 'number' },
            titles: { type: 'array', items: { type: 'string' } },
          },
          required: ['projectId', 'revision', 'totalElements', 'titles'],
          additionalProperties: false,
        },
        render(value: { projectId: string; revision: number; totalElements: number; titles: string[] }) {
          return `MuWeave Bundle ${value.projectId} (rev ${value.revision}): ${value.totalElements} elements [${value.titles.join(', ')}]`
        },
        presentationMeta(_args: Record<string, unknown>, value: { projectId: string; revision: number; totalElements: number }) {
          return {
            projectId: value.projectId,
            revision: value.revision,
            totalElements: value.totalElements,
          }
        },
      },
      isConcurrencySafe() {
        return true
      },
      async execute(args: { domain?: string }) {
        const res = await service.handleRpcAction('bundle.elements.list', {
          ...(args.domain ? { domain: args.domain } : {}),
        })
        if (!res.ok) {
          return { projectId: 'uninitialized', revision: 0, totalElements: 0, titles: [] }
        }
        const data = res.data as { projectId: string; revision: number; elements: Array<{ title: string }> }
        await service.recordDshToolArtifact(undefined, {
          artifactId: `overview_${Date.now()}`,
          toolName: 'muweave_bundle_overview',
          title: `原件快照读取 (${args.domain ?? 'all'})`,
          status: 'completed',
          summary: { revision: data.revision, count: data.elements.length },
        })
        return {
          projectId: data.projectId,
          revision: data.revision,
          totalElements: data.elements.length,
          titles: data.elements.slice(0, 12).map((e) => e.title),
        }
      },
    })
    const subCtx = sub as { effect?: (fn: () => () => void, label?: string) => void }
    subCtx.effect?.(() => disposeTool, 'muweave-workbench: overview tool')
  })
}
