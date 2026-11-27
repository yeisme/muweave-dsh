import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMuweaveRpcClient, type JobRecordV1, type MuweaveElementSummaryV1, type ScheduleEntryViewV1 } from '@yeisme/dsh-muweave-core/client'
import { StageSpine, useStageSpineJobs } from '../src/stage-axis'
import { groupBySpineStage, type SpineStageId } from '../src/stage-map'
import { stageSpineMetrics } from '../src/stage-spine-data'

const image = 'sha256:' + 'a'.repeat(64)
const audio = 'sha256:' + 'b'.repeat(64)

function element(elementId: string, domain: MuweaveElementSummaryV1['domain'], kind: MuweaveElementSummaryV1['kind'], extra: Partial<MuweaveElementSummaryV1> = {}): MuweaveElementSummaryV1 {
  return {
    elementId,
    domain,
    kind,
    sourceRef: elementId,
    sourceOwner: 'scaena',
    title: '测试产物',
    status: 'ready',
    digest: image,
    updatedAt: '2026-11-27T00:00:00Z',
    ...extra,
  }
}

const elements = [
  element('script:base', 'script', 'script.scene_card', { sceneRef: 'scene:1', status: 'draft' }),
  element('visual:candidate', 'eikona', 'eikona.candidate_group', { status: 'waiting_review', mediaBlobs: [{ blobDigest: image, mimeType: 'image/png', role: 'candidate' }] }),
  element('board:1', 'drama', 'drama.storyboard_table', { sourceRef: 'proj_current:board:1', shotRefs: ['shot:1', 'shot:2'] }),
  element('board:2', 'drama', 'drama.storyboard_table', { shotRefs: ['shot:2'], stale: true }),
  element('cut:1', 'drama', 'drama.edit_timeline'),
]

const jobs = [{
  jobId: 'job:sound',
  owner: 'sonora',
  kind: 'sfx',
  anchor: { shotRef: 'shot:2' },
  slots: [
    { slotId: '1', status: 'done', review: 'accepted', sha256: audio },
    { slotId: '2', status: 'done', review: 'unreviewed' },
    { slotId: '3', status: 'pending', review: 'unreviewed' },
  ],
}] as JobRecordV1[]

const storyboardRows = [
  { shotRef: 'shot:1', sceneRef: 'scene:1', linkedMedia: [{ role: 'keyframe', sha256: image }, { role: 'sfx', sha256: audio }] },
  { shotRef: 'shot:2', sceneRef: 'scene:1', linkedMedia: [{ role: 'reference', elementId: 'visual:candidate' }] },
]

function schedule(ref: string, projectId: string, date = '2026-11-20'): ScheduleEntryViewV1 {
  return { ref, projectId, date, label: '测试排期', kind: 'element', updatedAt: date }
}

afterEach(cleanup)

describe('production stage counts', () => {
  it('deduplicates shot links, applies exact review statuses, and excludes other projects’ schedule rows', () => {
    const metrics = stageSpineMetrics({
      groups: groupBySpineStage(elements),
      storyboardRows,
      jobs,
      entries: [
        schedule('visual:candidate', 'proj_other'),
        schedule('shot:2', 'proj_current'),
        schedule('cut:1', 'proj_current', '2026-11-27'),
        schedule('script:base', 'proj_current'),
        { ...schedule('proj_current:board:1', 'proj_current'), projectId: undefined, legacy: true },
      ],
      projectId: 'proj_current',
      now: new Date(2026, 10, 27),
    })
    expect(metrics.script).toEqual({ total: 1, review: 0, stale: 0, shots: 2, overdue: 1 })
    expect(metrics.visual).toEqual({ total: 1, review: 1, stale: 0, shots: 2, overdue: 0 })
    expect(metrics.storyboard).toEqual({ total: 2, review: 0, stale: 1, shots: 2, overdue: 2 })
    expect(metrics.sound).toEqual({ total: 2, review: 1, stale: undefined, shots: 2, overdue: 0 })
    expect(metrics.final).toEqual({ total: 1, review: 0, stale: 0, shots: undefined, overdue: 0 })
  })

  it('keeps unknown source metrics separate from a known empty stage', () => {
    const metrics = stageSpineMetrics({ groups: groupBySpineStage(elements) })
    expect(metrics.inspiration.total).toBe(0)
    expect(metrics.storyboard.shots).toBe(2)
    expect(metrics.script.shots).toBeUndefined()
    expect(metrics.visual.overdue).toBeUndefined()
    expect(metrics.sound.total).toBeUndefined()
  })

  it('reads schedule, shot details, and audio from the existing RPCs and navigates the sixth row', async () => {
    const seen: { action: string; payload: Record<string, string> }[] = []
    const rpc = createMuweaveRpcClient(async (_url, init) => {
      const req = JSON.parse(String(init?.body ?? '{}')) as typeof seen[number]
      seen.push(req)
      const [first, second] = storyboardRows
      const rows = req.payload.elementId === 'board:1' ? [first, second] : [second]
      const data = req.action === 'schedule.list' ? { entries: [schedule('shot:1', 'proj_current', '2000-01-01')] }
        : req.action === 'job.list' ? { jobs }
          : { element: { payload: { rows } } }
      return Response.json({ ok: true, generation: 1, data })
    })
    function Harness() {
      const groups = useMemo(() => groupBySpineStage(elements), [])
      const [current, setCurrent] = useState<SpineStageId>('sound')
      const audioJobs = useStageSpineJobs(rpc, 'ws_project')
      return <StageSpine rpc={rpc} groups={groups} current={current} onSelect={setCurrent} lang="zh" projectId="proj_current" workspaceId="ws_project" jobs={audioJobs} />
    }
    const { container } = render(<Harness />)
    const rows = [...container.querySelectorAll<HTMLButtonElement>('[data-stage-axis-row]')]
    expect(rows.map((row) => row.title)).toEqual(['灵感', '剧本', '视觉', '分镜', '声音', '成片'])
    await waitFor(() => expect(rows[3]?.getAttribute('data-stage-blocked')).toBe('true'))
    await waitFor(() => expect(rows[4]?.querySelector('[data-stage-metric="total"] b')?.textContent).toBe('2'))
    await waitFor(() => expect(rows[2]?.querySelector('[data-stage-metric="shots"] b')?.textContent).toBe('2'))
    expect(rows[3]?.querySelector('[data-stage-metric="overdue"] b')?.textContent).toBe('1')
    fireEvent.keyDown(window, { key: 'G', shiftKey: true })
    fireEvent.keyDown(window, { key: '6' })
    expect(rows[5]?.getAttribute('aria-current')).toBe('step')
    expect(seen).toContainEqual({ action: 'job.list', payload: { workspaceId: 'ws_project' } })
    expect(seen).toContainEqual({ action: 'bundle.element.get', payload: { elementId: 'board:1', workspaceId: 'ws_project' } })
    expect(seen).toContainEqual({ action: 'schedule.list', payload: {} })
  })
})
