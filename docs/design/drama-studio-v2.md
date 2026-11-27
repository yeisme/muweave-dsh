# MuWeave DSH Drama Studio v2 设计规格

> 对应 OpenSpec 变更：[muweave-dsh-drama-studio-v2](../../openspec/changes/muweave-dsh-drama-studio-v2/proposal.md)  
> 适用范围：`@yeisme/dsh-muweave-core`（协议、审片存储、粗剪导出、P3 级联取消、共享前端原语与样式令牌）、`@yeisme/dsh-muweave-drama`（分镜生产房间 4 个 Stage Tab 升级）。

## 1. 目标与市场对标

`muweave-drama` 此前停留在只读分镜展示层，缺少逐镜音画媒体编排、导演审片流转、浏览器内动态故事板（Animatic）预演、标准 NLE 粗剪交接包导出，以及多 Agent 编排 P3 的级联取消与异常可见性收口。

| 对标方向 | 行业参考能力 | MuWeave DSH v2 落地策略与差异化 |
| --- | --- | --- |
| 逐镜音画一体化 | LTX Studio 逐镜聚合画面/视频/音频 | 复用 6 轨 `shotMedia`（`keyframe \| reference \| video \| voice \| music \| sfx`）与 `/api/muweave-dsh/media` Range 流，不绑定单一云端厂商。 |
| 审片 + Animatic + NLE 导出 | Boords 审片状态、带时长动态故事板、EDL/CSV 导出 | 落地独立 `DramaReviewStore`（乐观锁防覆盖）+ 零第三方依赖原生 HTML5 `AnimaticPlayer` + 脱敏 `cut_manifest_v1 / cmx3600_edl / shotlist_csv` 导出器。 |
| 场次覆盖率与资产反查 | StudioBinder 场次↔分镜矩阵、资产影响反查 | 升级 `side-by-side`（未拆镜警告、点击过滤）与 `assets`（阻塞筛选、Eikona 母版联动、受影响镜头反查）。 |
| 竖屏短剧批产可控 | 9:16 节奏优先、缺媒一键补生成 | 保留费用封顶闸 + 幂等账本 + 零路径/零密钥围栏，串联“缺口一键唤起 `GenerationDrawer`（预填 `anchor.shotRef`）→ 审核绑定 → 预演 → 导出”。 |

## 2. 架构红线与边界约束

1. **不触碰 canonical 内部存储**：导演审片数据落 `pluginDataDir/drama-reviews.v1.json`，与 `schedule-store.ts`、`project-store.ts` 同构；绝不直接读写 `.scaena/**`、`.eikona/**`、`.auctra/**` 私有文件。
2. **RPC 与脱敏围栏**：新接口全部注册于 `/api/muweave-dsh/rpc` 白名单，统一返回 `{ ok, generation, hostInstanceId, data | error }`；写入与导出出口均执行 `findPlaintextCredential` 与 `containsHostPath` 校验；持久化采用 `0600` 原子写。
3. **零 Room / Tab 破坏性变更**：严格保持 [tab-room-mapping.md](./tab-room-mapping.md) 中 `muweave-drama` 的 4 个 Stage Tab ID（`storyboard`、`assets`、`timeline`、`side-by-side`）不变。
4. **视觉令牌门禁**：所有新增样式集中写入 `packages/dsh-muweave-core/src/client/styles.ts`，仅使用 `--mw-*` 令牌与 `rem` 单位（`1px`/`2px` 细线除外），禁止 ad-hoc 内联 `style`（仅允许动态 CSS 自定义属性如 `--dr-start`/`--dr-len`/`--mw-progress`），禁止橙色色相，保留 `:focus-visible` 与 `prefers-reduced-motion: reduce`。
5. **零额外媒体依赖**：基于原生 HTML5 `<video>` / `<audio>` 与外部化 React 18 实现，不引入第三方播放器或时间线包。

## 3. 后端 RPC 与数据契约

### 3.1 新增 RPC 动作

| RPC Action | 类型 | 说明 |
| --- | --- | --- |
| `drama.shot.review.list` | 只读 | 读取当前工作区所有镜头审片记录（返回 `ShotReviewRecordV1[]`）。 |
| `drama.shot.review.set` | 写入（递增 `generation`） | 创建或更新单镜审片状态、标签与批注；携带 `expectedRevision` 执行乐观锁校验。 |
| `drama.export.manifest` | 只读 | 编译脱敏粗剪交接包，支持 `cut_manifest_v1`、`cmx3600_edl`、`shotlist_csv`。 |

