/**
 * Creator platform v1 wire contract: capability catalog, zero-call estimates, approval-gated jobs
 * with pre-allocated output slots, and shot ↔ media links. See docs/design/creator-platform-v1.md.
 * Zero Node.js imports — shared between host half, client half and the kit agent tools.
 */

export const CAPABILITY_RPC_ACTIONS = [
  'capability.catalog',
  'capability.estimate',
  'job.request',
  'job.approve',
  'job.cancel',
  'job.list',
  'job.get',
  'job.reconcile',
  'job.slot.review',
  'shot.media.link',
  'shot.media.unlink',
  'budget.status',
] as const

export type CapabilityRpcAction = (typeof CAPABILITY_RPC_ACTIONS)[number]

export type CapabilityOwner = 'eikona' | 'scaena' | 'sonora' | 'auctra' | 'anatomia' | 'pinax' | 'manju-hotlist'

export type CapabilityKind = 'image' | 'video' | 'voice' | 'music' | 'sfx' | 'text' | 'analysis' | 'capture' | 'research'

/** Room that leads with this capability; the launcher filters by it. */
export type CapabilityStage = 'inspiration' | 'script' | 'visual' | 'storyboard' | 'sound'

/** free = never calls a paid provider; paid = owner returns a priced estimate; unknown = owner cannot price it. */
export type CapabilityCostClass = 'free' | 'paid' | 'unknown'

export type CostUnit = 'usd' | 'credits' | 'none'

export interface CapabilityInputFieldV1 {
  name: string
  label: string
  inputType: 'text' | 'textarea' | 'enum' | 'number' | 'element'
  required: boolean
  options?: string[]
  /** Element kinds accepted when inputType is 'element' (e.g. scene_card, candidate_group). */
  elementKinds?: string[]
  defaultValue?: string
}

export interface CapabilityDescriptorV1 {
  capabilityId: string
  owner: CapabilityOwner
  kind: CapabilityKind
  stage: CapabilityStage
  title: string
  summary: string
  costClass: CapabilityCostClass
  costUnit: CostUnit
  /** Binary found on PATH and its doctor/version probe passed. */
  available: boolean
  /** Stable reason code when unavailable: OWNER_NOT_INSTALLED | MARKER_MISSING | NO_COST_CAP | PAID_DISABLED_BY_HOST. */
  unavailableReason?: string
  /** Number of output slots one job allocates by default (e.g. 4 image candidates). */
  defaultSlots: number
  maxSlots: number
  inputs: CapabilityInputFieldV1[]
}

export interface CapabilityCatalogV1 {
  /** Host switch; false means estimates work but job.approve returns PAID_DISABLED. */
  paidEnabled: boolean
  capabilities: CapabilityDescriptorV1[]
}

/** Links that place an output in the production; all optional, carried through to the owner and the bundle. */
export interface ProductionAnchorV1 {
  episodeRef?: string
  sceneRef?: string
  shotRef?: string
  characterRefs?: string[]
}

export interface CapabilityEstimateRequestV1 {
  capabilityId: string
  /** Field values; prompts live only in host memory and the owner request file, never in stored records. */
  input: Record<string, string | number | string[]>
  slots?: number
  anchor?: ProductionAnchorV1
}

export interface CostAmountV1 {
  unit: CostUnit
  /** Absent when the owner cannot price the request. */
  amount?: number
}

export interface CapabilityEstimateV1 {
  estimateId: string
  capabilityId: string
  owner: CapabilityOwner
  costClass: CapabilityCostClass
  estimate: CostAmountV1
  /** Ceiling the host will pass to the owner (--max-cost-usd etc.); approval must be at or above estimate. */
  suggestedCeiling: CostAmountV1
  slots: number
  /** One line per planned call, already redacted ("4 × 1024x1536 gpt-image-2.5-sunburst"). */
  planLines: string[]
  /** Short title for lists; derived from the input, never the raw prompt. */
  title: string
  promptDigest: string
  anchor?: ProductionAnchorV1
  expiresAt: string
}

