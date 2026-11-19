import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  WorkspaceShell,
  closeGeneration,
  getGenerationSnapshot,
  openGeneration,
  createFallbackTranslator,
  type CapabilityDescriptorV1,
  type JobRecordV1,
  type MuweaveRpcClient,
} from '@yeisme/dsh-muweave-core/client'
import { WorkbenchDraftPage } from '@yeisme/dsh-muweave-workbench/client'

// Creator platform v1 UI (docs/design/creator-platform-v1.md, 界面): generation desk, approval card, 成稿 room.

const t = createFallbackTranslator('zh')
const noTab = [{ id: 'a', label: () => 'a', render: () => null }]

const imageCap: CapabilityDescriptorV1 = {
  capabilityId: 'eikona.image.generate',
  owner: 'eikona',
  kind: 'image',
  stage: 'visual',
  title: 'Eikona 出图',
  summary: '生成候选图',
  costClass: 'paid',
  costUnit: 'usd',
  available: true,
  defaultSlots: 2,
  maxSlots: 4,
  inputs: [{ name: 'prompt', label: '画面描述', inputType: 'textarea', required: true }],
}
const unknownCap: CapabilityDescriptorV1 = {
  ...imageCap,
  capabilityId: 'anatomia.reference.analyze',
  owner: 'anatomia',
  title: 'Anatomia 参考分析',
  costClass: 'unknown',
  costUnit: 'none',
  maxSlots: 1,
  inputs: [],
}
const offCap: CapabilityDescriptorV1 = { ...imageCap, capabilityId: 'pinax.inbox.capture', title: 'Pinax 收集', available: false, unavailableReason: 'OWNER_NOT_INSTALLED' }
const soundCap: CapabilityDescriptorV1 = { ...imageCap, capabilityId: 'sonora.voice.tts', stage: 'sound', title: 'Sonora 配音', inputs: [{ name: 'text', label: '台词', inputType: 'textarea', required: true }] }

function job(over: Partial<JobRecordV1>): JobRecordV1 {
  return {
    jobId: 'job_1',
    workspaceId: 'ws',
    capabilityId: 'eikona.image.generate',
    owner: 'eikona',
    kind: 'image',
    title: '林雾定妆',
    promptDigest: 'sha256:x',
    requestedBy: 'agent',
    status: 'waiting_approval',
    estimate: { unit: 'usd', amount: 0.16 },
    idempotencyKey: 'k',
    slots: [{ slotId: 's1', index: 0, status: 'pending', review: 'unreviewed' }],
    createdAt: '2026-11-17T00:00:00Z',
    updatedAt: '2026-11-17T00:00:00Z',
    nextAction: 'approve',
    ...over,
  }
}

interface Calls {
  list: Array<{ action: string; payload: Record<string, unknown> }>
}

function fakeRpc(opts: { paidEnabled?: boolean; jobs?: JobRecordV1[]; caps?: CapabilityDescriptorV1[]; elements?: Record<string, unknown>; unknownCostJobs?: number; spent?: number } = {}) {
  const calls: Calls = { list: [] }
  const paidEnabled = opts.paidEnabled ?? true
  const rpc = {
    async call(action: string, payload: Record<string, unknown> = {}) {
      calls.list.push({ action, payload })
      const ok = (data: unknown) => ({ ok: true as const, generation: 1, data })
      switch (action) {
        case 'job.list':
          return ok({ jobs: opts.jobs ?? [] })
        case 'capability.catalog':
          return ok({ paidEnabled, capabilities: opts.caps ?? [imageCap, unknownCap, offCap, soundCap] })
        case 'budget.status':
          return ok({ paidEnabled, day: '2026-11-17', lines: [{ unit: 'usd', committed: 0.5, spent: opts.spent ?? 0.25, dailyCap: 5 }], unknownCostJobs: opts.unknownCostJobs ?? 0 })
        case 'capability.estimate':
          return ok({
            estimateId: 'est_1',
            capabilityId: payload.capabilityId,
            owner: 'eikona',
            costClass: 'paid',
            estimate: { unit: 'usd', amount: 0.16 },
            suggestedCeiling: { unit: 'usd', amount: 0.2 },
            slots: 2,
            planLines: ['2 × 1024x1536 gpt-image-2.5-sunburst'],
            title: '林雾定妆',
            promptDigest: 'sha256:x',
            expiresAt: '2026-11-17T01:00:00Z',
          })
        case 'job.request':
          return ok(job({ jobId: 'job_new', requestedBy: 'ui' }))
        case 'bundle.elements.list': {
          const els = (opts.elements ?? {}) as Record<string, Array<{ elementId: string }>>
          return ok({ elements: els[String(payload.kind)] ?? [] })
        }
        case 'bundle.element.get': {
          const store = (opts.elements ?? {}) as Record<string, Array<{ elementId: string; payload?: unknown }>>
          const found = Object.values(store).flat().find((e) => e.elementId === payload.elementId)
          return ok({ element: { ...found, payload: found?.payload ?? {} } })
        }
        default:
          return ok({})
      }
    },
    async resolveMediaUrl(sha: string) {
      return `/media/${sha.replace(/\W/g, '').slice(-6)}.png`
    },
  }
  return { rpc: rpc as unknown as MuweaveRpcClient, calls }
}

