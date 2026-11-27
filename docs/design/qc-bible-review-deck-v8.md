# MuWeave DSH v8：连续性圣经、自动交付质检闸、离线甲方审片包与 9:16 安全区规格

> 对应 OpenSpec 变更：[muweave-dsh-qc-bible-review-deck-v8](../../openspec/changes/muweave-dsh-qc-bible-review-deck-v8/proposal.md)  
> 适用范围：`@yeisme/dsh-muweave-core`（Continuity Bible、Episode QC Gate、SRT/WebVTT 字幕、离线 Review Deck HTML、安全反馈回导、CLI & MCP 18 工具 / 8 资源、9:16 安全区）、`@yeisme/dsh-muweave-drama`、`@yeisme/dsh-muweave-eikona`。

## 1. 目标与核心交付

v8 补齐短剧/漫剧交付前最后五块生产级能力：
1. **片场连续性圣经（Continuity Bible）**：集中维护画幅、镜头语言、布光规则、风格指令、负向护栏、角色服装与不可变特征锚点，以及 2026 合规 AI 标注声明（`complianceDisclosure`），支持乐观锁持久化与一键 `@` 注入悬浮助手。
2. **零费用自动交付质检闸（Episode QC Gate）**：基于当前生效的无损粗剪（`applyEpisodeCut`）与 5 大质检维度自动计算 `0–100` 质检分与 `readyForDelivery` 结论，点击镜头告警直达 `ShotInspector`。
3. **离线甲方审片包 HTML（`review_deck_html`）与安全反馈回导（`drama.shot.review.import`）**：零外部 CDN/字体依赖、HTML/`</script>` 转义脱敏、支持甲方离线查看 9:16 预演并导出 `review-feedback.json`；回导默认跳过导演已锁定（`locked`）镜头，防止外部误覆盖。
4. **SRT / WebVTT 字幕编译（`srt_subtitles` / `webvtt_subtitles`）**：按生效粗剪与镜头对白字段直接生成标准 `.srt` / `.vtt` 字幕轨。
5. **9:16 短视频安全区叠加层**：`AnimaticPlayer` 内置可选 `9:16 安全区` 开关，实时标示顶部留白、右侧互动按钮区、底部字幕标题遮挡区与中心安全构图框。

## 2. 后端与协议契约（`packages/dsh-muweave-core`）

### 2.1 Continuity Bible（`continuity-bible-store.ts`）
- 存储：`pluginDataDir/continuity-bible.v1.json`（`0600` 原子写 + `.corrupt-<ts>` 隔离）。
- 校验：十六进制色值正则 `/^#[0-9a-fA-F]{6}$/`；全字段通过 `findPlaintextCredential` + `containsHostPath`（违规抛 `muweave/invalid_bible_input`）；`expectedRevision` 乐观锁（冲突抛 `muweave/bible_revision_conflict`）。
- RPC：`project.bible.get`、`project.bible.set`。

### 2.2 Automated Episode QC Gate（`drama-qc.ts` · `drama.qc.report`）
零付费纯函数 `runEpisodeQc(input)` 检查 5 大维度：
1. **开篇钩子与时长节奏**：0 镜 → blocker `qc_empty_episode`；第 1 镜 `> 3500ms` → warning `qc_opening_hook_slow`；总时长 `< 5000ms` 或 `> 300000ms` → warning `qc_episode_duration_range`。
2. **媒体与口型风险**：缺少 `keyframe` 且无 `video` → blocker `qc_shot_missing_visual`；缺少音频 → warning `qc_shot_missing_audio`；含 `voice` 且时长 `> 8000ms` → warning `qc_shot_lipsync_risk`；CAS 媒体缺失 → blocker `qc_cas_blob_missing`。
3. **资产四轴就绪**：存在阻塞资产 → warning `qc_asset_axis_blocked`。
4. **导演审片门禁**：`draft` → blocker `qc_shot_unapproved`；`needs_revision` → blocker `qc_shot_needs_revision`。
5. **合规声明**：未配置 `complianceDisclosure` → warning `qc_missing_compliance_disclosure`。

无异常维度输出 `pass` 项；得分 `clamp(0, 100, 100 - 15*blocker - 5*warning)`，`readyForDelivery = counts.blocker === 0 && shotCount > 0`。

### 2.3 字幕、离线 Review Deck HTML 与安全反馈回导
- `drama-export.ts` 新增 `srt_subtitles`（`.srt`）、`webvtt_subtitles`（`.vtt`）与 `review_deck_html`（`*-review-deck.html`）；便携导出 `--bundle-dir` 在 `review_deck_html` 模式下同步输出 `subtitles.srt`、`media/` 与 `README.txt`。
- `DramaReviewStore.importFeedback(workspaceId, items, { allowLocked })` 与 RPC `drama.shot.review.import`：校验凭据/路径/状态，默认跳过 `locked` 镜头（返回 `skipped_locked`，原因 `'locked_by_director'`），单次原子落盘。

### 2.4 CLI 与 MCP（18 Tools / 8 Resources / 3 Prompts）
- **CLI**：`muweave bible show|set`、`muweave qc [--episode] [--strict]`、`muweave review import <file.json> [--allow-locked]`、`muweave export srt_subtitles|webvtt_subtitles|review_deck_html [--bundle-dir]`。
- **MCP**：新增工具 `muweave_project_bible`、`muweave_drama_qc_report`（合计 18 工具，仍零 `job.approve`）与实时资源 `muweave://project/bible`、`muweave://drama/qc`（合计 8 资源）。
- **Demo 种子**：`demo-seed.ts` 统一首集 `episodeRef` 为 `'episode:01'`，内置示例对白字段与默认 `ContinuityBibleV1`（含 `complianceDisclosure`）。

## 3. 前端交互升级

- **`AnimaticPlayer`**：新增 `9:16 安全区` 开关（`data-animatic-safezone-toggle="true"`）与非交互 `.dr-safe-zone-overlay`（`data-safe-zone-overlay="true"`）。
- **Drama 房间**：`storyboard` 与 `timeline` 挂载可折叠交付质检条（`.dr-qc-strip`），点击带 `shotRef` 告警直开 `ShotInspector`；`TimelineView` 导出栏新增 SRT / WebVTT / Review Deck HTML 导出与「导入甲方反馈 JSON」文件上传回执。
- **Eikona 房间**：既有 `masters` Tab 内嵌「片场连续性圣经」（`.mw-bible-card`），支持编辑保存与「`@` 注入助手」。

## 4. 验收门禁

- `openspec validate muweave-dsh-qc-bible-review-deck-v8 --strict --no-interactive`
- 新增单测：`tests/continuity-bible.test.ts`、`tests/drama-qc-review-deck.test.ts`、`tests/v8-qc-safezone-ui.test.tsx`
- 全仓门禁：`pnpm typecheck && pnpm test && pnpm build && pnpm pack:plugins && pnpm test:integration`。
