import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { putCasBlob, type CliRunner } from '@yeisme/muweave-bundle'
import { containsHostPath, findPlaintextCredential, stripHostPaths } from '@yeisme/muweave-bundle/consumer'
import type {
  CustomAdapterConfigV1,
  CustomAdapterProtocol,
  CustomAdapterViewV1,
} from '../protocol'
import { inputText, sha256Hex, type CapabilityAdapter, type SlotUpdate } from './types'

export const CUSTOM_ADAPTERS_SCHEMA = 'muweave.custom-adapters.v1' as const
export const MAX_CUSTOM_ADAPTERS = 64

const ADAPTER_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/
const ENV_VAR_RE = /^[A-Z_][A-Z0-9_]{1,63}$/
const SAFE_BINARY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PROTOCOLS = new Set<CustomAdapterProtocol>(['openai_http', 'comfyui_http', 'cli_wrapper'])
const KINDS = new Set<CustomAdapterConfigV1['kind']>(['image', 'voice', 'video', 'sfx', 'music'])
const STAGES = new Set<CustomAdapterConfigV1['stage']>(['visual', 'storyboard', 'sound'])

export class CustomAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export const CUSTOM_ADAPTER_PRESETS: readonly Omit<CustomAdapterConfigV1, 'updatedAt'>[] = [
  {
    adapterId: 'openai-image',
    title: 'OpenAI 兼容出图引擎',
    protocol: 'openai_http',
    kind: 'image',
    stage: 'visual',
    enabled: true,
    endpointUrl: 'https://api.openai.com',
    model: 'gpt-image-1',
    authEnvVar: 'OPENAI_API_KEY',
    unitPriceUsd: 0.04,
    defaultSlots: 2,
    maxSlots: 4,
    allowPrivateNetwork: false,
  },
  {
    adapterId: 'openai-tts',
    title: 'OpenAI 兼容配音引擎 (TTS)',
    protocol: 'openai_http',
    kind: 'voice',
    stage: 'sound',
    enabled: true,
    endpointUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini-tts',
    authEnvVar: 'OPENAI_API_KEY',
    unitPriceUsd: 0.015,
    defaultSlots: 1,
    maxSlots: 2,
    allowPrivateNetwork: false,
  },
  {
    adapterId: 'comfyui-local',
    title: '本地 ComfyUI 工作流节点',
    protocol: 'comfyui_http',
    kind: 'image',
    stage: 'visual',
    enabled: true,
    endpointUrl: 'http://127.0.0.1:8188',
    model: 'default-txt2img',
    unitPriceUsd: 0,
    defaultSlots: 1,
    maxSlots: 4,
    allowPrivateNetwork: false,
  },
]

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  return false
}

function isAlwaysBlockedHost(host: string): boolean {
  if (host === '0.0.0.0' || host === '::') return true
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  return false
}

function isPrivateLanHost(host: string): boolean {
  if (host.endsWith('.local')) return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  const m172 = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (m172) {
    const second = Number(m172[1])
    if (second >= 16 && second <= 31) return true
  }
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true // fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true // fe80::/10
  return false
}

/**
 * SSRF & transport guard for custom adapter endpoints.
 * - Rejects non-http(s), credentials in URL, 0.0.0.0, and 169.254.* ALWAYS.
 * - Allows loopback over http/https.
 * - Rejects private LAN ranges unless allowPrivateNetwork === true.
 * - Requires https: for all non-loopback external endpoints.
 */
