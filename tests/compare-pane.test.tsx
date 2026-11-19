import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createMuweaveRpcClient, type JobRecordV1, type MuweaveElementSummaryV1, type MuweaveTranslator } from '@yeisme/dsh-muweave-core/client'
import { WorkbenchMainPage } from '@yeisme/dsh-muweave-workbench/client'
import { compareSummary, elementSubject, variantSubject, versionNumber } from '../packages/dsh-muweave-workbench/src/stage-map'
import { ComparePane, summaryBadges } from '../packages/dsh-muweave-workbench/src/compare-pane'
import { StageWorkbench } from '../packages/dsh-muweave-workbench/src/stage-workbench'

const A = 'sha256:' + 'a'.repeat(64)
const B = 'sha256:' + 'b'.repeat(64)

function el(id: string, extra: Partial<MuweaveElementSummaryV1> = {}): MuweaveElementSummaryV1 {
  return {
    elementId: id,
    domain: 'eikona',
    kind: 'eikona.candidate_group',
    title: '沈岚 · 雨夜定妆 ' + id,
    sourceOwner: 'eikona',
    sourceRef: 'ref:' + id,
    status: 'waiting_review',
    digest: A,
    updatedAt: '2026-11-18T16:47:00Z',
    ...extra,
  }
}

function job(extra: Partial<JobRecordV1> = {}): JobRecordV1 {
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
    slots: [0, 1, 2].map((i) => ({
      slotId: 's' + i,
      index: i,
      status: 'done' as const,
      review: i === 1 ? ('accepted' as const) : ('unreviewed' as const),
      mime: 'image/png',
      sha256: i === 1 ? B : 'sha256:' + String(i).repeat(64),
    })),
    createdAt: '2026-11-18T10:00:00Z',
    updatedAt: '2026-11-18T10:47:00Z',
    nextAction: 'review',
    ...extra,
  } as JobRecordV1
}

function rpcWith(data: Record<string, unknown> = {}) {
  return createMuweaveRpcClient(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action: string }
    return Response.json({ ok: true, generation: 1, data: data[body.action] ?? {} })
  })
}

beforeEach(() => globalThis.localStorage?.clear())
afterEach(() => cleanup())

describe('compareSummary (desk v8 P1 §2.2)', () => {
  it('reads only vN labels as numbers', () => {
    expect(versionNumber('v3')).toBe(3)
    expect(versionNumber('v3·b')).toBe(3)
    expect(versionNumber('bbbbbbbb')).toBeUndefined()
    expect(versionNumber('12345678')).toBeUndefined()
    expect(versionNumber(undefined)).toBeUndefined()
  })

  it('covers the four version branches', () => {
    expect(compareSummary({ version: 'v3' }, { version: 'v3' }).versionDiff).toBe('same')
    expect(compareSummary({ version: 'v3' }, { version: 'v2' })).toMatchObject({ versionDiff: 'older', versionsApart: 1 })
    expect(compareSummary({ version: 'v2' }, { version: 'v5' })).toMatchObject({ versionDiff: 'newer', versionsApart: 3 })
    expect(compareSummary({ version: 'v2' }, { version: 'deadbeef' }).versionDiff).toBe('unknown')
    expect(compareSummary(undefined, { version: 'v1' }).versionDiff).toBe('unknown')
  })

  it('compares digests by equality and never calls missing data different', () => {
    expect(compareSummary({ digest: A }, { digest: A }).digestDiff).toBe('same')
    expect(compareSummary({ digest: A }, { digest: B }).digestDiff).toBe('different')
    expect(compareSummary({ digest: A }, {}).digestDiff).toBe('unknown')
  })

  it('rounds the time gap to whole hours and omits it for bad timestamps', () => {
    expect(compareSummary({ updatedAt: '2026-11-18T16:47:00Z' }, { updatedAt: '2026-11-18T10:47:00Z' }).hoursApart).toBe(6)
    expect(compareSummary({ updatedAt: 'nope' }, { updatedAt: '2026-11-18T10:47:00Z' }).hoursApart).toBeUndefined()
  })

  it('renders assertions only, with status tones and no quality verdict', () => {
    const badges = summaryBadges(compareSummary({ version: 'v3', digest: A, updatedAt: '2026-11-18T16:47:00Z' }, { version: 'v2', digest: B, updatedAt: '2026-11-18T10:47:00Z' }), 'element', 'zh')
    expect(badges.map((b) => [b.tone, b.text])).toEqual([
      ['warn', '基线落后 1 版'],
      ['neutral', '内容不同'],
      ['neutral', '相隔 6 小时'],
    ])
    expect(summaryBadges(compareSummary({ digest: A }, { digest: A }), 'element', 'zh')).toEqual([{ key: 'digest', tone: 'ok', text: '内容一致' }])
    expect(badges.map((b) => b.text).join('')).not.toMatch(/更好|更差/)
  })
})

