# MuWeave DSH v7：自定义引擎 Bridge、多集无损粗剪层与 FCPXML / 剪映便携导出设计规格

> 对应 OpenSpec 变更：[muweave-dsh-bridge-cut-export-v7](../../openspec/changes/muweave-dsh-bridge-cut-export-v7/proposal.md)  
> 适用范围：`@yeisme/dsh-muweave-core`（Custom Engine Bridge、`DramaCutStore`、FCPXML 1.10 / 剪映草稿与便携媒体包导出、CLI & MCP 16 工具）、`@yeisme/dsh-muweave-drama`、`@yeisme/dsh-muweave-script`、`@yeisme/dsh-muweave-kit`。

## 1. 目标与核心能力

v7 围绕真实短剧/漫剧创作者的三条关键落地链路完成产品闭环：
1. **零明文密钥 Custom Engine Bridge**：支持用户将 OpenAI 兼容接口（出图 / 配音）、本地 ComfyUI 服务或自定义只读/受控 CLI 包装接入 MuWeave 能力目录，全链路复用 `paidEnabled`、`dailyCap` 与人工审批闸。
2. **多集切换 + 无损粗剪层（`DramaCutStore`）**：不改写 `.scaena/**` 或 `.muweave/` 原件，按剧集持久化镜头重排、时长微调、隐藏/恢复与转场（`cut | crossfade | dip_to_black`），同步生效于分镜台、Animatic 预演与时间线导出。
3. **FCPXML 1.10 / 剪映草稿 & 便携媒体包导出**：在既有 `cut_manifest_v1` / `cmx3600_edl` / `shotlist_csv` 基础上新增 `fcpxml_1_10` 与 `jianying_draft_v1`（`draft_content.json`），支持 `--bundle-dir` 一键打包相对路径 `media/<sha12>.<ext>`，零本机路径泄露。

## 2. 后端与安全契约（`packages/dsh-muweave-core`）

### 2.1 Custom Engine Bridge（`capabilities/custom-adapters.ts`）
- **存储与零密钥红线**：配置持久化于 `pluginDataDir/custom-adapters.v1.json`（`schema: 'muweave.custom-adapters.v1'`，`0600` 原子写 + `.corrupt-*` 备份）。`authEnvVar` 仅保存环境变量名（正则 `/^[A-Z_][A-Z0-9_]{1,63}$/`），明文 `sk-*` / `Bearer` 均被 `findPlaintextCredential` 拒绝；列表接口仅返回 `envReady: boolean`，仅在 `submit` 阶段从 `process.env[cfg.authEnvVar]` 读取密钥。
- **SSRF / HTTPS 围栏（`validateAdapterEndpointUrl`）**：
  - 仅允许 `http:` / `https:`；无条件拒绝 `file:`、`gopher:`、`user:pass@`、`0.0.0.0`、`169.254.*`。
  - 回环地址（`127.0.0.1`、`localhost`、`::1`）允许 `http:` / `https:`；私网 LAN（`10.*`、`172.16-31.*`、`192.168.*`、`fc00::/7`、`fe80::/10`、`.local`）默认以 `ADAPTER_PRIVATE_NET_FORBIDDEN` 拒绝，除非显式开启 `allowPrivateNetwork: true`。
  - 非回环公网地址强制要求 `https:`（否则拒绝 `ADAPTER_HTTPS_REQUIRED`）。
- **协议与预设**：支持 `openai_http`、`/prompt + /history + /view` 流程的 `comfyui_http`、无 shell `execFile` 的 `cli_wrapper`；内置 3 套预设（`openai-image`、`openai-tts`、`comfyui-local`）与零费用连通性探测 `testCustomAdapter`。
- **新增 RPC**：`adapter.custom.list`、`adapter.custom.save`、`adapter.custom.remove`、`adapter.custom.test`。

### 2.2 多集无损粗剪层（`drama-cut-store.ts`）
- 持久化于 `pluginDataDir/drama-cuts.v1.json`（`schema: 'muweave.drama-cuts.v1'`，`0600` 原子写 + `.corrupt-*` 备份）。
- 乐观锁：`expectedRevision` 不匹配抛出 `muweave/cut_revision_conflict`（附 `{ currentRevision }`）；时长覆盖校验范围为 `200_000..300_000_000` 微秒；全部字段通过凭据与宿主路径校验。
- 纯函数叠加器 `applyEpisodeCut(rows, override)` 过滤 `omittedShotRefs` 并应用 `shotOrder`、`durationOverridesMicros`、`transitions`。
- **新增 RPC**：`drama.cut.get`、`drama.cut.set`、`drama.cut.reset`。

### 2.3 FCPXML 1.10、剪映草稿与便携包导出（`drama-export.ts`）
- `DramaExportFormat` 扩展：`fcpxml_1_10`（`*.fcpxml`，`application/xml`）与 `jianying_draft_v1`（`draft_content.json`，`application/json`）。
- 导出自动叠加 `episodeRef` 筛选与 `EpisodeCutOverrideV1`，所有媒体引用统一为相对路径 `media/<sha12>.<ext>`，整包通过 `containsHostPath` 与 `findPlaintextCredential` 出口闸。
- `exportDramaPortableBundle({ workspaceDir, exportResult, bundleDir, mediaBlobs })` 复制经校验的 CAS 媒体至 `bundleDir/media/` 并生成无宿主路径的 `README.txt`。

### 2.4 CLI 与 MCP（16 Tools）扩展
- **CLI（`cli.ts`）**：`muweave adapters list|add|remove|test`、`muweave cut show|reorder|trim|omit|reset`、`muweave export --episode --bundle-dir`、`muweave demo seed --episodes <n>`。
- **MCP（`mcp/server.ts`）**：新增 `muweave_adapters_manage` 与 `muweave_drama_cut_manage`（合计 **16 Tools / 6 Resources / 3 Prompts**，仍绝不暴露 `job.approve`），并扩展 `muweave_drama_export` 支持 `episodeRef` 与新格式。

## 3. 前端交互升级（Drama / Script / Kit）

- **Drama（`packages/dsh-muweave-drama`）**：
  - 顶部 `.dr-episode-bar` 多集切换条（展示镜数、总时长与通过率）；
  - 有粗剪覆盖时展示 `.dr-cut-banner` 与「重置回原序」（`drama.cut.reset`）；分镜卡片提供上移/下移/隐藏恢复按钮；
  - `ShotInspector` 新增「粗剪微调」（时长、转场选择、隐藏/恢复）；
  - `TimelineView` 导出栏新增「导出 FCPXML」与「导出剪映草稿」。
- **Script（`packages/dsh-muweave-script`）**：多集工作区渲染 `.dr-episode-bar` 过滤双时间轴与场次卡。
- **Kit（`packages/dsh-muweave-kit`）**：在既有 `cli-cards` Tab 内新增「外部引擎 Bridge 配置」（`.kit-adapter-card`），提供 3 套预设一键填充、`envReady` 状态标签、前端拦截明文 `sk-*` / `Bearer`（不发 RPC）、测试连通与删除。

## 4. 验收门禁

- `openspec validate muweave-dsh-bridge-cut-export-v7 --strict --no-interactive`
- 新增单测：`tests/custom-adapters.test.ts`、`tests/drama-cut-export-v7.test.ts`、`tests/v7-product-ui.test.tsx`
- 全仓门禁：`pnpm typecheck && pnpm test && pnpm build && pnpm pack:plugins && pnpm test:integration`。
