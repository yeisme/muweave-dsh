# 幕织 MuWeave · DeepSeek Harness 创作插件矩阵（v8）

一套跑在 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（下称 DSH）里的三端合一（**DSH 剧场 UI + Creator CLI + 本地/远程 MCP Server**）短剧/漫剧创作工作台：把「做一部漫剧 / 竖屏短剧」的六个阶段——**灵感 → 剧本 → 视觉 → 分镜 → 声音 → 成片交付**——做成一条可审核、可质检、可无损粗剪、可回滚、可排期的流水线，而不是一堆生成按钮。

面向一人或 2–3 人的创作小组：真正的瓶颈不是「生成不出一张好图」，而是生成之后的**连续性管控、挑镜、导演审片、质检、粗剪导出与排期**。

> **架构边界**：本仓库是编排与交付层（UI / 审核 / 连续性圣经 / 质检 / 无损粗剪 / 账本 / 能力网关 / CLI / MCP）。`.muweave/` 是可重建的物化元件目录，绝不直接改写 `.eikona/**`、`.auctra/**`、`.scaena/**` 内部数据库。详见 [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md)。

## 当前能力总览（v8）

| 维度 | 当前状态 |
| --- | --- |
| 三端架构 | **7 房间 DSH 剧场 UI**（总览 / 视觉 / 剧本 / 分镜生产 / 成稿 / 工具箱 / 排期）+ **`muweave` Creator CLI** + **本地 stdio / 远程 Streamable HTTP MCP Server** |
| 作剧生产台 | 6 轨媒体检查器（`keyframe / reference / video / voice / music / sfx`）+ 5 态乐观锁导演审片 + 原生 HTML5 9:16/16:9 `AnimaticPlayer`（含 **9:16 安全区叠加层**）+ 多集无损粗剪（重排/裁时长/隐藏/转场）+ 批量审片 + 导演键盘流 |
| 连续性、质检与交付 | **片场连续性圣经**（`project.bible.*`）+ **5 维自动交付质检闸**（`drama.qc.report`）+ **离线甲方审片包 HTML**（零 CDN）与安全反馈回导（默认保护已锁定镜头）+ **FCPXML 1.10 / 剪映草稿 / CMX 3600 EDL / Cut Manifest / CSV / SRT / WebVTT** + `--bundle-dir` 便携媒体包 |
| 引擎生态与编排 | 内置 **Custom Engine Bridge**（OpenAI / ComfyUI / CLI Wrapper，零明文密钥 + SSRF/HTTPS 围栏）+ 可选零费用 `MUWEAVE_LOCAL_PREVIEW_ADAPTER=1` + `muweave doctor --capabilities` + 多 Agent 编排断路器与级联取消 |
| 验证与跨平台 E2E | `pnpm typecheck`、`pnpm test`（覆盖宿主 RPC、Bundle、CLI、MCP、样式静态门禁与全房间 UI）、`pnpm build`、`pnpm pack:plugins` 与 **macOS + Linux 双平台真机 Playwright E2E**（产出 6 文件脱敏证据包） |

## 现在怎么用（4 条路径）

1. **5 秒零成本全链路体验**：执行 `pnpm muweave demo seed --workspace ./demo --episodes 2` 生成 2 集 9:16 演示剧集，并可选设置 `MUWEAVE_LOCAL_PREVIEW_ADAPTER=1` 启用零费用本地预览适配器（`demo.image.preview`，默认关闭），无需外部 API 即可完整体验估价、审批、出图、审片、质检与导出。
2. **接自定义外部引擎（Custom Engine Bridge）**：在工具箱「外部引擎 Bridge 配置」或 `pnpm muweave adapters` 中配置 `openai_http`、`comfyui_http` 或无 shell `cli_wrapper`（仅保存环境变量名如 `OPENAI_API_KEY`，落盘 `custom-adapters.v1.json`，零明文密钥）。
3. **无引擎纯规划、质检与 NLE 交付**：剧本、分镜、片场连续性圣经、5 维自动质检、离线甲方审片包 HTML、反馈 JSON 回导、SRT/WebVTT 字幕、FCPXML/剪映/EDL 导出与排期均不依赖外部付费引擎。
4. **接入官方 owner CLI**：将 `eikona` / `sonora` / `scaena` / `auctra` 等 owner CLI 放进 PATH，运行 `pnpm muweave doctor --capabilities` 零费用检查能力可用性与修复建议（详见 [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md)）。

