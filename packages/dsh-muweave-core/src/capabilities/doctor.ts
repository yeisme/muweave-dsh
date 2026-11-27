import { stripHostPaths } from '@yeisme/muweave-bundle/consumer'
import type { CapabilityCatalogV1 } from '../capability-protocol'
import type { WorkspaceSummaryView } from '../protocol'

export interface CapabilityDoctorEntryV1 {
  capabilityId: string
  owner: string
  stage: string
  available: boolean
  reason?: string
  remediation: string
}

export interface CapabilityDoctorReportV1 {
  ok: true
  availableCount: number
  blockedCount: number
  paidEnabled: boolean
  capabilities: CapabilityDoctorEntryV1[]
}

const REMEDIATION_BY_REASON: Record<string, string> = {
  NO_COST_CAP: 'Owner CLI lacks a verified --max-cost-usd / --max-cost-credits flag; wait for an owner CLI release with cost-cap enforcement.',
  NO_SUBMIT_COMMAND: 'Owner CLI does not yet expose a non-interactive submit command; run manually via the owner CLI or wait for adapter support.',
  ADAPTER_PENDING: 'Adapter integration is planned; enable MUWEAVE_LOCAL_PREVIEW_ADAPTER=1 for zero-cost local preview testing.',
  OWNER_NOT_INSTALLED: 'Install the owner CLI on PATH and verify `<owner> --version` exits 0, or enable MUWEAVE_LOCAL_PREVIEW_ADAPTER=1 for zero-cost local previews.',
  MARKER_MISSING: 'Initialize the owner workspace marker (e.g. .scaena/project.json or .auctra/) before running this capability.',
  PAID_DISABLED_BY_HOST: 'Paid generation is disabled on this host; set paidEnabled: true in settings.v1.json or MUWEAVE_DSH_PAID=1 to allow human-approved paid jobs.',
}

function remediationFor(
  available: boolean,
  reason: string | undefined,
  costClass: string,
  paidEnabled: boolean,
  workspaceSummary?: WorkspaceSummaryView,
): string {
  if (!available) {
    if (reason && REMEDIATION_BY_REASON[reason]) return REMEDIATION_BY_REASON[reason]!
    return 'Inspect owner CLI installation and workspace initialization markers.'
  }
  if (costClass !== 'free' && !paidEnabled) {
    return 'Dry-run estimates work now; enable paidEnabled in settings.v1.json (or MUWEAVE_DSH_PAID=1) before approving paid runs in the DSH browser UI.'
  }
  if (workspaceSummary && !workspaceSummary.hasBundle) {
    return 'Ready to run; initialize or sync .muweave/ (or run `muweave demo seed`) to bind generated assets to storyboard shots.'
  }
  return 'Ready to use.'
}

/**
 * Pure, zero-paid-call diagnostic summary of all registered capabilities and actionable remediation steps.
 */
export function runCapabilityDoctor(
  catalog: CapabilityCatalogV1,
  workspaceSummary?: WorkspaceSummaryView,
): CapabilityDoctorReportV1 {
  const capabilities: CapabilityDoctorEntryV1[] = catalog.capabilities.map((cap) => {
    const reason = cap.available ? undefined : (cap.unavailableReason ?? 'CAPABILITY_UNAVAILABLE')
    return {
      capabilityId: cap.capabilityId,
      owner: cap.owner,
      stage: cap.stage,
      available: cap.available,
      ...(reason ? { reason } : {}),
      remediation: stripHostPaths(
        remediationFor(cap.available, reason, cap.costClass, catalog.paidEnabled, workspaceSummary),
      ),
    }
  })

  const availableCount = capabilities.filter((c) => c.available).length
  const blockedCount = capabilities.length - availableCount

  return {
    ok: true,
    availableCount,
    blockedCount,
    paidEnabled: catalog.paidEnabled,
    capabilities,
  }
}
