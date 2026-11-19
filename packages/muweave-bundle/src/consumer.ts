/**
 * Browser-safe, zero-Node-import consumer SDK for .muweave/ bundles.
 * Shared by DSH browser plugins AND reusable by client/muweave-frame-studio.
 */
import {
  MUWEAVE_BUNDLE_SCHEMA,
  MUWEAVE_ELEMENT_SCHEMA,
  MUWEAVE_INDEX_SCHEMA,
  containsHostPath,
  findPlaintextCredential,
  isSha256Digest,
  SHOT_MEDIA_MAX_ENTRIES,
  validateShotMediaEntry,
  type MuweaveBundleManifestV1,
  type MuweaveDomain,
  type MuweaveElementKind,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveIndexV1,
  type MuweaveShotMediaEntryV1,
  type MuweaveSourceOwner,
  type ProjectionEnvelopeV1,
} from './schema'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'contract_mismatch' | 'unsafe_payload'; reason: string }

export function parseBundleManifest(raw: unknown): ParseResult<MuweaveBundleManifestV1> {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'contract_mismatch', reason: 'Bundle manifest must be a JSON object' }
  }
  if (raw.schemaVersion !== MUWEAVE_BUNDLE_SCHEMA) {
    return { ok: false, code: 'contract_mismatch', reason: 'Unsupported bundle manifest schemaVersion' }
  }
  if (
    typeof raw.projectId !== 'string' ||
    !raw.projectId ||
    typeof raw.title !== 'string' ||
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 1 ||
    typeof raw.createdAt !== 'string' ||
    typeof raw.updatedAt !== 'string'
  ) {
    return { ok: false, code: 'contract_mismatch', reason: 'Bundle manifest missing projectId, title, revision, or timestamps' }
  }
  if (findPlaintextCredential(raw) || containsHostPath(raw)) {
    return { ok: false, code: 'unsafe_payload', reason: 'Bundle manifest contains credentials or host paths' }
  }
  if (!isPlainObject(raw.bindings)) {
    return { ok: false, code: 'contract_mismatch', reason: 'Bundle manifest bindings must be an object' }
  }
  const bindingsRaw = raw.bindings
  const requiredBindingArrays = [
    'eikonaRuns',
    'eikonaHandles',
    'eikonaCollections',
    'eikonaBatches',
    'auctraSceneRefs',
    'scaenaEpisodeRefs',
    'scaenaBreakdownRefs',
    'scaenaEditSessionRefs',
  ] as const
  for (const key of requiredBindingArrays) {
    if (!Array.isArray(bindingsRaw[key]) || bindingsRaw[key].some((value) => typeof value !== 'string')) {
      return { ok: false, code: 'contract_mismatch', reason: `Bundle manifest bindings.${key} must be an array of strings` }
    }
  }
  if (typeof bindingsRaw.piIncludeWorkspace !== 'boolean') {
    return { ok: false, code: 'contract_mismatch', reason: 'Bundle manifest bindings.piIncludeWorkspace must be a boolean' }
  }
  if (bindingsRaw.auctraProjectRef !== undefined && typeof bindingsRaw.auctraProjectRef !== 'string') {
    return { ok: false, code: 'contract_mismatch', reason: 'Bundle manifest bindings.auctraProjectRef must be a string' }
  }
  const shotMediaRaw = bindingsRaw.shotMedia
  const shotMedia: MuweaveShotMediaEntryV1[] = []
  if (shotMediaRaw !== undefined) {
    if (!Array.isArray(shotMediaRaw) || shotMediaRaw.length > SHOT_MEDIA_MAX_ENTRIES) {
      return { ok: false, code: 'contract_mismatch', reason: 'bindings.shotMedia must be an array of at most 2000 entries' }
    }
    for (const item of shotMediaRaw) {
      const v = validateShotMediaEntry(item)
      if (!v.ok) return { ok: false, code: 'contract_mismatch', reason: `bindings.shotMedia invalid: ${v.reason}` }
      shotMedia.push(v.value)
    }
  }
  const value = { ...raw, bindings: { ...bindingsRaw, shotMedia } }
  // SAFETY: all v1 fields were validated above, including normalized legacy shotMedia.
  return { ok: true, value: value as unknown as MuweaveBundleManifestV1 }
}

