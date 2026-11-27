/**
 * Shared RPC wire protocol, timing projection types, and generation monotonic guard.
 * Zero Node.js imports — shared between host half and client half.
 */
import type {
  MuweaveDomain,
  MuweaveElementFilter,
  MuweaveElementKind,
  MuweaveElementSummaryV1,
  MuweaveElementV1,
  MuweaveIndexV1,
  MuweaveSourceOwner,
  OwnerReadinessState,
} from '@yeisme/muweave-bundle/consumer'
import { findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import { CAPABILITY_RPC_ACTIONS } from './capability-protocol'
import { BOT_TASK_RPC_ACTIONS } from './bot-task/protocol'

export const MUWEAVE_RPC_PATH = '/api/muweave-dsh/rpc' as const
export const MUWEAVE_MEDIA_PATH = '/api/muweave-dsh/media' as const

export type ProjectStatus =
  | 'preparing'
  | 'in_production'
  | 'ready_to_publish'
  | 'published'
  | 'archived'

export interface ProjectOwnerBindingV1 {
  workspaceId: string
  owner: 'eikona' | 'auctra' | 'scaena' | 'pi'
  refs: string[]
  bindingState: 'bound' | 'uninitialized' | 'unavailable' | 'conflict'
  updatedAt: string
}

export interface ProjectBindInputV1 {
  projectId: string
  workspaceId: string
  owner: ProjectOwnerBindingV1['owner']
  refs: string[]
  expectedRevision?: string
}

export interface ProjectUnbindInputV1 {
  projectId: string
  workspaceId: string
  owner: ProjectOwnerBindingV1['owner']
  refs?: string[]
}

export interface ProjectClaimInputV1 {
  workspaceId: string
  projectId: string
  title: string
  status?: ProjectStatus
  idempotencyKey: string
}

export interface ProjectClaimResultV1 {
  project: ProjectRecordV1
  workspaceRefs: string[]
  claimed: true
}

export type DiagnosisFindingCode =
  | 'registry_corrupt'
  | 'bundle_missing'
  | 'owner_unavailable'
  | 'revision_conflict'
  | 'unknown_operation'

export type DiagnosisFindingSeverity = 'info' | 'warn' | 'error'

export interface DiagnosisFindingV1 {
  code: DiagnosisFindingCode
  severity: DiagnosisFindingSeverity
  detail: string
  action?: string
}

export interface DiagnosisReportV1 {
  projectId: string
  title: string
  state: 'healthy' | 'warning' | 'broken' | 'unknown'
  findings: DiagnosisFindingV1[]
}

export interface ProjectDiagnoseResultV1 {
  reports: DiagnosisReportV1[]
}

export interface ProjectUnbindResultV1 {
  project: ProjectRecordV1
  removed: boolean
}

/** Durable project identity. Content stays in .muweave/; this record only holds intent. */
export interface ProjectRecordV1 {
  id: string
  title: string
  status: ProjectStatus
  workspaceRefs: string[]
  ownerBindings: ProjectOwnerBindingV1[]
  createdAt: string
  updatedAt: string
  coverRef?: string
  archivedAt?: string
  archived: boolean
  lastSyncedAt?: string
  lastObservedRevisions?: Record<string, string>
  /** Present only for a project created by project.claim; used for replay-safe claims. */
  claimIdempotencyKey?: string
}

export interface ProjectsRegistryV1 {
  schema: 'muweave.projects.v1'
  projects: ProjectRecordV1[]
  activeProjectId?: string
  updatedAt: string
}

export const RPC_ACTIONS = [
  'workspace.list',
  'workspace.register',
  'bundle.status',
  'bundle.bind',
  'bundle.sync',
  'bundle.elements.list',
  'bundle.element.get',
  'media.token.issue',
  'eikona.spec.validate',
  'eikona.feedback.decide',
  'eikona.asset.bind',
  'eikona.asset.handoff',
  'auctra.scene_card.save',
  'auctra.scene_card.submit',
  'cli.catalog',
  'cli.run_allowlisted',
  'templates.list',
  'templates.render_preview',
  'timing.projection',
  'operation.reconcile',
  'schedule.list',
  'schedule.plan',
  'schedule.clear',
  'project.list',
  'project.create',
  'project.update',
  'project.archive',
  'project.restore',
  'project.bind',
  'project.unbind',
  'project.claim',
  'project.diagnose',
  'project.activate',
  'project.clone',
  'project.migration.report',
  'drama.shot.review.list',
  'drama.shot.review.set',
  'drama.shot.review.batch',
  'drama.shot.review.import',
  'drama.export.manifest',
  'drama.cut.get',
  'drama.cut.set',
  'drama.cut.reset',
  'drama.qc.report',
  'project.bible.get',
  'project.bible.set',
  'workspace.tabs.get',
  'workspace.tabs.save',
  'workspace.tabs.reset',
  'canvas.board.get',
  'canvas.board.save',
  'canvas.board.reset',
  'stage3d.scene.get',
  'stage3d.scene.save',
  'stage3d.scene.reset',
  'stage3d.snapshot.save',
  'audio.mix.get',
  'audio.mix.save',
  'audio.mix.reset',
  'adapter.custom.list',
  'adapter.custom.save',
  'adapter.custom.remove',
  'adapter.custom.test',
] as const

export type MuweaveRpcAction =
  | (typeof RPC_ACTIONS)[number]
  | (typeof CAPABILITY_RPC_ACTIONS)[number]
  | (typeof BOT_TASK_RPC_ACTIONS)[number]

export function isMuweaveRpcAction(v: unknown): v is MuweaveRpcAction {
  if (typeof v !== 'string') return false
  return (
    (RPC_ACTIONS as readonly string[]).includes(v) ||
    (CAPABILITY_RPC_ACTIONS as readonly string[]).includes(v) ||
    (BOT_TASK_RPC_ACTIONS as readonly string[]).includes(v)
  )
}

export interface RpcErrorShape {
  code: string
  message: string
  retryable?: boolean
  operationRef?: string
  details?: Record<string, unknown>
}

export type RpcEnvelope<T = unknown> =
  | { ok: true; generation: number; hostInstanceId?: string; data: T }
  | { ok: false; generation: number; hostInstanceId?: string; error: RpcErrorShape }

export function rpcOk<T>(generation: number, data: T, hostInstanceId?: string): RpcEnvelope<T> {
  return { ok: true, generation, ...(hostInstanceId ? { hostInstanceId } : {}), data }
}

export function rpcFail(
  generation: number,
  code: string,
  message: string,
  extra?: { retryable?: boolean; operationRef?: string; hostInstanceId?: string; details?: Record<string, unknown> },
): RpcEnvelope<never> {
  return {
    ok: false,
    generation,
    ...(extra?.hostInstanceId ? { hostInstanceId: extra.hostInstanceId } : {}),
    error: {
      code,
      message,
      ...(extra?.retryable === undefined ? {} : { retryable: extra.retryable }),
      ...(extra?.operationRef ? { operationRef: extra.operationRef } : {}),
      ...(extra?.details ? { details: extra.details } : {}),
    },
  }
}

export function stampHost<T>(envelope: RpcEnvelope<T>, hostInstanceId: string): RpcEnvelope<T> {
  return { ...envelope, hostInstanceId }
}

export interface WorkspaceSummaryView {
  workspaceId: string
  label: string
  hasBundle: boolean
  ownerMarkers: {
    eikona: boolean
    auctra: boolean
    scaena: boolean
    pi: boolean
  }
}

export type TimingSpanStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_for_human'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'unknown'
  | 'reconcile_required'

export interface TimingSpanProjectionV1 {
  spanId: string
  operationRef: string
  owner: 'eikona' | 'auctra' | 'scaena' | 'pi' | 'dsh' | 'cli'
  stageLabel: string
  status: TimingSpanStatus
  startedAt: string
  updatedAt: string
  elapsedMs: number
  idempotencyKey?: string
  blockerReason?: string
  nextAction?: 'none' | 'approve' | 'human_review' | 'reconcile_original' | 'inspect'
  /** Present for job-backed spans. */
  jobRef?: string
  taskRef?: string
  traceId?: string
}

export interface TimingProjectionSnapshotV1 {
  capturedAt: string
  activeCount: number
  waitingHumanCount: number
  reconcileRequiredCount: number
  spans: TimingSpanProjectionV1[]
}

export interface OperationRecordView {
  operationRef: string
  workspaceId: string
  action: string
  owner: 'eikona' | 'auctra' | 'scaena' | 'cli'
  idempotencyKey: string
  requestDigest: string
  expectedRevision?: string
  status: TimingSpanStatus
  createdAt: string
  updatedAt: string
  receiptSummary?: Record<string, unknown>
  errorCode?: string
}

export interface TemplateSlotDefV1 {
  name: string
  label: string
  inputType: 'text' | 'textarea' | 'enum'
  required: boolean
  options?: string[]
}

export interface TemplateCatalogEntryV1 {
  templateRef: string
  releaseId: string
  title: string
  category: 'eikona' | 'script' | 'drama'
  version: string
  digest: string
  summary: string
  slots: TemplateSlotDefV1[]
}

export interface AllowlistedCliCardDefV1 {
  operationId: string
  owner: 'muweave-bundle' | 'eikona' | 'auctra' | 'scaena'
  title: string
  description: string
  readOnly: boolean
  requiresMarker?: 'auctra' | 'scaena'
}

/**
 * Monotonic generation tracker on the client side (prevents stale read replies from overwriting
 * newer write states, and detects host restarts cleanly per dsh-plugin-development rules).
 */
export class ClientGenerationGuard {
  private appliedGen = 0
  private appliedIssuedAt = 0
  private hostInstanceId = ''
  private seq = 0

  nextIssueStamp(): number {
    return ++this.seq
  }

  observeHost(hostInstanceId: string | undefined): void {
    if (!hostInstanceId || hostInstanceId === this.hostInstanceId) return
    // A new process marker starts a fresh generation epoch without accepting this response by itself.
    this.hostInstanceId = hostInstanceId
    this.appliedGen = 0
    this.appliedIssuedAt = 0
  }

  shouldAccept(responseGeneration: number, requestIssueStamp: number): boolean {
    if (!Number.isSafeInteger(responseGeneration) || responseGeneration < 0) return false
    if (responseGeneration > this.appliedGen) {
      this.appliedGen = responseGeneration
      this.appliedIssuedAt = requestIssueStamp
      return true
    }
    if (responseGeneration === this.appliedGen) {
      // Same generation means the same host state: parallel reads may land in any order.
      this.appliedIssuedAt = Math.max(this.appliedIssuedAt, requestIssueStamp)
      return true
    }
    // A late response must never move the client backwards, even when it was issued later.
    return false
  }

  currentGeneration(): number {
    return this.appliedGen
  }
}

export function validateIncomingRpcBody(raw: unknown):
  | { ok: true; action: MuweaveRpcAction; payload: Record<string, unknown> }
  | { ok: false; code: string; message: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'muweave/invalid_body', message: 'Request body must be a JSON object' }
  }
  const obj = raw as Record<string, unknown>
  if (!isMuweaveRpcAction(obj.action)) {
    return { ok: false, code: 'muweave/unknown_action', message: `Action not allowlisted: ${String(obj.action)}` }
  }
  const payload = obj.payload === undefined ? {} : obj.payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'muweave/invalid_payload', message: 'Payload must be an object' }
  }
  const credHit = findPlaintextCredential(payload)
  if (credHit) {
    return { ok: false, code: 'muweave/plaintext_credential_rejected', message: 'Plaintext credentials are prohibited' }
  }
  return { ok: true, action: obj.action, payload: payload as Record<string, unknown> }
}

