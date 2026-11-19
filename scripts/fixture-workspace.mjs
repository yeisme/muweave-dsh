/**
 * Demo workspace fixture (docs/design/desk-v4.md): materializes a `.muweave/` bundle with Eikona
 * candidates, Auctra scenes, a Scaena breakdown and Pi artifacts, using injected upstream payloads so
 * no owner CLI ever runs. Shared by the e2e runner and `scripts/make-demo-workspace.mjs`.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bindBundleRef, initBundle, putCasBlob, syncBundle } from '../packages/muweave-bundle/lib/index.js'

// 1x1 valid PNG: the pixel content does not matter, only that media decode succeeds.
const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export async function prepareFixtureWorkspace({ dir } = {}) {
  const ws = dir ?? (await mkdtemp(path.join(os.tmpdir(), 'muweave-e2e-ws-')))
  if (dir) await mkdir(dir, { recursive: true })
  await mkdir(path.join(ws, '.auctra'), { recursive: true })
  await mkdir(path.join(ws, '.scaena'), { recursive: true })
  await writeFile(path.join(ws, '.scaena', 'project.json'), '{"id":"proj_rain_ep01"}\n')
  await mkdir(path.join(ws, '.pi', 'goals'), { recursive: true })
  await writeFile(
    path.join(ws, '.pi', 'goals', 'active_goal_ep01.md'),
    '# 第一集《雨夜街口》成片闭环\n- [x] 角色林雾三视图定妆\n- [ ] 第 1 场分镜拆解审阅\n',
  )
  await writeFile(path.join(ws, 'PLAN.md'), '# 连载拍摄计划\n- [x] 母版入库\n- [ ] 首集粗剪\n')

  await initBundle(ws, { projectId: 'proj_rain_ep01', title: '雨夜重逢 · 第一集' })
  // Bound so the host re-sync (after a shot-media link) recollects the storyboard through the fake scaena owner.
  await bindBundleRef(ws, 'scaena-breakdown', 'breakdown:ep01')
  const pngBytes = Buffer.from(SAMPLE_PNG_BASE64, 'base64')
  const casRef = await putCasBlob(ws, pngBytes, 'image/png', 'primary', { width: 1152, height: 2048 })

  await syncBundle({
    workspaceDir: ws,
    runner: async () => ({ exitCode: 0, stdout: '{}', stderr: '' }),
    upstreamPayloads: {
      eikona: [
        {
          ok: true,
          schema_version: 'eikona.review_packet.v1',
          run_id: 'run_linwu_01',
          review_state: 'waiting_review',
          candidates: [
            {
              artifact_id: 'art_linwu_front',
              handle: 'linwu-front-v1',
              uri: 'eikona://artifact/linwu-front-v1',
              role: 'primary',
              prompt_excerpt: '林雾霓虹雨夜正面定妆 1152x2048',
              model_ref: 'openai/gpt-image-2.5-sunburst',
              sha256: casRef.blobDigest,
            },
            {
              artifact_id: 'art_linwu_side',
              handle: 'linwu-side-v1',
              uri: 'eikona://artifact/linwu-side-v1',
              role: 'variant',
              prompt_excerpt: '林雾侧面轮廓光定妆 1152x2048',
              model_ref: 'openai/gpt-image-2.5-sunburst',
              sha256: casRef.blobDigest,
            },
          ],
        },
        {
          spec_version: '1.0',
          command: 'eikona.library.handoff',
          status: 'ready',
          facts: {
            collection_uri: 'eikona://asset-collections/project/proj_rain_ep01/linwu/v1',
            collection_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            binding_snapshot_id: 'bind_linwu_v1',
            binding_snapshot_digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            representation_count: 3,
          },
        },
      ],
      auctra: [
        {
          kind: 'auctra.screenplay.room.v1',
          project_ref: 'owner:auctra:rain_ep01',
          title: '雨夜重逢 · 双时间轴',
          revision: '4',
          scenes: [{ scene_ref: 'scene:ep01:s01', order: 1, title: '霓虹街口重逢' }],
          story_time_anchors: [{ scene_ref: 'scene:ep01:s01', label: '第 1 夜 23:15' }],
        },
        {
          kind: 'auctra.scene_card.v1',
          scene_ref: 'scene:ep01:s01',
          heading: '外景 霓虹街口 - 夜',
          revision: '2',
          goal: '林雾试探沈舟手中的旧怀表来源',
          obstacle: '巡逻无人机扫街逼近',
          stakes: '地下联络点暴露',
          turn: '沈舟翻转怀表露出暗格芯片',
          characters: ['char:linwu', 'char:shenzhou'],
        },
        {
          kind: 'auctra.candidate_diff.v1',
          candidate_id: 'cand_ep01_s01',
          scene_ref: 'scene:ep01:s01',
          base_revision: 1,
          canonical_revision: 2,
          stale: true,
          canonical_excerpt: '沈舟沉默地收起雨伞。',
          candidate_excerpt: '沈舟压低伞沿，将旧怀表推过积水反光的桌面。',
        },
      ],
      scaena: [
        {
          schema_version: 'scaena.storyboard_table_view.v1alpha1',
          breakdown_ref: 'breakdown:ep01',
          episode_ref: 'episode:01',
          rows: [
            {
              scene_ref: 'scene:ep01:s01',
              shot_ref: 'shot:ep01:s01:01',
              order: 1,
              planned_duration_micros: 3500000,
              cells: { camera: '9:16 竖屏特写推镜', focus: '旧怀表反光' },
              restricted_fields: ['dialogue_raw'],
            },
          ],
        },
        {
          schema_version: 'scaena.asset.list_page.v0.1',
          total_count: 1,
          assets: [
            {
              asset_ref: 'asset:char:linwu',
              kind: 'image',
              role: 'character',
              status: 'accepted',
              version: 0,
              version_ref: 'asset:char:linwu:v1',
              scaena_admission: 'admitted',
              subject_freeze: 'frozen',
              production_acceptance: 'accepted',
              current_usability: 'ready',
            },
          ],
        },
      ],
      dshArtifacts: [
        {
          artifactId: 'ptc_hook_01',
          toolName: 'muweave_bundle_overview',
          title: '首集前三秒钩子与母版核对',
          status: 'completed',
          sceneRef: 'scene:ep01:s01',
          summary: { checkedAssets: 2, ready: true },
        },
      ],
    },
  })

  return ws
}
