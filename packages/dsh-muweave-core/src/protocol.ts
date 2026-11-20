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
  'project.activate',
  'project.clone',
] as const

export type MuweaveRpcAction = (typeof RPC_ACTIONS)[number] | (typeof CAPABILITY_RPC_ACTIONS)[number]

export function isMuweaveRpcAction(v: unknown): v is MuweaveRpcAction {
  return typeof v === 'string' && ((RPC_ACTIONS as readonly string[]).includes(v) || (CAPABILITY_RPC_ACTIONS as readonly string[]).includes(v))
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

/** One row of the publishing board (`muweave.schedule.v1`); the bundle stays the element truth. */
export interface ScheduleEntryV1 {
  ref: string
  label: string
  kind: string
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  note?: string
  updatedAt: string
}

export interface ScheduleBoardV1 {
  schema: 'muweave.schedule.v1'
  entries: ScheduleEntryV1[]
  updatedAt: string
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
