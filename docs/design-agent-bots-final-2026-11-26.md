# MuWeave Agent Bots 机制：终版设计（2026-11-26）

> 两条独立路径的结论对撞后合成：① 三视角并行评审（架构/交互/风险）；② codex 独立读全仓 72 个 ts 文件。
> 文件行号已对真实代码核对。分歧逐条裁决，不取"各有优劣"。

## 零、双路径确认（两版独立得出同一结论）

这五条是**两边都independent得出**的，牢度最高：

1. **不新造 LLM 运行时**，复用 DSH 原生会话 + subagent + preset
2. **宿主加持久账本**（roster / task / event / 幂等索引），放 pluginDataDir
3. **task 是编排与审计单位，job 是能力调用单位**；一个 task 产出 0..N 个 job
4. **付费动作必须人在 UI 批**；bot 不能代批
5. **task 不因单个 job 失败而消失**，job 被裁不影响 task

## 一、结论

**押：管理 bot + 专业 bot 的账本式编排，不押在插件里造 runtime。**

bot 是三件套：

- 一个**受 host 管理的身份**：角色、preset、能力授予、工作区范围、独立 session 绑定
- 一张**宿主账本**：bot / task / event / 幂等索引，原子写 0600
- **花钱通道一行不改**：estimate → job.request → 生成台人批 → JobEngine

**砍掉的三条**：

- **新造 bot runtime**：插件重复实现 session/上下文/工具/重试/审批/compaction，必然出现两个 JobEngine 和两套状态
- **只做一个 bot + persona 区分**：persona 不能形成权限域，无法单独暂停/直连/审计，一旦要并行还得重来
- **P1 做无人值守**：这一刀砍掉约 60% 工程量、80% 风险

**唯一会翻车的硬条件**：主人要「睡前派活、醒来出片」。这必须动 `host.ts` 的审批同源闸，是不可逆的性质变化，单独决策。

## 二、现状：能复用的与必须修的

### 一行不改就能复用（已核对）

`CapabilityAdapter` 五动词 + 稳定 `unavailableReason`（`capabilities/types.ts:78-88`、`registry.ts:23-40`）｜`JobEngine` 8 态 + 重启对账（`jobs.ts:112-134`）｜审批同源闸（`host.ts:1614-1621`）｜可选字段向后兼容范式（`protocol.ts:367-378`，原文写明"不要因加可选字段上 v2 marker"）｜`@`/`/` 触发器源（`client/triggers.ts:12-27`）｜workspace 写锁（`muweave-bundle/src/compiler.ts:357,1415`）

### 必须先修的既有缺陷（不是 bot 带来的）

| # | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| 1 | **归因缺失** | `requestedBy` 只有 `ui\|agent`（`capability-protocol.ts:139`）；`JobRecordV1.owner` 是 CLI（`:145`）；`generation-jobs.tsx:313` 显示的是 eikona/scaena | 钱分不出人，无法按 bot 统计 |
| 2 | **裁剪失忆** | `MAX_JOB_RECORDS=200`，`trimmed()` 从内存 `delete`（`jobs.ts:171`）；幂等查询失效（`:224-226`）；`computeBudget` 用同一份被裁列表 | **已承诺金额少算**，幂等失效 |
| 3 | **幂等静默返回旧任务** | `capabilities/service.ts:162-169` 依赖内存估价（15min TTL，`:22`） | 重启后同 key 不同内容**静默返回旧 job** |
| 4 | jobs 不进进度 | `timing.projection` 只投 `operations`（`host.ts:1477-1495`） | 在途任务对进度条完全沉默 |
| 5 | **零日志** | `ctx.logger` 仅声明（`host.ts:77`），全仓 0 调用；未知异常压成 160 字无关联 id（`:1624-1629`） | 出错无法复盘委派链 |
| 6 | 直连无路 | 只能找到一个 `muweave-creator` session | 无法可靠 resume 某个专业 bot |
| 7 | 安全 residual | host 只校验浏览器同源审批，**代码里已明确记为 residual** | 能访问 shell 的 agent 可冒充用户 |

第 2、3 条是**真会造成账目错误**的，优先。

## 三、核心概念

