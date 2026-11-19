import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CapabilityCatalogV1, CapabilityDescriptorV1 } from '../protocol'
import type { MuweaveRpcClient } from './rpc-client'

export const TOOL_DICT_ZH = {
  catalogTitle: '工具目录', catalogReady: '现在能用', catalogNeedsApproval: '需要你批准', catalogBlocked: '暂不可用',
  catalogSummary: '可用 {ready} · 待批准 {approval} · 不可用 {blocked}', catalogApprovalHint: '点击后只创建等待审批的任务',
  catalogNoTools: '当前没有可展示的工具', catalogInputs: '输入', catalogCostPaid: '付费', catalogCostFree: '免费',
  catalogCostUnknown: '费用未知', catalogOwner: 'Owner', catalogBlockedReason: '阻塞原因',
} as const

export const TOOL_DICT_EN: Record<keyof typeof TOOL_DICT_ZH, string> = {
  catalogTitle: 'Tool catalog', catalogReady: 'Ready now', catalogNeedsApproval: 'Needs your approval', catalogBlocked: 'Unavailable',
  catalogSummary: 'Ready {ready} · Needs approval {approval} · Unavailable {blocked}', catalogApprovalHint: 'Clicking creates a waiting-for-approval task only',
  catalogNoTools: 'No tools to show', catalogInputs: 'Inputs', catalogCostPaid: 'Paid', catalogCostFree: 'Free',
  catalogCostUnknown: 'Cost unknown', catalogOwner: 'Owner', catalogBlockedReason: 'Blocked reason',
}

export type ToolOwner = 'eikona' | 'auctra' | 'scaena' | 'sonora' | 'muweave' | 'anatomia' | 'pinax' | 'manju-hotlist'
export type ToolAvailability = 'ready' | 'needs-approval' | 'blocked'
export interface ToolCatalogEntry {
  id: string; labelZh: string; labelEn: string; owner: ToolOwner; stage: CapabilityDescriptorV1['stage']
  availability: ToolAvailability; blockedReason?: string; costHint?: string
  inputs: CapabilityDescriptorV1['inputs']; opensRoom?: string; opensGeneration?: boolean; summaryZh?: string; summaryEn?: string
}
/**
 * What clicking a catalog row does. Paid capabilities only ever *open* the generation desk where the
 * user approves — the catalog never submits or approves on its own.
 */
export type ToolCatalogIntent =
  | { kind: 'generate' } // open the generation desk prefilled with this capability
  | { kind: 'approve' } // open the desk focused on the approval step
  | { kind: 'blocked'; reason: string }

export function toolCatalogIntent(entry: ToolCatalogEntry): ToolCatalogIntent {
  if (entry.availability === 'blocked') {
    return { kind: 'blocked', reason: entry.blockedReason ?? TOOL_DICT_ZH.catalogBlocked }
  }
  if (entry.availability === 'needs-approval') return { kind: 'approve' }
  return { kind: 'generate' }
}

export interface ToolCatalogGroups { ready: ToolCatalogEntry[]; needsApproval: ToolCatalogEntry[]; blocked: ToolCatalogEntry[] }

const EN_LABELS: Record<string, string> = {
  'eikona.image.generate': 'Generate image candidates', 'sonora.sfx.generate': 'Generate sound effect', 'scaena.shot.draw': 'Draw a shot',
  'scaena.shot.video': 'Generate shot video', 'sonora.voice.tts': 'Generate voice', 'sonora.music.generate': 'Generate music',
  'anatomia.reference.analyze': 'Analyze a reference', 'auctra.text.generate': 'Generate screenplay text', 'pinax.inbox.capture': 'Capture inbox material',
  'manju-hotlist.research.query': 'Research a query',
}
function costHint(cap: CapabilityDescriptorV1): string {
  if (cap.costClass === 'free' || cap.costUnit === 'none') return TOOL_DICT_ZH.catalogCostFree
  if (cap.costClass === 'unknown') return TOOL_DICT_ZH.catalogCostUnknown
  return TOOL_DICT_ZH.catalogCostPaid + ' · ' + cap.costUnit.toUpperCase()
}
function toEntry(cap: CapabilityDescriptorV1): ToolCatalogEntry {
  const availability: ToolAvailability = !cap.available ? 'blocked' : cap.costClass === 'paid' || cap.costClass === 'unknown' ? 'needs-approval' : 'ready'
  const owner = cap.owner as ToolOwner
  return { id: cap.capabilityId, labelZh: cap.title, labelEn: EN_LABELS[cap.capabilityId] ?? cap.title, owner, stage: cap.stage, availability,
    ...(cap.unavailableReason ? { blockedReason: cap.unavailableReason } : {}), costHint: costHint(cap), inputs: cap.inputs,
    opensRoom: owner === 'scaena' ? 'muweave-drama' : owner === 'auctra' ? 'muweave-script' : undefined,
    opensGeneration: availability !== 'blocked', summaryZh: cap.summary, summaryEn: EN_LABELS[cap.capabilityId] ?? cap.summary }
}
export function toolCatalogFromCapabilityCatalog(catalog: CapabilityCatalogV1 | undefined): ToolCatalogEntry[] { return (catalog?.capabilities ?? []).map(toEntry) }
export function groupToolCatalog(entries: readonly ToolCatalogEntry[]): ToolCatalogGroups {
  return entries.reduce<ToolCatalogGroups>((groups, entry) => { if (entry.availability === 'blocked') groups.blocked.push(entry); else if (entry.availability === 'needs-approval') groups.needsApproval.push(entry); else groups.ready.push(entry); return groups }, { ready: [], needsApproval: [], blocked: [] })
}
export function useToolCatalog(rpc: MuweaveRpcClient, enabled = true) {
  const [catalog, setCatalog] = useState<CapabilityCatalogV1 | undefined>()
  const [error, setError] = useState<string | undefined>()
  const load = useCallback(async () => { if (!enabled) return; const result = await rpc.call<CapabilityCatalogV1>('capability.catalog', {}); if (result.ok) { setCatalog(result.data); setError(undefined) } else setError(result.error.message) }, [enabled, rpc])
  useEffect(() => { void load() }, [load])
  const entries = useMemo(() => toolCatalogFromCapabilityCatalog(catalog), [catalog])
  return { catalog, entries, groups: groupToolCatalog(entries), error, reload: load }
}
export function toolOwnerLabel(owner: ToolOwner): string { return owner === 'muweave' ? 'MuWeave' : owner }