export function validateAdapterEndpointUrl(rawUrl: string, allowPrivateNetwork = false): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new CustomAdapterError('ADAPTER_INVALID_URL', 'endpointUrl must be a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CustomAdapterError('ADAPTER_INVALID_URL', 'endpointUrl must use http: or https:')
  }
  if (parsed.username || parsed.password) {
    throw new CustomAdapterError('ADAPTER_INVALID_URL', 'endpointUrl must not contain embedded credentials')
  }
  const host = normalizeHost(parsed.hostname)
  if (!host || isAlwaysBlockedHost(host)) {
    throw new CustomAdapterError('ADAPTER_SSRF_BLOCKED', `endpointUrl host is forbidden: ${host || 'empty'}`)
  }
  if (isLoopbackHost(host)) {
    return parsed
  }
  if (isPrivateLanHost(host)) {
    if (!allowPrivateNetwork) {
      throw new CustomAdapterError(
        'ADAPTER_PRIVATE_NET_FORBIDDEN',
        'Private LAN endpoints require allowPrivateNetwork: true',
      )
    }
    return parsed
  }
  if (parsed.protocol !== 'https:') {
    throw new CustomAdapterError(
      'ADAPTER_HTTPS_REQUIRED',
      'External non-loopback endpoints must use https:',
    )
  }
  return parsed
}

function validateConfigInput(raw: unknown): CustomAdapterConfigV1 {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CustomAdapterError('muweave/invalid_adapter_config', 'Adapter config must be an object')
  }
  if (findPlaintextCredential(raw)) {
    throw new CustomAdapterError(
      'muweave/plaintext_credential_rejected',
      'Plaintext API keys or Bearer tokens are forbidden; provide an environment variable name in authEnvVar',
    )
  }
  const r = raw as Record<string, unknown>
  const adapterId = typeof r.adapterId === 'string' ? r.adapterId.trim() : ''
  if (!ADAPTER_ID_RE.test(adapterId)) {
    throw new CustomAdapterError(
      'muweave/invalid_adapter_config',
      'adapterId must match /^[a-z0-9][a-z0-9._-]{1,63}$/',
    )
  }
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  if (!title || title.length > 120 || containsHostPath(title)) {
    throw new CustomAdapterError('muweave/invalid_adapter_config', 'title must be a safe non-empty string (<= 120 chars)')
  }
  const protocol = r.protocol as CustomAdapterProtocol
  if (!PROTOCOLS.has(protocol)) {
    throw new CustomAdapterError('muweave/invalid_adapter_config', 'protocol must be openai_http, comfyui_http, or cli_wrapper')
  }
  const kind = r.kind as CustomAdapterConfigV1['kind']
  if (!KINDS.has(kind)) {
    throw new CustomAdapterError('muweave/invalid_adapter_config', 'kind must be image, voice, video, sfx, or music')
  }
  const stage = (typeof r.stage === 'string' ? r.stage : kind === 'image' ? 'visual' : kind === 'video' ? 'storyboard' : 'sound') as CustomAdapterConfigV1['stage']
  if (!STAGES.has(stage)) {
    throw new CustomAdapterError('muweave/invalid_adapter_config', 'stage must be visual, storyboard, or sound')
  }
  const enabled = r.enabled !== false
  const allowPrivateNetwork = r.allowPrivateNetwork === true

  let authEnvVar: string | undefined
  if (r.authEnvVar !== undefined && r.authEnvVar !== null && r.authEnvVar !== '') {
    if (typeof r.authEnvVar !== 'string' || !ENV_VAR_RE.test(r.authEnvVar.trim())) {
      throw new CustomAdapterError(
        'muweave/invalid_adapter_config',
        'authEnvVar must be an uppercase environment variable name (e.g. OPENAI_API_KEY), never a secret value',
      )
    }
    authEnvVar = r.authEnvVar.trim()
  }

  let endpointUrl: string | undefined
  let binary: string | undefined
  let argsTemplate: string[] | undefined

  if (protocol === 'openai_http' || protocol === 'comfyui_http') {
    if (typeof r.endpointUrl !== 'string' || !r.endpointUrl.trim()) {
      throw new CustomAdapterError('muweave/invalid_adapter_config', 'endpointUrl is required for HTTP adapters')
    }
    const parsed = validateAdapterEndpointUrl(r.endpointUrl, allowPrivateNetwork)
    endpointUrl = parsed.toString().replace(/\/+$/, '')
  } else {
    if (typeof r.binary !== 'string' || !SAFE_BINARY_RE.test(r.binary.trim())) {
      throw new CustomAdapterError(
        'muweave/invalid_adapter_config',
        'binary must be a safe executable name without path separators or shell characters',
      )
    }
    binary = r.binary.trim()
    if (r.argsTemplate !== undefined) {
      if (!Array.isArray(r.argsTemplate) || r.argsTemplate.length > 32 || r.argsTemplate.some((x) => typeof x !== 'string' || containsHostPath(x))) {
        throw new CustomAdapterError('muweave/invalid_adapter_config', 'argsTemplate must be an array of safe strings')
      }
      argsTemplate = r.argsTemplate.map((s) => s.trim())
    }
  }

  const model = typeof r.model === 'string' && r.model.trim() ? r.model.trim().slice(0, 120) : undefined
  if (model && containsHostPath(model)) {
    throw new CustomAdapterError('muweave/invalid_adapter_config', 'model must not contain host paths')
  }

  let unitPriceUsd: number | undefined
  if (r.unitPriceUsd !== undefined && r.unitPriceUsd !== null && r.unitPriceUsd !== '') {
    const n = Number(r.unitPriceUsd)
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      throw new CustomAdapterError('muweave/invalid_adapter_config', 'unitPriceUsd must be a non-negative finite number')
    }
    unitPriceUsd = n
  }

  const defaultSlots =
    typeof r.defaultSlots === 'number' && Number.isInteger(r.defaultSlots) && r.defaultSlots >= 1 && r.defaultSlots <= 8
      ? r.defaultSlots
      : 1
  const maxSlots =
    typeof r.maxSlots === 'number' && Number.isInteger(r.maxSlots) && r.maxSlots >= defaultSlots && r.maxSlots <= 8
      ? r.maxSlots
      : Math.max(defaultSlots, 4)

  return {
    adapterId,
    title,
    protocol,
    kind,
    stage,
    enabled,
    ...(endpointUrl ? { endpointUrl } : {}),
    ...(binary ? { binary } : {}),
    ...(argsTemplate ? { argsTemplate } : {}),
    ...(model ? { model } : {}),
    ...(authEnvVar ? { authEnvVar } : {}),
    ...(unitPriceUsd !== undefined ? { unitPriceUsd } : {}),
    defaultSlots,
    maxSlots,
    allowPrivateNetwork,
    updatedAt: typeof r.updatedAt === 'string' && !Number.isNaN(Date.parse(r.updatedAt))
      ? r.updatedAt
      : new Date().toISOString(),
  }
}

