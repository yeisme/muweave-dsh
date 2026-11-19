/**
 * Pure schema, security fences, and shared types for @yeisme/muweave-bundle.
 * Zero Node.js imports so this module runs identically in Node, DSH browser, and MuWeave Web.
 */

export const MUWEAVE_BUNDLE_SCHEMA = 'muweave.bundle.v1' as const
export const MUWEAVE_INDEX_SCHEMA = 'muweave.index.v1' as const
export const MUWEAVE_ELEMENT_SCHEMA = 'muweave.element.v1' as const

export type MuweaveDomain = 'eikona' | 'script' | 'drama' | 'harness'

export type MuweaveElementKind =
  | 'eikona.candidate_group'
  | 'eikona.master_binding'
  | 'eikona.assessment_card'
  | 'eikona.handoff'
  | 'script.timeline'
  | 'script.scene_card'
  | 'script.context_graph'
  | 'script.candidate_diff'
  | 'drama.storyboard_table'
  | 'drama.asset_readiness'
  | 'drama.edit_timeline'
  | 'harness.pi_goal'
  | 'harness.pi_subagent'
  | 'harness.pi_plan'
  | 'harness.dsh_tool_artifact'

export type MuweaveSourceOwner = 'eikona' | 'auctra' | 'scaena' | 'pi' | 'dsh'

export type OwnerReadinessState = 'ready' | 'uninitialized_owner' | 'unavailable' | 'empty'

export type ProjectionState =
  | 'loading'
  | 'empty'
  | 'ready'
  | 'partial'
  | 'stale'
  | 'offline'
  | 'error'
  | 'unknown'
  | 'needs_contract'

export type CapabilityState =
  | 'ready'
  | 'unavailable'
  | 'permission_required'
  | 'contract_mismatch'
  | 'stale'
  | 'offline'

export interface ProjectionEnvelopeV1<T> {
  schemaVersion: string
  scope: {
    workspaceRef?: string
    projectRef?: string
    episodeRef?: string
    authorizationVersion?: string
  }
  owner: string
  state: ProjectionState
  capability: CapabilityState
  revision?: string
  digest?: string
  freshness: {
    observedAt: string
    updatedAt?: string
    maxAgeMs?: number
    source: 'owner' | 'cache' | 'fixture'
  }
  data?: T
  safeRefs: string[]
  reason?: string
  generatedAt: string
}

export interface MuweaveBindingsV1 {
  eikonaRuns: string[]
  eikonaHandles: string[]
  eikonaCollections: string[]
  eikonaBatches: string[]
  auctraProjectRef?: string
  auctraSceneRefs: string[]
  scaenaEpisodeRefs: string[]
  scaenaBreakdownRefs: string[]
  scaenaEditSessionRefs: string[]
  piIncludeWorkspace: boolean
  /** Shot -> media links (CAS digest or element id). Absent in bundles written before creator platform v1; readers default to []. */
  shotMedia: MuweaveShotMediaEntryV1[]
}

export const SHOT_MEDIA_ROLES = ['keyframe', 'reference', 'video', 'voice', 'music', 'sfx'] as const
export type MuweaveShotMediaRole = (typeof SHOT_MEDIA_ROLES)[number]

/** Mirrors dsh-muweave-core ShotMediaEntryV1 (this package must not import from core). */
export interface MuweaveShotMediaEntryV1 {
  shotRef: string
  sceneRef?: string
  episodeRef?: string
  /** Exactly one source: a CAS digest or an element id. */
  sha256?: string
  elementId?: string
  artifactId?: string
  role: MuweaveShotMediaRole
  linkedAt: string
  mime?: string
  jobId?: string
}

export const SHOT_MEDIA_MAX_ENTRIES = 2000
export const SHOT_MEDIA_MIME_TYPES: readonly string[] = [
  'image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'video/mp4', 'video/webm',
]

/** Row-level projection attached to drama.storyboard_table rows. */
export interface MuweaveLinkedMediaV1 {
  sha256?: string
  elementId?: string
  artifactId?: string
  role: MuweaveShotMediaRole
  mime?: string
}

export interface MuweaveBundleManifestV1 {
  schemaVersion: typeof MUWEAVE_BUNDLE_SCHEMA
  projectId: string
  title: string
  revision: number
  createdAt: string
  updatedAt: string
  bindings: MuweaveBindingsV1
}

export interface MuweaveMediaBlobRefV1 {
  blobDigest: string
  mimeType: string
  role: string
  width?: number
  height?: number
  label?: string
}