## 包结构

| 包 | 角色 | 说明 |
| --- | --- | --- |
| `@yeisme/muweave-bundle` | 规范 / CLI / SDK | `.muweave/` 物化元件目录编译 CLI（`init`/`bind`/`sync`/`inspect`/`validate`/`doctor`）与浏览器安全只读 Consumer SDK |
| `@yeisme/dsh-muweave-core` | 共享宿主、CLI、MCP 与前端底座 | `/api/muweave-dsh/rpc` 总线、Range 媒体流、审片/粗剪/连续性圣经/自定义 Bridge 存储、自动质检、NLE/字幕/离线审片包导出器、`muweave` CLI、MCP Server、共享 UI 与 `--mw-*` 视觉令牌 |
| `@yeisme/dsh-muweave-workbench` | 插件 1（总览 & 成稿） | `.muweave/` 总览、项目诊断与注册表迁移报告、首屏引导、双栏对比与成稿房间 |
| `@yeisme/dsh-muweave-eikona` | 插件 2（视觉） | 视觉候选画廊、2-up/4-up 对比、一键绑镜、母版与**片场连续性圣经**编辑器 |
| `@yeisme/dsh-muweave-script` | 插件 3（剧本） | 多集切换、剧本双时间轴、Scene Card 草稿/提交、线性阅读模式、Context Graph 与 stale diff |
| `@yeisme/dsh-muweave-drama` | 插件 4（分镜生产） | 多集无损粗剪、6 轨 `ShotInspector` + Filmstrip、9:16 安全区 `AnimaticPlayer`、交付质检条、NLE/字幕/离线审片包导出与甲方反馈回导 |
| `@yeisme/dsh-muweave-kit` | 插件 5（工具箱） | `muweave-creator` 智能体预设与窄工具、中文 `/` 创作技能、提示词配方、CLI/MCP 接入向导与外部引擎 Bridge 配置 |
| `@yeisme/dsh-muweave-schedule` | 插件 6（排期） | 发布排期月历导航头、待排池搜索与域筛选、项目作用域排期与撤销栈 |

## 环境要求与快速开始

- Node.js `>=22.19.0` · pnpm `10.16.1` · DSH `>=0.2.2-rc.2 <0.3.0`

```bash
pnpm install
pnpm typecheck
pnpm build                          # 构建 core、CLI、MCP 与 6 个插件
pnpm test
pnpm pack:plugins                   # 产出 .work/*.tgz
pnpm test:integration               # macOS / Linux 真机 E2E + 6 文件脱敏证据包
```

安装至隔离 DSH profile（不要直接覆盖日常 `~/.dsh/profiles/web`）：

```bash
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-workbench-0.1.0.tgz --offline
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-eikona-0.1.0.tgz --offline
# …其余插件同理
```

## CLI 快速体验（含 `muweave demo`）

构建后可直接通过 `pnpm muweave`（或 `muweave` 二进制）操作 `.muweave/`，支持人类可读、`--json` 与 `--agent`（`spec_version=1.0`）三种脱敏输出：