export function toCustomAdapterView(
  cfg: CustomAdapterConfigV1,
  env: NodeJS.ProcessEnv = process.env,
): CustomAdapterViewV1 {
  const envReady = !cfg.authEnvVar || Boolean(env[cfg.authEnvVar]?.trim())
  return { ...cfg, envReady }
}

export class CustomAdapterStore {
  private adapters: CustomAdapterConfigV1[] = []
  corruptFile?: string

  constructor(private readonly file: string) {
    this.load()
  }

  list(env: NodeJS.ProcessEnv = process.env): CustomAdapterViewV1[] {
    return [...this.adapters]
      .sort((a, b) => a.adapterId.localeCompare(b.adapterId))
      .map((cfg) => toCustomAdapterView(cfg, env))
  }

  allConfigs(): CustomAdapterConfigV1[] {
    return this.adapters.map((a) => ({ ...a }))
  }

  get(adapterId: string): CustomAdapterConfigV1 | undefined {
    const hit = this.adapters.find((a) => a.adapterId === adapterId)
    return hit ? { ...hit } : undefined
  }

  save(input: unknown, env: NodeJS.ProcessEnv = process.env): CustomAdapterViewV1 {
    const validated = validateConfigInput(input)
    const next: CustomAdapterConfigV1 = { ...validated, updatedAt: new Date().toISOString() }
    const idx = this.adapters.findIndex((a) => a.adapterId === next.adapterId)
    if (idx >= 0) {
      this.adapters[idx] = next
    } else {
      if (this.adapters.length >= MAX_CUSTOM_ADAPTERS) {
        throw new CustomAdapterError('muweave/adapter_limit_reached', `At most ${MAX_CUSTOM_ADAPTERS} custom adapters are allowed`)
      }
      this.adapters.push(next)
    }
    this.persist()
    return toCustomAdapterView(next, env)
  }