export interface MuweaveElementSummaryV1 {
  elementId: string
  domain: MuweaveDomain
  kind: MuweaveElementKind
  title: string
  subtitle?: string
  sourceOwner: MuweaveSourceOwner
  sourceRef: string
  sourceRevision?: string
  episodeRef?: string
  sceneRef?: string
  /** Shot refs covered by this element (storyboard tables), capped at 500. */
  shotRefs?: string[]
  characterRefs?: string[]
  role?: string
  status: string
  stale?: boolean
  digest: string
  mediaBlobs?: MuweaveMediaBlobRefV1[]
  updatedAt: string
}

export interface MuweaveElementV1<T = Record<string, unknown>> extends MuweaveElementSummaryV1 {
  schemaVersion: typeof MUWEAVE_ELEMENT_SCHEMA
  payload: T
}

export interface MuweaveIndexV1 {
  schemaVersion: typeof MUWEAVE_INDEX_SCHEMA
  projectId: string
  title: string
  revision: number
  generatedAt: string
  ownerStates: Record<MuweaveSourceOwner, OwnerReadinessState>
  counts: {
    total: number
    byDomain: Record<MuweaveDomain, number>
  }
  elements: MuweaveElementSummaryV1[]
}

// ============================================================================
// Security Fences: Credential & Host-Path Stripping + Sunburst Spec Guard
// ============================================================================

const CREDENTIAL_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'set_cookie',
  'password',
  'passwd',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'private_key',
  'secret_key',
  'session_token',
  'bearer',
  'credentials',
])

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\banatomia-sk-[A-Za-z0-9_-]{12,}/,
  /\baig_live_[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
]

const FORBIDDEN_PATH_KEYS = new Set([
  'local_object_path',
  'host_path',
  'absolute_path',
  'key_file',
  'keyfile',
])

const UNIX_ABS_PATH_RE = /(?<![A-Za-z0-9._-])\/(?:home|Users|root|var|tmp|etc|opt|private|mnt|srv|proc)\/[^\s"'<>]+/g
const WIN_ABS_PATH_RE = /\b[A-Za-z]:\\[^\s"'<>]+/g

export function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}

export function findPlaintextCredential(value: unknown, depth = 0): string | undefined {
  if (depth > 8) return 'max_depth_exceeded'
  if (typeof value === 'string') {
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.test(value)) return 'credential_pattern'
    }
    return undefined
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findPlaintextCredential(item, depth + 1)
      if (hit) return hit
    }
    return undefined
  }
  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (CREDENTIAL_KEYS.has(k.toLowerCase())) return `credential_key:${k.toLowerCase()}`
      const hit = findPlaintextCredential(v, depth + 1)
      if (hit) return hit
    }
  }
  return undefined
}

export function containsHostPath(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (typeof value === 'string') {
    UNIX_ABS_PATH_RE.lastIndex = 0
    WIN_ABS_PATH_RE.lastIndex = 0
    return UNIX_ABS_PATH_RE.test(value) || WIN_ABS_PATH_RE.test(value)
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsHostPath(item, depth + 1))
  }
  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_PATH_KEYS.has(k.toLowerCase())) return true
      if (containsHostPath(v, depth + 1)) return true
    }
  }
  return false
}

export function stripHostPaths<T>(value: T, depth = 0): T {
  if (depth > 10) return value
  if (typeof value === 'string') {
    const cleaned = value
      .replace(UNIX_ABS_PATH_RE, '[path-redacted]')
      .replace(WIN_ABS_PATH_RE, '[path-redacted]')
    // SAFETY: typeof value === 'string', so returning a sanitized string preserves T.
    return cleaned as unknown as T
  }
  if (Array.isArray(value)) {
    // SAFETY: Array.isArray(value), so mapping each item preserves T.
    return value.map((entry) => stripHostPaths(entry, depth + 1)) as unknown as T
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_PATH_KEYS.has(k.toLowerCase())) continue
      out[k] = stripHostPaths(v, depth + 1)
    }
    return out as T
  }
  return value
}

export interface EikonaGenerationSpecInput {
  model: string
  size: string
  quality?: string
  aspect?: string
  channel?: string
}

export type EikonaSpecValidation =
  | { ok: true; normalized: Required<Pick<EikonaGenerationSpecInput, 'model' | 'size' | 'quality'>> & { aspect?: string; channel: string } }
  | { ok: false; code: string; message: string }

const ALLOWED_EIKONA_MODELS = new Set([
  'openai/gpt-image-2.5-sunburst',
  'openai/gpt-image-2.5-flare',
  'openai/gpt-5.4-image-2',
])

