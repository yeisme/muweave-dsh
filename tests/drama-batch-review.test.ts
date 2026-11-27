import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CreatorHostService,
  type ShotReviewBatchResultV1,
  type ShotReviewRecordV1,
} from '@yeisme/dsh-muweave-core'

describe('drama.shot.review.batch: atomic batch updates with partial failure isolation', () => {
  it('applies valid shot reviews in one atomic write while isolating conflicts and invalid inputs', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-drama-batch-'))
    const pluginDataDir = path.join(ws, 'plugin-data')
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir })

      // Seed shot_01 at revision 1.
      const seed = await svc.handleRpcAction('drama.shot.review.set', {
        shotRef: 'shot_01',
        sceneRef: 'scene_01',
        status: 'in_review',
        expectedRevision: 0,
      })
      expect(seed.ok).toBe(true)
      const genBefore = svc.currentGeneration()

      // Batch: shot_01 has stale expectedRevision (0 != 1), shot_02 & shot_03 are valid, shot_04 leaks a host path.
      const batchRes = await svc.handleRpcAction('drama.shot.review.batch', {
        items: [
          { shotRef: 'shot_01', status: 'approved', expectedRevision: 0 },
          { shotRef: 'shot_02', sceneRef: 'scene_01', status: 'approved', note: '镜头二通过', expectedRevision: 0 },
          { shotRef: 'shot_03', sceneRef: 'scene_01', status: 'in_review', tags: ['待复核'] },
          { shotRef: 'shot_04', status: 'approved', note: 'bad /Users/alice/file.png' },
        ],
      })
      expect(batchRes.ok).toBe(true)
      if (!batchRes.ok) throw new Error('batch failed')
      expect(batchRes.generation).toBe(genBefore + 1)

      const data = batchRes.data as ShotReviewBatchResultV1
      expect(data.succeededCount).toBe(2)
      expect(data.failedCount).toBe(2)
      expect(data.results[0]).toMatchObject({
        shotRef: 'shot_01',
        ok: false,
        errorCode: 'muweave/review_revision_conflict',
        currentRevision: 1,
      })
      expect(data.results[1]).toMatchObject({ shotRef: 'shot_02', ok: true })
      expect(data.results[1]?.record?.revision).toBe(1)
      expect(data.results[2]).toMatchObject({ shotRef: 'shot_03', ok: true })
      expect(data.results[3]).toMatchObject({
        shotRef: 'shot_04',
        ok: false,
        errorCode: 'muweave/invalid_review_input',
      })
      svc.dispose()

      // Restart host and verify persisted state reflects exactly the 3 persisted records.
      const svc2 = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir })
      const listed = await svc2.handleRpcAction('drama.shot.review.list', {})
      expect(listed.ok).toBe(true)
      if (!listed.ok) throw new Error('list failed')
      const reviews = (listed.data as { reviews: ShotReviewRecordV1[] }).reviews
      expect(reviews.map((r) => `${r.shotRef}:${r.status}`)).toEqual([
        'shot_01:in_review',
        'shot_02:approved',
        'shot_03:in_review',
      ])
      svc2.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