```bash
# 1. 一键生成多集 9:16 演示工作区（含连续性圣经与对白；已有 .muweave/ 时需 --force）
pnpm muweave demo seed --workspace ./demo-ep01 --episodes 2

# 2. 状态检查、能力预检与连续性圣经
pnpm muweave status --workspace ./demo-ep01
pnpm muweave doctor --capabilities --workspace ./demo-ep01 --json
pnpm muweave bible show --workspace ./demo-ep01

# 3. 审片、自动化交付质检与安全回导甲方反馈
pnpm muweave shots list --workspace ./demo-ep01 --missing keyframe
pnpm muweave review set --workspace ./demo-ep01 --shot shot:ep01:s01:01 --status approved --note "节奏稳"
pnpm muweave qc --workspace ./demo-ep01 --episode episode:01 --strict
pnpm muweave review import ./review-feedback.json --workspace ./demo-ep01

# 4. 无损粗剪与 NLE / 字幕 / 离线甲方审片包便携导出
pnpm muweave cut show --workspace ./demo-ep01 --episode episode:01
pnpm muweave export fcpxml_1_10 --workspace ./demo-ep01 --episode episode:01 --bundle-dir ./portable-fcpxml
pnpm muweave export jianying_draft_v1 --workspace ./demo-ep01 --episode episode:01 --bundle-dir ./portable-jianying
pnpm muweave export srt_subtitles --workspace ./demo-ep01 --episode episode:01 --out ./ep01.srt
pnpm muweave export webvtt_subtitles --workspace ./demo-ep01 --episode episode:01 --out ./ep01.vtt
pnpm muweave export review_deck_html --workspace ./demo-ep01 --episode episode:01 --bundle-dir ./client-review-deck

# 5. 外部引擎 Bridge、排期与多 Agent 编排控制
pnpm muweave adapters list --workspace ./demo-ep01
pnpm muweave bots list --workspace ./demo-ep01
pnpm muweave tasks list --workspace ./demo-ep01
pnpm muweave schedule list --workspace ./demo-ep01
```

## MCP Server（本地 stdio / 远程 HTTP）接入指南

`@yeisme/dsh-muweave-core` 内置零新增依赖的 MCP JSON-RPC 2.0 服务（**18 个脱敏工具、8 个 `muweave://*` 实时资源、3 个创作提示词**），覆盖工作区状态、分镜审片、无损粗剪、NLE/字幕/审片包导出、排期、诊断、连续性圣经、交付质检、自定义 Bridge 与多 Agent 编排控制，**绝不暴露 `job.approve` 等自动付费审批动作**。

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

# 远程监听（强制 Bearer 鉴权，使用 crypto.timingSafeEqual 校验）
MUWEAVE_MCP_TOKEN="<your-mcp-token>" \
  pnpm muweave mcp --transport http --host 0.0.0.0 --port 3741 --workspace "${workspaceFolder}"
```

客户端请求 `/mcp` 时携带 `Authorization: Bearer <your-mcp-token>` 即可；如需代理至运行中的本地 DSH 宿主，可附加 `--host-url http://127.0.0.1:<dsh-port>`。

## 能力边界与 2026 合规交付说明

- **人工审批与费用安全闸**：付费生成默认关闭；外部 CLI、MCP 与 Kit 智能体均**无法调用 `job.approve`**，所有付费任务止步于 `waiting_approval` 并受费用封顶、日预算与幂等键约束。
- **AI 合规披露元数据**：片场连续性圣经内置 `complianceDisclosure` 字段，自动交付质检闸（`drama.qc.report`）在缺失时发出 `qc_missing_compliance_disclosure` 告警，离线甲方审片包（`review_deck_html`）与交付清单显式透传合规标注。
- **`.muweave/` 可重建性与零敏感泄露**：`.muweave/` 为只读物化层；所有本地状态文件（审片、粗剪、排期、连续性圣经、自定义 Bridge）均采用 `0600` 原子写与 `.corrupt-*` 备份，严格拒绝明文凭据（`sk-*` / `Bearer`）与宿主本机绝对路径进入配置、导出包、日志或 E2E 证据包。

## 设计文档与变更记录

- 设计文档索引：[`docs/design/README.md`](./docs/design/README.md)
- 引擎与能力契约：[`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md)
- 跨端复用边界：[`docs/architecture/`](./docs/architecture/)
- 版本演进记录：[`CHANGELOG.md`](./CHANGELOG.md)

## License

[MIT](./LICENSE) · 外部 owner 引擎各自独立授权。
