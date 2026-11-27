# 幕织 MuWeave · DeepSeek Harness 创作插件矩阵

一套跑在 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（下称 DSH）里的创作工作台插件：把「做一部漫剧 / 竖屏短剧」的六个阶段——**灵感 → 剧本 → 视觉 → 分镜 → 声音 → 成片**——做成一条可审核、可回滚、可排期的流水线，而不是一堆生成按钮。

面向的是一人或 2–3 人的创作小组：真正的瓶颈不是「生成不出一张好图」，而是生成之后的**挑、审、改版、排期**。

> **先说清楚边界**：本仓库是编排层（界面 / 审核 / 账本 / 能力网关）。真正出图、出片、出声的引擎是独立的 owner CLI，**目前不开源，计划陆续开源**。没有引擎也能用——能规划、能审核、能排期，只是不能付费生成。详见 [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md)。

## 当前状态

| 项 | 现状（基线 `591cc10`） |
| --- | --- |
| 类型检查 | `pnpm typecheck` 0 错误 |
| 测试 | 39 个文件 / 283 条全部通过（须串行跑，见下） |
| 打包 | 6 个插件 tarball 产出到 `.work/` |
| 结构 | v8 工作台结构已定（阶段脊柱 + 双模 Tab/Pane + 浮层 agent） |
| 视觉 | **进行中**：首屏仍在收口（去占位键、真图卡片、判定面板） |
| 可用能力 | 10 个能力中 2 个真正可执行（eikona 出图、sonora 音效），其余 8 个按原因码置灰 |
| 已知缺口 | `packages/dsh-muweave-schedule` 的依赖变更尚未同步到 `pnpm-lock.yaml`（`--frozen-lockfile` 会失败，用 `pnpm install --no-frozen-lockfile`） |

## 配套引擎（决定你能做什么）

插件之间不互相调用，而是围绕一份**工作区标记**协作：每个引擎在自己目录里写产物，`.muweave/` 记录引用与审核状态，`muweave-bundle doctor` 检查工作区完整度。

| 引擎 | 做什么 | 能力 | 集成状态 | 开源 |
| --- | --- | --- | --- | --- |
| **eikona** | 图像生成：定妆、场景、候选图组、对比评估 | `eikona.image.generate` | ✅ 可用 | 计划开源 |
| **sonora** | 声音：音效 / 配音 / 配乐 | `sonora.sfx.generate` ✅<br>`voice.tts` ⛔ `music.generate` ⛔ | 仅音效 | 计划开源 |
| **scaena** | 分镜与成片：镜头出图、镜头视频、剪辑会话 | `shot.draw` ⛔ `shot.video` ⛔ | 目录可见 | 计划开源 |
| **auctra** | 剧本工程：项目 / 场次 / 场景卡 | 剧本读写 ✅（文本生成 ⛔） | 可读写 | 计划开源 |
| **anatomia** | 参考视频拆解 | `reference.analyze` ⛔ | 目录可见 | 计划开源 |
| **pinax** | 笔记与灵感箱 | `inbox.capture` ⛔ | 未装即显示未安装 | 计划开源 |
| **manju-hotlist** | 漫剧热榜：选题行情 | `research.query` ⛔ | 同上 | 计划开源 |
| **promptrepo** | 提示词模板库（`promptrepo://` 引用） | 模板引用 ✅ | 可用 | 计划开源 |

⛔ 不是没写，是**引擎的命令缺费用封顶或幂等键，不敢让它自动花钱**；界面上会显示 `NO_COST_CAP` / `NO_SUBMIT_COMMAND` / `ADAPTER_PENDING` 这类原因码。补齐参数后把 `blocked()` 换成真适配器即可，审核链路不用改。

**现在怎么用**：① 只做规划+审核+排期（不依赖引擎）；② 按 [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md) 第 4 节的 CLI 契约，把自建服务包成同名 CLI 放进 PATH；③ 等引擎开源。

## 包结构

| 包 | 角色 | 说明 |
| --- | --- | --- |
| `@yeisme/muweave-bundle` | 规范 / CLI / SDK | `.muweave/` 物化元件目录的编译 CLI（`init`/`bind`/`sync`/`inspect`/`validate`/`doctor`）与浏览器安全的只读 Consumer SDK |
| `@yeisme/dsh-muweave-core` | 共享宿主与前端底座 | `/api/muweave-dsh/rpc` RPC 总线、短效 Range 媒体流、双模 Tab/Pane、`shell.overlay` 三态悬浮 agent、能力目录与安全闸 |
| `@yeisme/dsh-muweave-workbench` | 插件 1 | `.muweave/` 原件总览、引用绑定向导、Pi 工件与 DSH 工件双栏对比 |
| `@yeisme/dsh-muweave-eikona` | 插件 2 | 视觉元件画廊、2-up/4-up 缩放对比、评估分卡、角色/场景母版绑定与受控 Handoff |
| `@yeisme/dsh-muweave-script` | 插件 3 | 剧本双时间轴、Scene Card 草稿保存/提交、渐进式 Context Graph、stale 候选 diff |
| `@yeisme/dsh-muweave-drama` | 插件 4 | 分镜摘要表、镜头卡、资产四轴状态徽章、剪辑时间线摘要与剧本—分镜对照 |
| `@yeisme/dsh-muweave-kit` | 插件 5 | `muweave-creator` 智能体预设、按需创作 Skills、中文 `/` 检索、预设提示词插槽 |
| `@yeisme/dsh-muweave-schedule` | 插件 6 | 发布排期房间：月历 + 待排池、`schedule.list/plan/clear` RPC 与同名智能体工具 |

