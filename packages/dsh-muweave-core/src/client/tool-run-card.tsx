import type { BudgetStatusV1, CapabilityCatalogV1, CapabilityDescriptorV1, JobRecordV1 } from '../protocol'
import type { MuweaveTranslator } from './i18n'
import type { MuweaveRpcClient } from './rpc-client'
import { JobRow } from './generation-jobs'

export interface ToolRunCardProps {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  job: JobRecordV1
  catalog?: CapabilityCatalogV1
  capability?: CapabilityDescriptorV1
  budget?: BudgetStatusV1
  paidEnabled?: boolean
  planLines?: readonly string[]
  onChanged?: () => void
  onOpenRoom?: (target: { roomId?: string; ref?: string }) => void
}

export function ToolRunCard({ rpc, t, job, catalog, capability, budget, paidEnabled = false, planLines, onChanged, onOpenRoom }: ToolRunCardProps) {
  return <JobRow rpc={rpc} t={t} job={job} capability={capability} budget={budget} paidEnabled={paidEnabled} planLines={planLines} lang={t('langCode')} onChanged={onChanged ?? (() => undefined)} dataAttribute="tool-run" />
}
