import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createMuweaveRpcClient, type MuweaveRpcClient, type MuweaveTranslator } from '@yeisme/dsh-muweave-core/client'
import { DiagnosisPanel, readReports, summarize, STATE_META } from '../packages/dsh-muweave-workbench/src/diagnosis-panel'
import { ProjectPanel } from '../packages/dsh-muweave-workbench/src/project-panel'
import { MUWEAVE_CORE_CSS } from '../packages/dsh-muweave-core/src/client/styles'

// docs/design/project-features-next.md F3: the read-only project diagnosis panel in the project popover.

type Reply = { ok: true; data: unknown } | { ok: false; code?: string; message?: string }
type Handler = (payload: Record<string, unknown>) => Reply
interface Call {
  action: string
  payload: Record<string, unknown>
}

function createRpc(handlers: Record<string, Handler>) {
  const calls: Call[] = []
  const rpc = createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string; payload?: Record<string, unknown> }
    calls.push({ action: body.action, payload: body.payload ?? {} })
    const handler = handlers[body.action]
    const reply = handler ? handler(body.payload ?? {}) : ({ ok: true, data: {} } as Reply)
    return Response.json(
      reply.ok
        ? { ok: true, generation: 1, data: reply.data }
        : { ok: false, generation: 1, error: { code: reply.code ?? 'muweave/test_failure', message: reply.message ?? 'failed' } },
    )
  })
  return { rpc, calls, of: (action: string) => calls.filter((c) => c.action === action) }
}

const REPORTS = [
  { projectId: 'proj_ok', title: '健康项目', state: 'healthy', findings: [] },
  {
    projectId: 'proj_warn',
    title: '待核对',
    state: 'warning',
    findings: [{ code: 'owner_unavailable', severity: 'warn', detail: 'Eikona 暂时读不到', action: '去绑定检查器' }],
  },
  {
    projectId: 'proj_bad',
    title: '坏掉的项目',
    state: 'broken',
    findings: [
      { code: 'bundle_missing', severity: 'error', detail: 'workspace 没有 bundle' },
      { code: 'revision_conflict', severity: 'info', detail: 'revision 4 → 5', action: '重新读取' },
    ],
  },
  { projectId: 'proj_unknown', title: '说不清', state: 'unknown', findings: [] },
]

const diagnose = (reports: unknown): Handler => () => ({ ok: true, data: { reports } })
const $ = (selector: string) => document.querySelector(selector) as HTMLElement | null
const $$ = (selector: string) => Array.from(document.querySelectorAll(selector)) as HTMLElement[]
const toggle = () => $('[data-diagnosis-panel] .mw-diag-toggle')!

beforeEach(() => {
  cleanup()
  globalThis.localStorage?.clear()
})

describe('F3 report reading', () => {
  it('drops malformed reports and treats a missing or unknown state as unknown, never healthy', () => {
    const reports = readReports([
      { projectId: 'a', title: 'A', state: 'healthy', findings: [] },
      { projectId: 'b', state: 'fine', findings: 'nope' },
      { projectId: 'c', findings: [{ code: 'x', severity: 'loud', detail: 'd' }, { severity: 'error' }, null] },
      { title: 'no id' },
      'garbage',
      null,
    ])
    expect(reports).toEqual([
      { projectId: 'a', title: 'A', state: 'healthy', findings: [] },
      { projectId: 'b', title: 'b', state: 'unknown', findings: [] },
      { projectId: 'c', title: 'c', state: 'unknown', findings: [{ code: 'x', severity: 'warn', detail: 'd' }] },
    ])
    expect(readReports(undefined)).toEqual([])
  })

  it('summarizes worst first and keeps unknown off "全部正常"', () => {
    expect(summarize(readReports(REPORTS))).toEqual({ state: 'broken', text: '1 项异常 · 1 项需注意 · 1 项无法判断' })
    expect(summarize(readReports([REPORTS[0], REPORTS[3]]))).toEqual({ state: 'unknown', text: '1 项无法判断' })
    expect(summarize(readReports([REPORTS[0]]))).toEqual({ state: 'healthy', text: '全部正常' })
    // No reports is no evidence: it must not claim the projects are fine.
    expect(summarize([]).state).toBe('unknown')
  })

  it('maps each state to its fixed tone and label', () => {
    expect(STATE_META).toEqual({
      healthy: { label: '正常', tone: 'ok' },
      warning: { label: '需注意', tone: 'warn' },
      broken: { label: '异常', tone: 'bad' },
      unknown: { label: '无法判断', tone: 'neutral' },
    })
  })
})

