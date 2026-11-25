# MuWeave Agent Bots 机制设计（2026-11-25）

> 三份独立评审（架构 / 交互 / 风险）+ 综合裁决，行号已对真实代码复核。

## 一、结论：押「账本派」，不押「新运行时」

bot 是三件套，不是新造一套 agent 运行时：

1. **一条可 resume 的持久 DSH 会话** —— 人格与工具由 preset 定，`packages/dsh-muweave-kit/cordis.patch.yml:90-121` 已挂 subagent / ask-user / todo
2. **一张宿主账本** —— roster、task、归因、事件流，0600 原子写入 pluginDataDir
3. **花钱通道一行不改** —— `estimate → job.request → 生成台人批 → JobEngine`

**砍掉的两条方案**：

- 「bot 即新 agent 运行时塞进 muweave」：插件造不出会话，LLM 即 provider，违「插件不直连 provider」铁律，`host.ts:1614-1621` 的同源闸会退化成建议
- 「全托管派发器 + 自建任务状态机」：重造第二个 JobEngine，双写撕裂

**P1 不做自主付费执行**：bot 能推理、能派活、能提问，花钱必须人批。这一刀砍掉约 60% 工程量、80% 风险。

**唯一会翻车的硬条件**：主人要「睡前派活、醒来出片」—— 必须动 `host.ts:1614`，不可逆，单独决策。

**牢度**：行号事实 100%（已复核）；方案 80%；「前端契约已定型」70%；「无人值守」0%（本方案不做）。

## 二、现状与可复用底座（一行不改）

- `CapabilityAdapter` 五动词 + 稳定 `unavailableReason`（`capabilities/types.ts:78-88`、`registry.ts:23-40`）
- `JobEngine` 8 态与重启对账（`jobs.ts:112-134`）
- 审批同源闸（`host.ts:1614-1621`）
- 可选字段向后兼容范式（`protocol.ts:367-378`，原文写明「不要因加可选字段上 v2 marker」）
- `@` / `/` 触发器源（`client/triggers.ts:12-27`）
- workspace 写锁（`muweave-bundle/src/compiler.ts:357,1415`）

### 必须先修的既有洞（不是 bot 引入的）

1. **归因缺失** —— `requestedBy` 只有 `ui|agent`（`capability-protocol.ts:139`），`JobRecordV1.owner` 是 CLI（`:145`），`client/generation-jobs.tsx:313` 显示的「谁」是 eikona/scaena —— 钱分不出人
2. **裁剪失忆** —— `MAX_JOB_RECORDS=200`，`trimmed()` 把终态记录从内存 `delete`（`jobs.ts:159-173`），幂等查询随之失效（`jobs.ts:224-226`），`computeBudget` 用同一份被裁列表 → 已承诺金额少算
3. **幂等冲突检测有条件** —— `capabilities/service.ts:162-169` 依赖内存估价（15 分钟 TTL，`:22`）；重启后同 key 不同内容会**静默返回旧任务**
4. **进度不可见** —— `timing.projection` 只投 `operations`（`host.ts:1477-1495`），jobs 不在里面
5. **零日志** —— `ctx.logger` 仅声明（`host.ts:77`），全仓 0 调用；未知异常压成 160 字 `muweave/internal_error`（`host.ts:1624-1629`），无关联 id
6. **前端手工镜像无测试锁** —— `host-safe-catalog.ts:3-6,52` 是 browser-safe static mirror，`tests/` grep 不到任何引用

## 三、数据模型

| 实体 | 落盘 | 关键字段 |
|---|---|---|
| Bot | `bots.v1.json` | botId、role（manager 唯一）、presetRef、capabilityGrants、owner/workspaceScopes、budgetEnvelope、parentBotId?、state、revision(CAS) |
| Task | `tasks.v1.json`（脊柱，不按条数裁） | taskId、parentTaskRef?、assignedBy/To、goal、status、attention 五态、idempotencyKey+payloadDigest、traceId、depth、deadline |
| 事件 | `events.v1.jsonl` 追加 | ts/event/botId/sessionId/taskId/jobId/workspaceId/code/durationMs；**不落提示词原文** |
| 幂等索引 | `idempotency.v1.jsonl` 追加 | key→jobId，与裁剪解耦 |
| Job 扩展 | `jobs.v1.json` | 加可选 `requester?{botId,sessionId,taskId,parentJobId}`、`traceId?`；`validJob()` 只硬校验 4 个字段（`jobs.ts:44-50`），老记录照读 |

**红线：botId 永不进任何 owner 枚举。** 仓里 owner 有 6 套定义（`protocol.ts:30/232/255/287`、`capability-protocol.ts:24`、`host.ts:412/580`），加一个值要动 10 个校验点、2 个已落盘文件。

## 四、交互设计

