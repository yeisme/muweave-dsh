import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, link, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  MUWEAVE_BUNDLE_SCHEMA,
  MUWEAVE_ELEMENT_SCHEMA,
  MUWEAVE_INDEX_SCHEMA,
  SHOT_MEDIA_MAX_ENTRIES,
  SHOT_MEDIA_MIME_TYPES,
  containsHostPath,
  findPlaintextCredential,
  isSha256Digest,
  stripHostPaths,
  validateShotMediaEntry,
  type MuweaveBindingsV1,
  type MuweaveBundleManifestV1,
  type MuweaveDomain,
  type MuweaveElementKind,
  type MuweaveElementSummaryV1,
  type MuweaveElementV1,
  type MuweaveIndexV1,
  type MuweaveLinkedMediaV1,
  type MuweaveMediaBlobRefV1,
  type MuweaveShotMediaEntryV1,
  type MuweaveSourceOwner,
  type OwnerReadinessState,
} from './schema'
import { parseBundleIndex, parseBundleManifest, parseElement } from './consumer'

const execFileAsync = promisify(execFile)

export interface CliExecResult {
  exitCode: number
  stdout: string
  stderr: string
  /** True when the child was killed because it exceeded timeoutMs (exitCode is then 124). */
  timedOut?: true
}

export class BundleValidationError extends Error {
  readonly code: 'contract_mismatch' | 'unsafe_payload' | 'bundle_not_initialized'

  constructor(code: BundleValidationError['code'], message: string) {
    super(message)
    this.name = 'BundleValidationError'
    this.code = code
  }
}

export type CliRunner = (
  binary: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs?: number },
) => Promise<CliExecResult>

export const defaultCliRunner: CliRunner = async (binary, args, options) => {
  try {
    const { stdout, stderr } = await execFileAsync(binary, [...args], {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 15_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? '/tmp',
        LANG: 'C.UTF-8',
        NO_COLOR: '1',
      },
    })
    return { exitCode: 0, stdout: String(stdout), stderr: String(stderr) }
  } catch (err: unknown) {
    const e = err as {
      code?: number | string
      killed?: boolean
      signal?: string | null
      stdout?: string
      stderr?: string
      message?: string
    }
    // Any termination by signal (timeout, OOM kill, SIGTERM) means the outcome is unknown: report 124/timedOut.
    if (typeof e.signal === 'string' && e.signal.length > 0) {
      return {
        exitCode: 124,
        stdout: typeof e.stdout === 'string' ? e.stdout : '',
        stderr: typeof e.stderr === 'string' && e.stderr ? e.stderr : 'command timed out',
        timedOut: true,
      }
    }
    return {
      exitCode: typeof e.code === 'number' ? e.code : 1,
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.message ?? 'exec failed'),
    }
  }
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

export function sha256Digest(input: string | Uint8Array): string {
  return `sha256:${sha256Hex(input)}`
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

export async function atomicWriteJson(filePath: string, data: unknown, exclusive = false): Promise<void> {
  const credentialHit = findPlaintextCredential(data)
  if (credentialHit) {
    throw new Error(`Refusing to write plaintext credential (${credentialHit}) into .muweave/`)
  }
  if (containsHostPath(data)) {
    throw new Error('Refusing to write unsanitized host path into .muweave/')
  }
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
  const serialized = `${JSON.stringify(data, null, 2)}\n`
  await writeFile(tmpPath, serialized, { mode: 0o600 })
  if (!exclusive) {
    await rename(tmpPath, filePath)
    return
  }
  try {
    // Publish atomically without replacing a manifest created after the absence check.
    await link(tmpPath, filePath)
  } finally {
    await rm(tmpPath, { force: true })
  }
}

export async function appendSyncEvent(muweaveDir: string, event: Record<string, unknown>): Promise<void> {
  const sanitized = stripHostPaths(event)
  if (findPlaintextCredential(sanitized)) {
    throw new Error('Refusing to append credential into sync.jsonl')
  }
  const eventsPath = path.join(muweaveDir, 'events', 'sync.jsonl')
  await mkdir(path.dirname(eventsPath), { recursive: true })
  await appendFile(eventsPath, `${JSON.stringify({ ...sanitized, recordedAt: new Date().toISOString() })}\n`, { mode: 0o600 })
}

export function muweaveRoot(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), '.muweave')
}

export function casBlobPath(muweaveDir: string, blobDigest: string): string {
  if (!isSha256Digest(blobDigest)) {
    throw new Error(`Invalid sha256 digest: ${blobDigest}`)
  }
  const hex = blobDigest.slice('sha256:'.length)
  return path.join(muweaveDir, 'cas', 'sha256', hex.slice(0, 2), hex)
}

export const CAS_MAX_BYTES = 64 * 1024 * 1024
export const CAS_MIME_TYPES: ReadonlySet<string> = new Set(SHOT_MEDIA_MIME_TYPES)

export async function putCasBlob(
  workspaceDir: string,
  bytes: Uint8Array,
  mimeType: string,
  role = 'preview',
  meta?: { width?: number; height?: number; label?: string },
): Promise<MuweaveMediaBlobRefV1> {
  if (!CAS_MIME_TYPES.has(mimeType)) throw new Error(`CAS MIME type is not allowlisted: ${mimeType}`)
  if (bytes.byteLength > CAS_MAX_BYTES) throw new Error(`CAS blob exceeds ${CAS_MAX_BYTES} bytes`)
  const root = muweaveRoot(workspaceDir)
  const blobDigest = sha256Digest(bytes)
  const dest = casBlobPath(root, blobDigest)
  if (!existsSync(dest)) {
    await mkdir(path.dirname(dest), { recursive: true })
    const tmp = `${dest}.tmp.${randomUUID().slice(0, 8)}`
    await writeFile(tmp, bytes, { mode: 0o600 })
    await rename(tmp, dest)
  }
  return {
    blobDigest,
    mimeType,
    role,
    ...(meta?.width ? { width: meta.width } : {}),
    ...(meta?.height ? { height: meta.height } : {}),
    ...(meta?.label ? { label: meta.label } : {}),
  }
}

export async function readCasBlobVerified(workspaceDir: string, blobDigest: string): Promise<Buffer> {
  const root = muweaveRoot(workspaceDir)
  const filePath = casBlobPath(root, blobDigest)
  const bytes = await readFile(filePath)
  const actual = sha256Digest(bytes)
  if (actual !== blobDigest) {
    throw new Error(`CAS integrity mismatch: expected ${blobDigest}, got ${actual}`)
  }
  return bytes
}

export function emptyBindings(): MuweaveBindingsV1 {
  return {
    eikonaRuns: [],
    eikonaHandles: [],
    eikonaCollections: [],
    eikonaBatches: [],
    auctraSceneRefs: [],
    scaenaEpisodeRefs: [],
    scaenaBreakdownRefs: [],
    scaenaEditSessionRefs: [],
    piIncludeWorkspace: true,
    shotMedia: [],
  }
}