describe('ComparePane', () => {
  it('shows the empty state instead of a blank pane', () => {
    render(<ComparePane rpc={rpcWith()} lang="zh" current={elementSubject(el('e1'))} onClose={() => undefined} />)
    expect(document.querySelector('[data-compare-empty="true"]')?.textContent).toContain('选一个候选或基线来并排对比')
    expect(document.querySelector('[data-compare-side]')).toBeNull()
  })

  it('renders two same-shape thumbnails with meta, and closes from × and Escape', () => {
    const onClose = vi.fn()
    const current = elementSubject(el('e1', { sourceRevision: '3' }))
    const compare = elementSubject(el('e0', { sourceRevision: '2', digest: B, updatedAt: '2026-11-18T10:47:00Z' }))
    render(<ComparePane rpc={rpcWith()} lang="zh" current={current} compare={compare} onClose={onClose} />)
    const pane = document.querySelector('[data-compare-pane="true"]')!
    const sides = pane.querySelectorAll('[data-compare-side]')
    expect([...sides].map((s) => s.getAttribute('data-compare-side'))).toEqual(['current', 'compare'])
    expect([...sides].map((s) => s.querySelector('.mw-stage-thumb')?.getAttribute('data-shape'))).toEqual(['compare', 'compare'])
    expect(sides[1]?.textContent).toContain('基线v2')
    expect(pane.querySelector('[data-compare-badge="version"]')?.getAttribute('data-tone')).toBe('warn')

    const close = pane.querySelector<HTMLButtonElement>('[data-compare-close="true"]')
    expect(close).not.toBeNull()
    fireEvent.click(close!)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('StageWorkbench variant pin', () => {
  it('pins a variant slot as structured data and leaves the pins out without a handler', async () => {
    const primary = el('e1', { sceneRef: 'scene:12', sourceRevision: '3' })
    const onPinVariant = vi.fn()
    const noop = () => undefined
    render(<StageWorkbench rpc={rpcWith({ 'job.list': { jobs: [job()] } })} stage="visual" rows={[primary]} lang="zh" onSelect={noop} onPinCompare={noop} onPinVariant={onPinVariant} />)
    await waitFor(() => expect(document.querySelectorAll('[data-compare-pin="true"]')).toHaveLength(3))
    const pin = document.querySelectorAll<HTMLButtonElement>('[data-compare-pin="true"]')[2]!
    fireEvent.click(pin)
    expect(onPinVariant).toHaveBeenCalledWith(expect.objectContaining({ kind: 'variant', version: 'v3·c', owner: 'eikona' }), pin)
    expect(variantSubject(job(), job().slots[0]!, 'v3').key).toBe('job_1/s0')
  })
})

describe('Workbench compare flow (shell slot unchanged)', () => {
  const keyEcho = ((key: string) => key) as unknown as MuweaveTranslator

  it('pins baseline → variant, shows thumbnails + summary, and Esc / × return to single with focus restored', async () => {
    const primary = el('e1', { sceneRef: 'scene:12', sourceRevision: '3', mediaBlobs: [{ blobDigest: B, mimeType: 'image/png' }] as never })
    const rpc = rpcWith({
      'project.list': { projects: [] },
      'bundle.elements.list': { elements: [primary], ownerStates: {} },
      'job.list': { jobs: [job()] },
      'cli.catalog': { entries: [] },
    })
    render(<WorkbenchMainPage rpc={rpc as never} t={(k: string) => k} coreT={keyEcho} />)
    await waitFor(() => expect(document.querySelectorAll('[data-compare-pin="true"]')).toHaveLength(3))
    const split = () => document.querySelector('.mw-dsh-stage-split')!

    // Variant pin: compare preset (inspector steps aside), current vs candidate, cover bytes compared.
    const pin = document.querySelectorAll<HTMLButtonElement>('[data-compare-pin="true"]')[1]!
    pin.focus()
    fireEvent.click(pin)
    await waitFor(() => expect(document.querySelector('[data-compare-pane="true"]')).not.toBeNull())
    expect(split().getAttribute('data-split')).toBe('horizontal')
    expect(document.querySelector('[data-muweave-pane="inspector"]')).toBeNull()
    const badges = () => [...document.querySelectorAll('[data-compare-badge]')].map((b) => b.textContent)
    expect(badges()).toEqual(['同一版本', '内容一致', '相隔 6 小时'])

    // × presses the shell's own close: back to single, focus back on the pin.
    fireEvent.click(document.querySelector('[data-compare-close="true"]')!)
    await waitFor(() => expect(document.querySelector('[data-compare-pane="true"]')).toBeNull())
    expect(split().getAttribute('data-split')).toBe('single')
    expect(document.activeElement).toBe(pin)
    await waitFor(() => expect(document.querySelector('[data-muweave-pane="inspector"]')).not.toBeNull())

    // c = 对比基线; Esc exits and focus returns to that button.
    fireEvent.keyDown(window, { key: 'c' })
    await waitFor(() => expect(document.querySelector('[data-compare-pane="true"]')).not.toBeNull())
    expect(document.querySelector('[data-compare-side="compare"]')?.textContent).toContain('基线v3')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('[data-compare-pane="true"]')).toBeNull())
    expect(split().getAttribute('data-split')).toBe('single')
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('对比基线')
  })
})