  remove(adapterId: string): boolean {
    const target = adapterId.trim()
    const before = this.adapters.length
    this.adapters = this.adapters.filter((a) => a.adapterId !== target)
    if (this.adapters.length !== before) {
      this.persist()
      return true
    }
    return false
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      const rows = typeof parsed === 'object' && parsed !== null ? (parsed as { adapters?: unknown }).adapters : undefined
      if (!Array.isArray(rows)) throw new Error('adapters is not an array')
      const loaded: CustomAdapterConfigV1[] = []
      for (const row of rows) {
        try {
          loaded.push(validateConfigInput(row))
        } catch {
          /* skip invalid rows */
        }
      }
      this.adapters = loaded.slice(0, MAX_CUSTOM_ADAPTERS)
    } catch {
      this.adapters = []
      const aside = path.join(path.dirname(this.file), `custom-adapters.v1.corrupt-${Date.now()}.json`)
      try {
        renameSync(this.file, aside)
        this.corruptFile = aside
      } catch {
        this.corruptFile = this.file
      }
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
    writeFileSync(
      tmp,
      `${JSON.stringify({ schema: CUSTOM_ADAPTERS_SCHEMA, adapters: this.adapters }, null, 2)}\n`,
      { mode: 0o600 },
    )
    renameSync(tmp, this.file)
  }
}

export interface CustomAdapterTestResultV1 {
  ok: boolean
  adapterId: string
  protocol: CustomAdapterProtocol
  envReady: boolean
  reachable: boolean
  latencyMs: number
  code?: string
  message: string
}