/** One persisted row of the publishing board; the bundle stays the element truth. */
export interface ScheduleEntryV1 {
  ref: string
  label: string
  kind: string
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  note?: string
  updatedAt: string
  /** Optional v1-compatible ownership extension; omitted on legacy rows. */
  projectId?: string
}

/**
 * Response-only view of a schedule row. `legacy` is derived for clients and is never persisted;
 * the optional `projectId` extension keeps the existing `muweave.schedule.v1` schema compatible.
 * Do not add a board-level v2 marker: this optional field is a backward-compatible v1 extension,
 * and a version marker would create migration work without changing the board's required shape.
 */
export interface ScheduleEntryViewV1 extends ScheduleEntryV1 {
  legacy?: true
}

export interface ScheduleBoardV1 {
  schema: 'muweave.schedule.v1'
  entries: ScheduleEntryViewV1[]
  updatedAt: string
}

export type ShotReviewStatus = 'draft' | 'in_review' | 'needs_revision' | 'approved' | 'locked'

export interface ShotReviewRecordV1 {
  workspaceId: string
  shotRef: string
  sceneRef?: string
  episodeRef?: string
  status: ShotReviewStatus
  note?: string
  tags: string[]
  revision: number
  updatedAt: string
}

export interface ShotReviewSetInputV1 {
  workspaceId?: string
  shotRef: string
  sceneRef?: string
  episodeRef?: string
  status: ShotReviewStatus
  note?: string
  tags?: string[]
  expectedRevision?: number
}

