import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { createMuweaveRpcClient, type JobRecordV1, type MuweaveElementSummaryV1 } from '@yeisme/dsh-muweave-core/client'
import {
  STAGE_IDS,
  defaultStage,
  groupByStage,
  jobForElement,
  pendingCount,
  stageAtDigit,
  stageDotState,
  stageOfDomain,
  stepStage,
  variantSlots,
  versionLabel,
  type StageId,
} from '../packages/dsh-muweave-workbench/src/stage-map'
import { StageAxis } from '../packages/dsh-muweave-workbench/src/stage-axis'
import { StageWorkbench } from '../packages/dsh-muweave-workbench/src/stage-workbench'

function el(id: string, domain: string, status: string, extra: Partial<MuweaveElementSummaryV1> = {}): MuweaveElementSummaryV1 {
  return {
    elementId: id,
    domain: domain as MuweaveElementSummaryV1['domain'],
    kind: 'eikona.candidate_group',
    title: 'title ' + id,
    sourceOwner: 'eikona',
    sourceRef: 'ref:' + id,
    status,
    digest: 'sha256:' + 'a'.repeat(64),
    updatedAt: '2026-11-19T06:20:00Z',
    ...extra,
  }
}

// Mirrors the real demo bundle: 10 elements across 4 domains.
const DEMO = [
  el('d1', 'drama', 'ready'),
  el('d2', 'drama', 'ready', { sourceRevision: '1' }),
  el('h1', 'harness', 'completed'),
  el('e1', 'eikona', 'waiting_review'),
  el('e2', 'eikona', 'ready', { sourceRevision: 'sha256:' + 'b'.repeat(64) }),
  el('h2', 'harness', 'active'),
  el('h3', 'harness', 'ready'),
  el('s1', 'script', 'stale', { stale: true, sourceRevision: '1' }),
  el('s2', 'script', 'ready', { sourceRevision: '4' }),
  el('s3', 'script', 'draft', { sourceRevision: '2' }),
]

function rpcWith(data: Record<string, unknown> = {}) {
  return createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string }
    return Response.json({ ok: true, generation: 1, data: data[body.action] ?? {} })
  })
}

function job(slots: number, extra: Partial<JobRecordV1> = {}): JobRecordV1 {
  return {
    jobId: 'job_1',
    workspaceId: 'ws',
    capabilityId: 'eikona.image',
    owner: 'eikona',
    kind: 'image',
    title: '出图 · 沈岚',
    promptDigest: 'x',
    requestedBy: 'ui',
    status: 'completed',
    estimate: { unit: 'usd', amount: 0 },
    idempotencyKey: 'k',
    anchor: { sceneRef: 'scene:12' },
    slots: Array.from({ length: slots }, (_, i) => ({
      slotId: 's' + i,
      index: i,
      status: 'done' as const,
      review: i === 1 ? ('accepted' as const) : ('unreviewed' as const),
    })),
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
    nextAction: 'review',
    ...extra,
  } as JobRecordV1
}

afterEach(() => cleanup())

describe('stage map (desk v8 8.4)', () => {
  it('maps the four domains and leaves sound without one', () => {
    expect(stageOfDomain('harness')).toBe('inspiration')
    expect(stageOfDomain('script')).toBe('script')
    expect(stageOfDomain('eikona')).toBe('visual')
    expect(stageOfDomain('drama')).toBe('storyboard')
    expect(STAGE_IDS).toContain('sound')
    expect(stageOfDomain('sound')).toBeUndefined()
    expect(stageOfDomain('unknown-domain')).toBeUndefined()
  })

  it('buckets the demo bundle by stage in order, sound always empty', () => {
    const g = groupByStage(DEMO)
    expect(g.inspiration.map((e) => e.elementId)).toEqual(['h1', 'h2', 'h3'])
    expect(g.script.map((e) => e.elementId)).toEqual(['s1', 's2', 's3'])
    expect(g.visual.map((e) => e.elementId)).toEqual(['e1', 'e2'])
    expect(g.storyboard.map((e) => e.elementId)).toEqual(['d1', 'd2'])
    expect(g.sound).toEqual([])
    expect(groupByStage(undefined as never).sound).toEqual([])
  })

  it('counts waiting_review, draft and stale as pending, nothing else', () => {
    const g = groupByStage(DEMO)
    expect(pendingCount(g.inspiration)).toBe(0)
    expect(pendingCount(g.script)).toBe(2)
    expect(pendingCount(g.visual)).toBe(1)
    expect(pendingCount(g.storyboard)).toBe(0)
    expect(pendingCount([el('x', 'eikona', 'ready', { stale: true })])).toBe(1)
    expect(pendingCount([el('x', 'eikona', 'running'), el('y', 'eikona', 'active')])).toBe(0)
    expect(stageDotState(g.script)).toBe('doing')
    expect(stageDotState(g.storyboard)).toBe('done')
    expect(stageDotState(g.sound)).toBe('empty')
  })

  it('navigates stages and labels versions without inventing history', () => {
    expect(defaultStage(groupByStage(DEMO))).toBe('inspiration')
    expect(defaultStage(groupByStage([el('e', 'eikona', 'ready')]))).toBe('visual')
    expect(stepStage('inspiration', -1)).toBe('inspiration')
    expect(stepStage('storyboard', 1)).toBe('sound')
    expect(stepStage('sound', 1)).toBe('sound')
    expect(stageAtDigit('3')).toBe('visual')
    expect(stageAtDigit('9')).toBeUndefined()
    expect(stageAtDigit('x')).toBeUndefined()
    expect(versionLabel({ sourceRevision: '4' })).toBe('v4')
    expect(versionLabel({ sourceRevision: 'sha256:' + 'b'.repeat(64) })).toBe('bbbbbbbb')
    expect(versionLabel({})).toBeUndefined()
  })

  it('links variants only through a matching anchor and only when there is a choice', () => {
    const scene = el('e1', 'eikona', 'waiting_review', { sceneRef: 'scene:12' })
    expect(jobForElement(scene, [job(3)])?.jobId).toBe('job_1')
    expect(jobForElement(el('e2', 'eikona', 'ready'), [job(3)])).toBeUndefined()
    expect(jobForElement(scene, [job(3, { owner: 'scaena' })])).toBeUndefined()
    expect(jobForElement(scene, undefined as never)).toBeUndefined()
    expect(variantSlots(job(3))).toHaveLength(3)
    expect(variantSlots(job(1))).toEqual([])
    expect(variantSlots(undefined)).toEqual([])
  })
})