async function readExistingBundleManifest(workspaceDir: string): Promise<MuweaveBundleManifestV1 | undefined> {
  const manifestPath = path.join(muweaveRoot(workspaceDir), 'bundle.v1.json')
  try {
    const info = await lstat(manifestPath)
    if (!info.isFile() && !info.isSymbolicLink()) {
      throw new BundleValidationError('contract_mismatch', 'Bundle manifest must be a file')
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
  const raw = tryParseJson(await readFile(manifestPath, 'utf8').catch(() => ''))
  if (!raw) throw new BundleValidationError('contract_mismatch', 'Bundle manifest must be a readable JSON object')
  const parsed = parseBundleManifest(raw)
  if (!parsed.ok) throw new BundleValidationError(parsed.code, parsed.reason)
  return parsed.value
}

export async function readBundleManifestFromDisk(workspaceDir: string): Promise<MuweaveBundleManifestV1> {
  const manifest = await readExistingBundleManifest(workspaceDir)
  if (!manifest) throw new BundleValidationError('bundle_not_initialized', 'Missing .muweave/bundle.v1.json')
  return manifest
}

export async function initBundle(
  workspaceDir: string,
  options: { projectId?: string; title?: string } = {},
): Promise<MuweaveBundleManifestV1> {
  const root = muweaveRoot(workspaceDir)
  const manifestPath = path.join(root, 'bundle.v1.json')
  const existing = await readExistingBundleManifest(workspaceDir)
  if (existing) return existing
  const now = new Date().toISOString()
  const projectId = options.projectId ?? `proj_${path.basename(path.resolve(workspaceDir)).replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'}`
  const title = options.title ?? (path.basename(path.resolve(workspaceDir)) || 'MuWeave Project')
  const manifest: MuweaveBundleManifestV1 = {
    schemaVersion: MUWEAVE_BUNDLE_SCHEMA,
    projectId,
    title,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    bindings: emptyBindings(),
  }
  await mkdir(path.join(root, 'elements', 'eikona'), { recursive: true })
  await mkdir(path.join(root, 'elements', 'script'), { recursive: true })
  await mkdir(path.join(root, 'elements', 'drama'), { recursive: true })
  await mkdir(path.join(root, 'elements', 'harness'), { recursive: true })
  await mkdir(path.join(root, 'cas', 'sha256'), { recursive: true })
  await atomicWriteJson(manifestPath, manifest, true)
  const initialIndex: MuweaveIndexV1 = {
    schemaVersion: MUWEAVE_INDEX_SCHEMA,
    projectId,
    title,
    revision: 1,
    generatedAt: now,
    ownerStates: {
      eikona: 'empty',
      auctra: 'empty',
      scaena: 'empty',
      pi: 'empty',
      dsh: 'empty',
    },
    counts: {
      total: 0,
      byDomain: { eikona: 0, script: 0, drama: 0, harness: 0 },
    },
    elements: [],
  }
  await atomicWriteJson(path.join(root, 'index.v1.json'), initialIndex)
  await appendSyncEvent(root, { type: 'bundle.initialized', projectId, revision: 1 })
  return manifest
}

export type BindingTargetKind =
  | 'eikona-run'
  | 'eikona-handle'
  | 'eikona-collection'
  | 'eikona-batch'
  | 'auctra-project'
  | 'auctra-scene'
  | 'scaena-episode'
  | 'scaena-breakdown'
  | 'scaena-edit-session'

export type ShotMediaLinkInput = Omit<MuweaveShotMediaEntryV1, 'linkedAt'> & { linkedAt?: string }

function sameShotMediaSource(a: MuweaveShotMediaEntryV1, b: { shotRef: string; role?: string; sha256?: string; elementId?: string }): boolean {
  return a.shotRef === b.shotRef && (b.role === undefined || a.role === b.role) && a.sha256 === b.sha256 && a.elementId === b.elementId
}

/** Links media to a shot. Dedupes on shotRef+role+(sha256|elementId); newest first; capped at 2000. */
export async function addShotMediaLink(workspaceDir: string, entry: ShotMediaLinkInput): Promise<MuweaveBindingsV1> {
  const checked = validateShotMediaEntry({ ...entry, linkedAt: entry.linkedAt ?? new Date().toISOString() })
  if (!checked.ok) throw new Error(`Invalid shot media link: ${checked.reason}`)
  const next = checked.value
  return withWorkspaceBundleLock(workspaceDir, async () => {
    const manifest = await initBundle(workspaceDir)
    const rest = manifest.bindings.shotMedia.filter((e) => !sameShotMediaSource(e, next))
    const shotMedia = [next, ...rest].slice(0, SHOT_MEDIA_MAX_ENTRIES)
    return writeShotMedia(workspaceDir, manifest, shotMedia, { type: 'bundle.shot_media_linked', shotRef: next.shotRef, role: next.role })
  })
}

/** Removes links for a shot. With sha256/elementId only that source is removed; with neither, all links of the shot. */
export async function removeShotMediaLink(
  workspaceDir: string,
  target: { shotRef: string; sha256?: string; elementId?: string; role?: string },
): Promise<MuweaveBindingsV1> {
  return withWorkspaceBundleLock(workspaceDir, async () => {
    const manifest = await initBundle(workspaceDir)
    const bySource = target.sha256 !== undefined || target.elementId !== undefined
    const shotMedia = manifest.bindings.shotMedia.filter((e) =>
      bySource ? !sameShotMediaSource(e, target) : e.shotRef !== target.shotRef,
    )
    return writeShotMedia(workspaceDir, manifest, shotMedia, { type: 'bundle.shot_media_unlinked', shotRef: target.shotRef })
  })
}

async function writeShotMedia(
  workspaceDir: string,
  manifest: MuweaveBundleManifestV1,
  shotMedia: MuweaveShotMediaEntryV1[],
  event: Record<string, unknown>,
): Promise<MuweaveBindingsV1> {
  const updated: MuweaveBundleManifestV1 = {
    ...manifest,
    revision: manifest.revision + 1,
    updatedAt: new Date().toISOString(),
    bindings: { ...manifest.bindings, shotMedia },
  }
  await atomicWriteJson(path.join(muweaveRoot(workspaceDir), 'bundle.v1.json'), updated)
  await appendSyncEvent(muweaveRoot(workspaceDir), { ...event, revision: updated.revision })
  return updated.bindings
}

// Per-workspace async mutex so concurrent syncBundle / bindBundleRef / ingest calls never race revisions
const workspaceLocks = new Map<string, Promise<void>>()

async function withWorkspaceBundleLock<R>(workspaceDir: string, fn: () => Promise<R>): Promise<R> {
  const key = path.resolve(workspaceDir)
  const prev = workspaceLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = prev.then(() => gate)
  workspaceLocks.set(key, tail)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (workspaceLocks.get(key) === tail) {
      workspaceLocks.delete(key)
    }
  }
}

export async function bindBundleRef(
  workspaceDir: string,
  target: BindingTargetKind,
  refValue: string,
): Promise<MuweaveBundleManifestV1> {
  return withWorkspaceBundleLock(workspaceDir, async () => {
    const cleanRef = refValue.trim()
    if (!cleanRef || findPlaintextCredential(cleanRef) || containsHostPath(cleanRef)) {
      throw new Error('Binding ref must be a non-empty opaque reference without host paths or credentials')
    }
    const manifest = await initBundle(workspaceDir)
    const b = { ...manifest.bindings }
    const pushUnique = (arr: string[], v: string) => (arr.includes(v) ? arr : [...arr, v])
    switch (target) {
      case 'eikona-run':
        b.eikonaRuns = pushUnique(b.eikonaRuns, cleanRef)
        break
      case 'eikona-handle':
        b.eikonaHandles = pushUnique(b.eikonaHandles, cleanRef)
        break
      case 'eikona-collection':
        b.eikonaCollections = pushUnique(b.eikonaCollections, cleanRef)
        break
      case 'eikona-batch':
        b.eikonaBatches = pushUnique(b.eikonaBatches, cleanRef)
        break
      case 'auctra-project':
        b.auctraProjectRef = cleanRef
        break
      case 'auctra-scene':
        b.auctraSceneRefs = pushUnique(b.auctraSceneRefs, cleanRef)
        break
      case 'scaena-episode':
        b.scaenaEpisodeRefs = pushUnique(b.scaenaEpisodeRefs, cleanRef)
        break
      case 'scaena-breakdown':
        b.scaenaBreakdownRefs = pushUnique(b.scaenaBreakdownRefs, cleanRef)
        break
      case 'scaena-edit-session':
        b.scaenaEditSessionRefs = pushUnique(b.scaenaEditSessionRefs, cleanRef)
        break
    }
    const updated: MuweaveBundleManifestV1 = {
      ...manifest,
      revision: manifest.revision + 1,
      updatedAt: new Date().toISOString(),
      bindings: b,
    }
    await atomicWriteJson(path.join(muweaveRoot(workspaceDir), 'bundle.v1.json'), updated)
    await appendSyncEvent(muweaveRoot(workspaceDir), { type: 'bundle.bound', target, ref: cleanRef, revision: updated.revision })
    return updated
  })
}

export function computeElementDigest(el: {
  elementId: string
  domain: MuweaveDomain
  kind: MuweaveElementKind
  sourceOwner: MuweaveSourceOwner
  sourceRef: string
  sourceRevision?: string
  status: string
  stale?: boolean
  mediaBlobs?: readonly MuweaveMediaBlobRefV1[]
  payload: unknown
}): string {
  return sha256Digest(
    canonicalJson({
      elementId: el.elementId,
      domain: el.domain,
      kind: el.kind,
      sourceOwner: el.sourceOwner,
      sourceRef: el.sourceRef,
      sourceRevision: el.sourceRevision ?? null,
      status: el.status,
      stale: Boolean(el.stale),
      mediaBlobs: el.mediaBlobs ?? [],
      payload: el.payload,
    }),
  )
}

export function buildElement<T extends Record<string, unknown>>(input: {
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
  shotRefs?: string[]
  characterRefs?: string[]
  role?: string
  status: string
  stale?: boolean
  mediaBlobs?: MuweaveMediaBlobRefV1[]
  updatedAt?: string
  payload: T
}): MuweaveElementV1<T> {
  const normalizedElementId = input.elementId.replace(/[^a-zA-Z0-9._:-]/g, '_')
  const sanitizedTitle = stripHostPaths(input.title)
  const sanitizedSubtitle = input.subtitle ? stripHostPaths(input.subtitle) : undefined
  const sanitizedSourceRef = stripHostPaths(input.sourceRef)
  const sanitizedMediaBlobs = input.mediaBlobs ? stripHostPaths(input.mediaBlobs) : undefined
  const sanitizedPayload = stripHostPaths(input.payload)
  if (
    findPlaintextCredential(sanitizedPayload) ||
    findPlaintextCredential(sanitizedSourceRef) ||
    findPlaintextCredential(sanitizedMediaBlobs)
  ) {
    throw new Error(`Refusing to materialize element ${normalizedElementId}: credential detected`)
  }
  const sanitizedSourceRevision = input.sourceRevision ? stripHostPaths(input.sourceRevision) : undefined
  const sanitizedStatus = stripHostPaths(input.status)
  if (findPlaintextCredential(sanitizedSourceRevision) || findPlaintextCredential(sanitizedStatus)) {
    throw new Error(`Refusing to materialize element ${normalizedElementId}: credential detected`)
  }
  const updatedAt = input.updatedAt ?? new Date().toISOString()
  const digest = computeElementDigest({
    elementId: normalizedElementId,
    domain: input.domain,
    kind: input.kind,
    sourceOwner: input.sourceOwner,
    sourceRef: sanitizedSourceRef,
    sourceRevision: sanitizedSourceRevision,
    status: sanitizedStatus,
    stale: input.stale,
    mediaBlobs: sanitizedMediaBlobs,
    payload: sanitizedPayload,
  })
  return {
    schemaVersion: MUWEAVE_ELEMENT_SCHEMA,
    elementId: normalizedElementId,
    domain: input.domain,
    kind: input.kind,
    title: sanitizedTitle,
    ...(sanitizedSubtitle ? { subtitle: sanitizedSubtitle } : {}),
    sourceOwner: input.sourceOwner,
    sourceRef: sanitizedSourceRef,
    ...(sanitizedSourceRevision ? { sourceRevision: sanitizedSourceRevision } : {}),
    ...(input.episodeRef ? { episodeRef: stripHostPaths(input.episodeRef) } : {}),
    ...(input.sceneRef ? { sceneRef: stripHostPaths(input.sceneRef) } : {}),
    ...(input.shotRefs && input.shotRefs.length > 0 ? { shotRefs: stripHostPaths(input.shotRefs.slice(0, 500)) } : {}),
    ...(input.characterRefs && input.characterRefs.length > 0 ? { characterRefs: stripHostPaths(input.characterRefs) } : {}),
    ...(input.role ? { role: stripHostPaths(input.role) } : {}),
    status: sanitizedStatus,
    ...(input.stale ? { stale: true } : {}),
    digest,
    ...(sanitizedMediaBlobs && sanitizedMediaBlobs.length > 0 ? { mediaBlobs: sanitizedMediaBlobs } : {}),
    updatedAt,
    payload: sanitizedPayload,
  }
}

export function elementFilePath(muweaveDir: string, domain: MuweaveDomain, elementId: string): string {
  const safeFile = `${elementId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`
  return path.join(muweaveDir, 'elements', domain, safeFile)
}

function tryParseJson(stdout: string): Record<string, unknown> | undefined {
  const trimmed = stdout.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

// ============================================================================
// Upstream Payload Normalizers (used by both live CLI sync and receipt ingest)
// ============================================================================

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeEikonaPayload(raw: Record<string, unknown>): MuweaveElementV1[] {
  const schema = String(raw.schema_version ?? raw.command ?? '')
  const out: MuweaveElementV1[] = []

  if (schema === 'eikona.review_packet.v1' && nonemptyString(raw.run_id) && Array.isArray(raw.candidates)) {
    const runId = raw.run_id
    const candidates = raw.candidates
    const mediaBlobs: MuweaveMediaBlobRefV1[] = []
    for (const c of candidates) {
      if (typeof c === 'object' && c !== null) {
        const rec = c as Record<string, unknown>
        if (isSha256Digest(rec.sha256)) {
          mediaBlobs.push({
            blobDigest: rec.sha256,
            mimeType: String(rec.mime_type ?? 'image/png'),
            role: String(rec.role ?? 'candidate'),
            label: String(rec.artifact_id ?? ''),
          })
        }
      }
    }
    out.push(
      buildElement({
        elementId: `eikona-candidates-${runId}`,
        domain: 'eikona',
        kind: 'eikona.candidate_group',
        title: `视觉候选组 · ${runId}`,
        subtitle: `${candidates.length} 张候选 · ${String(raw.review_state ?? 'waiting_review')}`,
        sourceOwner: 'eikona',
        sourceRef: `eikona://runs/${runId}`,
        status: String(raw.review_state ?? raw.status ?? 'waiting_review'),
        mediaBlobs,
        payload: {
          runId,
          reviewState: raw.review_state ?? 'waiting_review',
          candidates: candidates.map((c) => {
            const rec = (c ?? {}) as Record<string, unknown>
            return {
              artifactId: String(rec.artifact_id ?? ''),
              handle: String(rec.handle ?? ''),
              uri: String(rec.uri ?? ''),
              role: String(rec.role ?? 'primary'),
              promptExcerpt: String(rec.prompt_excerpt ?? ''),
              overallScore: typeof rec.overall_score === 'number' ? rec.overall_score : undefined,
              width: typeof rec.width === 'number' ? rec.width : undefined,
              height: typeof rec.height === 'number' ? rec.height : undefined,
              modelRef: String(rec.model_ref ?? 'openai/gpt-image-2.5-sunburst'),
              sha256: isSha256Digest(rec.sha256) ? rec.sha256 : undefined,
            }
          }),
        },
      }),
    )
  } else if (schema === 'eikona.assess.result.v1' && nonemptyString(raw.run_id) && Array.isArray(raw.artifacts)) {
    const runId = raw.run_id
    const artifacts = raw.artifacts
    out.push(
      buildElement({
        elementId: `eikona-assess-${runId}`,
        domain: 'eikona',
        kind: 'eikona.assessment_card',
        title: `视觉评估分卡 · ${runId}`,
        subtitle: `标准 ${String(raw.criteria_id ?? 'default')} · ${artifacts.length} 项`,
        sourceOwner: 'eikona',
        sourceRef: `eikona://runs/${runId}/assessment`,
        status: 'ready',
        payload: {
          runId,
          criteriaId: String(raw.criteria_id ?? 'default'),
          modelRef: String(raw.model_ref ?? ''),
          scores: artifacts,
        },
      }),
    )
  } else if (schema === 'eikona.asset_handoff.v2') {
    const artifact = (raw.artifact ?? {}) as Record<string, unknown>
    const handle = artifact.handle ?? raw.artifact_id
    if (!nonemptyString(handle)) return out
    const sha = isSha256Digest(artifact.sha256) ? artifact.sha256 : undefined
    out.push(
      buildElement({
        elementId: `eikona-handoff-${handle}`,
        domain: 'eikona',
        kind: 'eikona.handoff',
        title: `视觉资产交接 · ${handle}`,
        subtitle: `角色 ${String(artifact.role ?? 'primary')} · ${String(raw.replacement_status ?? 'staged')}`,
        sourceOwner: 'eikona',
        sourceRef: String(artifact.uri ?? `eikona://artifact/${handle}`),
        role: String(artifact.role ?? 'primary'),
        status: String(raw.replacement_status ?? 'staged'),
        mediaBlobs: sha
          ? [{ blobDigest: sha, mimeType: String(artifact.mime_type ?? 'image/png'), role: String(artifact.role ?? 'primary') }]
          : [],
        payload: {
          runId: String(raw.run_id ?? ''),
          artifactId: String(raw.artifact_id ?? ''),
          handle,
          uri: String(artifact.uri ?? ''),
          promptSummary: String(raw.prompt_summary ?? ''),
          replacementStatus: String(raw.replacement_status ?? 'staged'),
          risks: Array.isArray(raw.risks) ? raw.risks : [],
        },
      }),
    )
  } else if (schema === 'eikona.library.handoff' || raw.command === 'eikona.library.handoff') {
    const facts = (raw.facts ?? {}) as Record<string, unknown>
    const collectionUri = facts.collection_uri
    if (!nonemptyString(collectionUri)) return out
    const bindId = String(facts.binding_snapshot_id ?? sha256Hex(collectionUri).slice(0, 10))
    out.push(
      buildElement({
        elementId: `eikona-master-${bindId}`,
        domain: 'eikona',
        kind: 'eikona.master_binding',
        title: `合格资产母版绑定 · ${bindId}`,
        subtitle: `${String(facts.representation_count ?? 0)} 视图表征`,
        sourceOwner: 'eikona',
        sourceRef: collectionUri,
        sourceRevision: String(facts.collection_digest ?? ''),
        status: String(raw.status ?? 'ready'),
        payload: {
          collectionUri,
          collectionDigest: String(facts.collection_digest ?? ''),
          bindingSnapshotId: bindId,
          bindingSnapshotDigest: String(facts.binding_snapshot_digest ?? ''),
          representationCount: Number(facts.representation_count ?? 0),
        },
      }),
    )
  } else if (schema === 'eikona.asset_handoff.batch.v1') {
    const opRef = raw.operation_ref
    const batch = (raw.artifact_batch ?? {}) as Record<string, unknown>
    if (!nonemptyString(opRef) || !Array.isArray(batch.artifacts)) return out
    const items = batch.artifacts
    out.push(
      buildElement({
        elementId: `eikona-batch-${opRef.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        domain: 'eikona',
        kind: 'eikona.handoff',
        title: `批量视觉交接 · ${opRef}`,
        subtitle: `成功授权 ${String(raw.granted_count ?? items.length)} / ${String(raw.member_count ?? items.length)}`,
        sourceOwner: 'eikona',
        sourceRef: opRef,
        status: String(raw.status ?? 'succeeded'),
        payload: {
          operationRef: opRef,
          projectRef: String(raw.project_ref ?? ''),
          grantExpiresAt: String(raw.grant_expires_at ?? ''),
          artifacts: items,
        },
      }),
    )
  }
  return out
}

export function normalizeAuctraPayload(raw: Record<string, unknown>): MuweaveElementV1[] {
  const kind = String(raw.kind ?? raw.schema_version ?? '')
  const out: MuweaveElementV1[] = []

  if (Array.isArray(raw.episodes) || Array.isArray(raw.scenes)) {
    const rev = String(raw.revision ?? '1')
    const scenes = Array.isArray(raw.scenes) ? raw.scenes : []
    out.push(
      buildElement({
        elementId: 'script-room-timeline',
        domain: 'script',
        kind: 'script.timeline',
        title: String(raw.title ?? '剧本双时间轴结构'),
        subtitle: `修订 v${rev} · ${scenes.length} 场戏`,
        sourceOwner: 'auctra',
        sourceRef: String(raw.project_ref ?? 'owner:auctra:room'),
        sourceRevision: rev,
        status: 'ready',
        payload: {
          revision: rev,
          structureMode: String(raw.structure_mode ?? 'screenplay_series_v1'),
          episodes: Array.isArray(raw.episodes) ? raw.episodes : [],
          scenes,
          storyTimeAnchors: Array.isArray(raw.story_time_anchors) ? raw.story_time_anchors : [],
        },
      }),
    )
  }

  const card = (raw.scene_card ?? raw) as Record<string, unknown>
  const cardRef = card.scene_ref ?? raw.scene_ref
  if ((kind === 'auctra.scene_card.v1' || raw.scene_card) && nonemptyString(cardRef)) {
    const sceneRef = cardRef
    const rev = String(card.revision ?? raw.revision ?? '1')
    const chars = Array.isArray(card.characters) ? card.characters.map(String) : []
    out.push(
      buildElement({
        elementId: `script-scenecard-${sceneRef.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        domain: 'script',
        kind: 'script.scene_card',
        title: `场次卡 · ${String(card.heading ?? sceneRef)}`,
        subtitle: `目标：${String(card.goal ?? '待补齐')} · 修订 v${rev}`,
        sourceOwner: 'auctra',
        sourceRef: sceneRef,
        sourceRevision: rev,
        episodeRef: typeof card.episode_ref === 'string' ? card.episode_ref : undefined,
        sceneRef,
        characterRefs: chars,
        status: String(card.review_status ?? 'draft'),
        stale: Boolean(card.stale),
        payload: {
          sceneRef,
          heading: String(card.heading ?? sceneRef),
          revision: rev,
          sceneFunction: String(card.scene_function ?? ''),
          location: String(card.location ?? ''),
          storyTime: String(card.story_time ?? 'unknown'),
          goal: String(card.goal ?? ''),
          obstacle: String(card.obstacle ?? ''),
          stakes: String(card.stakes ?? ''),
          turn: String(card.turn ?? ''),
          beats: Array.isArray(card.beats) ? card.beats : [],
          setupPayoff: Array.isArray(card.setup_payoff) ? card.setup_payoff : [],
          characters: chars,
        },
      }),
    )
  }

  if (Array.isArray(raw.nodes) && nonemptyString(raw.scene_ref)) {
    const sceneRef = raw.scene_ref
    const nodes = Array.isArray(raw.nodes) ? raw.nodes : []
    const edges = Array.isArray(raw.edges) ? raw.edges : []
    out.push(
      buildElement({
        elementId: `script-graph-${sceneRef.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        domain: 'script',
        kind: 'script.context_graph',
        title: `情境关系图谱 · ${sceneRef}`,
        subtitle: `${nodes.length} 节点 · ${edges.length} 关系边`,
        sourceOwner: 'auctra',
        sourceRef: `${sceneRef}#context`,
        sceneRef,
        status: 'ready',
        payload: {
          sceneRef,
          scope: String(raw.scope ?? 'hop'),
          nodes,
          edges,
          hasMore: Boolean(raw.has_more),
        },
      }),
    )
  }

  if (nonemptyString(raw.candidate_id)) {
    const candId = raw.candidate_id
    const sceneRef = String(raw.scene_ref ?? 'scene:01')
    const baseRev = Number(raw.base_revision ?? 1)
    const canonRev = Number(raw.canonical_revision ?? baseRev)
    const stale = baseRev < canonRev || Boolean(raw.stale)
    out.push(
      buildElement({
        elementId: `script-diff-${candId}`,
        domain: 'script',
        kind: 'script.candidate_diff',
        title: `候选改写对比 · ${candId}`,
        subtitle: stale ? `基线 v${baseRev} 落后正式版 v${canonRev}（需重对齐）` : `基于修订 v${baseRev} · 待人工审阅`,
        sourceOwner: 'auctra',
        sourceRef: `owner:auctra:candidate:${candId}`,
        sourceRevision: String(baseRev),
        sceneRef,
        status: stale ? 'stale' : String(raw.status ?? 'pending_review'),
        stale,
        payload: {
          candidateId: candId,
          sceneRef,
          baseRevision: baseRev,
          canonicalRevision: canonRev,
          stale,
          canonicalExcerpt: String(raw.canonical_excerpt ?? ''),
          candidateExcerpt: String(raw.candidate_excerpt ?? ''),
          rationaleSummary: String(raw.rationale_summary ?? ''),
        },
      }),
    )
  }
  return out
}

const ROLE_DEFAULT_MIME: Record<string, string> = {
  keyframe: 'image/png',
  reference: 'image/png',
  video: 'video/mp4',
  voice: 'audio/mpeg',
  music: 'audio/mpeg',
  sfx: 'audio/mpeg',
}
const ROLE_ORDER = ['keyframe', 'reference', 'video', 'voice', 'music', 'sfx']

function linkedMediaForShot(shotRef: string, shotMedia: readonly MuweaveShotMediaEntryV1[]): MuweaveLinkedMediaV1[] {
  if (!shotRef) return []
  return shotMedia
    .filter((e) => e.shotRef === shotRef)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => ROLE_ORDER.indexOf(a.e.role) - ROLE_ORDER.indexOf(b.e.role) || a.i - b.i)
    .map(({ e }) => ({
      ...(e.sha256 ? { sha256: e.sha256 } : {}),
      ...(e.elementId ? { elementId: e.elementId } : {}),
      ...(e.artifactId ? { artifactId: e.artifactId } : {}),
      role: e.role,
      ...(e.mime ? { mime: e.mime } : {}),
    }))
}

export function normalizeScaenaPayload(
  raw: Record<string, unknown>,
  shotMedia: readonly MuweaveShotMediaEntryV1[] = [],
): MuweaveElementV1[] {
  const schema = String(raw.schema_version ?? raw.command ?? '')
  const out: MuweaveElementV1[] = []

  if (Array.isArray(raw.rows)) {
    const breakdownRef = String(raw.breakdown_ref ?? 'breakdown:ep01')
    const epRef = String(raw.episode_ref ?? 'episode:01')
    const rows = Array.isArray(raw.rows) ? raw.rows : []
    const safeRows = rows.map((r) => {
      const row = (r ?? {}) as Record<string, unknown>
      const restricted = Array.isArray(row.restricted_fields) ? row.restricted_fields.map(String) : []
      const cellsRaw = (row.cells ?? {}) as Record<string, unknown>
      const safeCells: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(cellsRaw)) {
        if (restricted.includes(k)) {
          safeCells[k] = `[restricted:${k}]`
        } else {
          safeCells[k] = v
        }
      }
      return {
        sceneRef: String(row.scene_ref ?? ''),
        shotRef: String(row.shot_ref ?? ''),
        order: Number(row.order ?? 0),
        plannedDurationMicros: Number(row.planned_duration_micros ?? 0),
        cells: safeCells,
        restrictedFields: restricted,
        linkedMedia: linkedMediaForShot(String(row.shot_ref ?? ''), shotMedia),
      }
    })
    const blobs = new Map<string, MuweaveMediaBlobRefV1>()
    for (const row of safeRows) {
      for (const m of row.linkedMedia) {
        if (!m.sha256 || blobs.has(m.sha256)) continue
        blobs.set(m.sha256, {
          blobDigest: m.sha256,
          mimeType: m.mime ?? ROLE_DEFAULT_MIME[m.role] ?? 'image/png',
          role: m.role,
          label: row.shotRef,
        })
      }
    }
    const shotRefs = safeRows.map((r) => r.shotRef).filter(Boolean)
    const sceneSet = new Set(safeRows.map((r) => r.sceneRef).filter(Boolean))
    out.push(
      buildElement({
        elementId: `drama-storyboard-${breakdownRef.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        domain: 'drama',
        kind: 'drama.storyboard_table',
        title: `分镜摘要表 · ${breakdownRef}`,
        subtitle: `${epRef} · 共 ${safeRows.length} 镜`,
        sourceOwner: 'scaena',
        sourceRef: breakdownRef,
        sourceRevision: String(raw.revision ?? '1'),
        episodeRef: epRef,
        ...(sceneSet.size === 1 ? { sceneRef: [...sceneSet][0] } : {}),
        shotRefs,
        status: 'ready',
        ...(blobs.size > 0 ? { mediaBlobs: [...blobs.values()] } : {}),
        payload: {
          breakdownRef,
          episodeRef: epRef,
          rows: safeRows,
        },
      }),
    )
  } else if (Array.isArray(raw.assets) || (schema === 'scaena.asset.list_page.v0.1' && Array.isArray(raw.items))) {
    const assets = Array.isArray(raw.assets) ? raw.assets : raw.items as unknown[]
    const parsedAssets = assets.map((a) => {
      const item = (a ?? {}) as Record<string, unknown>
      const versionRef = String(item.version_ref ?? '')
      const vMatch = /:v(\d+)$/.exec(versionRef)
      return {
        assetRef: String(item.asset_ref ?? ''),
        kind: String(item.kind ?? 'image'),
        role: String(item.role ?? 'character'),
        status: String(item.status ?? 'pending'),
        versionRef,
        parsedVersion: vMatch ? Number(vMatch[1]) : Number(item.version ?? 0),
        axes: {
          scaenaAdmission: String(item.scaena_admission ?? 'pending'),
          subjectFreeze: String(item.subject_freeze ?? 'unfrozen'),
          productionAcceptance: String(item.production_acceptance ?? 'pending'),
          currentUsability: String(item.current_usability ?? 'blocked'),
        },
      }
    })
    out.push(
      buildElement({
        elementId: 'drama-assets-readiness',
        domain: 'drama',
        kind: 'drama.asset_readiness',
        title: '生产资产四轴就绪台账',
        subtitle: `已登记 ${parsedAssets.length} 项生产资产`,
        sourceOwner: 'scaena',
        sourceRef: 'owner:scaena:assets',
        status: 'ready',
        payload: {
          totalCount: Number(raw.total_count ?? parsedAssets.length),
          assets: parsedAssets,
        },
      }),
    )
  } else if (schema === 'scaena.edit.timeline_view.v1' || raw.command === 'scaena.edit.revision.inspect') {
    const data = raw.data as Record<string, unknown> | undefined
    const timeline = data?.schema_version === 'scaena.edit.timeline_view.v1' ? data : raw
    if (!Array.isArray(timeline.clips)) return out
    const sessionRef = String(raw.session_ref ?? timeline.session_ref ?? 'edit-session:episode:01')
    const clips = timeline.clips
    const subtitleRows = timeline.subtitles ?? timeline.captions
    const stemRows = timeline.audio_stems ?? timeline.stems ?? timeline.audio
    const subtitles = Array.isArray(subtitleRows) ? subtitleRows : []
    const stems = Array.isArray(stemRows) ? stemRows : []
    out.push(
      buildElement({
        elementId: `drama-timeline-${sessionRef.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        domain: 'drama',
        kind: 'drama.edit_timeline',
        title: `剪辑时间线摘要 · ${sessionRef}`,
        subtitle: `${clips.length} 片段 · ${subtitles.length} 字幕事件 · ${stems.length} 音轨`,
        sourceOwner: 'scaena',
        sourceRef: sessionRef,
        sourceRevision: String(timeline.revision ?? timeline.revision_ref ?? '1'),
        status: 'ready',
        payload: {
          sessionRef,
          revision: String(timeline.revision ?? timeline.revision_ref ?? '1'),
          aspectRatio: String(timeline.aspect_ratio ?? '9:16'),
          fps: Number(timeline.fps ?? 24),
          clips,
          subtitles,
          audioStems: stems,
        },
      }),
    )
  }
  return out
}

export async function collectPiWorkspaceElements(workspaceDir: string): Promise<{
  state: OwnerReadinessState
  elements: MuweaveElementV1[]
}> {
  const piRoot = path.join(path.resolve(workspaceDir), '.pi')
  if (!existsSync(piRoot)) {
    return { state: 'empty', elements: [] }
  }
  const elements: MuweaveElementV1[] = []

  // 1. Collect .pi/goals/active_goal_*.md or goal summaries safely
  const goalsDir = path.join(piRoot, 'goals')
  if (existsSync(goalsDir)) {
    const entries = await readdir(goalsDir).catch(() => [] as string[])
    for (const file of entries.filter((f) => f.endsWith('.md')).slice(0, 20)) {
      const full = path.join(goalsDir, file)
      const content = await readFile(full, 'utf8').catch(() => '')
      if (!content || findPlaintextCredential(content)) continue
      const lines = content.split(/\r?\n/).filter(Boolean)
      const heading = lines.find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '') ?? file.replace(/\.md$/, '')
      const taskLines = lines.filter((l) => /^\s*-\s*\[[ xX~-]\]/.test(l)).slice(0, 30)
      elements.push(
        buildElement({
          elementId: `pi-goal-${file.replace(/\.md$/, '')}`,
          domain: 'harness',
          kind: 'harness.pi_goal',
          title: `Pi Goal · ${heading.slice(0, 64)}`,
          subtitle: `${taskLines.length} 个里程碑条目`,
          sourceOwner: 'pi',
          sourceRef: `pi://goals/${file}`,
          status: content.includes('status: complete') ? 'completed' : 'active',
          payload: {
            goalFile: file,
            heading: heading.slice(0, 140),
            tasks: taskLines.map((t) => stripHostPaths(t.slice(0, 200))),
          },
        }),
      )
    }
  }

  // 2. Collect .pi/subagent-runs/<id> metadata safely
  const subDir = path.join(piRoot, 'subagent-runs')
  if (existsSync(subDir)) {
    const runs = await readdir(subDir).catch(() => [] as string[])
    for (const runId of runs.slice(0, 20)) {
      const runPath = path.join(subDir, runId)
      const st = await stat(runPath).catch(() => undefined)
      if (!st?.isDirectory()) continue
      const files = await readdir(runPath).catch(() => [] as string[])
      elements.push(
        buildElement({
          elementId: `pi-subagent-${runId}`,
          domain: 'harness',
          kind: 'harness.pi_subagent',
          title: `Pi 子代理运行 · ${runId.slice(0, 12)}`,
          subtitle: `产物文件 ${files.length} 项`,
          sourceOwner: 'pi',
          sourceRef: `pi://subagent-runs/${runId}`,
          status: 'recorded',
          updatedAt: st.mtime.toISOString(),
          payload: {
            runId,
            artifactNames: files.slice(0, 25),
          },
        }),
      )
    }
  }

  // 3. Collect workspace PLAN.md if present
  const planPath = path.join(path.resolve(workspaceDir), 'PLAN.md')
  if (existsSync(planPath)) {
    const planText = await readFile(planPath, 'utf8').catch(() => '')
    if (planText && !findPlaintextCredential(planText)) {
      const steps = planText
        .split(/\r?\n/)
        .filter((l) => /^\s*-\s*\[[ xX]\]/.test(l) || /^#+\s+/.test(l))
        .slice(0, 40)
      elements.push(
        buildElement({
          elementId: 'pi-workspace-plan',
          domain: 'harness',
          kind: 'harness.pi_plan',
          title: 'Pi 实施计划（PLAN.md）',
          subtitle: `结构化章节/步骤 ${steps.length} 条`,
          sourceOwner: 'pi',
          sourceRef: 'pi://workspace/PLAN.md',
          status: 'ready',
          payload: {
            digest: sha256Digest(planText),
            outline: steps.map((s) => stripHostPaths(s.slice(0, 200))),
          },
        }),
      )
    }
  }

  return { state: elements.length > 0 ? 'ready' : 'empty', elements }
}

export interface SyncBundleOptions {
  workspaceDir: string
  runner?: CliRunner
  /** Optional pre-fetched official contract payloads (e.g. from DSH tool receipts or tests). */
  upstreamPayloads?: {
    eikona?: Record<string, unknown>[]
    auctra?: Record<string, unknown>[]
    scaena?: Record<string, unknown>[]
    dshArtifacts?: Array<{
      artifactId: string
      toolName: string
      title: string
      status: string
      episodeRef?: string
      sceneRef?: string
      summary: Record<string, unknown>
    }>
  }
}

async function ingestElementsUnlocked(
  workspaceDir: string,
  newElements: readonly MuweaveElementV1[],
  ownerStateUpdates: Partial<Record<MuweaveSourceOwner, OwnerReadinessState>> = {},
): Promise<MuweaveIndexV1> {
  const manifest = await initBundle(workspaceDir)
  const root = muweaveRoot(workspaceDir)
  const indexPath = path.join(root, 'index.v1.json')
  let existingElements: MuweaveElementSummaryV1[] = []
  let existingStates: Record<MuweaveSourceOwner, OwnerReadinessState> = {
    eikona: 'empty',
    auctra: 'empty',
    scaena: 'empty',
    pi: 'empty',
    dsh: 'empty',
  }

  if (existsSync(indexPath)) {
    const rawIdx = JSON.parse(await readFile(indexPath, 'utf8'))
    const parsedIdx = parseBundleIndex(rawIdx)
    if (parsedIdx.ok) {
      existingElements = parsedIdx.value.elements
      existingStates = { ...existingStates, ...parsedIdx.value.ownerStates }
    }
  }

  const byId = new Map<string, MuweaveElementSummaryV1>()
  for (const item of existingElements) {
    byId.set(item.elementId, item)
  }

  for (const rawEl of newElements) {
    // Only record mediaBlobs that are actually materialized in local CAS so validateBundleOnDisk stays strict
    const presentBlobs = (rawEl.mediaBlobs ?? []).filter((b) => existsSync(casBlobPath(root, b.blobDigest)))
    const el: MuweaveElementV1 =
      presentBlobs.length === (rawEl.mediaBlobs ?? []).length
        ? rawEl
        : {
            ...rawEl,
            mediaBlobs: presentBlobs.length > 0 ? presentBlobs : undefined,
            digest: computeElementDigest({
              ...rawEl,
              mediaBlobs: presentBlobs,
            }),
          }
    await atomicWriteJson(elementFilePath(root, el.domain, el.elementId), el)
    const { schemaVersion: _sv, payload: _pl, ...summary } = el
    byId.set(el.elementId, summary)
  }

  const merged = Array.from(byId.values()).sort((a, b) => a.elementId.localeCompare(b.elementId))
  const nextRevision = manifest.revision + 1
  const now = new Date().toISOString()
  const updatedStates: Record<MuweaveSourceOwner, OwnerReadinessState> = {
    ...existingStates,
    ...ownerStateUpdates,
  }

  const nextIndex: MuweaveIndexV1 = {
    schemaVersion: MUWEAVE_INDEX_SCHEMA,
    projectId: manifest.projectId,
    title: manifest.title,
    revision: nextRevision,
    generatedAt: now,
    ownerStates: updatedStates,
    counts: {
      total: merged.length,
      byDomain: {
        eikona: merged.filter((e) => e.domain === 'eikona').length,
        script: merged.filter((e) => e.domain === 'script').length,
        drama: merged.filter((e) => e.domain === 'drama').length,
        harness: merged.filter((e) => e.domain === 'harness').length,
      },
    },
    elements: merged,
  }

  await atomicWriteJson(indexPath, nextIndex)
  await atomicWriteJson(path.join(root, 'bundle.v1.json'), {
    ...manifest,
    revision: nextRevision,
    updatedAt: now,
  } satisfies MuweaveBundleManifestV1)
  await appendSyncEvent(root, {
    type: 'bundle.synced',
    revision: nextRevision,
    ingestedCount: newElements.length,
    totalCount: merged.length,
  })
  return nextIndex
}

export async function ingestElementsIntoBundle(
  workspaceDir: string,
  newElements: readonly MuweaveElementV1[],
  ownerStateUpdates: Partial<Record<MuweaveSourceOwner, OwnerReadinessState>> = {},
): Promise<MuweaveIndexV1> {
  return withWorkspaceBundleLock(workspaceDir, () =>
    ingestElementsUnlocked(workspaceDir, newElements, ownerStateUpdates),
  )
}

type OwnerResponse = {
  payload?: Record<string, unknown>
  exitCode: number
  timedOut?: true
}

function ownerResponse(res: CliExecResult, refs?: Record<string, string>): OwnerResponse {
  const payload = tryParseJson(res.stdout)
  return { exitCode: res.exitCode, timedOut: res.timedOut, payload: payload && { ...payload, ...refs } }
}

const OWNER_NON_READY_STATUSES = new Set([
  'failed', 'failure', 'error', 'denied', 'blocked', 'unavailable', 'timeout', 'timed_out',
  'cancelled', 'canceled', 'cancelling', 'planned', 'queued', 'running', 'requires_action', 'conflict',
])

function collectOwner(
  responses: readonly OwnerResponse[],
  normalize: (payload: Record<string, unknown>) => MuweaveElementV1[],
  collected: MuweaveElementV1[],
): OwnerReadinessState {
  let state: OwnerReadinessState = 'empty'
  for (const { payload, exitCode, timedOut } of responses) {
    const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
    if (!payload || exitCode !== 0 || timedOut || payload.ok === false || payload.success === false || OWNER_NON_READY_STATUSES.has(status)) {
      state = 'unavailable'
      continue
    }
    try {
      const elements = normalize(payload)
      if (elements.length === 0 || elements.some((element) => !parseElement(element).ok)) {
        state = 'unavailable'
        continue
      }
      collected.push(...elements)
      // Keep successful materializations, but don't advertise full readiness after a failed read.
      if (state === 'empty') state = 'ready'
    } catch {
      state = 'unavailable'
    }
  }
  return state
}

async function syncBundleUnlocked(options: SyncBundleOptions): Promise<MuweaveIndexV1> {
  const workspaceDir = path.resolve(options.workspaceDir)
  const runner = options.runner ?? defaultCliRunner
  const bindings = (await readExistingBundleManifest(workspaceDir))?.bindings ?? emptyBindings()
  const collected: MuweaveElementV1[] = []
  const ownerStates: Partial<Record<MuweaveSourceOwner, OwnerReadinessState>> = {}

  // 1. Eikona collection via official CLI JSON contracts
  const eikonaPayloads: OwnerResponse[] = (options.upstreamPayloads?.eikona ?? []).map((payload) => ({ payload, exitCode: 0 }))
  for (const runId of bindings.eikonaRuns) {
    const res = await runner('eikona', ['review', 'packet', runId, '--with-assessment', '--json'], { cwd: workspaceDir })
    eikonaPayloads.push(ownerResponse(res))
  }
  for (const handle of bindings.eikonaHandles) {
    const res = await runner('eikona', ['assets', 'handoff', handle, '--json'], { cwd: workspaceDir })
    eikonaPayloads.push(ownerResponse(res))
  }
  for (const batchRef of bindings.eikonaBatches) {
    const res = await runner('eikona', ['assets', 'handoff', '--batch', batchRef, '--json'], { cwd: workspaceDir })
    eikonaPayloads.push(ownerResponse(res))
  }
  for (const colUri of bindings.eikonaCollections) {
    const res = await runner('eikona', ['library', 'handoff', colUri, '--json'], { cwd: workspaceDir })
    eikonaPayloads.push(ownerResponse(res))
  }
  ownerStates.eikona = collectOwner(eikonaPayloads, normalizeEikonaPayload, collected)

  // 2. Auctra collection (MUST check .auctra marker before invoking CLI to prevent side-effect writes)
  const auctraPayloads: OwnerResponse[] = (options.upstreamPayloads?.auctra ?? []).map((payload) => ({ payload, exitCode: 0 }))
  const hasAuctraMarker = existsSync(path.join(workspaceDir, '.auctra'))
  if (!hasAuctraMarker && auctraPayloads.length === 0) {
    ownerStates.auctra = bindings.auctraProjectRef || bindings.auctraSceneRefs.length > 0
      ? 'uninitialized_owner'
      : 'empty'
  } else {
    if (hasAuctraMarker && bindings.auctraProjectRef) {
      const roomRes = await runner('auctra', ['screenplay', 'room', 'describe', '--project', workspaceDir, '--json'], {
        cwd: workspaceDir,
      })
      auctraPayloads.push(ownerResponse(roomRes))
      for (const sceneRef of bindings.auctraSceneRefs) {
        const cardRes = await runner(
          'auctra',
          ['screenplay', 'room', 'scene-card', 'describe', sceneRef, '--project', workspaceDir, '--json'],
          { cwd: workspaceDir },
        )
        auctraPayloads.push(ownerResponse(cardRes))
        const graphRes = await runner(
          'auctra',
          ['screenplay', 'room', 'context', sceneRef, '--scope', 'hop', '--project', workspaceDir, '--json'],
          { cwd: workspaceDir },
        )
        auctraPayloads.push(ownerResponse(graphRes))
      }
    }
    ownerStates.auctra = collectOwner(auctraPayloads, normalizeAuctraPayload, collected)
  }

  // 3. Scaena collection (MUST check .scaena/project.json marker so we never trigger 5MB index.sqlite creation)
  const scaenaPayloads: OwnerResponse[] = (options.upstreamPayloads?.scaena ?? []).map((payload) => ({ payload, exitCode: 0 }))
  const hasScaenaMarker = existsSync(path.join(workspaceDir, '.scaena', 'project.json'))
  if (!hasScaenaMarker && scaenaPayloads.length === 0) {
    ownerStates.scaena =
      bindings.scaenaBreakdownRefs.length > 0 ||
      bindings.scaenaEpisodeRefs.length > 0 ||
      bindings.scaenaEditSessionRefs.length > 0
        ? 'uninitialized_owner'
        : 'empty'
  } else {
    if (hasScaenaMarker) {
      for (const bdRef of bindings.scaenaBreakdownRefs) {
        const bdRes = await runner(
          'scaena',
          ['storyboard', 'table', 'show', bdRef, '--project', workspaceDir, '--view', 'summary', '--page-size', '200', '--json', '--no-remote'],
          { cwd: workspaceDir },
        )
        scaenaPayloads.push(ownerResponse(bdRes, { breakdown_ref: bdRef }))
      }
      const assetRes = await runner(
        'scaena',
        ['asset', 'list', '--project', workspaceDir, '--limit', '100', '--sort=ref_asc', '--json', '--no-remote'],
        { cwd: workspaceDir },
      )
      scaenaPayloads.push(ownerResponse(assetRes))
      for (const editRef of bindings.scaenaEditSessionRefs) {
        const tlRes = await runner(
          'scaena',
          ['edit', 'revision', 'inspect', `--session=${editRef}`, '--project', workspaceDir, '--json', '--no-remote'],
          { cwd: workspaceDir },
        )
        scaenaPayloads.push(ownerResponse(tlRes, { session_ref: editRef }))
      }
    }
    ownerStates.scaena = collectOwner(scaenaPayloads, (payload) => normalizeScaenaPayload(payload, bindings.shotMedia), collected)
  }

  // 4. Pi workspace artifacts (.pi/goals, .pi/subagent-runs, PLAN.md)
  if (bindings.piIncludeWorkspace) {
    const piCollected = await collectPiWorkspaceElements(workspaceDir)
    ownerStates.pi = piCollected.state
    collected.push(...piCollected.elements)
  }

  // 5. DSH tool artifacts passed from session / plugin host
  const dshArtifacts = options.upstreamPayloads?.dshArtifacts ?? []
  for (const item of dshArtifacts) {
    collected.push(
      buildElement({
        elementId: `dsh-artifact-${item.artifactId}`,
        domain: 'harness',
        kind: 'harness.dsh_tool_artifact',
        title: item.title,
        subtitle: `工具 ${item.toolName} · ${item.status}`,
        sourceOwner: 'dsh',
        sourceRef: `dsh://tool-artifacts/${item.artifactId}`,
        episodeRef: item.episodeRef,
        sceneRef: item.sceneRef,
        status: item.status,
        payload: {
          artifactId: item.artifactId,
          toolName: item.toolName,
          summary: item.summary,
        },
      }),
    )
  }
  if (dshArtifacts.length > 0) ownerStates.dsh = 'ready'

  return ingestElementsUnlocked(workspaceDir, collected, ownerStates)
}

export async function syncBundle(options: SyncBundleOptions): Promise<MuweaveIndexV1> {
  return withWorkspaceBundleLock(options.workspaceDir, () => syncBundleUnlocked(options))
}

export async function readBundleIndexFromDisk(workspaceDir: string): Promise<MuweaveIndexV1> {
  const indexPath = path.join(muweaveRoot(workspaceDir), 'index.v1.json')
  if (!existsSync(indexPath)) throw new BundleValidationError('bundle_not_initialized', 'Missing .muweave/index.v1.json')
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(indexPath, 'utf8'))
  } catch {
    throw new BundleValidationError('contract_mismatch', 'Bundle index is not valid JSON')
  }
  const parsed = parseBundleIndex(raw)
  if (!parsed.ok) throw new BundleValidationError(parsed.code, parsed.reason)
  return parsed.value
}

