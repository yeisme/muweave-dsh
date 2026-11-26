# P1 实施记录：Bot Roster / Task Ledger / Event Log（2026-11-26）

对应设计 `docs/design-agent-bots-final-2026-11-26.md` 第七节 P1。

## 并行方式与为什么先做脚手架

P1 三块（roster / task / event）原本会全部撞在 `host.ts` 里：那是 1805 行文件里的**单个 switch，34 个 case**，任何新 RPC 都要往里塞分支。

所以先落了 `8977eb6 feat(core): scaffold the bot/task/event RPC family`：建出 `packages/dsh-muweave-core/src/bot-task/` 目录，并在 `host.ts` 加一行短路（紧邻 capabilities 那行）：

```ts
if (this.capabilities.isCapabilityAction(action)) return this.capabilities.handle(action, payload)
if (this.botTask.isBotTaskAction(action)) return this.botTask.handle(action, payload, this.generation)
```

这是照搬 capability 层已有的模式。有了这一行，三块各自在自己的文件里写，**合并零冲突**（实测三次 merge `--no-ff` 全干净）。

## 三块实现

### roster（`bot-task/roster.ts` 147 行，commit `be50bd8`）

- `bots.v1.json` 落 `pluginDataDir`，原子写 mode 0600
- 三个 action：`bot.roster` / `bot.get` / `bot.pause`
- 首次读取自动 bootstrap **1 个 manager**（`botId: 'muweave-manager'`, `presetRef: 'muweave-creator'`）
- zod schema 强约束：`role` 只能是 `manager|worker`、**manager 全库恰好 1 个**、botId 唯一
- `bot.pause` 可恢复（`paused → active`），不是单向锁死
- 文件损坏时给空/默认 roster 并记 `bot_task.roster_load_failed`，不阻断启动

### tasks（`bot-task/tasks.ts` 163 行，commit `a54ed32`）

- `tasks.v1.json` 落 `pluginDataDir`，**不按条数裁剪**（job 会裁到 200，task 是脊柱不能裁）
- 五个 action：`task.create` / `task.list` / `task.get` / `task.cancel` / `task.trace`
- 状态机 8 态：`proposed / assigned / running / waiting_approval / waiting_for_human / succeeded / failed / cancelled / orphaned`，**由 host 推导，不接受前端传终态**
- 重启时未终态且无法恢复执行身份 → 标 `orphaned`（`tasks.ts:99`），**不自动重派**
- 幂等：同 key 同 digest 返回原 task，不同 digest → `TASK_IDEMPOTENCY_CONFLICT`
- 委派限制：`depth > 2` → `BOT_DEPTH_EXCEEDED`；父 task 子节点 ≥4 → `BOT_FANOUT_EXCEEDED`
- `task.cancel` 级联子树，已终态不受影响

### events（`bot-task/events.ts` 169 行，commit `ab3e168`）

- `events.v1.jsonl` 追加写、mode 0600
- `event.list` 按 `traceId` / `taskId` 过滤 + 分页
- **脱敏闸**（核心）：写前过 `/(?:^|[^a-z0-9])sk-|ghp_|AKIA|Bearer\s|^\/|\\|[A-Za-z]:\//i` + `containsHostPath()` + `findPlaintextCredential()`
  - 命中：拒写原事件，改写一条 `event.rejected_sensitive`（自身不含被拒内容），并抛错
  - 单字段 >256 字符也拒
- 导出了 `append()` 给 tasks 后续接入
- 损坏的 jsonl 行跳过，不影响其余读取

## 我修过的一个前置错误

`78ebb73 fix(core): pass pluginDataDir into the bot/task/event stores`

初次脚手架里三个桩的 `Deps` 只声明了 `logger`，**没有 `pluginDataDir`**，`service.ts` 构造时也只传 logger。结果三个 store 无从知道账本落在哪。

roster 和 tasks 两个并行 agent **各自在 1–3 分钟内发现并停下报告**，没有越界去改 `service.ts`——「只改一个文件，必须改别的就停下报告」这条边界是可执行的，实测有效。

## 实测

```
合并前（主仓 78ebb73）：32 文件 / 245 测试
合并后（主仓 79b6ed1）：35 文件 / 259 测试
TC=0，0 错误
```

**净增 3 个测试文件、14 条测试**：

| 新测试文件 | 覆盖 |
|---|---|
| `tests/bot-roster.test.ts` | bootstrap、pause/恢复、持久化、损坏文件容错 |
| `tests/bot-tasks.test.ts` | 幂等冲突、深度/扇出限制、cancel 级联、不裁剪 |
| `tests/bot-events.test.ts` | 脱敏闸（路径/密钥被拒）、分页、损坏行容错、文件缺失 |

三路各自独立验收（`TC=0` + 33 文件 / 248–252 测试）后才合并。

## 合并记录

```
43b464f merge(core): P1 roster    （+208 −11）
3127723 merge(core): P1 tasks     （+225 −17）
79b6ed1 merge(core): P1 events    （+277 −13）
```

三次 `--no-ff` 合并**零冲突**。

## 下一步（P2）

1. `bot.delegate` RPC —— manager 创建 child task，接现有 `DelegationRuleV1` 五道闸
2. manager session 绑定（session → botId 的映射与恢复）
3. `@bot-id` 入口，与现有 `@` 元素 trigger 并列
4. kit 包的窄 agent 工具：`muweave_bot_roster` / `muweave_task_delegate` / `muweave_task_status` / `muweave_task_trace`
5. job 卡显示 `requester.botId`（P0 已加字段，前端待接）
