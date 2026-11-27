# MuWeave DSH v6：多 Agent 编排控制面与开放引擎生态设计规格

> 对应 OpenSpec 变更：[muweave-dsh-orchestration-ecosystem-v6](../../openspec/changes/muweave-dsh-orchestration-ecosystem-v6/proposal.md)  
> 适用范围：`@yeisme/dsh-muweave-core`（能力体检、可选本地零费用预览适配器、编排控制面板、CLI/MCP 编排管理）、`@yeisme/dsh-muweave-workbench`（工具目录原因码本地化与主卡片操作行精修）、`scripts/inner-e2e-runner.mjs`（v5/v6 全量真机截图覆盖）。

## 1. 目标与核心交付

v6 在 v5 三端合一的基础上，补齐**多 Agent 编排实时管控**与**零门槛引擎接入体验**：
1. **三端一致的编排控制面（UI + CLI + MCP）**：统一支持 Bot 断路器暂停/恢复（`expectedRevision` 乐观锁）、委派任务树轨迹追踪（`task.trace`）、孤儿任务提示与级联取消（`task.cancel` → `cancelledTaskIds` + `cancelledJobIds`）。
2. **能力预检诊断（`muweave doctor --capabilities`）**：零付费调用列出全部能力可用性、阻塞原因码与可执行修复建议。
3. **可选零费用本地预览适配器（`MUWEAVE_LOCAL_PREVIEW_ADAPTER=1`）**：默认关闭；显式开启后注册 `demo.image.preview`（`costUnit: 'none'`），无需外部付费引擎即可完整跑通 `estimate → request → approve → review → linkToShot` 并写入真实 CAS PNG。
4. **Workbench 视觉收口与 E2E 截图补全**：右栏工具目录完全消除裸英文枚举码（保留 `data-reason` 与 `title`），主产物卡片 `对比基线` 内嵌 `<kbd>C</kbd>` 消除裁切，补齐 4 张 v5/v6 `1440×900` 真机截图。

## 2. 后端与协议设计（`packages/dsh-muweave-core`）

### 2.1 能力预检诊断（`capabilities/doctor.ts`）
- `runCapabilityDoctor(catalog, workspaceSummary?)` 返回 `{ ok: true, availableCount, blockedCount, paidEnabled, capabilities: [{ capabilityId, owner, stage, available, reason?, remediation }] }`。
- 针对 `NO_COST_CAP`、`NO_SUBMIT_COMMAND`、`ADAPTER_PENDING`、`OWNER_NOT_INSTALLED`、`MARKER_MISSING`、`PAID_DISABLED_BY_HOST` 输出明确修复指引，零宿主路径与凭据泄露。

### 2.2 可选本地预览适配器（`capabilities/preview-adapter.ts`）
- `LOCAL_PREVIEW_ADAPTER`：`capabilityId: 'demo.image.preview'`、`owner: 'eikona'`、`kind: 'image'`、`stage: 'visual'`、`costClass: 'free'`、`costUnit: 'none'`、`defaultSlots: 2`、`maxSlots: 4`。
- **严格默认关闭**：仅在 `process.env.MUWEAVE_LOCAL_PREVIEW_ADAPTER === '1'` 时于 `CapabilityRegistry` 动态注册，对现有安全门禁与测试零影响。
- `submit` 按 prompt 摘要生成确定性色相最小 PNG，通过 `putCasBlob` 写入 CAS 并返回已完成 slot 产物（`sha256`、`mime: 'image/png'`）。

### 2.3 CLI 与 MCP 编排控制扩展
- **CLI（`cli.ts`）**：
  - `muweave doctor --capabilities [--json|--agent]`
  - `muweave bots list [--workspace ...]`、`muweave bots pause|resume <botId> [--expected-revision N]`
  - `muweave tasks list [--workspace ...]`、`muweave tasks trace|cancel <taskId>`
- **MCP（`mcp/server.ts`）**：扩展至 **14 Tools / 6 Resources / 3 Prompts**（仍绝不暴露 `job.approve`）：
  - `muweave_orchestration_status`：聚合 `bot.roster` 与 `task.list`（含 `paused` / `orphanedCount` 统计）。
  - `muweave_task_trace_or_cancel`：支持 `action: 'trace' | 'cancel'`，返回脱敏轨迹或级联取消回执。
  - `muweave://orchestration/tasks`（`application/json`）：实时任务与断路器快照资源。

## 3. 前端编排面板与 Workbench 精修

- **`OrchestrationPanel`（`packages/dsh-muweave-core/src/client/orchestration-panel.tsx`）**：
  - 挂载于 `GenerationDrawer` 顶部分段切换（`data-generation-drawer-tabs="true"`：`生成任务` 默认 / `编排与断路器`）。
  - 展示 Bot 列表（角色、状态胶囊、能力数、预算信封、`bot.pause` 断路器开关）与委派任务树（`orphanedCount` 告警、展开 `task.trace`、`task.cancel` 级联取消回执）。
- **Workbench 收口（`packages/dsh-muweave-workbench/src/{client.tsx,stage-workbench.tsx}`）**：
  - 右栏工具目录使用 `unavailableReasonLabel(entry.blockedReason, lang)` 渲染可读标签，保留原始码在 `data-reason` 与 `title`。
  - `<kbd>C</kbd>` 内嵌至 `对比基线` 按钮，`.mw-stage-primary-body` / `.mw-stage-primary-actions` 支持换行不裁切。
- **E2E 截图扩展（`scripts/inner-e2e-runner.mjs`）**：新增 `kit-cli-mcp-1440x900.png`、`shortcuts-modal-1440x900.png`、`drama-inspector-open-1440x900.png`、`orchestration-drawer-1440x900.png`。

## 4. 验收门禁

- `openspec validate muweave-dsh-orchestration-ecosystem-v6 --strict --no-interactive`
- 新增单测：`tests/capability-doctor-preview.test.ts`、`tests/orchestration-panel.test.tsx`
- 全仓门禁：`pnpm typecheck && pnpm test && pnpm build && pnpm pack:plugins && pnpm test:integration`（6 文件脱敏证据包零泄露）。
