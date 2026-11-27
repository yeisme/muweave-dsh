import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initBundle, syncBundle, type CliRunner } from '@yeisme/muweave-bundle'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import {
  buildDramaExportPackage,
  CreatorHostService,
  DramaExportInputError,
  msToSmpte,
  type DramaExportResultV1,
  type ShotReviewRecordV1,
} from '@yeisme/dsh-muweave-core'

const SHA_KF = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
const SHA_VID = 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
const SHA_VOX = 'sha256:3333333333333333333333333333333333333333333333333333333333333333'
const SHA_SFX = 'sha256:4444444444444444444444444444444444444444444444444444444444444444'

const SAMPLE_SHOTS = [
  {
    order: 1,
    sceneRef: 'scene_01',
    shotRef: 'shot_01',
    plannedDurationMicros: 3_500_000,
    linkedMedia: [
      { role: 'keyframe' as const, sha256: SHA_KF, mime: 'image/png' },
      { role: 'video' as const, sha256: SHA_VID, mime: 'video/mp4' },
      { role: 'voice' as const, sha256: SHA_VOX, mime: 'audio/mpeg' },
    ],
  },
  {
    order: 2,
    sceneRef: 'scene_01',
    shotRef: 'shot_02',
    plannedDurationMicros: 2_000_000,
    linkedMedia: [
      { role: 'sfx' as const, sha256: SHA_SFX, mime: 'audio/wav' },
    ],
  },
]

const SAMPLE_REVIEWS: ShotReviewRecordV1[] = [
  {
    workspaceId: 'ws_demo',
    shotRef: 'shot_01',
    sceneRef: 'scene_01',
    status: 'approved',
    note: '开场钩子, "节奏" 精准',
    tags: ['钩子'],
    revision: 2,
    updatedAt: '2026-11-27T00:00:00.000Z',
  },
]

describe('drama-export: SMPTE timecodes and rough-cut package compiler', () => {
  it('converts milliseconds to SMPTE HH:MM:SS:FF accurately at 24, 25, and 30 fps', () => {
    expect(msToSmpte(0, 24)).toBe('00:00:00:00')
    expect(msToSmpte(-500, 24)).toBe('00:00:00:00')
    expect(msToSmpte(3500, 24)).toBe('00:00:03:12')
    expect(msToSmpte(1200, 25)).toBe('00:00:01:05')
    expect(msToSmpte(1500, 30)).toBe('00:00:01:15')
    expect(msToSmpte(3_661_500, 24)).toBe('01:01:01:12')
  })

  it('compiles cut_manifest_v1 JSON with 6-role media mapping and review metadata', () => {
    const res = buildDramaExportPackage({
      format: 'cut_manifest_v1',
      projectId: 'proj_ep01',
      title: 'Neon Rain EP01',
      fps: 24,
      aspectRatio: '9:16',
      shots: SAMPLE_SHOTS,
      reviews: SAMPLE_REVIEWS,
    })
    expect(res.schema).toBe('muweave.drama-export.v1')
    expect(res.mimeType).toBe('application/json')
    expect(res.shotCount).toBe(2)
    expect(res.totalDurationMs).toBe(5500)
    expect(containsHostPath(res)).toBe(false)
    expect(findPlaintextCredential(res)).toBeUndefined()

    const parsed = JSON.parse(res.content) as {
      schema: string
      totalDurationMs: number
      shots: Array<{
        shotRef: string
        inMs: number
        outMs: number
        inTc: string
        outTc: string
        reviewStatus: string
        media: Record<string, { sha256?: string }>
      }>
    }
    expect(parsed.schema).toBe('muweave.cut_manifest.v1')
    expect(parsed.totalDurationMs).toBe(5500)
    expect(parsed.shots[0]?.inTc).toBe('00:00:00:00')
    expect(parsed.shots[0]?.outTc).toBe('00:00:03:12')
    expect(parsed.shots[0]?.reviewStatus).toBe('approved')
    expect(parsed.shots[0]?.media.keyframe?.sha256).toBe(SHA_KF)
    expect(parsed.shots[0]?.media.voice?.sha256).toBe(SHA_VOX)
    expect(parsed.shots[1]?.inMs).toBe(3500)
    expect(parsed.shots[1]?.outMs).toBe(5500)
    expect(parsed.shots[1]?.reviewStatus).toBe('draft')
    expect(parsed.shots[1]?.media.sfx?.sha256).toBe(SHA_SFX)
  })

  it('compiles CMX 3600 EDL with V and A tracks and SMPTE timecodes', () => {
    const res = buildDramaExportPackage({
      format: 'cmx3600_edl',
      projectId: 'proj_ep01',
      title: 'Neon Rain EP01',
      fps: 24,
      shots: SAMPLE_SHOTS,
      reviews: SAMPLE_REVIEWS,
    })
    expect(res.mimeType).toBe('text/plain')
    expect(res.filename).toMatch(/\.edl$/)
    expect(res.content).toContain('TITLE: Neon Rain EP01')
    expect(res.content).toContain('FCM: NON-DROP FRAME')
    expect(res.content).toContain('001  SHOT01   V     C        00:00:00:00 00:00:03:12 00:00:00:00 00:00:03:12')
    expect(res.content).toContain('* FROM CLIP NAME: shot_01 (scene_01) [approved]')
    expect(res.content).toContain('002  SHOT01   A     C        00:00:00:00 00:00:03:12 00:00:00:00 00:00:03:12')
    expect(res.content).toContain('* AUDIO ROLE: voice')
    expect(res.content).toContain('* AUDIO ROLE: sfx')
  })

  it('compiles UTF-8 BOM shotlist_csv with RFC 4180 quoting', () => {
    const res = buildDramaExportPackage({
      format: 'shotlist_csv',
      projectId: 'proj_ep01',
      title: 'Neon Rain EP01',
      fps: 24,
      shots: SAMPLE_SHOTS,
      reviews: SAMPLE_REVIEWS,
    })
    expect(res.mimeType).toBe('text/csv')
    expect(res.content.startsWith('\uFEFFOrder,Scene,Shot,DurationSec,ReviewStatus,Keyframe,Video,Voice,SFX,Music,Note')).toBe(true)
    expect(res.content).toContain('"开场钩子, ""节奏"" 精准"')
    expect(res.content).toContain(SHA_KF)
    expect(res.content).toContain(SHA_SFX)
  })

  it('blocks export when host paths or plaintext credentials are present', () => {
    expect(() =>
      buildDramaExportPackage({
        format: 'cut_manifest_v1',
        projectId: 'proj_ep01',
        title: 'Leaked /Users/alice/project',
        shots: SAMPLE_SHOTS,
      }),
    ).toThrowError(DramaExportInputError)

    expect(() =>
      buildDramaExportPackage({
        format: 'shotlist_csv',
        projectId: 'proj_ep01',
        title: 'Secret sk-live1234567890abcdef',
        shots: SAMPLE_SHOTS,
      }),
    ).toThrowError(DramaExportInputError)

    expect(() =>
      buildDramaExportPackage({
        format: 'cut_manifest_v1',
        projectId: 'proj_ep01',
        title: 'Bad FPS',
        fps: 48,
        shots: SAMPLE_SHOTS,
      }),
    ).toThrowError(DramaExportInputError)
  })
})

