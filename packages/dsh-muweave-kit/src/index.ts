import { createHash } from 'node:crypto'
import {
  getSharedCreatorHostService,
  mountSharedMuweaveHostRoutes,
  type CreatorHostServiceOptions,
  type DshHostContextLike,
} from '@yeisme/dsh-muweave-core'
import { validateEikonaGenerationSpec } from '@yeisme/muweave-bundle'
import { registerBotTools } from './bot-tools'

export const name = '@yeisme/dsh-muweave-kit'
// Top-level inject stays empty so this module can run both at root (`role: 'host'`) AND inside
// `@deepseek-ai/dsh-agent-preset` (`role: 'agent'`, where root `connection` is absent).
export const inject: readonly string[] = []

export interface KitRuntimeSkillDef {
  name: string
  description: string
  whenToUse: string
  content: string
  source: 'runtime'
}

export const MUWEAVE_RUNTIME_SKILLS: readonly KitRuntimeSkillDef[] = [
  {
    name: 'muweave-drama-router',
    description: 'Select the narrowest AI drama/script production stage, context pack, and owner CLI contract.',
    whenToUse: 'Use when planning or executing short-drama, manga-drama, screenplay, or storyboard workflows.',
    source: 'runtime',
    content: [
      '# MuWeave Drama Router (DSH Runtime)',
      '',
      '1. Canonical truth stays in `cli/eikona` (visuals), `cli/auctra` (screenplay), and `agent/scaena` (storyboard & assets).',
      '2. `.muweave/` is a CLI-authored materialized bundle (`muweave-bundle sync`). Never hand-edit `.muweave/*.json`, `.eikona/**`, `.auctra/**`, or `.scaena/**`.',
      '3. Check workspace markers (`muweave-bundle doctor --json`) before invoking owner CLIs.',
      '4. For paid generation use only `muweave_capability_catalog` -> `muweave_capability_estimate` -> `muweave_job_request` -> `muweave_job_status`. The job waits for the user to approve in the 生成台 UI; never run owner generate commands (`eikona generate`, `sonora ... generate`) through bash and never claim a job was approved.',
    ].join('\n'),
  },
  {
    name: 'muweave-eikona-visual',
    description: 'Generate, inspect, and hand off Eikona character/scene visual elements using Sunburst pixel rules.',
    whenToUse: 'Use when generating character turnarounds, scene references, or inspecting Eikona review packets.',
    source: 'runtime',
    content: [
      '# MuWeave Eikona Visual Skill',
      '',
      '- Default live paid model: `openai/gpt-image-2.5-sunburst` on channel `noemi`.',
      '- Always pass `--quality high` and pixel `--size WxH` (e.g. `1152x2048 --aspect 9:16`). Never pass `--size 2k` or bare model names.',
      '- To generate images, estimate with `muweave_capability_estimate` (`eikona.image.generate`) then `muweave_job_request`; tell the user "等待用户在生成台批准". Do not call `eikona generate` from bash.',
      '- After `eikona review packet` or `eikona assets handoff`, run `muweave-bundle sync --json` to refresh `.muweave/`.',
    ].join('\n'),
  },
  {
    name: 'muweave-script-scene',
    description: 'Author and refine Auctra screenplay Scene Cards, beats, and candidate diffs without overwriting canon.',
    whenToUse: 'Use when drafting or revising screenplay scenes, 3-second hooks, or dramatic turns.',
    source: 'runtime',
    content: [
      '# MuWeave Script Scene Skill',
      '',
      '- Verify `.auctra/` exists before running `auctra screenplay room` commands.',
      '- All AI revisions remain candidates/drafts with `expectedRevision` and `idempotencyKey` until human review acceptance.',
    ].join('\n'),
  },
  {
    name: 'muweave-storyboard-breakdown',
    description: 'Inspect Scaena summary storyboards, 4-axis asset readiness, and edit timeline alignment.',
    whenToUse: 'Use when checking shot lists, character/location readiness axes, or episode duration budgets.',
    source: 'runtime',
    content: [
      '# MuWeave Storyboard Breakdown Skill',
      '',
      '- Verify `.scaena/project.json` exists before running `scaena` commands so empty directories are never initialized.',
      '- Use `scaena storyboard table show <ref> --view summary --json --no-remote` and `--sort=ref_asc` on `asset list`.',
    ].join('\n'),
  },
  {
    name: 'muweave-schedule-plan',
    description: 'Plan publishing dates for scenes, drafts, and shots on the MuWeave schedule board.',
    whenToUse: 'Use when the user asks what to publish when, or wants a week/month of slots filled or re-balanced.',
    source: 'runtime',
    content: [
      '# MuWeave Schedule Plan Skill',
      '',
      '- The board is local planning data (`~/.dsh/plugin-data/muweave-dsh/schedule.v1.json`), not domain truth: `.muweave/` still owns the elements.',
      '- Read first: `muweave_schedule_list`. Then write with `muweave_schedule_plan` (`ref`, `date` as `YYYY-MM-DD`, optional `label`/`kind`/`note`).',
      '- Scheduling spends nothing and is reversible, so it needs no UI approval — unlike paid generation, which only the user approves in 生成台.',
      '- One reference holds exactly one date: re-planning moves it. `muweave_schedule_clear` removes it.',
      '- Prefer `scene:`/`shot:`/element ids already present in `.muweave/`; do not invent refs.',
    ].join('\n'),
  },
]