export function parseElementSummary(raw: unknown): ParseResult<MuweaveElementSummaryV1> {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'contract_mismatch', reason: 'Element summary must be an object' }
  }
  if (
    typeof raw.elementId !== 'string' ||
    !raw.elementId ||
    typeof raw.domain !== 'string' ||
    typeof raw.kind !== 'string' ||
    typeof raw.title !== 'string' ||
    typeof raw.sourceOwner !== 'string' ||
    typeof raw.sourceRef !== 'string' ||
    !isSha256Digest(raw.digest)
  ) {
    return { ok: false, code: 'contract_mismatch', reason: 'Element summary missing required identity or sha256 digest' }
  }
  if (findPlaintextCredential(raw) || containsHostPath(raw)) {
    return { ok: false, code: 'unsafe_payload', reason: 'Element summary contains credentials or host paths' }
  }
  return { ok: true, value: raw as unknown as MuweaveElementSummaryV1 }
}

export function parseBundleIndex(raw: unknown): ParseResult<MuweaveIndexV1> {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'contract_mismatch', reason: 'Index must be a JSON object' }
  }
  if (raw.schemaVersion !== MUWEAVE_INDEX_SCHEMA) {
    return { ok: false, code: 'contract_mismatch', reason: `Unsupported index schemaVersion: ${String(raw.schemaVersion)}` }
  }
  if (typeof raw.projectId !== 'string' || typeof raw.revision !== 'number' || !Array.isArray(raw.elements)) {
    return { ok: false, code: 'contract_mismatch', reason: 'Index missing projectId, revision, or elements array' }
  }
  if (findPlaintextCredential(raw) || containsHostPath(raw)) {
    return { ok: false, code: 'unsafe_payload', reason: 'Index contains credentials or host paths' }
  }
  for (const item of raw.elements) {
    const parsed = parseElementSummary(item)
    if (!parsed.ok) return parsed
  }
  return { ok: true, value: raw as unknown as MuweaveIndexV1 }
}

export function parseElement<T = Record<string, unknown>>(raw: unknown): ParseResult<MuweaveElementV1<T>> {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'contract_mismatch', reason: 'Element must be a JSON object' }
  }
  if (raw.schemaVersion !== MUWEAVE_ELEMENT_SCHEMA) {
    return { ok: false, code: 'contract_mismatch', reason: `Unsupported element schemaVersion: ${String(raw.schemaVersion)}` }
  }
  const summary = parseElementSummary(raw)
  if (!summary.ok) return summary
  if (!isPlainObject(raw.payload)) {
    return { ok: false, code: 'contract_mismatch', reason: 'Element payload must be an object' }
  }
  if (findPlaintextCredential(raw.payload) || containsHostPath(raw.payload)) {
    return { ok: false, code: 'unsafe_payload', reason: 'Element payload contains credentials or host paths' }
  }
  return { ok: true, value: raw as unknown as MuweaveElementV1<T> }
}

export interface MuweaveElementFilter {
  domain?: MuweaveDomain
  kind?: MuweaveElementKind
  sourceOwner?: MuweaveSourceOwner
  episodeRef?: string
  sceneRef?: string
  characterRef?: string
  query?: string
}