```
User
  └─ Manager Bot session（默认入口）
       └─ Root Task
            ├─ Delegation Edge → Worker Bot session
            │    └─ Child Task
            │         └─ 0..N owner Jobs
            └─ Events / Trace
```

- **Manager bot**：默认入口，澄清目标、生成计划、创建 task、委派。**不因"管理"而获得超出 grants 的能力**
- **Worker bot**：负责一个明确 task，只能用 task 范围内的能力，**默认不能继续委派**
- **Session**：DSH 原生会话。**每个 bot 在每个 workspace 用独立会话**，直连时 resume 该会话，避免 transcript 互相污染
- **Event**：不含原始 prompt、凭据、绝对路径、思维链的结构化事实

### task 状态（host 推导，前端不自行拼接终态）

```
proposed → assigned → running → waiting_approval → running
                         ├→ waiting_for_human → running
                         ├→ succeeded / failed / cancelled
                         └→ orphaned
```

`orphaned` = session 或 host 重启后无法恢复执行身份。**必须停住并提示用户，不能自动重派。**

## 四、必须保持的边界

1. **botId 不进任何 owner 枚举**。owner 仍表示 eikona/scaena/sonora 等领域真源，bot 是调用者身份。仓里 owner 有 6 套定义（`protocol.ts:30/232/255/287`、`capability-protocol.ts:24`、`host.ts:412/580`），加一个值要动 10 个校验点
2. **付费能力仍由浏览器 UI 批准**。管理 bot、worker、subagent 都不能代批
3. **`.muweave/` 不成为 bot 数据库**。它仍是可重建 bundle；账本放 pluginDataDir
4. **不持久化原始 prompt / 凭据 / owner 原始响应 / 绝对路径 / 思维链**
5. **客户端传入的 botId 只作为请求意图**，最终身份由绑定的 session + host roster 解析

## 五、委派与权限

```ts
interface DelegationRuleV1 {
  fromBotId: string
  toBotId: string
  workspaceId: string
  capabilityIds?: string[]
  maxDepth: number
  maxChildren: number
  requiresUserApproval: boolean
}
```

五道闸：

1. 只有 manager 能派
2. worker 不能反向/平级派
3. 能力必须 `grants ∩ 可用 ∩ ownerScopes ∩ workspaceScopes` 四重交集
4. 付费能力终态只能停在 `waiting_approval`
5. bot 不能改自己的 grants、不能自派

**预算**：root task 视图，bot 之间不能转移预算。批准时校验「本次 ceiling + 该 root task 已承诺 ≤ root envelope」。unknown cost 按最大 ceiling 计入 committed，直到 owner 返回 actual。日预算仍由全局 settings 约束。

## 六、RPC 与 agent 工具

第一版只加必要动作：

```
bot.roster / bot.get / bot.delegate / bot.pause
task.list / task.get / task.cancel / task.trace
event.list
```

所有写 action 用 `idempotencyKey` + canonical payload digest；重复请求返回原 task，摘要不同返回稳定 `IDEMPOTENCY_CONFLICT`。

agent 侧加**窄工具**，不让 bot 直接碰 host service 或 shell：`muweave_bot_roster`、`muweave_task_delegate`、`muweave_task_status`、`muweave_task_trace`。`task_delegate` 只能由 manager session 调，worker 调返回 `BOT_DELEGATION_FORBIDDEN`。

## 七、分期

### P0：先让「任务可追踪」成立（约 1 周）

1. Bot / Task / Event / Idempotency 的 schema + 原子读写 + 校验（不接 UI）
2. job 加可选 `requester` / `traceId`，旧记录兼容；**独立幂等索引，与展示裁剪解耦**
3. `bot.list`、`task.create/get/list`、`bot.trace` 的最小 RPC
4. 错误 / 重启 / 审批等待 / reconcile / 取消路径写**脱敏事件**
5. host logger 最小结构化调用，关联 `hostInstanceId` + task/job ref + error code

**验收**：同 key 同摘要只返回原记录；同 key 不同摘要稳定拒绝；重启后未知 job 可查询和 reconcile；旧 242 个测试全绿。

### P1：最小可行闭环（约 2 周）