export type DramaExportFormat =
  | 'cut_manifest_v1'
  | 'cmx3600_edl'
  | 'shotlist_csv'
  | 'fcpxml_1_10'
  | 'jianying_draft_v1'
  | 'srt_subtitles'
  | 'webvtt_subtitles'
  | 'review_deck_html'

export interface DramaExportResultV1 {
  schema: 'muweave.drama-export.v1'
  format: DramaExportFormat
  filename: string
  mimeType:
    | 'application/json'
    | 'text/plain'
    | 'text/csv'
    | 'application/xml'
    | 'text/html'
    | 'text/vtt'
    | 'application/x-subrip'
  shotCount: number
  totalDurationMs: number
  fps: number
  aspectRatio: string
  content: string
  generatedAt: string
}

export type CustomAdapterProtocol = 'openai_http' | 'comfyui_http' | 'cli_wrapper'

export interface CustomAdapterConfigV1 {
  adapterId: string
  title: string
  protocol: CustomAdapterProtocol
  kind: 'image' | 'voice' | 'video' | 'sfx' | 'music'
  stage: 'visual' | 'storyboard' | 'sound'
  enabled: boolean
  endpointUrl?: string
  binary?: string
  argsTemplate?: string[]
  model?: string
  /** Name of the environment variable holding the API key (e.g. OPENAI_API_KEY); NEVER the secret itself. */
  authEnvVar?: string
  unitPriceUsd?: number
  defaultSlots?: number
  maxSlots?: number
  allowPrivateNetwork?: boolean
  updatedAt: string
}

