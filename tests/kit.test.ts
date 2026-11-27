import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import { apply as applyKitHost, MUWEAVE_RUNTIME_SKILLS } from '@yeisme/dsh-muweave-kit'

/**
 * Locates the host's own `ptc.patch.yml` so the parity check follows the dsh actually installed,
 * not a hard-coded Homebrew path. Returns undefined when no host install is reachable.
 */
function findHostPtcPreset(): string | undefined {
  const presetRel = 'node_modules/@deepseek-ai/dsh-web-app/presets/ptc.patch.yml'
  const fromEnv = process.env.MUWEAVE_HOST_DSH_PRESET
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : undefined

  const roots: string[] = []
  try {
    const bin = execFileSync('sh', ['-c', 'command -v dsh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (bin) {
      // Walk up from the real binary until the package root (`package.json` name `@deepseek-ai/dsh`).
      let dir = path.dirname(realpathSync(bin))
      for (let i = 0; i < 6; i += 1) {
        const manifest = path.join(dir, 'package.json')
        if (existsSync(manifest)) {
          try {
            if (JSON.parse(readFileSync(manifest, 'utf8')).name === '@deepseek-ai/dsh') {
              roots.push(dir)
              break
            }
          } catch {
            // ignore malformed manifests and keep walking
          }
        }
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
      }
    }
  } catch {
    // no dsh on PATH: fall through to the conventional prefixes below
  }
  roots.push('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh', '/home/linuxbrew/.linuxbrew/lib/node_modules/@deepseek-ai/dsh')
  for (const root of roots) {
    const candidate = path.join(root, presetRel)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

describe('@yeisme/dsh-muweave-kit PTC preset parity, scoped runtime skills, and tools', () => {
  it('keeps preset-muweave-creator child rows aligned with the installed dsh ptc.patch.yml', async () => {
    const kitPatchPath = path.resolve(import.meta.dirname, '../packages/dsh-muweave-kit/cordis.patch.yml')
    const kitRaw = await readFile(kitPatchPath, 'utf8')
    // Strip YAML custom !!js tags only for structural id/name comparison
    const normalizedKit = kitRaw.replace(/!!js\s+/g, '')
    const parsedKit = YAML.parse(normalizedKit) as Array<{
      insert: Array<{ id: string; config?: { id?: string; plugins?: Array<{ id: string; name: string }> } }>
    }>
    const presetRow = parsedKit[0]!.insert.find((r) => r.id === 'preset-muweave-creator')
    expect(presetRow).toBeDefined()
    expect(presetRow!.config?.id).toBe('muweave-creator')

    const kitChildIds = (presetRow!.config?.plugins ?? []).map((p) => p.id)
    expect(kitChildIds).toContain('tool-executor-ptc')
    expect(kitChildIds).toContain('muweave-kit-agent')

    const hostPtcPath = findHostPtcPreset()
    if (hostPtcPath) {
      const hostRaw = (await readFile(hostPtcPath, 'utf8')).replace(/!!js\s+/g, '')
      const parsedHost = YAML.parse(hostRaw) as Array<{
        insert: Array<{ id: string; config: { plugins: Array<{ id: string; name: string }> } }>
      }>
      const hostPlugins = parsedHost[0]!.insert[0]!.config.plugins
      const hostIds = hostPlugins.map((p) => p.id)
      // Every upstream PTC plugin id must exist in the exact same order before our trailing `muweave-kit-agent` row
      expect(kitChildIds.slice(0, hostIds.length)).toEqual(hostIds)
    }
  })

  it('registers kebab-case creator skills and PTC tools ONLY when role === agent', async () => {
    const registeredSkills: string[] = []
    const registeredTools: string[] = []

    applyKitHost(
      {
        effect(fn) {
          fn()
        },
        inject(deps, cb) {
          if (deps.includes('skills')) {
            cb({
              effect(fn: () => void) {
                fn()
              },
              skills: {
                register(def: { name: string }) {
                  registeredSkills.push(def.name)
                  return () => undefined
                },
              },
            })
          }
          if (deps.includes('tools')) {
            cb({
              effect(fn: () => void) {
                fn()
              },
              tools: {
                register(def: { name: string }) {
                  registeredTools.push(def.name)
                  return () => undefined
                },
              },
            })
          }
        },
      },
      { role: 'agent' },
    )

    expect(registeredSkills).toEqual(MUWEAVE_RUNTIME_SKILLS.map((s) => s.name))
    expect(registeredSkills).toContain('muweave-cli-mcp-assist')
    for (const s of registeredSkills) {
      expect(s).toMatch(/^[a-z0-9-]+$/)
    }
    expect(registeredTools).toEqual([
      'muweave_bot_roster',
      'muweave_task_delegate',
      'muweave_task_status',
      'muweave_task_trace',
      'muweave_sync_bundle',
      'muweave_validate_eikona_spec',
      'muweave_capability_catalog',
      'muweave_capability_estimate',
      'muweave_job_request',
      'muweave_job_status',
      'muweave_schedule_list',
      'muweave_schedule_plan',
      'muweave_schedule_clear',
      'muweave_drama_shots_list',
      'muweave_drama_review_set',
      'muweave_drama_export',
      'muweave_project_diagnose',
    ])
    expect(registeredTools.some((n) => /approve/i.test(n))).toBe(false)
  })

  it('agent job_request yields waiting_approval and never calls the owner submit', async () => {
    const { mkdtemp, mkdir, rm } = await import('node:fs/promises')
    const os = await import('node:os')
    const root = await mkdtemp(path.join(os.tmpdir(), 'muweave-kit-'))
    const ws = path.join(root, 'ws')
    await mkdir(ws, { recursive: true })
    const calls: string[][] = []
    const runner = async (bin: string, args: readonly string[]) => {
      calls.push([bin, ...args])
      if (args[0] === '--version') return { exitCode: 0, stdout: '1.0.0\n', stderr: '' }
      if (args.includes('--dry-run')) return { exitCode: 0, stdout: JSON.stringify({ data: { estimated_usd: 0.4 } }), stderr: '' }
      return { exitCode: 2, stdout: '', stderr: 'unexpected' }
    }
    const g = globalThis as Record<string, unknown>
    const saved = g.__YEISME_MUWEAVE_DSH_HOST_BUS__
    delete g.__YEISME_MUWEAVE_DSH_HOST_BUS__
    const tools = new Map<string, { execute(a: unknown): Promise<any>; description: string }>()
    try {
      applyKitHost(
        {
          effect(fn) {
            fn()
          },
          inject(deps, cb) {
            if (deps.includes('tools')) {
              cb({
                effect(fn: () => void) {
                  fn()
                },
                tools: {
                  register(def: { name: string; description: string; execute(a: unknown): Promise<any> }) {
                    tools.set(def.name, def)
                    return () => undefined
                  },
                },
              })
            }
          },
        },
        { role: 'agent', runner, pluginDataDir: path.join(root, 'data'), defaultWorkspaceDir: ws, workspaceRoots: [ws] } as never,
      )
      for (const t of ['muweave_capability_catalog', 'muweave_capability_estimate', 'muweave_job_request', 'muweave_job_status']) {
        expect(tools.get(t)!.description).toMatch(/UI/)
        expect(tools.get(t)!.description).toMatch(/bash/)
      }
      const cat = await tools.get('muweave_capability_catalog')!.execute({})
      expect(cat.ok).toBe(true)
      expect(cat.paidEnabled).toBe(false)
      expect(cat.available.map((c: { capabilityId: string }) => c.capabilityId)).toContain('eikona.image.generate')
      const est = await tools.get('muweave_capability_estimate')!.execute({ capabilityId: 'eikona.image.generate', input: { prompt: 'a lantern' } })
      expect(est.ok).toBe(true)
      const job = await tools.get('muweave_job_request')!.execute({ estimateId: est.estimateId })
      expect(job.status).toBe('waiting_approval')
      expect(job.message).toContain('等待用户在生成台批准')
      const again = await tools.get('muweave_job_request')!.execute({ estimateId: est.estimateId })
      expect(again.jobId).toBe(job.jobId)
      const st = await tools.get('muweave_job_status')!.execute({ jobId: job.jobId })
      expect(st.jobs[0].status).toBe('waiting_approval')
      expect(calls.some((c) => c.includes('--approve-cost') || c.includes('--background'))).toBe(false)
      expect(tools.has('muweave_job_approve')).toBe(false)
    } finally {
      ;(g.__YEISME_MUWEAVE_DSH_HOST_BUS__ as { service?: { dispose(): void } } | undefined)?.service?.dispose()
      g.__YEISME_MUWEAVE_DSH_HOST_BUS__ = saved
      await rm(root, { recursive: true, force: true })
    }
  })
})
