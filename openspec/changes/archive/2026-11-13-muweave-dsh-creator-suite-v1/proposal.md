# 提案：幕织 DSH 创作插件矩阵与 .muweave/ 物化信息元件中心（v1）

## Why

当前漫剧与剧本创作链路横跨 `cli/eikona`（视觉资产与候选评估）、`cli/auctra`（剧本双时间轴、Scene Card 与审稿）、`agent/scaena`（分镜表、资产四轴状态与剪辑时间线）、`backend-server/template-registry`（预设提示词目录）以及 Pi / DSH Agent 会话。创作者在高频 Agent 交互中缺乏可视化的多栏工作台、跨工具项目级原件汇总与真实阶段进度反馈，且每次切换视图重复拉起多进程会导致首屏缓慢。

## What Changes

1. 新增 `@yeisme/muweave-bundle` 与 `muweave-bundle` CLI：以官方 `--json` / `handoff` 契约编译生成可随时重建的 `.muweave/` 物化信息元件目录（覆盖 Eikona、Auctra、Scaena、Pi 与 DSH 工具工件），并提供零 Node 依赖的只读 `@yeisme/muweave-bundle/consumer` SDK 供 DSH 插件与未来 `client/muweave-frame-studio` 双端复用。
2. 新增 `@yeisme/dsh-muweave-core` 宿主与客户端底座：提供精确缓冲路由 `POST /api/muweave-dsh/rpc`、短效 Range 媒体路由 `GET /api/muweave-dsh/media`、对账状态机、双模 Tab/Pane 容器（对话页官方右栏 `dockkit` + 全局页可调宽三栏与二分屏对比）、基于 `shell.overlay` 的三态嵌入式会话悬浮 Agent、`@` 信息元件引用、`/` 技能与提示词触发，以及符合 `drama-process-timing` 的进度条。
3. 在同一工作区交付 5 个可独立启停的 DSH 插件：
   - `@yeisme/dsh-muweave-workbench`：`.muweave/` 做剧原件总览台、引用绑定与一键同步向导、Pi 工件（Goal/Subagent/Plan）与 DSH 工具工件双栏对比中心；
   - `@yeisme/dsh-muweave-eikona`：Eikona 视觉信息元件画廊、2-up/4-up 缩放对比、评估分卡、角色/场景母版绑定与受控采纳/Handoff（严格执行 `openai/gpt-image-2.5-sunburst` 像素 `WxH` 与 `--quality high` 约束）；
   - `@yeisme/dsh-muweave-script`：Auctra 剧本双时间轴、Scene Card 草稿保存/提交（`expectedRevision`）、渐进式 Context Graph 与 Candidate stale Diff；
   - `@yeisme/dsh-muweave-drama`：Scaena 分镜摘要表、镜头卡、资产四轴状态徽章、剪辑时间线摘要与剧本—分镜并排对照；
   - `@yeisme/dsh-muweave-kit`：`muweave-creator` 专属 PTC 智能体预设、创作 Skills 按需运行时注册与中文 `/` 检索、`template-registry.catalog.v1` 插槽表单填充及白名单 CLI 操作卡。

## Impact

- 能力准入：DSH 多插件宿主集成、通用 Tab/Pane 容器、悬浮 Agent 壳与物化包构建器为 `fit`；Eikona、Auctra、Scaena、Template Registry 与 Pi 工件消费为 `split-owner`；跨目录直读私有 SQLite、任意 Shell 执行、明文凭据传输与伪造读秒进度条为 `reject-now`。
- 本轮聚焦本地实现、五插件打包与断网真实 DSH 宿主端到端验证；不修改 `client/muweave-frame-studio` 源码、不触碰用户日常 `~/.dsh/profiles/web`、不执行真实付费调用、远程建仓或发布。
