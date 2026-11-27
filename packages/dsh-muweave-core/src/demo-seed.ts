import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  addShotMediaLink,
  initBundle,
  muweaveRoot,
  putCasBlob,
  sha256Digest,
  syncBundle,
  validateBundleOnDisk,
  type CliRunner,
} from '@yeisme/muweave-bundle'
import { DramaReviewStore } from './drama-review-store'
import { ScheduleStore } from './schedule-store'

export class DemoSeedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface SeedDemoWorkspaceOptions {
  force?: boolean
  pluginDataDir?: string
  episodes?: number
}

export interface SeedDemoWorkspaceResult {
  ok: true
  projectId: string
  title: string
  episodeCount: number
  elementCount: number
  shotCount: number
  reviewCount: number
  scheduleCount: number
  validationOk: boolean
}

const OFFLINE_RUNNER: CliRunner = async () => ({
  exitCode: 1,
  stdout: '',
  stderr: 'offline demo seed',
})

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const crcInput = out.subarray(4, 8 + data.length)
  view.setUint32(8 + data.length, crc32(crcInput), false)
  return out
}

/** Generate a minimal valid 2x2 RGBA PNG image so demo CAS blobs are real, verifiable PNGs. */
function makeSolidPng(r: number, g: number, b: number): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, 2, false) // width
  ihdrView.setUint32(4, 2, false) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // 2 scanlines, each: filter(0) + 2 pixels * 4 bytes = 9 bytes
  const raw = new Uint8Array(18)
  for (let row = 0; row < 2; row += 1) {
    const base = row * 9
    raw[base] = 0
    for (let col = 0; col < 2; col += 1) {
      const px = base + 1 + col * 4
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
      raw[px + 3] = 255
    }
  }
  const idat = deflateSync(raw)
  const chunks = [
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ]
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const png = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    png.set(c, offset)
    offset += c.length
  }
  return png
}

function canonicalWorkspaceId(workspaceDir: string): string {
  const resolved = path.resolve(workspaceDir)
  let canonical = resolved
  try {
    canonical = realpathSync(resolved)
  } catch {
    /* keep resolved */
  }
  return `ws_${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`
}