### 3.2 共享协议 DTO（`packages/dsh-muweave-core/src/protocol.ts`）

```ts
export type ShotReviewStatus =
  | 'draft'
  | 'in_review'
  | 'needs_revision'
  | 'approved'
  | 'locked'

export interface ShotReviewRecordV1 {
  workspaceId: string
  shotRef: string
  sceneRef?: string
  episodeRef?: string
  status: ShotReviewStatus
  note?: string
  tags: string[]
  revision: number
  updatedAt: string
}

export interface ShotReviewSetInputV1 {
  workspaceId?: string
  shotRef: string
  sceneRef?: string
  episodeRef?: string
  status: ShotReviewStatus
  note?: string
  tags?: string[]
  expectedRevision?: number
}

export type DramaExportFormat = 'cut_manifest_v1' | 'cmx3600_edl' | 'shotlist_csv'

export interface DramaExportResultV1 {
  schema: 'muweave.drama-export.v1'
  format: DramaExportFormat
  filename: string
  mimeType: 'application/json' | 'text/plain' | 'text/csv'
  shotCount: number
  totalDurationMs: number
  fps: number
  aspectRatio: string
  content: string
  generatedAt: string
}
```

### 3.3 `DramaReviewStore` 状态与校验规则

- 存储路径：`pluginDataDir/drama-reviews.v1.json`（Schema `'muweave.drama-reviews.v1'`）。
- 输入约束：
  - `shotRef`：非空不透明标识，长度 `<= 128`，禁止 `/`, `\`, `..`。
  - `note`：长度 `<= 500`；`tags`：最多 8 条、每条 `<= 32` 字符。
  - `note` 与 `tags` 命中 `findPlaintextCredential` 或 `containsHostPath` 时抛出 `muweave/invalid_review_input`。
- 乐观锁：`expectedRevision` 与已持久化的 `revision` 不一致时拒绝写入，抛出 `muweave/review_revision_conflict` 并在错误详情中返回 `{ currentRevision }`；首次创建允许 `expectedRevision === 0` 或省略。
- 损坏容错：读取遇到损坏 JSON 时自动备份为 `drama-reviews.v1.corrupt-<ts>.json` 并记录 `corruptFile`。

### 3.4 粗剪交接包格式样例（`drama-export.ts`）

- **时间码**：`msToSmpte(ms, fps)` 支持 `24 / 25 / 30` fps（默认 `24`），非负单调递增。
- **`cut_manifest_v1`**：结构化 JSON，包含 `projectId, title, fps, aspectRatio, totalDurationMs, shots[]`；每个 shot 仅投影安全媒体元数据（`sha256`、`elementId`、`mime`）。
- **`cmx3600_edl`**：
  ```text
  TITLE: <sanitized_title>
  FCM: NON-DROP FRAME
  001  SHOT001  V     C        00:00:00:00 00:00:03:12 00:00:00:00 00:00:03:12
  * FROM CLIP NAME: shot_01 (scene_01) [approved]
  002  SHOT001  A     C        00:00:00:00 00:00:03:12 00:00:00:00 00:00:03:12
  * AUDIO ROLE: voice
  ```
- **`shotlist_csv`**：UTF-8 BOM + RFC 4180 双引号转义，列头为 `Order,Scene,Shot,DurationSec,ReviewStatus,Keyframe,Video,Voice,SFX,Music,Note`。
- **脱敏出口闸**：序列化结果返回前统一通过 `containsHostPath` 与 `findPlaintextCredential` 断言。

### 3.5 多 Agent 编排 P3 收口

- `TaskLedger.list()` 增加 `orphanedCount: number`（当前工作区 `status === 'orphaned'` 任务数）。
- `BotTaskService` 注入 `onTasksCancelled?: (taskIds: readonly string[]) => Promise<string[]>`；`CreatorHostService` 将其绑定至 `CapabilityService.cancelJobsForTasks(ids)`。
- `CapabilityService.cancelJobsForTasks` 扫描活跃且 `requester?.taskId` 命中的任务并逐个取消（单项异常不阻断其余取消；若 owner 取消结果不明确则保持 `reconcile_required`），在 `task.cancel` 响应中返回 `cancelledJobIds`。
- `GenerationJobs` 在顶部读取 `bot.roster` 与 `task.list` 摘要，当存在 `paused` Bot 或 `orphanedCount > 0` 时渲染显式文本与状态色调告警（`data-bot-paused-count`、`data-orphaned-task-count`）。

## 4. 前端交互规格

### 4.1 共享原语（`packages/dsh-muweave-core/src/client`）

- `shot-media.tsx`：导出 `SHOT_MEDIA_ROLE_LIST`、`mediaForRole(linked, role)`、`shotReadinessSummary(linked)`，并扩展 `ShotGenerateButton` 支持可选 `capabilityId` 与 `label`。
- `AnimaticPlayer`（`animatic-player.tsx`）：
  - 通过 `data-aspect="9:16" | "16:9"` 切换竖屏/横屏容器比例。
  - 通过 `/api/muweave-dsh/media` 短 TTL 授权读取 `video` / `keyframe` 以及同步 `<audio>`（`voice`、`sfx`）。
  - 提供播放/暂停、上一镜/下一镜、进度条跳转、静音、当前时间码 `MM:SS.s / MM:SS.s` 与审片角标，遵循 `prefers-reduced-motion: reduce`。

### 4.2 作剧房间（`packages/dsh-muweave-drama`）

| Stage Tab / 组件 | 核心能力 |
| --- | --- |
| `storyboard` | 场次/审片状态/缺媒筛选条；可展开 `AnimaticPlayer`；镜头卡与表格行展示审片角标、6 轨就绪指示点与检查器入口；`RoomHero` 展示总镜数、总时长(秒)、资产就绪、审片通过。 |
| `ShotInspector` | 受控右侧/浮层检查器：5 态审片与批注（冲突时提示并支持“重新读取”）、6 轨媒体预览/试听/解绑、Eikona 已有元素一键绑定、缺媒一键唤起 `GenerationDrawer`（预填 `anchor: { episodeRef, sceneRef, shotRef }`）。 |
| `timeline` | 顶部粗剪导出栏（`EDL` / `Cut Manifest JSON` / `分镜表 CSV`）；画面/配音/音效三轨同步时间线（点击片段打开 `ShotInspector`）；底部片段明细表。 |
| `side-by-side` | 左侧 Auctra 场次卡展示 `N 镜 · X.Xs · 已通过 M/N`，0 镜场次显式标出 `未拆镜`（`data-scene-uncovered="true"`）；点击场次卡实时过滤右侧镜头。 |
| `assets` | `全部 / 阻塞中 / 已就绪` 筛选；自动关联 `eikona.master_binding` 缩略图；反查展示受影响 `shotRef` 芯片，点击直达 `ShotInspector`。 |

## 5. 验收矩阵

- **规格校验**：`openspec validate muweave-dsh-drama-studio-v2 --strict --no-interactive`
- **新增自动化测试**：
  - `tests/drama-review-store.test.ts`（乐观锁冲突、`0600` 原子写、`.corrupt-*` 隔离、路径/凭据拒绝）
  - `tests/drama-export.test.ts`（三种导出格式、SMPTE 时间码、6 轨投影、零路径/零凭据围栏）
  - `tests/drama-production-ui.test.tsx`（筛选条、`ShotInspector` 6 轨与审片、`AnimaticPlayer`、`side-by-side` 覆盖率、`assets` 反查）
  - `tests/bot-cascade-cancel.test.ts`（级联取消、`orphanedCount`、`paused` 断路器 UI 呈现）
  - `tests/styles-static.test.ts`（视觉令牌与内联样式门禁）
- **全仓门禁**：`pnpm typecheck && pnpm test && pnpm build && pnpm pack:plugins && pnpm test:integration`（集成测试按规范在 `temp/integration-test-runs/<run-id>/` 输出 6 文件脱敏证据包）。

## 6. v3 产品化升级与全仓收口

在 v2 完整交付的基础上，v3 完成历史规划项彻底清零、作剧高频作业提效与跨平台真机 E2E 视觉打磨闭环：

### 6.1 后端收口与协议扩展（`packages/dsh-muweave-core`）

| 能力 | 接口 / 实现落点 | 说明 |
| --- | --- | --- |
| 注册表迁移报告 | `project.migration.report` · `ProjectStore.migrationReport()` · `host.ts` | 只读汇总 schema 版本、脱敏 `projects.v1.corrupt-*.json` 备份列表（零绝对路径）、未认领旧 bundle 候选数、无归属 legacy 排期条数与 v1→v2 迁移就绪检查项 `checks[]`。 |
| 批量审片流转 | `drama.shot.review.batch` · `DramaReviewStore.setBatch()` · `host.ts` | 单次原子落盘批量更新多镜审片状态，返回逐镜 `{ shotRef, ok, record?, errorCode? }`，部分乐观锁冲突不破坏其余成功项，写入后递增 `generation`。 |
| 跨日预算聚合 | `budget.status` (`BudgetStatusV1.windowSummaries`) · `jobs.ts` | 向后兼容追加 `windowSummaries?: { last7Days: BudgetLineV1[]; allTime: BudgetLineV1[] }`，保留原有今日 `lines` 口径。 |
| 委派边预算信封 | `DelegationRuleV1.budgetCeiling` · `bot-task/tasks.ts` (`task.delegate`) | 支持可选 `{ unit: 'usd' \| 'credits'; amount: number }` 委派上限，持久化前校验非负合法性。 |

### 6.2 产品化前端能力（Core Client + Workbench + Drama）

- **全集生产就绪度进度条（Episode Readiness Strip）**：`packages/dsh-muweave-drama/src/client.tsx` 在 `storyboard` 顶部渲染 `.dr-readiness-strip`（`data-drama-readiness-strip="true"`），分 5 态（`locked / approved / in_review / needs_revision / draft`）展示占比并支持点击状态段联动筛选，同时展示 6 轨媒体齐套率百分比。
- **批量审片与 `@` 批量派活**：分镜卡/表格支持多选复选框并弹出 `.dr-batch-bar`（`data-drama-batch-bar="true"`），提供「批量标为待审」「批量通过」（调用 `drama.shot.review.batch`）、「打包 `@` 送入 Agent」与「清空选择」。
- **导演键盘流（Accelerators）**：
  - `ShotInspector`（焦点不在 `<input>` / `<textarea>` / `<select>` 内时）：`ArrowLeft` / `k` 上一镜、`ArrowRight` / `j` 下一镜、`a` 快速通过、`r` 标为需修改、`Escape` 关闭，头部以 `.dr-kbd-hints` 低干扰 `<kbd>` 标签提示。
  - `AnimaticPlayer`（播放器容器获得焦点时）：`Space` 播停、`ArrowLeft` / `ArrowRight` 步进。
- **跨日预算摘要**：`GenerationJobs` 在今日预算旁展示 `windowSummaries.last7Days` 与 `windowSummaries.allTime` 汇总。
- **Workbench 迁移报告与首屏引导**：`diagnosis-panel.tsx` 挂载只读 `.mw-migration-report` 区块展示 `project.migration.report` 结果；空工作区呈现 3 步编辑式 `.mw-onboarding-card`（绑定工作区 → 同步/采集资产 → 进入分镜预演与粗剪导出）。

### 6.3 跨平台真机 E2E（macOS + Linux）与视觉精修

- `scripts/run-integration-e2e.mjs` 在 Linux 上保持 `unshare -rn` 隔离不变；在 `darwin`（macOS）上启用本地 loopback 隔离模式，严格校验 `~/.dsh/profiles/web` 指纹未变并完整产出 6 文件脱敏证据包。
- `scripts/inner-e2e-runner.mjs` 自动探测 Chrome / Playwright Chromium（`CHROME_PATH` → macOS Chrome → `/usr/bin/google-chrome` → Playwright 默认），补充 Drama Studio v2/v3 关键视图在 `1440×900` 与 `390×844` 断点下的真实截图，并在 `styles.ts` 完成定向视觉精修（通过 `tests/styles-static.test.ts` 门禁）。
- 新增自动化单测：`tests/project-migration-report.test.ts`、`tests/drama-batch-review.test.ts`，以及 `tests/drama-production-ui.test.tsx` 中 Readiness Strip、批量审片与导演键盘流用例。