- **输入框同组件、按 bot 绑定、同屏唯一**。`client/floating-agent.tsx` 的浮层只是暂存托盘，不做第四个输入框
- **推翻前端「选 bot 只是提示、owner 可忽略」的含蓄口径**：静默改派等于撒谎，必须回执「已转 X，原因 Y」
- **直连 bot = resume 它那条会话**，复用前端 roster（`frame/agent/roster.ts:8`，main + 6 个具名助手）与 Companion
- **「谁在干」显示 bot 不是 CLI**：P0 改 `generation-jobs.tsx:313`
- **补第五态 `review`**：`waiting_for_human` 在四态注意力模型里没有位置；jobs 必须进 timing 投影，靠 traceId 串 task→job→事件

## 五、委派与权限

**派活单位是 task 不是 job**：job 会被裁，且一次派活可能产出 0 个或 3 个 job；task 是脊柱，job 是叶子。

**显式委派边** `DelegationRuleV1{from,to,workspaceId,allowedCapabilityIds?,requiresApproval}`，五道闸：

1. 只有 `manager` 能派
2. worker 不能反向/平级派
3. 能力必须 `grants ∩ 可用 ∩ ownerScopes ∩ workspaceScopes` 四重交集（新 `BotCapabilityResolver`，`CapabilityRegistry` 不改）
4. 付费能力终态只能停在 `waiting_approval`，**bot 永不代批**（`capability-protocol.ts:174` 原文：Only the UI sends this）
5. bot 不能改自己 grants、不能自派

**诚实声明**：宿主不认证 `managerBotId`，只校验声明自洽，与今天 `requestedBy` 自填同信任级。

**预算**：叶子承担成本，管理 bot 只占信封；批准时校验「本次上限 + 该子树已承诺 ≤ 信封」，禁止 bot 间转移预算。

## 六、可观测性与成本

- 一条追加事件流 + `bot.trace(taskId)` 一次还原整条因果链；事件流 0 条提示词、0 条绝对路径、0 token
- **单调用成本链仍牢**：dry-run 估价零成本、ceiling ≥ estimate、未知成本显式勾选、最坏情况计入 committed
- **四件在多层委派下不成立**：① 无归因 ② 总敞口 = Σ 子任务上限而 N 由 bot 定 ③ 跨日少算（只统计 `approvedAt` 是今天的）④ 估价 15 分钟过期（`service.ts:22`），委派链拉长会让 `ESTIMATE_EXPIRED` 变多
- 修法：P1 只加归因与按 bot 视图，不动全局保守记账；P2 上 per-delegation 信封

## 七、分期落地

- **P0（1 周，先修洞）**：幂等改无条件摘要比对（照 `host.ts:590-601`）；幂等索引与裁剪解耦；归因字段；timing 补 jobs；事件流 0→1
- **P1（约 2 周，5 件）**：roster（≤7 个 bot，对齐现有 main+6）；`bot.delegate`/`bot.trace`/`task.*` RPC（注册进 `protocol.ts:122`，在 `host.ts:867` 旁一行短路）；归因 + 按 bot 预算视图；`@bot` 触发 + resume；断路器状态 UI 可见
- **P2（可信赖）**：级联取消、孤儿扫掠 + 人工确认重派、per-delegation 信封、五态 review
- **P3（无人值守，默认不做）**：预算信封预授权 + 硬上限 + 断路器 + dry-run + 人工 opt-in

**P1 验收（可机器判）**：同意图重复派活只产 1 task/1 job；深度/自派/越权 → 稳定 code 拒绝且事件流有记录；任意 job 能反解 botId/sessionId/taskId；断网断 CLI 主流程可走通；事件流 0 提示词；既有 32 个测试与 preset 对齐测试全绿。

## 八、翻车点与熔断

| # | 翻车点 | 概率×后果 | 熔断 |
|---|---|---|---|
| 1 | 归因缺失，分不了账 | ≈100% × 高 | requester + 按 bot 视图，P0 必做 |
| 2 | 裁剪同时打穿幂等与预算 | 中高 × 高 | 独立幂等索引；task 不裁 |
| 3 | 管理 bot 单点：挂了/被 compaction 截断，在途任务全孤儿 | 高 × 中高 | 落盘 pending 不随会话消失；超 TTL 标 orphaned 并显式提示，不自动重派 |
| 4 | 重启剪断审批链 | 中 × 中高 | `waiting_approval→failed/ESTIMATE_EXPIRED`；只 eikona 有派生 run-id 去重 |
| 5 | bot 自放大（层级/扇出/自派） | 中 × 高 | depth≤3、扇出≤4、自派拒、同意图去重、墙钟硬截、连续被拒进 read_only；断路器必须用户可见 |
| 6 | 并发写 `.muweave/` | 低 | 已有 workspace 锁，不是主要矛盾 |

## 九、待主人拍板

1. **管理 bot 能否代批花钱？** 建议永不；要就动 `host.ts:1614-1621`，是不可逆的性质变化
2. **bot 是「多人格」还是「多权限域」？** 若是后者才值得建 roster；只是人格差异，一个 preset 换 persona 就够
3. **直连 bot 的会话上下文独立还是共享？** 独立=冷启动干净但每次重建；共享=省 token 但互相污染记忆、审计分不清谁说的
4. **前端契约是否以本文为准？** 前后端今天零 RPC、平行产品，不定死
