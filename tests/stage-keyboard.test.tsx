import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { createMuweaveRpcClient, type JobRecordV1, type MuweaveElementSummaryV1 } from '@yeisme/dsh-muweave-core/client'
import { MUWEAVE_KEYMAP } from '../packages/dsh-muweave-core/src/client/keymap'
import { groupByStage, type CompareSubject, type StageId } from '../packages/dsh-muweave-workbench/src/stage-map'
import { StageAxis } from '../packages/dsh-muweave-workbench/src/stage-axis'
import { StageWorkbench, stageRegionOf } from '../packages/dsh-muweave-workbench/src/stage-workbench'

// Desk v8 P2 (docs/design/desk-v8-spec.md §2): every accelerator has a mouse path, never fires while
// typing, and Tab walks axis → L1 → L2 → L3 → inspector.

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

const ROWS = [
  el('e1', 'eikona', 'waiting_review', { sceneRef: 'scene:12', sourceRevision: '3' }),
  el('e2', 'eikona', 'draft'),
  el('s1', 'script', 'ready'),
  el('d1', 'drama', 'ready'),
]

function job(): JobRecordV1 {
  return {
    jobId: 'job_1',
    workspaceId: 'ws',
    capabilityId: 'eikona.image',
    owner: 'eikona',
    kind: 'image',
    title: '出图',
    promptDigest: 'x',
    requestedBy: 'ui',
    status: 'completed',
    estimate: { unit: 'usd', amount: 0 },
    idempotencyKey: 'k',
    anchor: { sceneRef: 'scene:12' },
    slots: [0, 1].map((i) => ({ slotId: 's' + i, index: i, status: 'done' as const, review: 'unreviewed' as const })),
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
    nextAction: 'review',
  } as JobRecordV1
}

function rpcWith(data: Record<string, unknown> = {}) {
  return createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string }
    return Response.json({ ok: true, generation: 1, data: data[body.action] ?? {} })
  })
}

interface Log {
  pinned: CompareSubject[]
  dismissed: number
  synced: number
}

function Desk({ log, initial = 'visual', field = false, jobs = [job()] }: { log: Log; initial?: StageId; field?: boolean; jobs?: JobRecordV1[] }) {
  const groups = groupByStage(ROWS)
  const [stage, setStage] = useState<StageId>(initial)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  return (
    <div data-muweave-workspace-root="true">
      {field ? <input aria-label="field" /> : null}
      <div className="mw-stage-layout">
        <StageAxis groups={groups} current={stage} onSelect={setStage} lang="zh" />
        <StageWorkbench
          rpc={rpcWith({ 'job.list': { jobs } })}
          stage={stage}
          rows={groups[stage]}
          lang="zh"
          selectedId={selected}
          onSelect={setSelected}
          onPinCompare={(subject) => log.pinned.push(subject)}
          onPinVariant={(subject) => log.pinned.push(subject)}
          onDismiss={() => {
            log.dismissed += 1
            setSelected(undefined)
          }}
          onSync={() => {
            log.synced += 1
          }}
        />
      </div>
      <aside data-muweave-pane="inspector">
        <button type="button">inspector action</button>
      </aside>
    </div>
  )
}

const newLog = (): Log => ({ pinned: [], dismissed: 0, synced: 0 })
const currentStage = () => document.querySelector('[data-stage-axis-row][data-current="true"]')?.getAttribute('data-stage-axis-row')
const activeRegion = () => stageRegionOf(document.activeElement)
const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey })

afterEach(() => cleanup())