1. roster：默认 1 个 manager，最多 6 个 worker，每个绑独立 sessionRef
2. manager 拿到结构化 `task.assign` 工具；UI 出 task tree、bot 状态、待审批、「打开 bot」
3. `@bot-id` 与现有 `@` 元素 trigger 并列；选中后 `openSession(sessionRef)`，失败必须显式提示
4. job 卡显示 `requester.botId`，保留能力 owner；进度页用 trace 连 task/job/event
5. 熔断：`depth ≤ 2`、每 task `children ≤ 4`、每 root `tasks ≤ 16`

**验收**：用户可从 manager 派一个**免费**任务给 worker、直连 worker、看到回执、取消并恢复；付费任务停在 UI 审批；断网/断 CLI 主流程可走通；事件流 0 条 prompt、0 条绝对路径。

### P2：可信赖编排

级联取消、孤儿扫掠 + **人工确认**重派、per-delegation 信封、跨日账本聚合、断路器状态 UI 可见。

### P3：无人值守（默认不做）

预算信封预授权 + 硬上限 + 断路器 + dry-run + 人工 opt-in。唯一改动点 `host.ts` 审批闸。

## 八、翻车点（按概率×后果排序）

| # | 翻车点 | 熔断 |
|---|---|---|
| 1 | 管理 bot 递归派活放大 | `depth ≤ 2`、children ≤ 4、root tasks ≤ 16；超限稳定拒绝 |
| 2 | 重启后任务变孤儿 | 进 `orphaned`，只允许用户确认 resume 或重新委派，**不自动换 bot 重派** |
| 3 | 付费审批被绕过 | agent tool 不暴露 shell owner 命令；`job.approve` 继续 UI-only |
| 4 | 幂等冲突被裁剪掩盖 | 独立 `idempotency.v1.jsonl`，永不依赖展示记录 |
| 5 | 预算被拆任务绕过 | rootTaskId 继承 + 按 root 汇总 + 批准时原子锁校验 |
| 6 | 上下文互相污染 | bot/workspace 独立 session，handoff 只传结构化摘要和 refs |
| 7 | bot 自报身份 | host 按 session binding 解析调用者，客户端 botId 只作目标意图 |
| 8 | 事件泄露 prompt | 事件 schema 只允许 code / digest / ref / 计数 / 状态 / 脱敏摘要 |
| 9 | owner unknown 被误报成功 | 延续 `reconcile_required`，禁止自动重提，trace 明示「结果未知」 |
| 10 | 断路器不可见 | roster / composer / task 行共用同一状态投影，暂停时禁用派活 |

## 九、待主人拍板

1. **管理 bot 能否代批花钱？** 建议永不。要就动审批同源闸，不可逆，单独决策。
2. **要用几个 bot？** 建议 P1 先 1 manager + 2 worker（只读/低风险），跑通再扩到 6。
3. **直连 bot 失败（session 不存在）时怎么办？** 建议显式报 `BOT_SESSION_UNAVAILABLE` + 给「重新创建会话」，不静默新建。
4. **前端契约是否以本文为准？** 两仓今天零 RPC、是并行产品，建议不对齐 UI 细节，只对齐实体名与状态词。

## 十、分歧裁决（两版设计不同的地方）

| 分歧 | 我的初版 | codex | 裁决 | 理由 |
|---|---|---|---|---|
| P0 范围 | 修 5 个既有缺陷 | 建 schema + 最小 RPC | **合并**：先修缺陷（否则在新账本上重复错误），再加 schema | 两件事顺序不能反 |
| 委派深度上限 | ≤3 | ≤2 | **≤2** | P1 求稳；实测 3 层已难在 UI 上说清谁在干什么 |
| 会话隔离 | 列为待拍板 | 直接定：每 bot 每 workspace 独立 | **取 codex** | 共享 transcript 会互相污染且审计分不清，没有好处 |
| 孤儿任务 | 说过不自动重派 | 做成独立状态 `orphaned` | **取 codex** | 状态可查询才可操作，注释里写不算 |
| 安全 residual | 说「不认证 managerBotId」 | 指出代码已明确记为 residual | **取 codex** | 有代码依据，且它没把这当已解决 |
| task 状态归属 | 未明确 | **host 推导，前端不拼终态** | **取 codex** | 前端拼终态必然和 host 分叉 |