function Shell({ rpc }: { rpc: MuweaveRpcClient }) {
  return <WorkspaceShell title="房间" rpc={rpc} t={t} stageTabs={noTab} stage={['visual', 'sound']} />
}

const pill = () => document.querySelector<HTMLButtonElement>('[data-muweave-generate-open]')!
const drawer = () => screen.getByRole('dialog', { name: '生成台' })

afterEach(() => {
  vi.useRealTimers()
  closeGeneration()
  cleanup()
})

describe('生成台 drawer', () => {
  it('opens from the pill, lists room capabilities (unavailable ones disabled with a reason), closes on Escape and returns focus', async () => {
    const { rpc } = fakeRpc({ jobs: [job({ status: 'running' })] })
    render(<Shell rpc={rpc} />)
    await waitFor(() => expect(pill().querySelector('[data-muweave-generate-count]')?.textContent).toBe('1'))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(pill())
    const d = drawer()
    expect(await within(d).findByRole('button', { name: /Eikona 出图/ })).toBeTruthy()
    // The pinax capability is unavailable: listed, disabled, with its reason.
    await waitFor(() => expect(within(d).getByRole('button', { name: /Pinax 收集/ }).hasAttribute('disabled')).toBe(true))
    expect(within(d).getByText(/未安装 owner 工具/)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(pill())
  })

  it('estimates with plan lines and requests approval as the ui; nothing is approved here', async () => {
    const { rpc, calls } = fakeRpc()
    render(<Shell rpc={rpc} />)
    fireEvent.click(pill())
    const form = await waitFor(() => {
      const f = document.querySelector<HTMLFormElement>('[data-muweave-generate-form="eikona.image.generate"]')
      if (!f) throw new Error('form')
      return f
    })
    const estimate = within(form).getByRole('button', { name: '估价' }) as HTMLButtonElement
    expect(estimate.disabled).toBe(true)
    fireEvent.change(within(form).getByLabelText('画面描述'), { target: { value: '雨夜街口，林雾回头' } })
    fireEvent.click(estimate)
    expect(await screen.findByText('2 × 1024x1536 gpt-image-2.5-sunburst')).toBeTruthy()
    expect(screen.getByText('$0.16', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提交审批' }))
    await waitFor(() => expect(calls.list.some((c) => c.action === 'job.request')).toBe(true))
    const req = calls.list.find((c) => c.action === 'job.request')!
    expect(req.payload).toMatchObject({ estimateId: 'est_1', requestedBy: 'ui' })
    expect(typeof req.payload.idempotencyKey).toBe('string')
    expect(calls.list.some((c) => c.action === 'job.approve')).toBe(false)
  })
})

describe('审批卡', () => {
  it('disables approval and explains how to turn paid generation on when paidEnabled is false', async () => {
    const { rpc } = fakeRpc({ paidEnabled: false, jobs: [job({})] })
    render(<Shell rpc={rpc} />)
    fireEvent.click(pill())
    const approve = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('[data-muweave-approve]')
      if (!b) throw new Error('approve')
      return b
    })
    expect(approve.disabled).toBe(true)
    expect(approve.textContent).toContain('批准并生成（≤ $0.16）')
    expect(screen.getByText(/settings\.v1\.json/).textContent).toContain('MUWEAVE_DSH_PAID=1')
    expect(await screen.findByText(/今日已承诺 \$0\.5，已花费 \$0\.25/)).toBeTruthy()
  })

  it('needs the separate unknown-cost checkbox before approving', async () => {
    const { rpc, calls } = fakeRpc({
      jobs: [job({ capabilityId: 'anatomia.reference.analyze', owner: 'anatomia', estimate: { unit: 'usd' } })],
    })
    render(<Shell rpc={rpc} />)
    fireEvent.click(pill())
    const approve = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('[data-muweave-approve]')
      if (!b) throw new Error('approve')
      return b
    })
    expect(approve.disabled).toBe(true)
    fireEvent.change(document.querySelector('[data-muweave-ceiling]')!, { target: { value: '1' } })
    fireEvent.click(screen.getByLabelText('接受未知费用'))
    await waitFor(() => expect(approve.disabled).toBe(false))
    fireEvent.click(approve)
    await waitFor(() => expect(calls.list.some((c) => c.action === 'job.approve')).toBe(true))
    expect(calls.list.find((c) => c.action === 'job.approve')!.payload).toMatchObject({ jobId: 'job_1', acceptUnknownCost: true })
  })

  it('shows a done image slot, never reports a missing cost as zero, and links an accepted slot to its shot', async () => {
    const done = job({
      status: 'waiting_for_human',
      anchor: { episodeRef: 'breakdown:ep01', sceneRef: 'scene:01', shotRef: 'shot:01' },
      slots: [{ slotId: 's1', index: 0, status: 'done', review: 'unreviewed', sha256: 'sha256:abc123', mime: 'image/png' }],
    })
    const { rpc, calls } = fakeRpc({ jobs: [done] })
    render(<Shell rpc={rpc} />)
    fireEvent.click(pill())
    const img = await waitFor(() => {
      const i = document.querySelector<HTMLImageElement>('.mw-gen-slot img')
      if (!i) throw new Error('img')
      return i
    })
    expect(img.getAttribute('src')).toContain('/media/')
    expect(screen.getByText(/owner 未报告/)).toBeTruthy()
    fireEvent.click(document.querySelector('[data-muweave-slot-accept="s1"]')!)
    await waitFor(() => expect(calls.list.some((c) => c.action === 'job.slot.review')).toBe(true))
    expect(calls.list.find((c) => c.action === 'job.slot.review')!.payload).toEqual({
      jobId: 'job_1',
      slotId: 's1',
      decision: 'accept',
      linkToShot: true,
    })
    // Rooms showing shots reload in place when an accepted slot is linked.
    await waitFor(() => expect(getGenerationSnapshot().mediaRevision ?? 0).toBeGreaterThan(0))
  })

  it('renders an audio player for a done audio slot', async () => {
    const done = job({ status: 'waiting_for_human', slots: [{ slotId: 's1', index: 0, status: 'done', review: 'unreviewed', sha256: 'sha256:aud001', mime: 'audio/mpeg' }] })
    const { rpc } = fakeRpc({ jobs: [done] })
    render(<Shell rpc={rpc} />)
    fireEvent.click(pill())
    await waitFor(() => expect(document.querySelector('audio[controls]')).toBeTruthy())
  })
})