export interface CustomAdapterViewV1 extends CustomAdapterConfigV1 {
  /** True when authEnvVar is omitted or process.env[authEnvVar] is non-empty; secret value is NEVER returned. */
  envReady: boolean
}

export type CutTransitionKind = 'cut' | 'crossfade' | 'dip_to_black'

export interface EpisodeCutOverrideV1 {
  workspaceId: string
  episodeRef: string
  shotOrder: string[]
  omittedShotRefs: string[]
  durationOverridesMicros: Record<string, number>
  transitions: Record<string, CutTransitionKind>
  revision: number
  updatedAt: string
}

export interface EpisodeCutSetInputV1 {
  workspaceId?: string
  episodeRef: string
  shotOrder?: string[]
  omittedShotRefs?: string[]
  durationOverridesMicros?: Record<string, number>
  transitions?: Record<string, CutTransitionKind>
  expectedRevision?: number
}

export interface ContinuityColorSwatchV1 {
  name: string
  hex: string
}

export interface ContinuityCharacterAnchorV1 {
  name: string
  roleRef?: string
  wardrobe: string
  immutableTraits: string
  negativeNotes?: string
}

export interface ContinuityVisualGrammarV1 {
  aspectRatio: string
  lensStyle: string
  lightingRule: string
  styleDirective: string
}

