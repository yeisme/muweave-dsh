import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CreatorHostService,
  DRAMA_REVIEWS_SCHEMA,
  DramaReviewInputError,
  DramaReviewStore,
  type ShotReviewRecordV1,
} from '@yeisme/dsh-muweave-core'

describe('DramaReviewStore: optimistic-locked shot review persistence', () => {
  it('creates, updates with matching expectedRevision, unlocks from locked, and persists with 0600 mode', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-drama-review-'))
    const file = path.join(dir, 'drama-reviews.v1.json')
    try {
      const store = new DramaReviewStore(file)
      const created = store.set('ws_alpha', {
        shotRef: 'shot_01',
        sceneRef: 'scene_01',
        episodeRef: 'ep_01',
        status: 'in_review',
        note: '构图节奏不错，微调光影',
        tags: ['光影', '构图', '光影'],
        expectedRevision: 0,
      })
      expect(created.revision).toBe(1)
      expect(created.status).toBe('in_review')
      expect(created.tags).toEqual(['光影', '构图'])

      const locked = store.set('ws_alpha', {
        shotRef: 'shot_01',
        status: 'locked',
        expectedRevision: 1,
      })
      expect(locked.revision).toBe(2)
      expect(locked.status).toBe('locked')
      expect(locked.note).toBe('构图节奏不错，微调光影')
      expect(locked.sceneRef).toBe('scene_01')

      // Unlocking from locked back to needs_revision succeeds when expectedRevision matches.
      const unlocked = store.set('ws_alpha', {
        shotRef: 'shot_01',
        status: 'needs_revision',
        note: '补一句环境音提示',
        expectedRevision: 2,
      })
      expect(unlocked.revision).toBe(3)
      expect(unlocked.status).toBe('needs_revision')
      expect(unlocked.note).toBe('补一句环境音提示')

      // Atomic file persisted with 0600 permissions.
      const info = await stat(file)
      expect(info.mode & 0o777).toBe(0o600)

      const raw = JSON.parse(await readFile(file, 'utf8')) as { schema: string; reviews: ShotReviewRecordV1[] }
      expect(raw.schema).toBe(DRAMA_REVIEWS_SCHEMA)
      expect(raw.reviews).toHaveLength(1)

      // Reload from disk preserves all fields.
      const reloaded = new DramaReviewStore(file)
      const listed = reloaded.list({ workspaceId: 'ws_alpha' })
      expect(listed.reviews).toHaveLength(1)
      expect(listed.reviews[0]?.revision).toBe(3)
      expect(listed.reviews[0]?.status).toBe('needs_revision')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects stale expectedRevision with muweave/review_revision_conflict and preserves existing data', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-drama-review-lock-'))
    const file = path.join(dir, 'drama-reviews.v1.json')
    try {
      const store = new DramaReviewStore(file)
      store.set('ws_alpha', { shotRef: 'shot_01', status: 'in_review', note: 'v1' })
      store.set('ws_alpha', { shotRef: 'shot_01', status: 'approved', note: 'v2', expectedRevision: 1 })

      let caught: unknown
      try {
        store.set('ws_alpha', { shotRef: 'shot_01', status: 'draft', note: 'stale write', expectedRevision: 1 })
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(DramaReviewInputError)
      const err = caught as DramaReviewInputError
      expect(err.code).toBe('muweave/review_revision_conflict')
      expect(err.details).toEqual({ currentRevision: 2 })

      // Existing data must remain untouched.
      const current = store.get('ws_alpha', 'shot_01')
      expect(current?.revision).toBe(2)
      expect(current?.status).toBe('approved')
      expect(current?.note).toBe('v2')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('renames a corrupt JSON file aside to .corrupt-* and recovers cleanly', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-drama-review-corrupt-'))
    const file = path.join(dir, 'drama-reviews.v1.json')
    try {
      await writeFile(file, '{not valid json', 'utf8')
      const store = new DramaReviewStore(file)
      expect(store.list().reviews).toEqual([])
      expect(store.corruptFile).toContain('drama-reviews.v1.corrupt-')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects host paths, plaintext credentials, path traversal, and oversized fields', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-drama-review-fence-'))
    const file = path.join(dir, 'drama-reviews.v1.json')
    try {
      const store = new DramaReviewStore(file)
      expect(() =>
        store.set('ws_alpha', { shotRef: '../shot_01', status: 'draft' }),
      ).toThrowError(DramaReviewInputError)
      expect(() =>
        store.set('ws_alpha', { shotRef: 'shot/01', status: 'draft' }),
      ).toThrowError(DramaReviewInputError)
      expect(() =>
        store.set('ws_alpha', { shotRef: 'shot_01', status: 'draft', note: 'see /Users/alice/secret.png' }),
      ).toThrowError(DramaReviewInputError)
      expect(() =>
        store.set('ws_alpha', { shotRef: 'shot_01', status: 'draft', note: 'token sk-live1234567890abcdef' }),
      ).toThrowError(DramaReviewInputError)
      expect(() =>
        store.set('ws_alpha', { shotRef: 'shot_01', status: 'draft', tags: ['Bearer abcdefghijklmnop'] }),
      ).toThrowError(DramaReviewInputError)
      expect(() =>
        store.set('ws_alpha', { shotRef: 'shot_01', status: 'draft', note: 'x'.repeat(501) }),
      ).toThrowError(DramaReviewInputError)
      expect(() =>
        store.set('ws_alpha', {
          shotRef: 'shot_01',
          status: 'draft',
          tags: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'],
        }),
      ).toThrowError(DramaReviewInputError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('drama.shot.review.* RPC integration', () => {
  it('persists reviews across host restarts, bumps generation, and enforces optimistic lock', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-drama-review-rpc-'))
    const pluginDataDir = path.join(ws, 'plugin-data')
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir })
      const gen0 = svc.currentGeneration()

      const saved = await svc.handleRpcAction('drama.shot.review.set', {
        shotRef: 'shot_01',
        sceneRef: 'scene_01',
        status: 'approved',
        note: '通过',
        tags: ['节奏好'],
        expectedRevision: 0,
      })
      expect(saved.ok).toBe(true)
      if (!saved.ok) throw new Error('expected ok')
      expect(saved.generation).toBeGreaterThan(gen0)
      const rev = (saved.data as { review: ShotReviewRecordV1 }).review
      expect(rev.revision).toBe(1)

      const conflict = await svc.handleRpcAction('drama.shot.review.set', {
        shotRef: 'shot_01',
        status: 'draft',
        expectedRevision: 0,
      })
      expect(conflict.ok).toBe(false)
      if (conflict.ok) throw new Error('expected conflict')
      expect(conflict.error.code).toBe('muweave/review_revision_conflict')
      expect(conflict.error.details).toEqual({ currentRevision: 1 })
      svc.dispose()

      // Restart host and verify persisted review is returned.
      const svc2 = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir })
      const listed = await svc2.handleRpcAction('drama.shot.review.list', { sceneRef: 'scene_01' })
      expect(listed.ok).toBe(true)
      if (!listed.ok) throw new Error('expected list ok')
      const data = listed.data as { reviews: ShotReviewRecordV1[] }
      expect(data.reviews).toHaveLength(1)
      expect(data.reviews[0]?.shotRef).toBe('shot_01')
      expect(data.reviews[0]?.status).toBe('approved')
      svc2.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