/** Zero-cost connectivity & security probe for a custom adapter (never triggers generation). */
export async function testCustomAdapter(
  cfg: CustomAdapterConfigV1,
  runner: CliRunner,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CustomAdapterTestResultV1> {
  const started = Date.now()
  const envReady = !cfg.authEnvVar || Boolean(env[cfg.authEnvVar]?.trim())

  if (cfg.protocol === 'cli_wrapper') {
    if (!cfg.binary || !SAFE_BINARY_RE.test(cfg.binary)) {
      return {
        ok: false,
        adapterId: cfg.adapterId,
        protocol: cfg.protocol,
        envReady,
        reachable: false,
        latencyMs: Date.now() - started,
        code: 'ADAPTER_INVALID_BINARY',
        message: 'Invalid CLI wrapper binary name',
      }
    }
    const res = await runner(cfg.binary, ['--version'], { cwd: process.cwd(), timeoutMs: 8_000 })
    const ok = res.exitCode === 0
    return {
      ok,
      adapterId: cfg.adapterId,
      protocol: cfg.protocol,
      envReady,
      reachable: ok,
      latencyMs: Date.now() - started,
      ...(ok ? {} : { code: 'OWNER_NOT_INSTALLED' }),
      message: ok ? `CLI binary ${cfg.binary} responded to --version` : `CLI binary ${cfg.binary} exited with ${res.exitCode}`,
    }
  }

  let parsedUrl: URL
  try {
    parsedUrl = validateAdapterEndpointUrl(cfg.endpointUrl ?? '', cfg.allowPrivateNetwork === true)
  } catch (err) {
    const code = err instanceof CustomAdapterError ? err.code : 'ADAPTER_INVALID_URL'
    return {
      ok: false,
      adapterId: cfg.adapterId,
      protocol: cfg.protocol,
      envReady,
      reachable: false,
      latencyMs: Date.now() - started,
      code,
      message: err instanceof Error ? err.message : 'Invalid endpoint URL',
    }
  }

  const base = parsedUrl.toString().replace(/\/+$/, '')
  if (cfg.protocol === 'comfyui_http') {
    try {
      const resp = await fetchImpl(`${base}/system_stats`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      })
      return {
        ok: resp.ok,
        adapterId: cfg.adapterId,
        protocol: cfg.protocol,
        envReady,
        reachable: resp.ok,
        latencyMs: Date.now() - started,
        ...(resp.ok ? {} : { code: 'ADAPTER_UNREACHABLE' }),
        message: resp.ok ? 'ComfyUI /system_stats reachable' : `ComfyUI returned HTTP ${resp.status}`,
      }
    } catch {
      return {
        ok: false,
        adapterId: cfg.adapterId,
        protocol: cfg.protocol,
        envReady,
        reachable: false,
        latencyMs: Date.now() - started,
        code: 'ADAPTER_UNREACHABLE',
        message: 'Could not reach ComfyUI /system_stats',
      }
    }
  }

  // openai_http zero-cost probe: HEAD or /v1/models (never generates)
  try {
    const headers: Record<string, string> = {}
    if (cfg.authEnvVar && env[cfg.authEnvVar]?.trim()) {
      headers.authorization = `Bearer ${env[cfg.authEnvVar]!.trim()}`
    }
    const resp = await fetchImpl(`${base}/v1/models`, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(5_000),
    })
    // A 200 or 405 (HEAD unsupported) proves the endpoint is reachable; 401/403 means auth failed.
    const reachable = resp.status < 500
    const authOk = resp.status !== 401 && resp.status !== 403
    const ok = envReady && reachable && authOk
    return {
      ok,
      adapterId: cfg.adapterId,
      protocol: cfg.protocol,
      envReady,
      reachable,
      latencyMs: Date.now() - started,
      ...(ok ? {} : { code: !envReady ? 'ADAPTER_ENV_MISSING' : !authOk ? 'ADAPTER_AUTH_FAILED' : 'ADAPTER_UNREACHABLE' }),
      message: ok
        ? 'Endpoint reachable and auth environment variable ready'
        : !envReady
          ? `Environment variable ${cfg.authEnvVar} is not set`
          : `Endpoint responded with HTTP ${resp.status}`,
    }
  } catch {
    return {
      ok: false,
      adapterId: cfg.adapterId,
      protocol: cfg.protocol,
      envReady,
      reachable: false,
      latencyMs: Date.now() - started,
      code: 'ADAPTER_UNREACHABLE',
      message: 'Endpoint is unreachable',
    }
  }
}

const customRunResults = new Map<string, SlotUpdate[]>()