describe('F3 diagnosis panel', () => {
  it('does not call project.diagnose until the user expands it', async () => {
    const { rpc, of } = createRpc({ 'project.diagnose': diagnose(REPORTS) })
    render(<DiagnosisPanel rpc={rpc} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(of('project.diagnose')).toHaveLength(0)
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(toggle().textContent).toContain('展开后检查')
    expect($('.mw-diag-body')).toBeNull()

    fireEvent.click(toggle())
    await waitFor(() => expect($('[data-diag-project]')).not.toBeNull())
    expect(of('project.diagnose')).toHaveLength(1)
    expect(of('project.diagnose')[0]?.payload).toEqual({})
  })

  it('renders the four states with their own pill tone and label, listing only non-healthy projects', async () => {
    const { rpc } = createRpc({ 'project.diagnose': diagnose(REPORTS) })
    render(<DiagnosisPanel rpc={rpc} />)
    fireEvent.click(toggle())
    await waitFor(() => expect($$('[data-diag-project]')).toHaveLength(3))

    expect($('[data-diag-project="proj_ok"]')).toBeNull()
    const pill = (id: string) => $(`[data-diag-project="${id}"] .mw-diag-state`)!
    expect([pill('proj_warn'), pill('proj_bad'), pill('proj_unknown')].map((el) => [el.dataset.diagState, el.dataset.tone, el.textContent])).toEqual([
      ['warning', 'warn', '需注意'],
      ['broken', 'bad', '异常'],
      ['unknown', 'neutral', '无法判断'],
    ])
    expect(toggle().dataset.diagState).toBe('broken')
    expect($('[data-diag-summary]')!.textContent).toBe('· 1 项异常 · 1 项需注意 · 1 项无法判断')

    const findings = $$('[data-diag-project="proj_bad"] [data-diag-finding]')
    expect(findings.map((el) => [el.dataset.diagFinding, el.dataset.tone])).toEqual([
      ['bundle_missing', 'bad'],
      ['revision_conflict', 'info'],
    ])
    expect(findings[0]!.querySelector('.mw-diag-action')).toBeNull()
  })

  it('never renders unknown with the healthy tone or wording', async () => {
    const { rpc } = createRpc({ 'project.diagnose': diagnose([REPORTS[3]]) })
    render(<DiagnosisPanel rpc={rpc} />)
    fireEvent.click(toggle())
    await waitFor(() => expect($('[data-diag-project="proj_unknown"]')).not.toBeNull())
    const row = $('[data-diag-project="proj_unknown"]')!
    expect(row.querySelector('[data-tone="ok"]')).toBeNull()
    expect(row.textContent).not.toMatch(/正常/)
    expect(row.textContent).toContain('状态待核对')
    expect(row.querySelector('.mw-dot')!.getAttribute('data-hollow')).toBe('true')
    expect(toggle().dataset.diagState).toBe('unknown')
    expect(document.body.textContent).not.toContain('所有项目正常')
    expect(document.body.textContent).not.toContain('全部正常')
  })

  it('says 所有项目正常 only when every report is healthy with no findings', async () => {
    const { rpc } = createRpc({ 'project.diagnose': diagnose([REPORTS[0], { ...REPORTS[0], projectId: 'proj_ok2' }]) })
    render(<DiagnosisPanel rpc={rpc} />)
    fireEvent.click(toggle())
    await waitFor(() => expect($('[data-diag-empty="healthy"]')).not.toBeNull())
    expect($('[data-diag-empty="healthy"]')!.textContent).toBe('所有项目正常')
    expect(toggle().dataset.diagState).toBe('healthy')
    expect(toggle().querySelector('.mw-dot')!.getAttribute('data-tone')).toBe('ok')
    expect($$('[data-diag-project]')).toHaveLength(0)
  })

  it('treats a missing reports field as no projects instead of crashing or claiming health', async () => {
    const { rpc } = createRpc({ 'project.diagnose': () => ({ ok: true, data: {} }) })
    render(<DiagnosisPanel rpc={rpc} />)
    fireEvent.click(toggle())
    await waitFor(() => expect($('[data-diag-empty="none"]')).not.toBeNull())
    expect(document.body.textContent).not.toContain('所有项目正常')
    expect(toggle().dataset.diagState).toBe('unknown')
  })

  it('survives an rpc failure and a throwing client, offering a retry', async () => {
    const failing = createRpc({ 'project.diagnose': () => ({ ok: false, code: 'muweave/unsupported_action', message: '宿主不支持' }) })
    render(<DiagnosisPanel rpc={failing.rpc} />)
    fireEvent.click(toggle())
    await waitFor(() => expect($('[data-diag-error]')).not.toBeNull())
    expect($('[data-diag-error]')!.textContent).toContain('宿主不支持')
    expect(toggle().dataset.diagState).toBe('unknown')
    fireEvent.click($('[data-diag-error] button')!)
    await waitFor(() => expect(failing.of('project.diagnose')).toHaveLength(2))
    cleanup()

    const throwing = { call: () => Promise.reject(new Error('boom')), resolveMediaUrl: async () => undefined, generation: () => 0 } as unknown as MuweaveRpcClient
    render(<DiagnosisPanel rpc={throwing} />)
    fireEvent.click(toggle())
    await waitFor(() => expect($('[data-diag-error]')!.textContent).toContain('boom'))
  })

  it('re-reads on every expand and passes a scoped projectId through', async () => {
    const { rpc, of } = createRpc({ 'project.diagnose': diagnose(REPORTS) })
    render(<DiagnosisPanel rpc={rpc} projectId="proj_bad" />)
    fireEvent.click(toggle())
    await waitFor(() => expect(of('project.diagnose')).toHaveLength(1))
    fireEvent.click(toggle())
    expect($('.mw-diag-body')).toBeNull()
    fireEvent.click(toggle())
    await waitFor(() => expect(of('project.diagnose')).toHaveLength(2))
    expect(of('project.diagnose').map((c) => c.payload)).toEqual([{ projectId: 'proj_bad' }, { projectId: 'proj_bad' }])
  })

  it('shows action text as a button only when a navigator is wired, and calls it with the row', async () => {
    const { rpc } = createRpc({ 'project.diagnose': diagnose(REPORTS) })
    const seen: string[] = []
    render(<DiagnosisPanel rpc={rpc} onNavigate={(report, finding) => seen.push(report.projectId + ':' + finding.code)} />)
    fireEvent.click(toggle())
    await waitFor(() => expect($$('button.mw-diag-action')).toHaveLength(2))
    fireEvent.click($('[data-diag-project="proj_warn"] button.mw-diag-action')!)
    expect(seen).toEqual(['proj_warn:owner_unavailable'])
    cleanup()

    render(<DiagnosisPanel rpc={rpc} />)
    fireEvent.click(toggle())
    await waitFor(() => expect($$('span.mw-diag-action')).toHaveLength(2))
    expect($$('button.mw-diag-action')).toHaveLength(0)
  })
})

describe('F3 in the project popover', () => {
  const keyEcho = ((key: string) => key) as unknown as MuweaveTranslator
  const PROJECTS = [
    { id: 'proj_ok', title: '健康项目', status: 'in_production', archived: false, workspaceRefs: [], updatedAt: '2026-11-19T00:00:00Z' },
    { id: 'proj_warn', title: '待核对', status: 'preparing', archived: false, workspaceRefs: [], updatedAt: '2026-11-19T00:00:00Z' },
  ]

  it('sits under the claim entry, stays lazy on open, and an action switches to that project', async () => {
    const { rpc, of } = createRpc({
      'project.list': () => ({ ok: true, data: { projects: PROJECTS } }),
      'workspace.list': () => ({ ok: true, data: { workspaces: [] } }),
      'project.activate': (p) => ({ ok: true, data: { project: PROJECTS.find((row) => row.id === p.projectId) } }),
      'project.diagnose': diagnose(REPORTS),
    })
    const activated: Array<string | undefined> = []
    render(<ProjectPanel rpc={rpc} t={keyEcho} activeProjectId="proj_ok" onActivate={(project) => activated.push(project?.id)} />)
    await waitFor(() => expect(of('project.list').length).toBeGreaterThan(0))
    expect($('[data-diagnosis-panel]')).toBeNull()

    fireEvent.click($('[data-muweave-project-bar] [aria-haspopup]')!)
    await waitFor(() => expect($('[data-diagnosis-panel]')).not.toBeNull())
    const entry = $('[data-claim-entry]')!.closest('.mw-claim-entry-wrap')!
    expect(entry.compareDocumentPosition($('[data-diagnosis-panel]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(of('project.diagnose')).toHaveLength(0)

    fireEvent.click(toggle())
    await waitFor(() => expect($('[data-diag-project="proj_warn"] button.mw-diag-action')).not.toBeNull())
    fireEvent.click($('[data-diag-project="proj_warn"] button.mw-diag-action')!)
    await waitFor(() => expect(activated).toContain('proj_warn'))
    expect(of('project.activate').at(-1)?.payload).toEqual({ projectId: 'proj_warn' })
    await waitFor(() => expect($('[data-popover]')).toBeNull())
    // Navigation only: no write besides switching the active project.
    expect(of('project.bind').length + of('bundle.sync').length + of('operation.reconcile').length).toBe(0)
  })
})

describe('F3 styles', () => {
  const rule = (selector: string) => {
    const at = MUWEAVE_CORE_CSS.indexOf('\n' + selector + ' {')
    return at < 0 ? '' : MUWEAVE_CORE_CSS.slice(at, MUWEAVE_CORE_CSS.indexOf('}', at))
  }

  it('fades the body in over the fast token, draws a 3px severity rule, and keeps unknown off the tinted fill', () => {
    expect(rule('.mw-diag-body')).toMatch(/animation:\s*mw-fade-in var\(--mw-dur-fast\) var\(--mw-ease-out\) both;/)
    expect(rule('.mw-diag-finding')).toMatch(/box-shadow:\s*inset 0\.1875rem 0 0 var\(--mw-tone\);/)
    expect(rule('.mw-diag-state[data-tone="neutral"]')).toMatch(/background:\s*transparent;/)
    expect(rule('.mw-diag-action')).toMatch(/color:\s*var\(--mw-label-3\);/)
    expect(rule('.mw-diag-list')).toMatch(/var\(--mw-r-2\)/)
  })
})