export interface ContinuityBibleV1 {
  schema: 'muweave.continuity-bible.v1'
  workspaceId: string
  projectTitle?: string
  visualGrammar: ContinuityVisualGrammarV1
  colorPalette: ContinuityColorSwatchV1[]
  characterAnchors: ContinuityCharacterAnchorV1[]
  negativeGuardrails: string[]
  complianceDisclosure: string
  revision: string
  updatedAt: string
}

export interface ContinuityBibleSetInputV1 {
  workspaceId?: string
  projectTitle?: string
  visualGrammar?: Partial<ContinuityVisualGrammarV1>
  colorPalette?: ContinuityColorSwatchV1[]
  characterAnchors?: ContinuityCharacterAnchorV1[]
  negativeGuardrails?: string[]
  complianceDisclosure?: string
  expectedRevision?: string
}

export type EpisodeQcSeverity = 'blocker' | 'warning' | 'pass'

export interface EpisodeQcFindingV1 {
  code: string
  severity: EpisodeQcSeverity
  shotRef?: string
  message: string
  suggestion?: string
}

export interface EpisodeQcReportV1 {
  schema: 'muweave.episode-qc.v1'
  episodeRef?: string
  score: number
  readyForDelivery: boolean
  counts: {
    blocker: number
    warning: number
    pass: number
  }
  shotCount: number
  totalDurationMs: number
  findings: EpisodeQcFindingV1[]
  generatedAt: string
}

export interface ShotReviewImportItemV1 {
  shotRef: string
  status: ShotReviewStatus
  note?: string
  tags?: string[]
}

export interface ShotReviewImportEntryResultV1 {
  shotRef: string
  action: 'imported' | 'skipped_locked' | 'invalid'
  status?: ShotReviewStatus
  reason?: string
}

export interface ShotReviewImportResultV1 {
  importedCount: number
  skippedLockedCount: number
  invalidCount: number
  results: ShotReviewImportEntryResultV1[]
}

export type TheaterRoomGroup = 'core' | 'studio' | 'ops'

export type WorkspaceTabPresetId =
  | 'default'
  | 'director'
  | 'writer'
  | 'visual_3d'
  | 'full_studio'
  | 'custom'

export interface WorkspaceTabsConfigV1 {
  schema: 'muweave.workspace-tabs.v1'
  workspaceId: string
  presetId: WorkspaceTabPresetId
  pinnedRoomIds: string[]
  roomOrder: string[]
  hiddenRoomIds: string[]
  revision: string
  updatedAt: string
}

export interface WorkspaceTabsSaveInputV1 {
  workspaceId?: string
  presetId?: WorkspaceTabPresetId
  pinnedRoomIds?: string[]
  roomOrder?: string[]
  hiddenRoomIds?: string[]
  expectedRevision?: string
}

export type CanvasNodeKind = 'character' | 'scene' | 'prop' | 'shot' | 'note' | 'asset'

export interface CanvasNodeV1 {
  id: string
  kind: CanvasNodeKind
  title: string
  subtitle?: string
  x: number
  y: number
  width?: number
  height?: number
  color?: string
  elementId?: string
  refId?: string
  sha256?: string
}

export interface CanvasEdgeV1 {
  id: string
  from: string
  to: string
  label?: string
  kind?: 'flow' | 'ref' | 'conflict'
}

export interface CanvasBoardV1 {
  schema: 'muweave.canvas-board.v1'
  workspaceId: string
  nodes: CanvasNodeV1[]
  edges: CanvasEdgeV1[]
  viewport?: { x: number; y: number; zoom: number }
  revision: string
  updatedAt: string
}

export interface CanvasBoardSaveInputV1 {
  workspaceId?: string
  nodes?: CanvasNodeV1[]
  edges?: CanvasEdgeV1[]
  viewport?: { x: number; y: number; zoom: number }
  expectedRevision?: string
}

export interface Stage3dCameraV1 {
  x: number
  y: number
  z: number
  targetX: number
  targetY: number
  targetZ: number
  fovMm: number
  preset?: string
}

export interface Stage3dActorV1 {
  id: string
  name: string
  x: number
  y: number
  z: number
  yawDeg: number
  pose?: string
  color?: string
  roleRef?: string
}