export interface MuweaveKitConfig extends CreatorHostServiceOptions {
  role?: 'host' | 'agent'
}

export function apply(ctx: DshHostContextLike, config: MuweaveKitConfig = {}): void {
  const role = config.role ?? 'host'

  if (role === 'host') {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['connection'], (sub) => {
        const subHostCtx: DshHostContextLike = {
          connection: sub.connection as DshHostContextLike['connection'],
          effect: (sub.effect as DshHostContextLike['effect']) ?? ctx.effect.bind(ctx),
        }
        mountSharedMuweaveHostRoutes(subHostCtx, 'muweave-kit', config)
      })
    } else if (ctx.connection?.fetch) {
      mountSharedMuweaveHostRoutes(ctx, 'muweave-kit', config)
    }
    return
  }

  // Agent preset child row (`role: 'agent'`): register scoped runtime skills & PTC tools ONLY in `muweave-creator` preset!
  const service = getSharedCreatorHostService(config)

  ctx.inject?.(['skills'], (sub) => {
    const skillsSvc = sub.skills as { register(def: KitRuntimeSkillDef): () => void } | undefined
    if (!skillsSvc?.register) return
    const subCtx = sub as { effect?: (fn: () => () => void, label?: string) => void }
    for (const skill of MUWEAVE_RUNTIME_SKILLS) {
      subCtx.effect?.(() => skillsSvc.register(skill), `muweave-kit: skill ${skill.name}`)
    }
  })

  ctx.inject?.(['tools'], (sub) => {
    const toolsSvc = sub.tools as { register(def: Record<string, unknown>): () => void } | undefined
    if (!toolsSvc?.register) return
    const subCtx = sub as { effect?: (fn: () => () => void, label?: string) => void }
    registerBotTools(toolsSvc, subCtx.effect)

    subCtx.effect?.(
      () =>
        toolsSvc.register({
          name: 'muweave_sync_bundle',
          description: 'Synchronize bound Eikona, Auctra, Scaena, and .pi elements into the local .muweave/ materialized bundle.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          output: {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                revision: { type: 'number' },
                total: { type: 'number' },
              },
              required: ['ok', 'revision', 'total'],
              additionalProperties: false,
            },
            render(v: { ok: boolean; revision: number; total: number }) {
              return `Synced .muweave/ bundle (revision ${v.revision}, total elements ${v.total})`
            },
          },
          async execute() {
            const res = await service.handleRpcAction('bundle.sync', {})
            if (!res.ok) return { ok: false, revision: 0, total: 0 }
            const idx = (res.data as { index: { revision: number; counts: { total: number } } }).index
            return { ok: true, revision: idx.revision, total: idx.counts.total }
          },
        }),
      'muweave-kit: tool muweave_sync_bundle',
    )

    subCtx.effect?.(
      () =>
        toolsSvc.register({
          name: 'muweave_validate_eikona_spec',
          description: 'Validate Eikona image generation model, pixel size WxH, and quality against Sunburst rules.',
          parameters: {
            type: 'object',
            properties: {
              model: { type: 'string', description: 'Slash-form model ref, e.g. openai/gpt-image-2.5-sunburst' },
              size: { type: 'string', description: 'Pixel size WxH, e.g. 1152x2048' },
              quality: { type: 'string', description: 'Quality tier, e.g. high' },
            },
            required: ['model', 'size'],
            additionalProperties: false,
          },
          output: {
            schema: {
              type: 'object',
              properties: {
                valid: { type: 'boolean' },
                code: { type: 'string' },
                message: { type: 'string' },
              },
              required: ['valid', 'code', 'message'],
              additionalProperties: false,
            },
            render(v: { valid: boolean; code: string; message: string }) {
              return v.valid ? `Valid Eikona spec: ${v.message}` : `Invalid Eikona spec [${v.code}]: ${v.message}`
            },
          },
          async execute(args: { model: string; size: string; quality?: string }) {
            const check = validateEikonaGenerationSpec(args)
            if (check.ok) {
              return {
                valid: true,
                code: 'ok',
                message: `${check.normalized.model} ${check.normalized.size} quality=${check.normalized.quality}`,
              }
            }
            return { valid: false, code: check.code, message: check.message }
          },
        }),
      'muweave-kit: tool muweave_validate_eikona_spec',
    )

    const reg = (name: string, def: Record<string, unknown>, execute: (args: any) => Promise<unknown>): void => {
      subCtx.effect?.(() => toolsSvc.register({ name, ...def, execute }), `muweave-kit: tool ${name}`)
    }
    const NO_BASH = ' Approval only happens in the MuWeave 生成台 UI by the user; the agent cannot approve and must not try to run owner generate commands through bash.'
    const fail = (res: { error?: { code?: string; message?: string } }) => ({ ok: false, code: res.error?.code ?? 'error', message: res.error?.message ?? 'failed' })
    const jobLine = (j: Record<string, any>) => {
      const slots = (j.slots ?? []) as Array<{ status: string }>
      const done = slots.filter((x) => x.status === 'done').length
      return { jobId: j.jobId, capabilityId: j.capabilityId, title: j.title, status: j.status, slotsDone: done, slotsTotal: slots.length, nextAction: j.nextAction }
    }
    const jsonOut = (v: unknown) => JSON.stringify(v)

    reg('muweave_capability_catalog', {
      description: 'List creator capabilities (available and unavailable with reasons) and whether paid generation is enabled on this host.' + NO_BASH,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'object' }, render: jsonOut },
    }, async () => {
      const res = await service.handleRpcAction('capability.catalog', {})
      if (!res.ok) return fail(res as never)
      const d = res.data as { paidEnabled: boolean; capabilities: Array<Record<string, any>> }
      const pick = (c: Record<string, any>) => ({ capabilityId: c.capabilityId, title: c.title, stage: c.stage, costClass: c.costClass, defaultSlots: c.defaultSlots, inputs: (c.inputs ?? []).map((i: any) => i.name), ...(c.unavailableReason ? { reason: c.unavailableReason } : {}) })
      return {
        ok: true,
        paidEnabled: d.paidEnabled,
        available: d.capabilities.filter((c) => c.available).map(pick),
        unavailable: d.capabilities.filter((c) => !c.available).map(pick),
      }
    })

    reg('muweave_capability_estimate', {
      description: 'Zero-cost estimate for a capability: returns estimateId, plan lines, estimate and suggested ceiling. Creates nothing and spends nothing.' + NO_BASH,
      parameters: {
        type: 'object',
        properties: {
          capabilityId: { type: 'string', description: 'e.g. eikona.image.generate' },
          input: { type: 'object', description: 'Field values from the catalog inputs, e.g. {"prompt": "..."}' },
          slots: { type: 'number' },
          anchor: { type: 'object', description: 'Optional {episodeRef, sceneRef, shotRef, characterRefs}' },
        },
        required: ['capabilityId', 'input'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object' }, render: jsonOut },
    }, async (args: { capabilityId: string; input: Record<string, unknown>; slots?: number; anchor?: Record<string, unknown> }) => {
      const res = await service.handleRpcAction('capability.estimate', { capabilityId: args.capabilityId, input: args.input, ...(args.slots ? { slots: args.slots } : {}), ...(args.anchor ? { anchor: args.anchor } : {}) })
      if (!res.ok) return fail(res as never)
      const e = (res.data as { estimate: Record<string, any> }).estimate
      return { ok: true, estimateId: e.estimateId, planLines: e.planLines, estimate: e.estimate, suggestedCeiling: e.suggestedCeiling, costClass: e.costClass, slots: e.slots, expiresAt: e.expiresAt }
    })

    reg('muweave_job_request', {
      description: 'Create a generation job from an estimateId. The job is created in waiting_approval and nothing is submitted to the owner. Tell the user: 等待用户在生成台批准.' + NO_BASH,
      parameters: { type: 'object', properties: { estimateId: { type: 'string' } }, required: ['estimateId'], additionalProperties: false },
      output: { schema: { type: 'object' }, render: jsonOut },
    }, async (args: { estimateId: string }) => {
      const idempotencyKey = `agent-${createHash('sha256').update(String(args.estimateId)).digest('hex').slice(0, 24)}`
      const res = await service.requestJobFromAgent({ estimateId: args.estimateId, idempotencyKey })
      if (!res.ok) return fail(res as never)
      const j = res.data as Record<string, any>
      return { ok: true, jobId: j.jobId, status: j.status, message: '等待用户在生成台批准' }
    })

    reg('muweave_job_status', {
      description: 'Read status and slot progress of one job (jobId) or the recent jobs of the workspace.' + NO_BASH,
      parameters: { type: 'object', properties: { jobId: { type: 'string' } }, additionalProperties: false },
      output: { schema: { type: 'object' }, render: jsonOut },
    }, async (args: { jobId?: string }) => {
      if (args.jobId) {
        const res = await service.handleRpcAction('job.get', { jobId: args.jobId })
        if (!res.ok) return fail(res as never)
        return { ok: true, jobs: [jobLine((res.data as { job: Record<string, any> }).job)] }
      }
      const res = await service.handleRpcAction('job.list', {})
      if (!res.ok) return fail(res as never)
      return { ok: true, jobs: (res.data as { jobs: Array<Record<string, any>> }).jobs.slice(0, 20).map(jobLine) }
    })

    // Publishing board: local, reversible, spends nothing — so the agent may write it directly.
    const boardOut = (res: { ok: boolean; data?: unknown; error?: { code?: string; message?: string } }) => {
      if (!res.ok) return fail(res as never)
      const board = res.data as { entries: Array<Record<string, any>>; updatedAt: string }
      return { ok: true, entries: board.entries, updatedAt: board.updatedAt, total: board.entries.length }
    }

    reg('muweave_schedule_list', {
      description: 'List the publishing schedule board (one row per .muweave/ reference: ref, label, kind, date YYYY-MM-DD, note). Optionally filter by from/to dates.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Inclusive start day, YYYY-MM-DD' },
          to: { type: 'string', description: 'Inclusive end day, YYYY-MM-DD' },
        },
        additionalProperties: false,
      },
      output: { schema: { type: 'object' }, render: jsonOut },
    }, async (args: { from?: string; to?: string }) => {
      const res = await service.handleRpcAction('schedule.list', {})
      if (!res.ok) return fail(res as never)
      const board = res.data as { entries: Array<Record<string, any>>; updatedAt: string }
      const entries = board.entries.filter((e) => {
        const date = String(e.date ?? '')
        if (args.from && date < args.from) return false
        if (args.to && date > args.to) return false
        return true
      })
      return { ok: true, entries, updatedAt: board.updatedAt, total: entries.length }
    })

    reg('muweave_schedule_plan', {
      description: 'Plan one .muweave/ reference on a publishing day (YYYY-MM-DD). One reference holds exactly one date; planning again moves it. Local, reversible, spends nothing.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element id, or a bundle ref such as scene:ep01:s01' },
          date: { type: 'string', description: 'Local calendar day, YYYY-MM-DD' },
          label: { type: 'string', description: 'Display title; defaults to the ref' },
          kind: { type: 'string', description: 'Element kind or ref family, e.g. auctra.scene_card' },
          note: { type: 'string', description: 'One line about what matters that day' },
        },
        required: ['ref', 'date'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object' }, render: jsonOut },
    }, async (args: { ref: string; date: string; label?: string; kind?: string; note?: string }) => {
      const res = await service.handleRpcAction('schedule.plan', { ...args })
      return boardOut(res as never)
    })

    reg('muweave_schedule_clear', {
      description: 'Remove one reference from the publishing schedule board.',
      parameters: {
        type: 'object',
        properties: { ref: { type: 'string', description: 'The ref to unschedule' } },
        required: ['ref'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object' }, render: jsonOut },
    }, async (args: { ref: string }) => {
      const res = await service.handleRpcAction('schedule.clear', { ref: args.ref })
      return boardOut(res as never)
    })
  })
}
