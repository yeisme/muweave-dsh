# MuWeave DSH v5：三端合一（DSH UI + Creator CLI + Local/Remote MCP）设计规格

> 对应 OpenSpec 变更：[muweave-dsh-tri-surface-v5](../../openspec/changes/muweave-dsh-tri-surface-v5/proposal.md)  
> 适用范围：`@yeisme/dsh-muweave-core`（CLI、Demo 种子、本地 stdio / 远程 HTTP MCP、全局快捷键与悬浮助手）、`@yeisme/dsh-muweave-drama`（Filmstrip、搜索、Markdown 审片纪要）、`@yeisme/dsh-muweave-kit`（4 项智能体窄工具 + CLI/MCP 接入向导）。

## 1. 目标与三端统一架构

v5 将 MuWeave DSH 从单一浏览器工作台扩展为**三端合一的创作者编排平面**：
- **DSH 剧场界面**：面向导演/制片的高频审片、动态故事板预演与多房间协作；
- **Creator CLI（`muweave`）**：面向终端脚本、CI 与 AI 代理的结构化命令行（支持人类可读、`--json` 与 `--agent` `spec_version=1.0` 契约），并内置零依赖 `muweave demo seed` 体验工作区；
- **MCP Server（本地 stdio + 远程 Streamable HTTP）**：面向 Claude Desktop、Cursor 及远程 Agent Runner 的标准 MCP JSON-RPC 2.0 接口。

三端共享同一套 `CreatorHostService` 逻辑、`.muweave/` 物化目录与安全围栏（`stripHostPaths`、`findPlaintextCredential`、**永不向外部/Agent 暴露 `job.approve`**）。

## 2. Creator CLI 与 Demo Showcase（`cli.ts` / `demo-seed.ts`）

### 2.1 `muweave demo seed`
- 入口：`seedDemoWorkspace(workspaceDir, { force?: boolean, pluginDataDir?: string })`。
- 产出示例剧集「雨夜怀表 · 第 1 集」：包含 3 张 Auctra 场次卡 + 双时间轴 + 1 条 stale 候选 diff、6 个 9:16 Scaena 分镜镜头（含写入 CAS 的有效 PNG 缩略图）、4 轴资产就绪表（含 1 项阻塞资产）、剪辑时间线、1 组 Eikona 视觉候选与母版绑定，以及可选的示例审片与排期数据。
- 安全边界：目标 `.muweave/` 非空且未传 `--force` 时拒绝覆盖；产出必须通过 `validateBundleOnDisk()` 校验。

### 2.2 命令清单与输出契约
- 支持命令：`status`、`shots list`、`review set`、`review batch`、`export`、`schedule list|plan|clear`、`diagnose`、`migrate report`、`demo [seed]`、`mcp`。
- 输出格式：默认简洁人类可读；`--json` 输出纯 JSON；`--agent` 输出符合 `ai-native-cli-output-contract`（`spec_version=1.0`，`fact.*` / `action.*` / `error.*`）的结构化文本，所有 `--json` / `--agent` 输出均经 `stripHostPaths` 脱敏。

## 3. MCP Server（本地 stdio + 远程 Streamable HTTP）

### 3.1 协议与传输层（零新增 npm 依赖）
- 兼容 MCP JSON-RPC 2.0（`2024-11-05` 与 `2025-03-26`）：`initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call`、`resources/list`、`resources/read`、`prompts/list`、`prompts/get`。
- **本地 stdio（`mcp/server.ts`）**：兼容换行分隔 JSON-RPC 与 `Content-Length` 帧格式，日志仅写 `stderr`。
- **远程 Streamable HTTP（`mcp/http.ts`）**：基于 `node:http`（默认 `127.0.0.1:3741`），提供：
  - `GET /healthz` → `200 { ok: true, protocol: 'mcp', transport: 'streamable-http', serverName: 'muweave-dsh-mcp' }`
  - `OPTIONS /mcp` → `204` CORS 预检
  - `POST /mcp` → 1 MiB 请求体上限、`Mcp-Session-Id` 响应头、JSON-RPC 200 / 通知 202
  - `GET /mcp` → SSE（`text/event-stream`）保活流
  - `DELETE /mcp` → `204` 会话关闭