export async function seedDemoWorkspace(
  workspaceDir: string,
  options: SeedDemoWorkspaceOptions = {},
): Promise<SeedDemoWorkspaceResult> {
  const root = muweaveRoot(workspaceDir)
  const bundleManifestPath = path.join(root, 'bundle.v1.json')
  if (existsSync(bundleManifestPath) && !options.force) {
    throw new DemoSeedError(
      'muweave/demo_workspace_not_empty',
      'Workspace already has an initialized .muweave/ bundle; pass --force to overwrite',
    )
  }
  if (options.force && existsSync(root)) {
    await rm(root, { recursive: true, force: true })
  }

  const projectId = 'proj_rain_watch_ep01'
  const title = '雨夜怀表 · 第 1 集'

  await initBundle(workspaceDir, { projectId, title })

  // Create 3 distinct valid PNGs in CAS for demo shots & Eikona candidates.
  const blob1 = await putCasBlob(workspaceDir, makeSolidPng(28, 42, 68), 'image/png', 'demo-keyframe-01')
  const blob2 = await putCasBlob(workspaceDir, makeSolidPng(42, 74, 96), 'image/png', 'demo-keyframe-02')
  const blob3 = await putCasBlob(workspaceDir, makeSolidPng(86, 54, 72), 'image/png', 'demo-keyframe-03')

  // Link keyframes to 4 of 6 shots (leaving shot_05 & shot_06 missing keyframe for demo filtering).
  await addShotMediaLink(workspaceDir, {
    shotRef: 'shot_01',
    sceneRef: 'scene_01',
    episodeRef: 'ep_01',
    role: 'keyframe',
    sha256: blob1.blobDigest,
    mime: 'image/png',
  })
  await addShotMediaLink(workspaceDir, {
    shotRef: 'shot_02',
    sceneRef: 'scene_01',
    episodeRef: 'ep_01',
    role: 'keyframe',
    sha256: blob2.blobDigest,
    mime: 'image/png',
  })
  await addShotMediaLink(workspaceDir, {
    shotRef: 'shot_03',
    sceneRef: 'scene_02',
    episodeRef: 'ep_01',
    role: 'keyframe',
    sha256: blob3.blobDigest,
    mime: 'image/png',
  })
  await addShotMediaLink(workspaceDir, {
    shotRef: 'shot_04',
    sceneRef: 'scene_02',
    episodeRef: 'ep_01',
    role: 'keyframe',
    sha256: blob1.blobDigest,
    mime: 'image/png',
  })

  const episodeCount = typeof options.episodes === 'number' && options.episodes >= 2 ? 2 : 1
  const ep2Auctra = episodeCount >= 2
    ? [
        {
          kind: 'auctra.scene_card.v1',
          scene_ref: 'scene_04',
          episode_ref: 'episode:02',
          revision: '1',
          heading: '第四场 · 地铁末班车铜钥匙密室',
          location: '内景 · 末班地铁车厢 · 冷蓝',
          story_time: '00:15',
          goal: '林深与顾岚在末班地铁车厢内核对铜钥匙上的编号',
          obstacle: '追踪者已登上相邻车厢并切断应急照明',
          stakes: '若在下一站前无法脱身，两人将被围堵在站台',
          turn: '钥匙背面暗纹映出下一处钟楼坐标',
          review_status: 'draft',
          characters: ['char_lin_shen', 'char_gu_lan'],
          beats: ['车厢闪烁灯光', '钥匙暗纹特写', '紧急拉闸跳站'],
        },
      ]
    : []
  const ep2Scaena = episodeCount >= 2
    ? [
        {
          breakdown_ref: 'bd_ep02',
          episode_ref: 'episode:02',
          revision: '1',
          rows: [
            {
              scene_ref: 'scene_04',
              shot_ref: 'ep2_shot_01',
              order: 1,
              planned_duration_micros: 3_000_000,
              cells: { shot_size: '中景 MS', camera: '手持跟拍', action: '末班地铁灯光频闪，林深紧握铜钥匙' },
              restricted_fields: [],
            },
            {
              scene_ref: 'scene_04',
              shot_ref: 'ep2_shot_02',
              order: 2,
              planned_duration_micros: 2_500_000,
              cells: { shot_size: '特写 CU', camera: '急推', action: '钥匙背面钟楼坐标在暗光下浮现' },
              restricted_fields: [],
            },
          ],
        },
      ]
    : []
  const totalShotCount = episodeCount >= 2 ? 8 : 6

  const index = await syncBundle({
    workspaceDir,
    runner: OFFLINE_RUNNER,
    upstreamPayloads: {
      eikona: [
        {
          schema_version: 'eikona.review_packet.v1',
          run_id: 'run_rain_watch_01',
          review_state: 'waiting_review',
          candidates: [
            {
              artifact_id: 'art_lin_shen_01',
              handle: 'char_lin_shen_rain_v1',
              uri: 'eikona://runs/run_rain_watch_01/art_lin_shen_01',
              role: 'keyframe',
              prompt_excerpt: '雨夜霓虹街口，风衣侦探林深掌心紧握停摆的铜壳怀表',
              overall_score: 0.92,
              width: 1152,
              height: 2048,
              model_ref: 'openai/gpt-image-2.5-sunburst',
              sha256: blob1.blobDigest,
              mime_type: 'image/png',
            },
            {
              artifact_id: 'art_clockshop_02',
              handle: 'scene_clockshop_v1',
              uri: 'eikona://runs/run_rain_watch_01/art_clockshop_02',
              role: 'reference',
              prompt_excerpt: '旧城钟表铺暖黄钨丝灯与雨水玻璃倒影',
              overall_score: 0.88,
              width: 1152,
              height: 2048,
              model_ref: 'openai/gpt-image-2.5-sunburst',
              sha256: blob2.blobDigest,
              mime_type: 'image/png',
            },
          ],
        },
        {
          schema_version: 'eikona.library.handoff',
          status: 'ready',
          facts: {
            collection_uri: 'eikona://collections/char_lin_shen',
            collection_digest: sha256Digest('char_lin_shen_master_v1'),
            binding_snapshot_id: 'snap_lin_shen_v1',
            binding_snapshot_digest: sha256Digest('snap_lin_shen_v1'),
            representation_count: 3,
          },
        },
      ],
      auctra: [
        {
          project_ref: projectId,
          title: '雨夜怀表 · 第 1 集双时间轴',
          revision: '3',
          episodes: [{ episode_ref: 'ep_01', title }],
          scenes: [
            { scene_ref: 'scene_01', heading: '第一场 · 暴雨霓虹十字路口', story_time: '2026-11-27T23:10:00Z', order: 1 },
            { scene_ref: 'scene_02', heading: '第二场 · 午夜旧城钟表铺', story_time: '2026-11-27T23:25:00Z', order: 2 },
            { scene_ref: 'scene_03', heading: '第三场 · 停摆指针逆转瞬间', story_time: '2026-11-27T23:40:00Z', order: 3 },
          ],
          story_time_anchors: [
            { anchor_id: 'anchor_midnight', label: '午夜钟声前 50 分钟' },
          ],
        },
        {
          kind: 'auctra.scene_card.v1',
          scene_ref: 'scene_01',
          episode_ref: 'ep_01',
          revision: '3',
          heading: '第一场 · 暴雨霓虹十字路口',
          location: '外景 · 霓虹老街 · 雨夜',
          story_time: '23:10',
          goal: '林深必须在怀表彻底失磁前找到留下暗号的匿名信使',
          obstacle: '暴雨冲刷街面线索，黑伞人群掩盖了信使行踪',
          stakes: '错过午夜窗口将永久失去三年前失踪案的唯一物证',
          turn: '怀表秒针突然倒退三格，指向街角亮灯的旧钟表铺',
          review_status: 'approved',
          characters: ['char_lin_shen', 'char_messenger'],
          beats: ['霓虹积水倒影切入', '怀表停摆特写', '倒退三格触发悬念钩子'],
        },
        {
          kind: 'auctra.scene_card.v1',
          scene_ref: 'scene_02',
          episode_ref: 'ep_01',
          revision: '3',
          heading: '第二场 · 午夜旧城钟表铺',
          location: '内景 · 老钟表铺 · 暖光',
          story_time: '23:25',
          goal: '从修表师顾岚处核验怀表内盖刻字的真实来源',
          obstacle: '顾岚否认见过该怀表，并试图拉下卷闸门逐客',
          stakes: '若无法取得顾岚信任，后续追查将彻底断线',
          turn: '林深亮出表盖夹层里的半张旧车票，顾岚神色骤变',
          review_status: 'in_review',
          characters: ['char_lin_shen', 'char_gu_lan'],
          beats: ['推门风铃响', '柜台试探交锋', '半张车票逼出真相'],
        },
        {
          kind: 'auctra.scene_card.v1',
          scene_ref: 'scene_03',
          episode_ref: 'ep_01',
          revision: '2',
          heading: '第三场 · 停摆指针逆转瞬间',
          location: '内景 · 钟表铺暗室 · 雷鸣',
          story_time: '23:40',
          goal: '解锁怀表暗格，读取三年前留下的坐标密码',
          obstacle: '门外传来急促脚步声，未知追踪者已经逼近',
          stakes: '必须在破门前带走密码并安全撤离',
          turn: '暗格弹开露出下一集核心道具：刻着林深名字的钥匙',
          review_status: 'draft',
          characters: ['char_lin_shen', 'char_gu_lan'],
          beats: ['暗室开表', '门外逼近压迫感', '集尾悬念定格'],
        },
        {
          candidate_id: 'cand_s02_turn_v2',
          scene_ref: 'scene_02',
          base_revision: 1,
          canonical_revision: 3,
          stale: true,
          status: 'pending_review',
          canonical_excerpt: '林深亮出表盖夹层里的半张旧车票，顾岚神色骤变。',
          candidate_excerpt: '林深直接将怀表拍在木桌中央，表盖震开滑出一张泛黄车票。',
          rationale_summary: '强化动作冲突节奏，缩短对白铺垫。',
        },
        ...ep2Auctra,
      ],
      scaena: [
        {
          breakdown_ref: 'bd_ep01',
          episode_ref: 'ep_01',
          revision: '2',
          rows: [
            {
              scene_ref: 'scene_01',
              shot_ref: 'shot_01',
              order: 1,
              planned_duration_micros: 3_500_000,
              cells: { shot_size: '特写 CU', camera: '缓推', action: '雨滴砸在霓虹积水，铜壳怀表落入掌心' },
              restricted_fields: [],
            },
            {
              scene_ref: 'scene_01',
              shot_ref: 'shot_02',
              order: 2,
              planned_duration_micros: 3_000_000,
              cells: { shot_size: '中景 MS', camera: '跟拍', action: '林深抬头扫视黑伞人群，秒针倒退三格' },
              restricted_fields: [],
            },
            {
              scene_ref: 'scene_02',
              shot_ref: 'shot_03',
              order: 3,
              planned_duration_micros: 4_000_000,
              cells: { shot_size: '过肩 OTS', camera: '固定', action: '推开钟表铺木门，暖光与门外暴雨形成冷暖对撞' },
              restricted_fields: [],
            },
            {
              scene_ref: 'scene_02',
              shot_ref: 'shot_04',
              order: 4,
              planned_duration_micros: 3_500_000,
              cells: { shot_size: '近景 MCU', camera: '急推', action: '顾岚目光定在半张旧车票上，瞳孔骤缩' },
              restricted_fields: [],
            },
            {
              scene_ref: 'scene_03',
              shot_ref: 'shot_05',
              order: 5,
              planned_duration_micros: 3_000_000,
              cells: { shot_size: '特写 ECU', camera: '微移', action: '怀表暗格弹开，露出刻字铜钥匙' },
              restricted_fields: [],
            },
            {
              scene_ref: 'scene_03',
              shot_ref: 'shot_06',
              order: 6,
              planned_duration_micros: 3_000_000,
              cells: { shot_size: '全景 WS', camera: '拉远定格', action: '门外脚步逼近，两人对视后切黑出集尾钩子' },
              restricted_fields: [],
            },
          ],
        },
        {
          total_count: 4,
          assets: [
            {
              asset_ref: 'asset:char_lin_shen',
              kind: 'image',
              role: 'character',
              version_ref: 'char_lin_shen:v2',
              scaena_admission: 'admitted',
              subject_freeze: 'frozen',
              production_acceptance: 'accepted',
              current_usability: 'ready',
            },
            {
              asset_ref: 'asset:char_gu_lan',
              kind: 'image',
              role: 'character',
              version_ref: 'char_gu_lan:v1',
              scaena_admission: 'admitted',
              subject_freeze: 'frozen',
              production_acceptance: 'accepted',
              current_usability: 'ready',
            },
            {
              asset_ref: 'asset:prop_pocket_watch',
              kind: 'image',
              role: 'prop',
              version_ref: 'prop_pocket_watch:v3',
              scaena_admission: 'admitted',
              subject_freeze: 'frozen',
              production_acceptance: 'accepted',
              current_usability: 'ready',
            },
            {
              asset_ref: 'asset:scene_darkroom',
              kind: 'image',
              role: 'scene',
              version_ref: 'scene_darkroom:v1',
              scaena_admission: 'pending',
              subject_freeze: 'unfrozen',
              production_acceptance: 'pending',
              current_usability: 'blocked',
            },
          ],
        },
        {
          schema_version: 'scaena.edit.timeline_view.v1',
          session_ref: 'edit_ep01',
          revision: '1',
          aspect_ratio: '9:16',
          fps: 24,
          clips: [
            { clip_ref: 'shot_01', shot_ref: 'shot_01', in_ms: 0, out_ms: 3500 },
            { clip_ref: 'shot_02', shot_ref: 'shot_02', in_ms: 3500, out_ms: 6500 },
            { clip_ref: 'shot_03', shot_ref: 'shot_03', in_ms: 6500, out_ms: 10500 },
            { clip_ref: 'shot_04', shot_ref: 'shot_04', in_ms: 10500, out_ms: 14000 },
            { clip_ref: 'shot_05', shot_ref: 'shot_05', in_ms: 14000, out_ms: 17000 },
            { clip_ref: 'shot_06', shot_ref: 'shot_06', in_ms: 17000, out_ms: 20000 },
          ],
          subtitles: [
            { id: 'sub_01', in_ms: 500, out_ms: 3200, text: '这块怀表，三年前就该停了。' },
          ],
          audio_stems: [
            { stem_ref: 'rain_bed', role: 'sfx', in_ms: 0, out_ms: 20000 },
          ],
        },
        ...ep2Scaena,
      ],
    },
  })

  const validation = await validateBundleOnDisk(workspaceDir)
  if (!validation.ok) {
    throw new DemoSeedError(
      'muweave/demo_validation_failed',
      `Seeded demo bundle failed validation: ${validation.findings.map((f) => `${f.code}: ${f.message}`).join('; ')}`,
    )
  }

  let reviewCount = 0
  let scheduleCount = 0
  if (options.pluginDataDir) {
    const wsId = canonicalWorkspaceId(workspaceDir)
    const reviewStore = new DramaReviewStore(path.join(options.pluginDataDir, 'drama-reviews.v1.json'))
    reviewStore.setBatch(wsId, [
      { shotRef: 'shot_01', sceneRef: 'scene_01', episodeRef: 'ep_01', status: 'locked', note: '开场三秒钩子定稿', tags: ['钩子', '光影'] },
      { shotRef: 'shot_02', sceneRef: 'scene_01', episodeRef: 'ep_01', status: 'approved', note: '倒退秒针节奏准确', tags: ['节奏'] },
      { shotRef: 'shot_03', sceneRef: 'scene_02', episodeRef: 'ep_01', status: 'in_review', note: '待确认暖光色温', tags: ['光影'] },
      { shotRef: 'shot_04', sceneRef: 'scene_02', episodeRef: 'ep_01', status: 'needs_revision', note: '补强车票特写层次', tags: ['构图'] },
    ])
    reviewCount = 4

    const scheduleStore = new ScheduleStore(path.join(options.pluginDataDir, 'schedule.v1.json'))
    scheduleStore.plan({
      ref: 'drama-storyboard-bd_ep01',
      date: '2026-12-01',
      label: '雨夜怀表 · 第 1 集精剪首播',
      kind: 'drama.storyboard_table',
      note: '抖音/小红书同步首发',
      projectId,
    })
    scheduleStore.plan({
      ref: 'eikona-candidates-run_rain_watch_01',
      date: '2026-11-30',
      label: '角色定妆海报预热',
      kind: 'eikona.candidate_group',
      projectId,
    })
    scheduleCount = 2
  }

  return {
    ok: true,
    projectId,
    title,
    episodeCount,
    elementCount: index.elements.length,
    shotCount: totalShotCount,
    reviewCount,
    scheduleCount,
    validationOk: validation.ok,
  }
}