## 环境要求

- Node.js `>=22.19.0`
- pnpm `10.16.1`（`packageManager` 字段已固定）
- DSH `0.2.2-rc.x`（`engines.dsh` 见根 `package.json`）

## 快速开始

```bash
pnpm install --no-frozen-lockfile   # 见上方「已知缺口」
pnpm typecheck
pnpm build                          # 必须先 build，测试会校验打包产物
pnpm test
pnpm pack:plugins                   # 产出 .work/*.tgz
```

装进一个**隔离的** DSH profile（不要直接覆盖日常 profile）：

```bash
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-workbench-0.1.0.tgz --offline
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-eikona-0.1.0.tgz --offline
# …其余插件同理
```

### 测试必须串行

并发跑时多个 vitest 进程会抢同一个 `localStorage` 文件，随机出现假失败：

```bash
mkdir -p temp
NODE_OPTIONS=--localstorage-file=temp/vitest-$(date +%H%M%S).json \
  pnpm exec vitest run --no-file-parallelism
```

## CLI 快速体验（含 `muweave demo`）

构建后可直接通过 `pnpm muweave`（或全局安装的 `muweave` 命令）操作 `.muweave/` 工作区，支持默认人类可读、`--json` 与 `--agent`（`spec_version=1.0`）三种脱敏输出：

```bash
# 1. 在空目录一键生成「雨夜怀表 · 第 1 集」9:16 演示工作区（已有 .muweave/ 时需显式 --force）
pnpm muweave demo seed --workspace ./demo-ep01

# 2. 查看工作区状态与缺媒镜头
pnpm muweave status --workspace ./demo-ep01
pnpm muweave shots list --workspace ./demo-ep01 --missing keyframe

# 3. 审片与导出标准 NLE 粗剪交接包（支持 cut_manifest_v1 / cmx3600_edl / shotlist_csv）
pnpm muweave review set --workspace ./demo-ep01 --shot shot_01 --status approved --note "节奏稳"
pnpm muweave export cmx3600_edl --workspace ./demo-ep01 --out ./roughcut.edl

# 4. 排期与诊断
pnpm muweave schedule list --workspace ./demo-ep01
pnpm muweave diagnose --workspace ./demo-ep01 --json
```

## MCP Server（本地 stdio / 远程 HTTP）接入指南

`@yeisme/dsh-muweave-core` 内置零新增依赖的 MCP JSON-RPC 2.0 服务（12 个脱敏工具、5 个 `muweave://*` 资源、3 个创作提示词），**绝不暴露 `job.approve` 等自动付费审批动作**。

### 1. 本地 stdio（Claude Desktop / Cursor 等）

```json
{
  "mcpServers": {
    "muweave": {
      "command": "node",
      "args": [
        "${workspaceFolder}/packages/dsh-muweave-core/lib/cli.js",
        "mcp",
        "--transport",
        "stdio",
        "--workspace",
        "${workspaceFolder}"
      ]
    }
  }
}
```

### 2. 远程 Streamable HTTP 服务

默认监听回环地址 `127.0.0.1:3741`（提供 `GET /healthz` 与 `GET/POST/DELETE /mcp`）。监听非回环地址（如 `0.0.0.0`）时**必须**配置 `MUWEAVE_MCP_TOKEN` 或 `--auth-token`，否则启动立即以 `REMOTE_AUTH_TOKEN_REQUIRED` 失败退出：

```bash
# 本地回环启动
pnpm muweave mcp --transport http --host 127.0.0.1 --port 3741 --workspace "${workspaceFolder}"

# 远程监听（强制 Bearer 鉴权）
MUWEAVE_MCP_TOKEN="<your-mcp-token>" \
  pnpm muweave mcp --transport http --host 0.0.0.0 --port 3741 --workspace "${workspaceFolder}"
```

客户端请求 `/mcp` 时携带 `Authorization: Bearer <your-mcp-token>` 即可；如需代理至运行中的本地 DSH 宿主，可附加 `--host-url http://127.0.0.1:<dsh-port>`。

## 安全设计（为什么一半能力是灰的）

付费能力要同时满足四条才允许执行：命令有**费用封顶**、有**幂等键**、有**真正的提交子命令**、产物**可核对**（id / sha256）。缺一条就只进能力目录、不进执行。

配套约束：

- 付费生成默认关闭，**agent 只能申请、不能自行批准**；
- 每次提交带 `--max-cost-usd` 与由幂等键派生的 run id；
- 宿主只读引擎写到私有输出目录的产物，不碰引擎自己的证据目录；
- 所有生成 / 审阅 / 退回 / 绑定都写账本，可回放。

## 设计文档

`docs/design/` 下有 24 篇设计文档（v3→v8 演进、剧场/编辑器两条视觉线、动效与项目管理架构），入口见 [`docs/design/README.md`](./docs/design/README.md)。跨端复用边界见 [`docs/architecture/`](./docs/architecture/)，引擎与能力契约见 [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md)。

## 目录

```
packages/            # 6 个 DSH 插件 + core + bundle
scripts/             # 构建、打包、集成测试、截图自检
tests/               # vitest：宿主 RPC、bundle 契约、插件渲染
docs/                # 架构、设计、引擎集成文档
openspec/            # 变更与规格（历史归档）
```

## License

[MIT](./LICENSE) · 引擎各自独立授权，开源后分别给出许可证。