export type JobStatus =
  | 'waiting_approval'
  | 'queued'
  | 'running'
  | 'waiting_for_human'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reconcile_required'

export type JobSlotStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type SlotReviewState = 'unreviewed' | 'accepted' | 'rejected'

export interface JobSlotV1 {
  slotId: string
  index: number
  status: JobSlotStatus
  review: SlotReviewState
  /** Present once done: CAS digest for image/audio/video bytes, owner refs for the rest. */
  sha256?: string
  mime?: string
  ownerRef?: string
  label?: string
  errorCode?: string
}

export type JobRequester = 'ui' | 'agent'

export interface JobRecordV1 {
  jobId: string
  workspaceId: string
  capabilityId: string
  owner: CapabilityOwner
  kind: CapabilityKind
  title: string
  promptDigest: string
  requestedBy: JobRequester
  status: JobStatus
  estimate: CostAmountV1
  approvedCeiling?: CostAmountV1
  /** Owner-reported spend after completion; absent means not reported, never zero. */
  actualCost?: CostAmountV1
  idempotencyKey: string
  /** Owner run/job/task id once submitted; reconcile always polls this, never resubmits. */
  ownerJobRef?: string
  anchor?: ProductionAnchorV1
  slots: JobSlotV1[]
  createdAt: string
  updatedAt: string
  approvedAt?: string
  errorCode?: string
  /** Next thing the human can do. */
  nextAction: 'approve' | 'wait' | 'review' | 'reconcile' | 'none'
}

export interface JobRequestV1 {
  estimateId: string
  idempotencyKey: string
  requestedBy: JobRequester
}

/** Only the UI sends this; the agent tool can request but never approve. */
export interface JobApproveV1 {
  jobId: string
  ceiling: CostAmountV1
  /** Must be true for costClass 'unknown'; the sheet shows a separate checkbox for it. */
  acceptUnknownCost?: boolean
}

export interface JobSlotReviewV1 {
  jobId: string
  slotId: string
  decision: 'accept' | 'reject'
  /** On accept with an anchor.shotRef, also link the slot media to that shot. */
  linkToShot?: boolean
}

export interface ShotMediaLinkV1 {
  shotRef: string
  sceneRef?: string
  episodeRef?: string
  /** Exactly one source: a CAS digest from a reviewed slot, or an element id (candidate artifact). */
  sha256?: string
  elementId?: string
  artifactId?: string
  role: 'keyframe' | 'reference' | 'video' | 'voice' | 'music' | 'sfx'
}

export interface ShotMediaEntryV1 extends ShotMediaLinkV1 {
  linkedAt: string
  mime?: string
  jobId?: string
}

export interface BudgetLineV1 {
  unit: CostUnit
  /** Sum of approved ceilings for jobs still active today (local day). */
  committed: number
  /** Sum of owner-reported actual cost today. */
  spent: number
  /** Optional daily cap from host config; job.approve fails with BUDGET_EXCEEDED above it. */
  dailyCap?: number
}

export interface BudgetStatusV1 {
  paidEnabled: boolean
  day: string
  lines: BudgetLineV1[]
  unknownCostJobs: number
}

export const JOB_ERROR_CODES = [
  'CAPABILITY_UNAVAILABLE',
  'ESTIMATE_EXPIRED',
  'ESTIMATE_FAILED',
  'PAID_DISABLED',
  'CEILING_BELOW_ESTIMATE',
  'UNKNOWN_COST_NOT_ACCEPTED',
  'BUDGET_EXCEEDED',
  'APPROVAL_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
  'OWNER_SUBMIT_FAILED',
  'OWNER_STATUS_UNKNOWN',
  'JOB_NOT_FOUND',
  'SLOT_NOT_READY',
] as const

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number]

export function jobIsActive(status: JobStatus): boolean {
  return status === 'waiting_approval' || status === 'queued' || status === 'running' || status === 'reconcile_required'
}