export async function readElementFromDisk(workspaceDir: string, elementId: string): Promise<MuweaveElementV1> {
  const root = muweaveRoot(workspaceDir)
  const idx = await readBundleIndexFromDisk(workspaceDir)
  const summary = idx.elements.find((e) => e.elementId === elementId)
  if (!summary) {
    throw new Error(`Element not found: ${elementId}`)
  }
  const filePath = elementFilePath(root, summary.domain, summary.elementId)
  const raw = JSON.parse(await readFile(filePath, 'utf8'))
  const parsed = parseElement(raw)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

export interface BundleValidationReport {
  ok: boolean
  projectId?: string
  revision?: number
  checkedElements: number
  verifiedCasBlobs: number
  findings: Array<{ code: string; message: string }>
}

export async function validateBundleOnDisk(workspaceDir: string): Promise<BundleValidationReport> {
  const root = muweaveRoot(workspaceDir)
  const findings: Array<{ code: string; message: string }> = []
  const manifestPath = path.join(root, 'bundle.v1.json')
  const indexPath = path.join(root, 'index.v1.json')
  if (!existsSync(manifestPath) || !existsSync(indexPath)) {
    return {
      ok: false,
      checkedElements: 0,
      verifiedCasBlobs: 0,
      findings: [{ code: 'bundle_not_initialized', message: 'Missing .muweave/bundle.v1.json or index.v1.json' }],
    }
  }
  const manifestRes = parseBundleManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  if (!manifestRes.ok) {
    findings.push({ code: manifestRes.code, message: manifestRes.reason })
  }
  const indexRes = parseBundleIndex(JSON.parse(await readFile(indexPath, 'utf8')))
  if (!indexRes.ok) {
    findings.push({ code: indexRes.code, message: indexRes.reason })
    return { ok: false, checkedElements: 0, verifiedCasBlobs: 0, findings }
  }

  let checkedElements = 0
  let verifiedCasBlobs = 0
  for (const summary of indexRes.value.elements) {
    const elPath = elementFilePath(root, summary.domain, summary.elementId)
    if (!existsSync(elPath)) {
      findings.push({ code: 'missing_element_file', message: `Missing element file for ${summary.elementId}` })
      continue
    }
    const elRes = parseElement(JSON.parse(await readFile(elPath, 'utf8')))
    if (!elRes.ok) {
      findings.push({ code: elRes.code, message: `${summary.elementId}: ${elRes.reason}` })
      continue
    }
    const recomputedDigest = computeElementDigest(elRes.value)
    if (elRes.value.digest !== recomputedDigest) {
      findings.push({
        code: 'element_digest_tampered',
        message: `Stored content digest mismatch on ${summary.elementId}: expected ${elRes.value.digest}, computed ${recomputedDigest}`,
      })
    }
    if (elRes.value.digest !== summary.digest) {
      findings.push({ code: 'digest_mismatch', message: `Index vs element digest mismatch on ${summary.elementId}` })
    }
    checkedElements++
    for (const blob of elRes.value.mediaBlobs ?? []) {
      const p = casBlobPath(root, blob.blobDigest)
      if (!existsSync(p)) {
        findings.push({
          code: 'missing_cas_blob',
          message: `Missing CAS media blob ${blob.blobDigest} referenced by ${summary.elementId}`,
        })
        continue
      }
      try {
        await readCasBlobVerified(workspaceDir, blob.blobDigest)
        verifiedCasBlobs++
      } catch (err) {
        findings.push({ code: 'cas_corrupted', message: err instanceof Error ? err.message : 'CAS verification failed' })
      }
    }
  }

  return {
    ok: findings.length === 0,
    projectId: indexRes.value.projectId,
    revision: indexRes.value.revision,
    checkedElements,
    verifiedCasBlobs,
    findings,
  }
}

export async function cleanAndRebuildBundle(options: SyncBundleOptions): Promise<MuweaveIndexV1> {
  return withWorkspaceBundleLock(options.workspaceDir, async () => {
    const root = muweaveRoot(options.workspaceDir)
    const manifestPath = path.join(root, 'bundle.v1.json')
    const savedManifest = await readExistingBundleManifest(options.workspaceDir)
    await rm(root, { recursive: true, force: true })
    await initBundle(options.workspaceDir, {
      projectId: savedManifest?.projectId,
      title: savedManifest?.title,
    })
    if (savedManifest) {
      await atomicWriteJson(manifestPath, {
        ...savedManifest,
        updatedAt: new Date().toISOString(),
      })
    }
    return syncBundleUnlocked(options)
  })
}