describe('stage keyboard (desk v8 P2)', () => {
  it('c pins the L1 primary as the baseline, exactly like the 「对比基线」 button', () => {
    const log = newLog()
    render(<Desk log={log} />)
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === '对比基线')!
    expect(button.getAttribute('aria-keyshortcuts')).toBe('c')
    // The inline hint sits next to the button, outside its accessible name.
    expect(button.nextElementSibling?.matches('kbd.mw-key-hint[aria-hidden="true"]')).toBe(true)

    fireEvent.keyDown(window, { key: 'c' })
    fireEvent.click(button)
    expect(log.pinned).toHaveLength(2)
    expect(log.pinned[0]).toEqual(log.pinned[1])
    expect(log.pinned[0]?.title).toBe('title e1')

    // Modified c belongs to the browser / host.
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'C', shiftKey: true })
    expect(log.pinned).toHaveLength(2)
  })

  it('G then 3 jumps to the third stage; j / k step from there', () => {
    render(<Desk log={newLog()} initial="inspiration" />)
    expect(currentStage()).toBe('inspiration')
    fireEvent.keyDown(window, { key: 'G', shiftKey: true })
    fireEvent.keyDown(window, { key: '3' })
    expect(currentStage()).toBe('visual')
    fireEvent.keyDown(window, { key: 'j' })
    expect(currentStage()).toBe('storyboard')
    fireEvent.keyDown(window, { key: 'k' })
    expect(currentStage()).toBe('visual')
    // Mouse path for the same moves: the rows, each titled with its full name for the narrow axis.
    const row = document.querySelector<HTMLButtonElement>('[data-stage-axis-row="script"]')!
    expect(row.getAttribute('title')).toBe('剧本')
    fireEvent.click(row)
    expect(currentStage()).toBe('script')
  })

  it('leaves j / k / c / G / Tab alone while a field has focus', () => {
    const log = newLog()
    render(<Desk log={log} field />)
    const input = document.querySelector('input')!
    input.focus()
    for (const key of ['j', 'k', 'c', 'G', '1']) fireEvent.keyDown(input, { key })
    expect(currentStage()).toBe('visual')
    expect(log.pinned).toHaveLength(0)
    const tabEvent = fireEvent.keyDown(input, { key: 'Tab' })
    expect(tabEvent).toBe(true) // not prevented: the browser keeps its own Tab
    expect(document.activeElement).toBe(input)
  })

  it('Tab walks axis → L1 → L2 → L3 → inspector and Shift+Tab walks back', async () => {
    render(<Desk log={newLog()} />)
    await waitFor(() => expect(document.querySelector('[data-level="L2"]')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('[data-stage-axis-row="visual"]')!.focus()
    expect(activeRegion()).toBe('axis')

    const forward: (string | undefined)[] = []
    for (let i = 0; i < 4; i += 1) {
      tab()
      forward.push(activeRegion())
    }
    expect(forward).toEqual(['L1', 'L2', 'L3', 'inspector'])
    // Past the inspector Tab is the browser's again.
    expect(tab()).toBe(true)

    const back: (string | undefined)[] = []
    for (let i = 0; i < 4; i += 1) {
      tab(true)
      back.push(activeRegion())
    }
    expect(back).toEqual(['L3', 'L2', 'L1', 'axis'])
    // The axis is entered on the current stage row.
    expect(document.activeElement?.getAttribute('data-stage-axis-row')).toBe('visual')
  })

  it('arrows move inside a region and Tab skips a region with nothing to focus', async () => {
    render(<Desk log={newLog()} jobs={[]} />)
    const l1 = document.querySelectorAll<HTMLButtonElement>('[data-level="L1"] button')
    l1[0]!.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(l1[1])
    // No variants without slots: L1 goes straight to L3.
    tab()
    expect(activeRegion()).toBe('L3')
  })

  it('Esc closes the inspector detail; the inspector × is the mouse path', () => {
    const log = newLog()
    render(<Desk log={log} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(log.dismissed).toBe(0) // nothing selected, nothing to close
    fireEvent.click(document.querySelector('[data-level="L1"] button')!) // 审阅 selects the primary
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(log.dismissed).toBe(1)
  })

  it('empty stage says so and offers 去同步; sound stays honest without one', () => {
    const log = newLog()
    const { unmount } = render(<Desk log={log} initial="storyboard" />)
    fireEvent.click(document.querySelector('[data-stage-axis-row="sound"]')!)
    const empty = document.querySelector('[data-stage-empty="true"]')!
    expect(empty.textContent).toContain('本阶段还没有产物')
    expect(empty.querySelector('[data-stage-sync="true"]')).toBeNull()
    unmount()

    const groups = groupByStage([])
    render(
      <StageWorkbench
        rpc={rpcWith({ 'job.list': null })}
        stage="visual"
        rows={groups.visual}
        lang="zh"
        onSelect={() => undefined}
        onPinCompare={() => undefined}
        onSync={() => {
          log.synced += 1
        }}
      />,
    )
    expect(document.querySelector('[data-stage-empty="true"]')?.textContent).toContain('本阶段还没有产物')
    fireEvent.click(document.querySelector('[data-stage-sync="true"]')!)
    expect(log.synced).toBe(1)
  })

  it('lists every stage accelerator in the shared keymap', () => {
    const stage = MUWEAVE_KEYMAP.filter((b) => b.scope === 'stage').map((b) => `${b.id}:${b.keys.join(' ')}`)
    expect(stage).toEqual([
      'stage-next:j',
      'stage-prev:k',
      'stage-jump:g 1-5',
      'stage-compare:c',
      'stage-region-next:Tab',
      'stage-region-prev:shift+Tab',
      'stage-dismiss:Escape',
    ])
  })
})