describe('成稿 room', () => {
  const elements = {
    'script.scene_card': [
      { elementId: 'sc2', title: '场次卡 2', sourceRef: 'scene:02', sceneRef: 'scene:02', payload: { goal: '追上马车', obstacle: '大雨', turn: '怀表停了' } },
      { elementId: 'sc1', title: '场次卡 1', sourceRef: 'scene:01', sceneRef: 'scene:01', payload: { goal: '夺回怀表', obstacle: '', turn: '' } },
    ],
    'drama.storyboard_table': [
      {
        elementId: 'sb1',
        title: '第一集 分镜',
        sourceRef: 'breakdown:ep01',
        payload: {
          rows: [
            { sceneRef: 'scene:01', shotRef: 'shot:01', order: 1, plannedDurationMicros: 3_500_000, cells: { description: '雨夜街口，林雾回头' }, restrictedFields: [], linkedMedia: [{ sha256: 'sha256:key001', role: 'keyframe', mime: 'image/png' }] },
            { sceneRef: 'scene:02', shotRef: 'shot:02', order: 2, plannedDurationMicros: 2_000_000, cells: { description: '马车远去' }, restrictedFields: [] },
          ],
        },
      },
    ],
  }

  function Room({ rpc }: { rpc: MuweaveRpcClient }) {
    return <WorkbenchDraftPage rpc={rpc} t={(k) => k} coreT={t} />
  }

  it('shows the linked keyframe as an image and a poster otherwise, scenes in order, with stats', async () => {
    const { rpc } = fakeRpc({ elements })
    render(<Room rpc={rpc} />)
    const linked = await waitFor(() => {
      const c = document.querySelector<HTMLElement>('[data-muweave-shot-card="shot:01"]')
      if (!c) throw new Error('card')
      return c
    })
    await waitFor(() => expect(linked.querySelector('img')).toBeTruthy())
    const plain = document.querySelector<HTMLElement>('[data-muweave-shot-card="shot:02"]')!
    expect(plain.querySelector('img')).toBeNull()
    expect(plain.querySelector('.mw-poster')).toBeTruthy()
    const order = [...document.querySelectorAll('[data-muweave-scene-card]')].map((n) => n.getAttribute('data-muweave-scene-card'))
    expect(order).toEqual(['scene:01', 'scene:02'])
    expect(document.querySelector('.mw-hero-stats')?.textContent).toContain('1')
  })

  it('opens the drawer prefilled from 为此镜出图 with the shot anchor, and from 配音 with the scene anchor', async () => {
    const { rpc, calls } = fakeRpc({ elements })
    render(<Room rpc={rpc} />)
    const btn = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('[data-muweave-shot-generate="shot:02"]')
      if (!b) throw new Error('btn')
      return b
    })
    expect(btn.textContent).toBe('为此镜出图')
    fireEvent.click(btn)
    const area = (await screen.findByLabelText('画面描述')) as HTMLTextAreaElement
    expect(area.value).toBe('马车远去')
    fireEvent.click(within(drawer()).getByRole('button', { name: '估价' }))
    await waitFor(() => expect(calls.list.some((c) => c.action === 'capability.estimate')).toBe(true))
    expect(calls.list.find((c) => c.action === 'capability.estimate')!.payload).toMatchObject({
      capabilityId: 'eikona.image.generate',
      anchor: { episodeRef: 'breakdown:ep01', sceneRef: 'scene:02', shotRef: 'shot:02' },
    })
    closeGeneration()
    fireEvent.click(document.querySelector('[data-muweave-scene-voice="scene:02"]')!)
    const text = (await screen.findByLabelText('台词')) as HTMLTextAreaElement
    expect(text.value).toBe('追上马车')
  })
})