describe('drama.export.manifest RPC integration', () => {
  it('exports storyboard shots and persisted reviews via CreatorHostService without leaking host paths', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-drama-export-rpc-'))
    const pluginDataDir = path.join(ws, 'plugin-data')
    try {
      await mkdir(path.join(ws, '.scaena'), { recursive: true })
      await writeFile(path.join(ws, '.scaena', 'project.json'), JSON.stringify({ projectId: 'proj_ep01' }), 'utf8')

      const fakeRunner: CliRunner = async (cmd, args) => {
        if (cmd === 'scaena' && args.includes('show')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              episodeRef: 'ep_01',
              breakdownRef: 'bd_01',
              shots: [
                { scene_ref: 'scene_01', shot_ref: 'shot_01', order: 1, planned_duration_micros: 3_000_000, cells: { camera: 'CU' } },
                { scene_ref: 'scene_01', shot_ref: 'shot_02', order: 2, planned_duration_micros: 2_500_000, cells: { camera: 'WS' } },
              ],
            }),
            stderr: '',
          }
        }
        return { exitCode: 1, stdout: '', stderr: 'not mocked' }
      }

      await initBundle(ws, { projectId: 'proj_ep01', title: 'Episode One' })
      await syncBundle({
        workspaceDir: ws,
        runner: fakeRunner,
        upstreamPayloads: {
          scaena: [
            {
              breakdown_ref: 'bd_01',
              episode_ref: 'ep_01',
              rows: [
                { scene_ref: 'scene_01', shot_ref: 'shot_01', order: 1, planned_duration_micros: 3_000_000, cells: { camera: 'CU' }, restricted_fields: [] },
                { scene_ref: 'scene_01', shot_ref: 'shot_02', order: 2, planned_duration_micros: 2_500_000, cells: { camera: 'WS' }, restricted_fields: [] },
              ],
            },
          ],
        },
      })

      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir, runner: fakeRunner })
      const reviewRes = await svc.handleRpcAction('drama.shot.review.set', {
        shotRef: 'shot_01',
        sceneRef: 'scene_01',
        status: 'approved',
        note: '定稿',
      })
      expect(reviewRes.ok).toBe(true)

      for (const format of ['cut_manifest_v1', 'cmx3600_edl', 'shotlist_csv'] as const) {
        const exp = await svc.handleRpcAction('drama.export.manifest', { format, fps: 24, aspectRatio: '9:16' })
        expect(exp.ok).toBe(true)
        if (!exp.ok) throw new Error(`export failed for ${format}: ${exp.error.code}`)
        const result = exp.data as DramaExportResultV1
        expect(result.format).toBe(format)
        expect(result.shotCount).toBe(2)
        expect(result.totalDurationMs).toBe(5500)
        expect(containsHostPath(result)).toBe(false)
        expect(findPlaintextCredential(result)).toBeUndefined()
      }
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