- **桥接模式**：本地直连 `CreatorHostService`；或通过 `--host-url` 代理至运行中 DSH 宿主的 `/api/muweave-dsh/rpc`（绝不打印 Bearer 凭据）。

### 3.2 强制远程鉴权与安全围栏
1. **非回环强制令牌**：当 `host` 不是 `127.0.0.1` / `localhost` / `::1` 且未提供 `authToken`（及 `MUWEAVE_MCP_TOKEN`）时，启动阶段立即抛出 `REMOTE_AUTH_TOKEN_REQUIRED`（Fail-Fast）。
2. **恒定时间校验**：启用令牌后，`/mcp` 必须校验 `Authorization: Bearer <token>`（使用 `crypto.timingSafeEqual`），失败返回 `401`。
3. **零自动扣费审批**：12 个 MCP 工具中绝不包含 `job.approve`；`muweave_job_request_or_status` 仅能创建 `waiting_approval` 状态任务并明确提示需人工在 UI 审批。

### 3.3 12 Tools / 5 Resources / 3 Prompts
- **Tools**：`muweave_workspace_status`、`muweave_bundle_sync`、`muweave_elements_list`、`muweave_element_get`、`muweave_drama_shots_list`、`muweave_drama_review_set`、`muweave_drama_review_batch`、`muweave_drama_export`、`muweave_schedule_manage`、`muweave_project_diagnose`、`muweave_capability_estimate`、`muweave_job_request_or_status`。
- **Resources（`muweave://*`）**：`muweave://workspace/overview`、`muweave://drama/storyboard`、`muweave://drama/timeline/edl`、`muweave://script/scenes`、`muweave://schedule/board`。
- **Prompts**：`drama_director_review`、`drama_shot_breakdown_9x16`、`eikona_character_turnaround`。

## 4. DSH Kit 工具同步与 v5 UX 精修

- **Kit 智能体工具同步（`packages/dsh-muweave-kit/src/index.ts`）**：在 `muweave-creator` 预设注册 4 个窄工具（`muweave_drama_shots_list`、`muweave_drama_review_set`、`muweave_drama_export`、`muweave_project_diagnose`）与运行时技能 `muweave-cli-mcp-assist`，保持零 `job.approve` 暴露。
- **CLI & MCP 接入向导（`packages/dsh-muweave-kit/src/client.tsx`）**：嵌入既有 `cli-cards` Tab（不增删 Tab ID），提供常用 CLI 一键复制与 3 模式 MCP 配置（本地 stdio / 远程 HTTP / 联机回环代理），仅使用 `${workspaceFolder}` 与 `<your-mcp-token>` 占位符。
- **全局与分镜 UX 升级**：
  - `?` 快捷键弹窗（`ShortcutsHelpModal`，4 分组，Escape 关闭并归还焦点）；
  - 剧场房间角标（`publishTheaterRoomBadges`，分镜台汇报 `needs_revision` 数量）；
  - 悬浮助手单条 `@` 芯片 `×` 移除与按当前房间切换的快捷提示胶囊；
  - `ShotInspector` 底部横向 Filmstrip 快速切镜、分镜台关键词搜索、时间线「复制审片纪要 (Markdown)」。

## 5. 验收门禁

- `openspec validate muweave-dsh-tri-surface-v5 --strict --no-interactive`
- 新增单测：`tests/muweave-cli.test.ts`、`tests/muweave-mcp-server.test.ts`、`tests/ux-v5-polish.test.tsx`
- 全仓门禁：`pnpm typecheck && pnpm test && pnpm build && pnpm pack:plugins && pnpm test:integration`（零路径/凭据泄露，`tests/styles-static.test.ts` 全绿）。