const approveBtn = () => document.querySelector<HTMLButtonElement>('[data-muweave-approve]')!
const ceilingInput = () => document.querySelector<HTMLInputElement>('[data-muweave-ceiling]')!
async function openWith(rpc: MuweaveRpcClient) {
  render(<Shell rpc={rpc} />)
  fireEvent.click(pill())
  await waitFor(() => {
    if (!document.querySelector('[data-muweave-approve],[data-muweave-reconcile]')) throw new Error('card')
  })
}

describe('review fixes', () => {
  it('unknown cost is detected from the job estimate, not the catalog class', async () => {
    // Catalog says paid, but the job estimate carries no amount.
    const { rpc, calls } = fakeRpc({ jobs: [job({ estimate: { unit: 'usd' } })] })
    await openWith(rpc)
    fireEvent.change(ceilingInput(), { target: { value: '1' } })
    expect(approveBtn().disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('接受未知费用'))
    await waitFor(() => expect(approveBtn().disabled).toBe(false))
    fireEvent.click(approveBtn())
    await waitFor(() => expect(calls.list.some((c) => c.action === 'job.approve')).toBe(true))
    expect(calls.list.find((c) => c.action === 'job.approve')!.payload).toMatchObject({ acceptUnknownCost: true })
  })

  it('reconcile_required job offers 核对 and a two-step 放弃', async () => {
    const { rpc, calls } = fakeRpc({ jobs: [job({ status: 'reconcile_required', nextAction: 'reconcile' })] })
    await openWith(rpc)
    expect(screen.getByText(/只会查询 owner，不会重新提交/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '核对' }))
    await waitFor(() => expect(calls.list.some((c) => c.action === 'job.reconcile')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '放弃（费用未知）' }))
    expect(calls.list.some((c) => c.action === 'job.cancel')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '确认放弃（费用未知）' }))
    await waitFor(() => expect(calls.list.some((c) => c.action === 'job.cancel')).toBe(true))
    expect(calls.list.find((c) => c.action === 'job.cancel')!.payload).toEqual({ jobId: 'job_1' })
  })

  it('maps new error codes to localized messages in zh and en', async () => {
    const en = createFallbackTranslator('en')
    for (const code of ['SPEND_UNKNOWN', 'ESTIMATE_EXPIRED', 'APPROVAL_REQUIRED']) {
      const key = `genErr_${code}` as Parameters<typeof t>[0]
      expect(t(key)).not.toBe(key)
      expect(en(key)).not.toBe(key)
      expect(t(key)).not.toBe(en(key))
    }
    const { rpc } = fakeRpc({ jobs: [job({ status: 'cancelled', errorCode: 'SPEND_UNKNOWN' })] })
    render(<Shell rpc={rpc} />)
    fireEvent.click(pill())
    expect(await screen.findByText(/费用未知，请到 owner 那边核对/)).toBeTruthy()
  })

  it('never shows spent $0 when unreported, and counts unknown-cost jobs', async () => {
    const { rpc } = fakeRpc({ jobs: [job({})], spent: 0, unknownCostJobs: 2 })
    await openWith(rpc)
    const line = await waitFor(() => {
      const el = document.querySelector('[data-muweave-budget]')
      if (!el) throw new Error('budget')
      return el
    })
    expect(line.textContent).not.toContain('已花费 $0')
    expect(line.textContent).toContain('2 个任务 owner 未报告费用')
  })

  it('polls every 5 s while closed only for queued/running, and 2 s when open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const waiting = fakeRpc({ jobs: [job({ status: 'reconcile_required' })] })
    render(<Shell rpc={waiting.rpc} />)
    await vi.advanceTimersByTimeAsync(12000)
    expect(waiting.calls.list.filter((c) => c.action === 'job.list').length).toBe(1)
    cleanup()
    const running = fakeRpc({ jobs: [job({ status: 'running' })] })
    render(<Shell rpc={running.rpc} />)
    await vi.advanceTimersByTimeAsync(4000)
    const n0 = running.calls.list.filter((c) => c.action === 'job.list').length
    expect(n0).toBe(1)
    await vi.advanceTimersByTimeAsync(1500)
    expect(running.calls.list.filter((c) => c.action === 'job.list').length).toBe(2)
    fireEvent.click(pill())
    await vi.advanceTimersByTimeAsync(4100)
    expect(running.calls.list.filter((c) => c.action === 'job.list').length).toBeGreaterThanOrEqual(4)
    cleanup()
    const before = running.calls.list.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(running.calls.list.length).toBe(before)
  })

  it('ignores Escape while composing and returns focus to the opener', async () => {
    const { rpc } = fakeRpc({ elements: {} })
    render(
      <>
        <button type="button" id="opener" />
        <Shell rpc={rpc} />
      </>,
    )
    const opener = document.getElementById('opener') as HTMLButtonElement
    opener.focus()
    openGeneration(undefined, opener)
    await screen.findByRole('dialog', { name: '生成台' })
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(document, { key: 'Escape', keyCode: 229 })
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('falls back to the pill when the opener is disconnected', async () => {
    const { rpc } = fakeRpc()
    render(<Shell rpc={rpc} />)
    const gone = document.createElement('button')
    document.body.appendChild(gone)
    openGeneration(undefined, gone)
    await screen.findByRole('dialog', { name: '生成台' })
    gone.remove()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(pill())
  })

  it('keeps approve disabled for empty, non-positive or below-estimate ceilings, with a hint', async () => {
    const { rpc } = fakeRpc({ jobs: [job({})] })
    await openWith(rpc)
    for (const bad of ['', '0', '-1', '0.1']) {
      fireEvent.change(ceilingInput(), { target: { value: bad } })
      expect(approveBtn().disabled).toBe(true)
      expect(document.querySelector('[data-muweave-ceiling-hint]')).toBeTruthy()
    }
    fireEvent.change(ceilingInput(), { target: { value: '0.2' } })
    await waitFor(() => expect(approveBtn().disabled).toBe(false))
    expect(document.querySelector('[data-muweave-ceiling-hint]')).toBeNull()
  })
})