export function validateEikonaGenerationSpec(input: EikonaGenerationSpecInput): EikonaSpecValidation {
  const model = (input.model ?? '').trim()
  if (!model) {
    return { ok: false, code: 'eikona/missing_model', message: 'Model ref is required (default: openai/gpt-image-2.5-sunburst)' }
  }
  if (model.includes(':')) {
    return { ok: false, code: 'eikona/colon_model_unsupported', message: 'Provider-colon model refs are unsupported; use slash-form openai/gpt-image-2.5-sunburst' }
  }
  if (model === 'gpt-image-2.5' || model === 'gpt-5.4-image-2' || model === 'gpt-image-2') {
    return { ok: false, code: 'eikona/unqualified_model_rejected', message: 'Bare model names are rejected; use canonical openai/gpt-image-2.5-sunburst' }
  }
  if (!ALLOWED_EIKONA_MODELS.has(model)) {
    return { ok: false, code: 'eikona/unknown_model', message: `Unsupported model ref: ${model}` }
  }
  const size = (input.size ?? '').trim()
  if (/^[0-9]+k$/i.test(size)) {
    return { ok: false, code: 'eikona/shorthand_size_forbidden', message: 'Shorthand sizes like 2k are forbidden on Image 2.5; use pixel WxH such as 1152x2048' }
  }
  if (!/^\d{3,4}x\d{3,4}$/.test(size)) {
    return { ok: false, code: 'eikona/invalid_pixel_size', message: 'Size must be explicit pixel WxH (e.g. 1152x2048 or 1024x1024)' }
  }
  const quality = (input.quality ?? 'high').trim()
  if (model === 'openai/gpt-image-2.5-sunburst' && quality !== 'high') {
    return { ok: false, code: 'eikona/sunburst_requires_high_quality', message: 'openai/gpt-image-2.5-sunburst requires --quality high' }
  }
  return {
    ok: true,
    normalized: {
      model,
      size,
      quality,
      ...(input.aspect ? { aspect: input.aspect.trim() } : {}),
      channel: (input.channel ?? 'noemi').trim() || 'noemi',
    },
  }
}

// ============================================================================
// Shot media link validation
// ============================================================================

function isOpaqueRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 256 || value !== value.trim()) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false
  if (value.includes('/') || value.includes('\\') || value.includes('..') || value.startsWith('~')) return false
  if (containsHostPath(value) || findPlaintextCredential(value)) return false
  return true
}

export type ShotMediaValidation =
  | { ok: true; value: MuweaveShotMediaEntryV1 }
  | { ok: false; reason: string }

/** Validates one entry. `linkedAt` is required here; use addShotMediaLink to stamp new entries. */
export function validateShotMediaEntry(raw: unknown): ShotMediaValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'shot media entry must be an object' }
  const r = raw as Record<string, unknown>
  if (!isOpaqueRef(r.shotRef)) return { ok: false, reason: 'shotRef must be a non-empty opaque reference' }
  if (!SHOT_MEDIA_ROLES.includes(r.role as MuweaveShotMediaRole)) return { ok: false, reason: 'role must be keyframe|reference|video|voice|music|sfx' }
  const hasSha = r.sha256 !== undefined
  const hasEl = r.elementId !== undefined
  if (hasSha === hasEl) return { ok: false, reason: 'exactly one of sha256 / elementId is required' }
  if (hasSha && !isSha256Digest(r.sha256)) return { ok: false, reason: 'sha256 must be sha256:<64 hex>' }
  if (hasEl && !isOpaqueRef(r.elementId)) return { ok: false, reason: 'elementId must be an opaque reference' }
  for (const key of ['sceneRef', 'episodeRef', 'artifactId', 'jobId'] as const) {
    if (r[key] !== undefined && !isOpaqueRef(r[key])) return { ok: false, reason: `${key} must be an opaque reference` }
  }
  if (r.mime !== undefined && (typeof r.mime !== 'string' || !SHOT_MEDIA_MIME_TYPES.includes(r.mime))) {
    return { ok: false, reason: 'mime is not allowlisted' }
  }
  if (typeof r.linkedAt !== 'string' || Number.isNaN(Date.parse(r.linkedAt))) return { ok: false, reason: 'linkedAt must be an ISO timestamp' }
  const value: MuweaveShotMediaEntryV1 = {
    shotRef: r.shotRef,
    role: r.role as MuweaveShotMediaRole,
    linkedAt: r.linkedAt,
    ...(hasSha ? { sha256: r.sha256 as string } : {}),
    ...(hasEl ? { elementId: r.elementId as string } : {}),
    ...(r.sceneRef !== undefined ? { sceneRef: r.sceneRef as string } : {}),
    ...(r.episodeRef !== undefined ? { episodeRef: r.episodeRef as string } : {}),
    ...(r.artifactId !== undefined ? { artifactId: r.artifactId as string } : {}),
    ...(r.mime !== undefined ? { mime: r.mime as string } : {}),
    ...(r.jobId !== undefined ? { jobId: r.jobId as string } : {}),
  }
  return { ok: true, value }
}