export function filterElements(
  elements: readonly MuweaveElementSummaryV1[],
  filter: MuweaveElementFilter = {},
): MuweaveElementSummaryV1[] {
  const q = filter.query?.trim().toLowerCase()
  return elements.filter((el) => {
    if (filter.domain && el.domain !== filter.domain) return false
    if (filter.kind && el.kind !== filter.kind) return false
    if (filter.sourceOwner && el.sourceOwner !== filter.sourceOwner) return false
    if (filter.episodeRef && el.episodeRef !== filter.episodeRef) return false
    if (filter.sceneRef && el.sceneRef !== filter.sceneRef) return false
    if (filter.characterRef && !(el.characterRefs ?? []).includes(filter.characterRef)) return false
    if (q) {
      const hay = `${el.title} ${el.subtitle ?? ''} ${el.sourceRef} ${el.kind} ${el.role ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function projectBundleIndex(
  raw: unknown,
  filter: MuweaveElementFilter = {},
  observedAt = new Date().toISOString(),
): ProjectionEnvelopeV1<MuweaveIndexV1> {
  const parsed = parseBundleIndex(raw)
  if (!parsed.ok) {
    return {
      schemaVersion: 'ProjectionEnvelope.v1',
      scope: {},
      owner: 'muweave-bundle',
      state: 'error',
      capability: 'contract_mismatch',
      freshness: { observedAt, source: 'cache' },
      safeRefs: [],
      reason: parsed.reason,
      generatedAt: observedAt,
    }
  }
  const idx = parsed.value
  const filtered = filterElements(idx.elements, filter)
  const hasStale = filtered.some((e) => e.stale)
  return {
    schemaVersion: 'ProjectionEnvelope.v1',
    scope: { projectRef: idx.projectId },
    owner: 'muweave-bundle',
    state: filtered.length === 0 ? 'empty' : hasStale ? 'stale' : 'ready',
    capability: hasStale ? 'stale' : 'ready',
    revision: String(idx.revision),
    freshness: { observedAt, updatedAt: idx.generatedAt, source: 'cache' },
    data: {
      ...idx,
      elements: filtered,
      counts: {
        total: filtered.length,
        byDomain: {
          eikona: filtered.filter((e) => e.domain === 'eikona').length,
          script: filtered.filter((e) => e.domain === 'script').length,
          drama: filtered.filter((e) => e.domain === 'drama').length,
          harness: filtered.filter((e) => e.domain === 'harness').length,
        },
      },
    },
    safeRefs: filtered.map((e) => e.sourceRef),
    generatedAt: observedAt,
  }
}

export function projectElement<T = Record<string, unknown>>(
  raw: unknown,
  observedAt = new Date().toISOString(),
): ProjectionEnvelopeV1<MuweaveElementV1<T>> {
  const parsed = parseElement<T>(raw)
  if (!parsed.ok) {
    return {
      schemaVersion: 'ProjectionEnvelope.v1',
      scope: {},
      owner: 'muweave-bundle',
      state: 'error',
      capability: 'contract_mismatch',
      freshness: { observedAt, source: 'cache' },
      safeRefs: [],
      reason: parsed.reason,
      generatedAt: observedAt,
    }
  }
  const el = parsed.value
  return {
    schemaVersion: 'ProjectionEnvelope.v1',
    scope: {
      ...(el.episodeRef ? { episodeRef: el.episodeRef } : {}),
    },
    owner: el.sourceOwner,
    state: el.stale ? 'stale' : 'ready',
    capability: el.stale ? 'stale' : 'ready',
    ...(el.sourceRevision ? { revision: el.sourceRevision } : {}),
    digest: el.digest,
    freshness: { observedAt, updatedAt: el.updatedAt, source: 'cache' },
    data: el,
    safeRefs: [el.sourceRef, ...(el.characterRefs ?? [])],
    generatedAt: observedAt,
  }
}

export interface MuweaveBundleReadTransport {
  readIndex(): Promise<unknown>
  readElement(elementId: string): Promise<unknown>
  resolveMediaUrl?(blobDigest: string): Promise<string | undefined>
}

/**
 * Reusable read-only adapter for both DSH browser panels and client/muweave-frame-studio.
 */
export function createMuweaveBundleConsumer(transport: MuweaveBundleReadTransport) {
  return {
    async listElements(filter?: MuweaveElementFilter): Promise<ProjectionEnvelopeV1<MuweaveIndexV1>> {
      const raw = await transport.readIndex()
      return projectBundleIndex(raw, filter)
    },
    async getElement<T = Record<string, unknown>>(elementId: string): Promise<ProjectionEnvelopeV1<MuweaveElementV1<T>>> {
      const raw = await transport.readElement(elementId)
      return projectElement<T>(raw)
    },
    async getMediaUrl(blobDigest: string): Promise<string | undefined> {
      if (!isSha256Digest(blobDigest) || !transport.resolveMediaUrl) return undefined
      return transport.resolveMediaUrl(blobDigest)
    },
  }
}

export * from './schema'
