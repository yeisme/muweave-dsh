import type { AllowlistedCliCardDefV1, TemplateCatalogEntryV1 } from './protocol'

/**
 * Browser-safe static catalog mirror (zero node:crypto / node:fs imports) so client bundles stay
 * 100% pure browser code and never pull Node built-ins into window.__ModuleLoader__.
 */
export const BUILTIN_CREATOR_TEMPLATES: readonly TemplateCatalogEntryV1[] = [
  {
    templateRef: 'promptrepo://official/image/drama-character-turnaround-v1@1.0.0?locale=zh',
    releaseId: 'rel_char_turnaround_v1',
    title: '漫剧角色三视图与定妆母版配方',
    category: 'eikona',
    version: '1.0.0',
    digest: 'sha256:4a90e26b2d47b96b88e247151293df3611d726386510b59cf780a93230cf3f01',
    summary: '生成正面/侧面/背面一致服装光影的角色定妆图，自动对齐 Sunburst 1152x2048 高质规格。',
    slots: [
      { name: 'character_name', label: '角色姓名与年龄气质', inputType: 'text', required: true },
      { name: 'wardrobe_anchor', label: '核心服装与随身标志道具', inputType: 'textarea', required: true },
      { name: 'visual_style', label: '漫剧画风基调', inputType: 'enum', required: true, options: ['赛博霓虹写实漫', '东方新国风厚涂', '韩系都市高反差条漫'] },
    ],
  },
  {
    templateRef: 'promptrepo://official/writing/screenplay-scene-conflict-turn-v1@1.0.0?locale=zh',
    releaseId: 'rel_scene_conflict_v1',
    title: '单场戏剧冲突与前三秒钩子精修',
    category: 'script',
    version: '1.0.0',
    digest: 'sha256:9b81e7f5a3d809c2b3e5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9',
    summary: '围绕目标、阻碍、代价与反转（Turn）重构 60 秒竖屏短剧单场 Scene Card 与对白候选。',
    slots: [
      { name: 'scene_goal', label: '主动人物本场核心目标', inputType: 'text', required: true },
      { name: 'core_obstacle', label: '最大外部/心理阻碍', inputType: 'text', required: true },
      { name: 'hook_line', label: '开场 3 秒视觉或台词钩子草案', inputType: 'textarea', required: false },
    ],
  },
  {
    templateRef: 'promptrepo://official/video/vertical-shot-breakdown-9x16-v1@1.0.0?locale=zh',
    releaseId: 'rel_shot_breakdown_v1',
    title: '9:16 竖屏连载分镜拆解与景别节奏卡',
    category: 'drama',
    version: '1.0.0',
    digest: 'sha256:2f4d6b8a0c2e4f6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e',
    summary: '将已审阅剧本场次拆解为镜头序列、景别运动、预计微秒时长与声画意图。',
    slots: [
      { name: 'episode_scene_ref', label: '目标集场引用 (如 episode:01 / scene:01)', inputType: 'text', required: true },
      { name: 'target_duration_sec', label: '目标总时长（秒）', inputType: 'enum', required: true, options: ['45', '60', '90'] },
      { name: 'pacing_mode', label: '剪辑节奏档位', inputType: 'enum', required: true, options: ['高频快切反转', '情绪张力递进', '悬疑压迫留白'] },
    ],
  },
]

export const ALLOWLISTED_CLI_CARDS_BROWSER: readonly AllowlistedCliCardDefV1[] = [
  {
    operationId: 'bundle.doctor',
    owner: 'muweave-bundle',
    title: '检查工作区做剧标记 (.muweave / .eikona / .auctra / .scaena / .pi)',
    description: '本地只读检查项目目录初始化状态，不创建隐藏数据库文件。',
    readOnly: true,
  },
  {
    operationId: 'bundle.validate',
    owner: 'muweave-bundle',
    title: '校验 .muweave/ 物化元件完整性与脱敏约束',
    description: '核对全部元件 SHA-256 摘要、CAS 媒体哈希及零路径/零密钥围栏。',
    readOnly: true,
  },
  {
    operationId: 'eikona.doctor',
    owner: 'eikona',
    title: 'Eikona 环境与渠道就绪诊断',
    description: '执行 eikona doctor --agent，零远端生图调用、零额度消耗。',
    readOnly: true,
  },
  {
    operationId: 'eikona.models.recommend',
    owner: 'eikona',
    title: '读取 Eikona 推荐图像模型清单',
    description: '执行 eikona models recommend --agent，默认付费推荐 openai/gpt-image-2.5-sunburst。',
    readOnly: true,
  },
  {
    operationId: 'auctra.room.describe',
    owner: 'auctra',
    title: '读取 Auctra 可视化编剧室结构快照',
    description: '预检 .auctra/ 存在后执行 auctra screenplay room describe --json。',
    readOnly: true,
    requiresMarker: 'auctra',
  },
  {
    operationId: 'scaena.production.doctor',
    owner: 'scaena',
    title: 'Scaena 生产控制面本地诊断',
    description: '预检 .scaena/project.json 存在后执行 scaena production doctor --agent --no-remote。',
    readOnly: true,
    requiresMarker: 'scaena',
  },
]