export function buildCustomCapabilityAdapter(
  cfg: CustomAdapterConfigV1,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  env: NodeJS.ProcessEnv = process.env,
): CapabilityAdapter {
  const capabilityId = cfg.adapterId.startsWith('custom.') ? cfg.adapterId : `custom.${cfg.adapterId}`
  const isPaid = typeof cfg.unitPriceUsd === 'number' && cfg.unitPriceUsd > 0
  const owner = cfg.kind === 'voice' || cfg.kind === 'sfx' || cfg.kind === 'music' ? 'sonora' : 'eikona'

  return {
    binary: cfg.protocol === 'cli_wrapper' ? (cfg.binary ?? 'custom-cli') : 'builtin',
    descriptor: {
      capabilityId,
      owner,
      kind: cfg.kind,
      stage: cfg.stage,
      title: cfg.title,
      summary: stripHostPaths(`Custom ${cfg.protocol} bridge (${cfg.model ?? cfg.binary ?? 'default'})`),
      costClass: isPaid ? 'paid' : 'free',
      costUnit: isPaid ? 'usd' : 'none',
      defaultSlots: cfg.defaultSlots ?? 1,
      maxSlots: cfg.maxSlots ?? 4,
      inputs: [
        { name: 'prompt', label: '画面/音频描述', inputType: 'textarea', required: true },
      ],
    },
    async estimate(_ctx, input, slots) {
      const prompt = inputText(input, 'prompt')
      if (!prompt) return { ok: false, errorCode: 'ESTIMATE_FAILED' }
      const totalUsd = isPaid ? Number(((cfg.unitPriceUsd ?? 0) * slots).toFixed(4)) : 0
      return {
        ok: true,
        value: {
          costClass: isPaid ? 'paid' : 'free',
          estimate: isPaid ? { unit: 'usd', amount: totalUsd } : { unit: 'none', amount: 0 },
          suggestedCeiling: isPaid ? { unit: 'usd', amount: Math.ceil(totalUsd * 100) / 100 } : { unit: 'none', amount: 0 },
          slots,
          planLines: [`${slots} × ${cfg.title} (${cfg.model ?? cfg.protocol})`],
        },
      }
    },
    async submit(ctx, req) {
      const prompt = inputText(req.input, 'prompt')
      const ownerJobRef = `custom_${sha256Hex(`${cfg.adapterId}:${req.idempotencyKey}`).slice(0, 16)}`

      if (cfg.protocol === 'openai_http') {
        const parsed = validateAdapterEndpointUrl(cfg.endpointUrl ?? '', cfg.allowPrivateNetwork === true)
        const base = parsed.toString().replace(/\/+$/, '')
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (cfg.authEnvVar) {
          const secret = env[cfg.authEnvVar]?.trim()
          if (!secret) return { outcome: 'failed' }
          headers.authorization = `Bearer ${secret}`
        }

        if (cfg.kind === 'voice') {
          const resp = await fetchImpl(`${base}/v1/audio/speech`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: cfg.model ?? 'gpt-4o-mini-tts', input: prompt, voice: 'alloy', response_format: 'mp3' }),
          })
          if (!resp.ok) return { outcome: 'failed' }
          const bytes = new Uint8Array(await resp.arrayBuffer())
          const blob = await putCasBlob(ctx.cwd, bytes, 'audio/mpeg', 'custom-voice')
          customRunResults.set(ownerJobRef, [
            { index: 0, status: 'done', ownerRef: `${ownerJobRef}:slot_1`, label: cfg.title, mime: 'audio/mpeg', sha256: blob.blobDigest },
          ])
          return { outcome: 'submitted', ownerJobRef }
        }

        const resp = await fetchImpl(`${base}/v1/images/generations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: cfg.model ?? 'gpt-image-1',
            prompt,
            n: req.slots,
            response_format: 'b64_json',
          }),
        })
        if (!resp.ok) return { outcome: 'failed' }
        const json = (await resp.json()) as { data?: Array<{ b64_json?: string }> }
        const items = json.data ?? []
        const updates: SlotUpdate[] = []
        for (let i = 0; i < Math.min(items.length, req.slots); i += 1) {
          const b64 = items[i]?.b64_json
          if (!b64) continue
          const bytes = new Uint8Array(Buffer.from(b64, 'base64'))
          const blob = await putCasBlob(ctx.cwd, bytes, 'image/png', 'custom-image')
          updates.push({
            index: i,
            status: 'done',
            ownerRef: `${ownerJobRef}:slot_${i + 1}`,
            label: `${cfg.title} #${i + 1}`,
            mime: 'image/png',
            sha256: blob.blobDigest,
          })
        }
        if (updates.length === 0) return { outcome: 'failed' }
        customRunResults.set(ownerJobRef, updates)
        return { outcome: 'submitted', ownerJobRef }
      }

      if (cfg.protocol === 'comfyui_http') {
        const parsed = validateAdapterEndpointUrl(cfg.endpointUrl ?? '', cfg.allowPrivateNetwork === true)
        const base = parsed.toString().replace(/\/+$/, '')
        const promptResp = await fetchImpl(`${base}/prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: { text: prompt, model: cfg.model ?? 'default' }, client_id: ownerJobRef }),
        })
        if (!promptResp.ok) return { outcome: 'failed' }
        const queued = (await promptResp.json()) as { prompt_id?: string }
        const promptId = queued.prompt_id ?? ownerJobRef

        const histResp = await fetchImpl(`${base}/history/${encodeURIComponent(promptId)}`, { method: 'GET' })
        if (!histResp.ok) return { outcome: 'ambiguous', ownerJobRef }
        const hist = (await histResp.json()) as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }>
        const entry = hist[promptId] ?? Object.values(hist)[0]
        const images = Object.values(entry?.outputs ?? {}).flatMap((o) => o.images ?? [])
        const updates: SlotUpdate[] = []
        for (let i = 0; i < Math.min(images.length, req.slots); i += 1) {
          const img = images[i]!
          const q = new URLSearchParams({
            filename: img.filename,
            ...(img.subfolder ? { subfolder: img.subfolder } : {}),
            ...(img.type ? { type: img.type } : {}),
          })
          const viewResp = await fetchImpl(`${base}/view?${q.toString()}`, { method: 'GET' })
          if (!viewResp.ok) continue
          const bytes = new Uint8Array(await viewResp.arrayBuffer())
          const blob = await putCasBlob(ctx.cwd, bytes, 'image/png', 'comfyui-image')
          updates.push({
            index: i,
            status: 'done',
            ownerRef: `${ownerJobRef}:slot_${i + 1}`,
            label: `${cfg.title} #${i + 1}`,
            mime: 'image/png',
            sha256: blob.blobDigest,
          })
        }
        if (updates.length === 0) return { outcome: 'failed' }
        customRunResults.set(ownerJobRef, updates)
        return { outcome: 'submitted', ownerJobRef }
      }

      // cli_wrapper: execFile via ctx.runner (zero shell)
      if (!cfg.binary || !SAFE_BINARY_RE.test(cfg.binary)) return { outcome: 'failed' }
      const args = [
        ...(cfg.argsTemplate ?? []),
        '--prompt',
        prompt,
        '--slots',
        String(req.slots),
        '--json',
      ]
      const res = await ctx.runner(cfg.binary, args, { cwd: ctx.cwd, timeoutMs: 30_000 })
      if (res.exitCode !== 0) return { outcome: 'failed' }
      try {
        const parsed = JSON.parse(res.stdout) as { artifacts?: Array<{ base64?: string; mime?: string; sha256?: string }> }
        const updates: SlotUpdate[] = []
        for (let i = 0; i < Math.min((parsed.artifacts ?? []).length, req.slots); i += 1) {
          const art = parsed.artifacts![i]!
          const mime = art.mime ?? (cfg.kind === 'voice' || cfg.kind === 'sfx' ? 'audio/mpeg' : 'image/png')
          if (art.base64) {
            const blob = await putCasBlob(ctx.cwd, new Uint8Array(Buffer.from(art.base64, 'base64')), mime, 'cli-wrapper')
            updates.push({ index: i, status: 'done', ownerRef: `${ownerJobRef}:slot_${i + 1}`, mime, sha256: blob.blobDigest })
          } else if (art.sha256) {
            updates.push({ index: i, status: 'done', ownerRef: `${ownerJobRef}:slot_${i + 1}`, mime, sha256: art.sha256 })
          }
        }
        if (updates.length === 0) return { outcome: 'failed' }
        customRunResults.set(ownerJobRef, updates)
        return { outcome: 'submitted', ownerJobRef }
      } catch {
        return { outcome: 'failed' }
      }
    },
    async poll(_ctx, ownerJobRef, slotCount) {
      const slots = customRunResults.get(ownerJobRef)
      if (!slots) {
        return {
          state: 'done',
          actualCost: isPaid ? { unit: 'usd', amount: 0 } : { unit: 'none', amount: 0 },
          slots: Array.from({ length: slotCount }, (_, index) => ({ index, status: 'skipped' as const })),
        }
      }
      return {
        state: 'done',
        actualCost: isPaid
          ? { unit: 'usd', amount: Number(((cfg.unitPriceUsd ?? 0) * slots.length).toFixed(4)) }
          : { unit: 'none', amount: 0 },
        slots,
      }
    },
    async cancel(_ctx, ownerJobRef) {
      customRunResults.delete(ownerJobRef)
      return true
    },
    async review() {
      return true
    },
  }
}
