import {
  ClientGenerationGuard,
  type CapabilityRpcAction,
  MUWEAVE_MEDIA_PATH,
  MUWEAVE_RPC_PATH,
  type MuweaveRpcAction,
  type RpcEnvelope,
} from '../protocol'

export type BrowserFetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface MuweaveRpcClient {
  call<T = unknown>(action: MuweaveRpcAction | CapabilityRpcAction, payload?: Record<string, unknown>, signal?: AbortSignal): Promise<RpcEnvelope<T>>
  resolveMediaUrl(blobDigest: string, mimeType?: string): Promise<string | undefined>
  generation(): number
}

function localEnvelope<T>(generation: number, code: string, message: string, retryable: boolean): RpcEnvelope<T> {
  return { ok: false, generation, error: { code, message, retryable } }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError'
  return err instanceof Error && err.name === 'AbortError'
}

function isRpcEnvelope<T>(value: unknown): value is RpcEnvelope<T> {
  if (typeof value !== 'object' || value === null || !('ok' in value) || !('generation' in value)) return false
  const candidate = value as { ok: unknown; generation: unknown; hostInstanceId?: unknown; data?: unknown; error?: unknown }
  if (typeof candidate.ok !== 'boolean' || typeof candidate.generation !== 'number' || !Number.isSafeInteger(candidate.generation) || candidate.generation < 0) return false
  if (candidate.hostInstanceId !== undefined && typeof candidate.hostInstanceId !== 'string') return false
  if (candidate.ok) return 'data' in candidate
  if (typeof candidate.error !== 'object' || candidate.error === null) return false
  const error = candidate.error as { code?: unknown; message?: unknown; retryable?: unknown; operationRef?: unknown }
  return typeof error.code === 'string' && typeof error.message === 'string' &&
    (error.retryable === undefined || typeof error.retryable === 'boolean') &&
    (error.operationRef === undefined || typeof error.operationRef === 'string')
}

function safeMediaUrl(rawUrl: string, base: string): string | undefined {
  let parsed: URL
  let baseUrl: URL
  try {
    parsed = new URL(rawUrl, base)
    baseUrl = new URL(base)
  } catch {
    return undefined
  }
  if (parsed.origin !== baseUrl.origin || parsed.pathname !== MUWEAVE_MEDIA_PATH || !parsed.searchParams.get('token')) return undefined
  return parsed.toString()
}

export function createMuweaveRpcClient(fetchImpl?: BrowserFetchLike): MuweaveRpcClient {
  const guard = new ClientGenerationGuard()
  const mediaCache = new Map<string, { url: string; expiresAt: number }>()

  const call = async <T = unknown>(
    action: MuweaveRpcAction | CapabilityRpcAction,
    payload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<RpcEnvelope<T>> => {
    const impl = fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined)
    if (!impl) return localEnvelope(guard.currentGeneration(), 'muweave/no_fetch', 'Browser fetch is unavailable', false)
    const stamp = guard.nextIssueStamp()
    const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://127.0.0.1/'
    let resp: Response
    try {
      resp = await impl(new URL(MUWEAVE_RPC_PATH.replace(/^\//, ''), base), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, payload }),
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      if (isAbortError(err)) return localEnvelope(guard.currentGeneration(), 'muweave/aborted', 'Request aborted', false)
      return localEnvelope(guard.currentGeneration(), 'muweave/network_unreachable', 'Host is unreachable', true)
    }

    if (!resp.ok) return localEnvelope(guard.currentGeneration(), 'muweave/http_error', `Host returned HTTP ${resp.status}`, resp.status >= 500)
    let parsed: unknown
    try {
      parsed = await resp.json()
    } catch {
      parsed = undefined
    }
    if (!isRpcEnvelope<T>(parsed)) {
      return localEnvelope(guard.currentGeneration(), 'muweave/malformed_envelope', 'Host answered non-envelope payload', false)
    }
    guard.observeHost(parsed.hostInstanceId)
    if (!guard.shouldAccept(parsed.generation, stamp)) {
      return localEnvelope(guard.currentGeneration(), 'muweave/stale_generation_dropped', 'Superseded by newer host generation', true)
    }
    return parsed
  }

  const resolveMediaUrl = async (blobDigest: string, mimeType = 'image/png'): Promise<string | undefined> => {
    const cached = mediaCache.get(blobDigest)
    const now = Date.now()
    if (cached && cached.expiresAt > now + 10_000) return cached.url
    const res = await call<{ token: string; url: string; expiresInMs: number }>('media.token.issue', { blobDigest, mimeType })
    if (!res.ok || typeof res.data.url !== 'string' || !Number.isSafeInteger(res.data.expiresInMs) || res.data.expiresInMs <= 0) return undefined
    const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://127.0.0.1/'
    const resolved = safeMediaUrl(res.data.url, base)
    if (!resolved) return undefined
    mediaCache.set(blobDigest, { url: resolved, expiresAt: now + res.data.expiresInMs })
    return resolved
  }

  return { call, resolveMediaUrl, generation: () => guard.currentGeneration() }
}

let sharedClientInstance: MuweaveRpcClient | undefined

export function getSharedMuweaveRpcClient(): MuweaveRpcClient {
  if (!sharedClientInstance) sharedClientInstance = createMuweaveRpcClient()
  return sharedClientInstance
}