export interface Stage3dLightV1 {
  id: string
  kind: 'key' | 'fill' | 'rim' | 'ambient'
  x: number
  y: number
  z: number
  intensityPct: number
  colorHex?: string
}

export interface Stage3dPropV1 {
  id: string
  name: string
  x: number
  y: number
  z: number
  scale?: number
}

export interface Stage3dShotSceneV1 {
  shotRef: string
  episodeRef?: string
  sceneRef?: string
  camera: Stage3dCameraV1
  actors: Stage3dActorV1[]
  lights: Stage3dLightV1[]
  props: Stage3dPropV1[]
  snapshotSha256?: string
  notes?: string
  updatedAt: string
}

export interface Stage3dScenesV1 {
  schema: 'muweave.stage3d-scenes.v1'
  workspaceId: string
  scenes: Record<string, Stage3dShotSceneV1>
  revision: string
  updatedAt: string
}

export interface Stage3dSceneSaveInputV1 {
  workspaceId?: string
  shotRef: string
  episodeRef?: string
  sceneRef?: string
  camera: Stage3dCameraV1
  actors?: Stage3dActorV1[]
  lights?: Stage3dLightV1[]
  props?: Stage3dPropV1[]
  snapshotSha256?: string
  notes?: string
  expectedRevision?: string
}

export interface Stage3dSnapshotSaveInputV1 {
  workspaceId?: string
  shotRef?: string
  dataUrl: string
  label?: string
  bindToShot?: boolean
}

export interface Stage3dSnapshotSaveResultV1 {
  sha256: string
  mime: 'image/png'
  bytes: number
  boundShotRef?: string
}

export type AudioTrackKind = 'voice' | 'music' | 'sfx'

export interface AudioTrackMixV1 {
  track: AudioTrackKind
  gainPct: number
  muted: boolean
  solo: boolean
  fadeInMs: number
  fadeOutMs: number
}

export interface AudioCueOverrideV1 {
  shotRef: string
  track: AudioTrackKind
  offsetMs?: number
  gainPct?: number
  fadeInMs?: number
  fadeOutMs?: number
  muted?: boolean
}

export interface AudioMixConfigV1 {
  schema: 'muweave.audio-mix.v1'
  workspaceId: string
  episodeRef?: string
  masterGainPct: number
  tracks: Record<AudioTrackKind, AudioTrackMixV1>
  cues: AudioCueOverrideV1[]
  revision: string
  updatedAt: string
}

export interface AudioMixSaveInputV1 {
  workspaceId?: string
  episodeRef?: string
  masterGainPct?: number
  tracks?: Partial<Record<AudioTrackKind, Partial<AudioTrackMixV1>>>
  cues?: AudioCueOverrideV1[]
  expectedRevision?: string
}

export interface ProjectMigrationCheckV1 {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export interface ProjectMigrationReportV1 {
  schema: 'muweave.migration-report.v1'
  registrySchema: string
  projectCount: number
  archivedCount: number
  corruptBackupCount: number
  /** Sanitized basenames only (never absolute host paths). */
  corruptBackups: string[]
  legacyScheduleCount: number
  unclaimedBundleCount: number
  readyForV2: boolean
  checks: ProjectMigrationCheckV1[]
  generatedAt: string
}

export interface ShotReviewBatchInputV1 {
  workspaceId?: string
  items: ShotReviewSetInputV1[]
}

export interface ShotReviewBatchItemResultV1 {
  shotRef: string
  ok: boolean
  record?: ShotReviewRecordV1
  errorCode?: string
  message?: string
  currentRevision?: number
}

export interface ShotReviewBatchResultV1 {
  results: ShotReviewBatchItemResultV1[]
  succeededCount: number
  failedCount: number
}

export type {
  MuweaveDomain,
  MuweaveElementFilter,
  MuweaveElementKind,
  MuweaveElementSummaryV1,
  MuweaveElementV1,
  MuweaveIndexV1,
  MuweaveSourceOwner,
  OwnerReadinessState,
}
export * from './capability-protocol'
