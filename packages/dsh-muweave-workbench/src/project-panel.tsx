import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { MuweaveRpcClient, MuweaveTranslator } from '@yeisme/dsh-muweave-core/client'

type ProjectStatus = 'preparing' | 'in_production' | 'ready_to_publish' | 'published' | 'archived'
export interface ProjectRow { id: string; title: string; status: ProjectStatus; archived: boolean; workspaceRefs: string[]; updatedAt: string }
interface WorkspaceRow { workspaceId: string; label: string; hasBundle: boolean }
const STATUS_LABELS: Record<ProjectStatus, string> = { preparing: '准备中', in_production: '制作中', ready_to_publish: '待发布', published: '已发布', archived: '已归档' }

/**
 * Project context. Two shapes:
 * - `variant="bar"` (default on the stage): one persistent row — current project, status, switcher
 *   and 新建项目. This is the entry that used to hide inside the collapsed left drawer.
 * - `variant="full"`: the whole list + create form, used inside the bar's popover.
 */
export function ProjectPanel({
  rpc,
  t,
  activeProjectId,
  onActivate,
  variant = 'bar',
}: {
  rpc: MuweaveRpcClient
  t: MuweaveTranslator
  activeProjectId?: string
  onActivate: (project: ProjectRow | undefined) => void
  variant?: 'bar' | 'full'
}) {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [open, setOpen] = useState(false)
  /** Set when the host does not answer project.* — the bar then explains itself instead of breaking the room. */
  const [unsupported, setUnsupported] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<ProjectStatus>('preparing')
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([])
  const [owner, setOwner] = useState<'eikona' | 'auctra' | 'scaena' | 'pi'>('eikona')
  const [ownerRef, setOwnerRef] = useState('')
  const [elementCounts, setElementCounts] = useState<Record<string, number>>({})
  const load = useCallback(async () => {
    const [projectRes, workspaceRes] = await Promise.all([rpc.call<{ projects: ProjectRow[]; activeProjectId?: string }>('project.list', { includeArchived }), rpc.call<{ workspaces: WorkspaceRow[] }>('workspace.list', {})])
    setUnsupported(!projectRes.ok)
    if (projectRes.ok) {
      // Defensive: a host or test double may answer ok without a projects array.
      const rows = projectRes.data?.projects ?? []
      setProjects(rows)
      const counts = await Promise.all(rows.map(async (project) => {
        const rows = await Promise.all(project.workspaceRefs.map(async (workspace) => {
          const response = await rpc.call<{ elements: unknown[] }>('bundle.elements.list', { workspaceId: workspace, projectId: project.id })
          return response.ok ? response.data.elements.length : 0
        }))
        return [project.id, rows.reduce((sum, count) => sum + count, 0)] as const
      }))
      setElementCounts(Object.fromEntries(counts))
      const active = rows.find((project) => project.id === (activeProjectId ?? projectRes.data?.activeProjectId))
      if (active && active.id !== activeProjectId) onActivate(active)
    }
    if (workspaceRes.ok) setWorkspaces(workspaceRes.data?.workspaces ?? [])
  }, [activeProjectId, includeArchived, onActivate, rpc])
  useEffect(() => { void load() }, [load])
  const activate = async (project: ProjectRow) => { const result = await rpc.call<{ project: ProjectRow }>('project.activate', { projectId: project.id }); if (result.ok) onActivate(result.data.project) }
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return
    const result = await rpc.call<{ project: ProjectRow }>('project.create', { title: title.trim(), status, ...(workspaceIds.length ? { workspaceIds } : {}), idempotencyKey: 'ui-' + Date.now() + '-' + Math.random().toString(36).slice(2) })
    if (!result.ok) return
    if (ownerRef.trim() && workspaceIds[0]) await rpc.call('project.bind', { projectId: result.data.project.id, workspaceId: workspaceIds[0], owner, refs: [ownerRef.trim()], idempotencyKey: 'bind-' + result.data.project.id + '-' + Date.now() })
    await rpc.call('project.activate', { projectId: result.data.project.id }); setTitle(''); setWorkspaceIds([]); setOwnerRef(''); setStatus('preparing'); setCreating(false); await load(); onActivate(result.data.project)
  }
  const archive = async (project: ProjectRow) => { if (!window.confirm('归档项目“' + project.title + '”？')) return; const result = await rpc.call<{ project: ProjectRow }>('project.archive', { projectId: project.id, expectedUpdatedAt: project.updatedAt, idempotencyKey: 'archive-' + project.id + '-' + project.updatedAt }); if (result.ok) { await load(); if (activeProjectId === project.id) onActivate(undefined) } }
  /** Copies metadata only: no owner dirs, elements, bindings or schedule rows (per the arch doc). */
  const clone = async (project: ProjectRow) => {
    const result = await rpc.call<{ project: ProjectRow; copied: Record<string, boolean> }>('project.clone', {
      sourceProjectId: project.id,
      title: project.title + ' 副本',
      idempotencyKey: 'clone-' + project.id + '-' + Date.now(),
    })
    if (!result.ok) return
    await load()
    onActivate(result.data.project)
  }
  const restore = async (project: ProjectRow) => { const result = await rpc.call<{ project: ProjectRow }>('project.restore', { projectId: project.id, idempotencyKey: 'restore-' + project.id + '-' + project.updatedAt }); if (result.ok) await load() }
  const full = <section className="mw-stack" data-muweave-projects="true" data-gap="sm">
    <div className="mw-spread"><span className="mw-eyebrow">项目</span><button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => setCreating((value) => !value)}>新建项目</button></div>
    {creating ? <form className="mw-dsh-card mw-stack" data-flat="true" onSubmit={(event) => void create(event)}>
      <label className="mw-field"><span>标题</span><input className="mw-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} autoFocus /></label>
      <label className="mw-field"><span>状态</span><select className="mw-input" value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}>{(['preparing', 'in_production', 'ready_to_publish', 'published'] as const).map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
      <label className="mw-field"><span>Workspace（可多选）</span><select className="mw-input" multiple value={workspaceIds} onChange={(event) => setWorkspaceIds(Array.from(event.target.selectedOptions, (option) => option.value))}>{workspaces.map((workspace) => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.label}</option>)}</select></label>
      <label className="mw-field"><span>Owner 类型（可选）</span><select className="mw-input" value={owner} onChange={(event) => setOwner(event.target.value as typeof owner)}><option value="eikona">Eikona</option><option value="auctra">Auctra</option><option value="scaena">Scaena</option><option value="pi">Pi</option></select></label>
      <label className="mw-field"><span>Owner 绑定 ref（可选）</span><input className="mw-input" value={ownerRef} onChange={(event) => setOwnerRef(event.target.value)} placeholder="opaque ref" /></label>
      <div className="mw-row"><button type="submit" className="mw-dsh-btn" data-variant="primary" disabled={!title.trim()}>创建并进入</button><button type="button" className="mw-dsh-btn" data-variant="quiet" onClick={() => setCreating(false)}>取消</button></div>
    </form> : null}
    <nav className="mw-nav" aria-label="项目列表">{projects.map((project) => <div key={project.id} className="mw-nav-item" data-selected={project.id === activeProjectId ? 'true' : 'false'} aria-current={project.id === activeProjectId ? 'page' : undefined}>
      <button type="button" className="mw-card-hit" onClick={() => void activate(project)}><span className="mw-spread"><span>{project.title}</span><span className="mw-chip">{STATUS_LABELS[project.status]}</span></span><span className="mw-dsh-muted">{elementCounts[project.id] ?? 0} 个元件</span></button>
      {project.archived ? (
        <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => void restore(project)}>恢复</button>
      ) : (
        <span className="mw-row" data-gap="xs">
          <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => void clone(project)}>复制</button>
          <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => void archive(project)}>归档</button>
        </span>
      )}
    </div>)}</nav>
    <button type="button" className="mw-dsh-btn" data-variant="quiet" data-size="sm" onClick={() => setIncludeArchived((value) => !value)}>{includeArchived ? '隐藏已归档' : '显示已归档'}</button>
    {projects.length === 0 ? <span className="mw-dsh-muted">还没有项目</span> : null}
  </section>

  if (unsupported) {
    return (
      <div className="mw-project-bar mw-row" data-muweave-project-bar="true" data-gap="sm">
        <span className="mw-eyebrow">项目</span>
        <span className="mw-dsh-muted">该宿主未启用项目管理</span>
      </div>
    )
  }

  if (variant === 'full') return full

  const active = projects.find((project) => project.id === activeProjectId)
  return (
    <div className="mw-project-bar mw-row" data-muweave-project-bar="true" data-gap="sm">
      <span className="mw-eyebrow">项目</span>
      <button
        type="button"
        className="mw-dsh-btn"
        data-variant="quiet"
        data-size="sm"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mw-truncate">{active ? active.title : '未选择项目'}</span>
        {active ? <span className="mw-chip">{STATUS_LABELS[active.status]}</span> : null}
        {active ? <span className="mw-dsh-muted">{elementCounts[active.id] ?? 0}</span> : null}
      </button>
      <button type="button" className="mw-dsh-btn" data-variant="ghost" data-size="sm" onClick={() => { setCreating(true); setOpen(true) }}>
        新建项目
      </button>
      {open ? (
        <div className="mw-project-popover" data-popover="true" role="dialog" aria-label="项目管理">
          {full}
        </div>
      ) : null}
    </div>
  )
}
