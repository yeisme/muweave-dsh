export type ProjectStatus = 'preparing' | 'in_production' | 'ready_to_publish' | 'published' | 'archived'

export interface ScheduleScopeProject {
  id: string
  title: string
  status: ProjectStatus
  workspaceRefs: readonly string[]
}

export interface ScheduleScopeEntry {
  ref: string
  workspaceId?: string
  projectId?: string
}

export type ScheduleEntryOwnership = 'mine' | 'unknown' | 'others'

export const PROJECT_SCOPE_DICT_ZH = {
  projectStatusPreparing: '准备中',
  projectStatusInProduction: '制作中',
  projectStatusReadyToPublish: '待发布',
  projectStatusPublished: '已发布',
  projectStatusArchived: '已归档',
  noActiveProject: '未选择项目',
  projectOverviewHint: '去总览切换项目',
  unknownOwnershipHint: '这些条目的归属未知，可能属于其它项目',
  showOtherProjectEntries: '显示其它项目条目',
  hideOtherProjectEntries: '隐藏其它项目条目',
} as const

export const PROJECT_SCOPE_DICT_EN = {
  projectStatusPreparing: 'Preparing',
  projectStatusInProduction: 'In production',
  projectStatusReadyToPublish: 'Ready to publish',
  projectStatusPublished: 'Published',
  projectStatusArchived: 'Archived',
  noActiveProject: 'No project selected',
  projectOverviewHint: 'Switch projects from Overview',
  unknownOwnershipHint: 'These entries have unknown ownership and may belong to another project',
  showOtherProjectEntries: 'Show entries from other projects',
  hideOtherProjectEntries: 'Hide entries from other projects',
} as const

function projectIdFromRef(ref: string): string | undefined {
  const colon = ref.indexOf(':')
  const slash = ref.indexOf('/')
  const separator = colon >= 0 && (slash < 0 || colon < slash) ? colon : slash
  if (separator <= 0) return undefined
  const prefix = ref.slice(0, separator)
  return prefix.startsWith('proj_') ? prefix : undefined
}

export function refBelongsToProject(
  ref: string,
  entry: ScheduleScopeEntry,
  project: ScheduleScopeProject,
): ScheduleEntryOwnership {
  const refProjectId = projectIdFromRef(ref)
  if (refProjectId) return refProjectId === project.id ? 'mine' : 'others'
  if (typeof entry.workspaceId === 'string' && entry.workspaceId.length > 0) {
    return project.workspaceRefs.includes(entry.workspaceId) ? 'mine' : 'others'
  }
  return 'unknown'
}

export function scopeScheduleEntries<T extends ScheduleScopeEntry>(
  entries: readonly T[],
  project: ScheduleScopeProject | undefined,
): { mine: T[]; unknown: T[]; others: T[] } {
  if (!project) return { mine: [...entries], unknown: [], others: [] }
  return entries.reduce<{ mine: T[]; unknown: T[]; others: T[] }>((groups, entry) => {
    const ownership = refBelongsToProject(entry.ref, entry, project)
    groups[ownership].push(entry)
    return groups
  }, { mine: [], unknown: [], others: [] })
}
