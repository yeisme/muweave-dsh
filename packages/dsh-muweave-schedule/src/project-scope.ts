export type ProjectStatus = 'preparing' | 'in_production' | 'ready_to_publish' | 'published' | 'archived'

export interface ScheduleScopeProject {
  id: string
  title: string
  status: ProjectStatus
  workspaceRefs: readonly string[]
}

/** A backlog element: ownership comes from which workspace it was read from, or its ref prefix. */
export interface ScheduleScopeEntry {
  ref: string
  workspaceId?: string
}

/**
 * A schedule board entry as `schedule.list` answers it. Both v2 fields are read defensively:
 * `projectId` is absent on entries planned without a project, `legacy` only marks entries planned
 * before the project dimension existed. Neither missing field is an error.
 */
export interface ScheduleScopeBoardEntry {
  ref: string
  projectId?: unknown
  legacy?: unknown
}

export type ScheduleEntryOwnership = 'mine' | 'unknown' | 'others'

/** Why an entry landed in its group: stored projectId, a ref-prefix guess on a legacy entry, or nothing. */
export type OwnershipBasis = 'explicit' | 'inferred' | 'unknown'

export interface ScopedScheduleEntry<T> {
  entry: T
  ownership: ScheduleEntryOwnership
  basis: OwnershipBasis
}

export interface ScopedScheduleGroups<T> {
  mine: ScopedScheduleEntry<T>[]
  unknown: ScopedScheduleEntry<T>[]
  others: ScopedScheduleEntry<T>[]
}

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
  inferredChipMark: '推断',
  inferredChipSuffix: '由 ref 推断归属',
  inferredOwnershipHint: '标「推断」的条目没有记录项目，归属由 ref 推断',
  legacyEntriesHint: '{count} 条排期是加项目维度之前排的，归属靠 ref 推断',
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
  inferredChipMark: 'inferred',
  inferredChipSuffix: 'ownership inferred from ref',
  inferredOwnershipHint: 'Entries marked “inferred” have no stored project; ownership is inferred from the ref',
  legacyEntriesHint: '{count} entries were planned before projects existed; their ownership is inferred from the ref',
} as const

function projectIdFromRef(ref: string): string | undefined {
  const colon = ref.indexOf(':')
  const slash = ref.indexOf('/')
  const separator = colon >= 0 && (slash < 0 || colon < slash) ? colon : slash
  if (separator <= 0) return undefined
  const prefix = ref.slice(0, separator)
  return prefix.startsWith('proj_') ? prefix : undefined
}

/** Backlog elements: a `proj_*` ref prefix wins, then the workspace the element was read from. */
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

export function scopeBacklogRows<T extends ScheduleScopeEntry>(
  rows: readonly T[],
  project: ScheduleScopeProject | undefined,
): { mine: T[]; unknown: T[]; others: T[] } {
  if (!project) return { mine: [...rows], unknown: [], others: [] }
  return rows.reduce<{ mine: T[]; unknown: T[]; others: T[] }>((groups, row) => {
    groups[refBelongsToProject(row.ref, row, project)].push(row)
    return groups
  }, { mine: [], unknown: [], others: [] })
}

/** The stored projectId, if the host sent a usable one. */
export function entryProjectId(entry: ScheduleScopeBoardEntry): string | undefined {
  return typeof entry.projectId === 'string' && entry.projectId.length > 0 ? entry.projectId : undefined
}

export function isLegacyEntry(entry: ScheduleScopeBoardEntry): boolean {
  return entry.legacy === true
}

/**
 * Which project a schedule entry belongs to, in strict priority order:
 *
 * 1. `projectId` present → compare it with the active project. Highest priority; the ref is ignored.
 * 2. No `projectId` but `legacy: true` → only a `proj_*` ref prefix counts, and the result is marked
 *    `inferred`. Workspace membership is deliberately not used: two projects may bind the same
 *    workspace, and guessing from it is what made entries leak across projects.
 * 3. Anything else (including a non-legacy entry planned without a project) → `unknown`.
 */
export function classifyScheduleEntry(
  entry: ScheduleScopeBoardEntry,
  project: ScheduleScopeProject,
): { ownership: ScheduleEntryOwnership; basis: OwnershipBasis } {
  const stored = entryProjectId(entry)
  if (stored) return { ownership: stored === project.id ? 'mine' : 'others', basis: 'explicit' }
  if (isLegacyEntry(entry)) {
    const inferred = projectIdFromRef(entry.ref)
    if (inferred) return { ownership: inferred === project.id ? 'mine' : 'others', basis: 'inferred' }
  }
  return { ownership: 'unknown', basis: 'unknown' }
}

/**
 * Groups board entries for the active project, each tagged with its ownership basis. Without an
 * active project nothing is filtered: every entry is `mine`, and the basis still reports the evidence.
 */
export function scopeScheduleEntries<T extends ScheduleScopeBoardEntry>(
  entries: readonly T[],
  project: ScheduleScopeProject | undefined,
): ScopedScheduleGroups<T> {
  const groups: ScopedScheduleGroups<T> = { mine: [], unknown: [], others: [] }
  for (const entry of entries) {
    if (!project) {
      const basis: OwnershipBasis = entryProjectId(entry) ? 'explicit' : isLegacyEntry(entry) && projectIdFromRef(entry.ref) ? 'inferred' : 'unknown'
      groups.mine.push({ entry, ownership: 'mine', basis })
      continue
    }
    const { ownership, basis } = classifyScheduleEntry(entry, project)
    groups[ownership].push({ entry, ownership, basis })
  }
  return groups
}