function AxisHarness({ initial = 'script' as StageId }) {
  const [stage, setStage] = useState<StageId>(initial)
  return <StageAxis groups={groupByStage(DEMO)} current={stage} onSelect={setStage} lang="zh" />
}

function currentRow(): string | null {
  return document.querySelector('[data-stage-axis-row][data-current="true"]')?.getAttribute('data-stage-axis-row') ?? null
}

describe('StageAxis', () => {
  it('renders five rows with pending as the primary number and marks the current stage', () => {
    render(<AxisHarness />)
    const rows = document.querySelectorAll('[data-stage-axis="true"] [data-stage-axis-row]')
    expect(rows).toHaveLength(5)
    expect([...rows].map((r) => r.getAttribute('data-stage-axis-row'))).toEqual(['inspiration', 'script', 'visual', 'storyboard', 'sound'])
    expect(document.querySelectorAll('[data-current="true"]')).toHaveLength(1)
    expect(currentRow()).toBe('script')
    const script = document.querySelector('[data-stage-axis-row="script"]')!
    expect(script.querySelector('.mw-stage-pending')?.textContent).toBe('2')
    expect(script.querySelector('.mw-stage-total')?.textContent).toBe('3')
    expect(script.querySelector('.mw-stage-dot')?.getAttribute('data-state')).toBe('doing')
    expect(document.querySelector('[data-stage-axis-row="sound"] .mw-stage-dot')?.getAttribute('data-state')).toBe('empty')
  })

  it('switches on click, j / k, and G then a digit', () => {
    render(<AxisHarness />)
    fireEvent.click(document.querySelector('[data-stage-axis-row="storyboard"]')!)
    expect(currentRow()).toBe('storyboard')
    fireEvent.keyDown(window, { key: 'k' })
    expect(currentRow()).toBe('visual')
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'j' })
    expect(currentRow()).toBe('sound')
    fireEvent.keyDown(window, { key: 'G', shiftKey: true })
    fireEvent.keyDown(window, { key: '1' })
    expect(currentRow()).toBe('inspiration')
  })

  it('ignores stage keys while typing in a field', () => {
    render(
      <>
        <AxisHarness />
        <input aria-label="field" />
      </>,
    )
    const input = document.querySelector('input')!
    fireEvent.keyDown(input, { key: 'j' })
    expect(currentRow()).toBe('script')
  })
})

describe('StageWorkbench', () => {
  const noop = () => undefined

  it('renders L1 + L3 + an honest version band, and no variant band without slots', async () => {
    const g = groupByStage(DEMO)
    render(<StageWorkbench rpc={rpcWith({ 'job.list': { jobs: [] } })} stage="script" rows={g.script} lang="zh" onSelect={noop} onPinCompare={noop} />)
    const root = document.querySelector('[data-stage-workbench="true"]')!
    expect(root.querySelector('[data-level="L1"]')?.textContent).toContain('title s1')
    expect(root.querySelector('[data-level="L2"]')).toBeNull()
    expect(root.querySelectorAll('[data-level="L3"] .mw-stage-queue')[0]?.querySelectorAll('li')).toHaveLength(2)
    // L1 is the stale s1 with revision "1": only v1, no invented history.
    expect(root.querySelectorAll('.mw-stage-version-chip')).toHaveLength(1)
    expect(root.querySelector('.mw-stage-version-chip')?.textContent).toBe('v1')
    // No cover: the placeholder says so instead of borrowing another image.
    expect(root.querySelector('[data-level="L1"] .mw-stage-thumb')?.getAttribute('data-empty')).toBe('true')
  })

  it('shows the variant band from real job slots when the anchor matches', async () => {
    const primary = el('e1', 'eikona', 'waiting_review', { sceneRef: 'scene:12', sourceRevision: '3' })
    render(<StageWorkbench rpc={rpcWith({ 'job.list': { jobs: [job(3)] } })} stage="visual" rows={[primary]} lang="zh" onSelect={noop} onPinCompare={noop} />)
    await waitFor(() => expect(document.querySelector('[data-level="L2"]')).not.toBeNull())
    const variants = document.querySelectorAll('.mw-stage-variant')
    expect(variants).toHaveLength(3)
    expect([...variants].map((v) => v.querySelector('.mw-stage-variant-tag')?.textContent)).toEqual(['v3·a', 'v3·b', 'v3·c'])
    expect(variants[1]?.getAttribute('data-current')).toBe('true')
  })

  it('tolerates a job.list reply without a jobs array and an empty stage', async () => {
    render(<StageWorkbench rpc={rpcWith({ 'job.list': null })} stage="sound" rows={[]} lang="zh" onSelect={noop} onPinCompare={noop} />)
    expect(document.querySelector('[data-stage-workbench="true"]')?.textContent).toContain('声音')
    expect(document.querySelector('[data-level="L1"]')).toBeNull()
  })
})
