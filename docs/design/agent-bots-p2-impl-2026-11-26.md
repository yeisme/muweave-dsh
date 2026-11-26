# P2 实施记录：可信赖编排（2026-11-26）

对应设计 `docs/design/agent-bots-final-2026-11-26.md` 第七节 P2。

## 并行方式

P2 拆成四块，A 是核心（定义接口），B/C/D 互不依赖：

```
P2-A（串行，核心）
  ↓ 合入 develop 后
P2-B ‖ P2-C ‖ P2-D（三路 worktree 并行）
```

四块各自只碰自己的文件，**四次 merge 零冲突**。

## P2-A：`task.delegate` + DelegationRuleV1 五道闸（`29887df`）

`bot-task/tasks.ts` 加 `task.delegate`，是 `task.create` 的受控封装。五道闸：

| # | 闸 | 错误码 |
|---|---|---|
| 1 | 调用方必须是 `role === 'manager'` 且 `state === 'active'` | `BOT_DELEGATION_FORBIDDEN` |
| 2 | 目标 bot 存在且 `state === 'active'` | `BOT_TARGET_UNAVAILABLE` |
| 3 | 目标必须是 `worker`（manager 不能互派） | `BOT_DELEGATION_FORBIDDEN` |
| 4 | 能力交集 + workspace 范围（`'*'` 通配） | `BOT_CAPABILITY_NOT_GRANTED` |
| 5 | `depth > 2` / 父 task 子节点 ≥4 | `BOT_DEPTH_EXCEEDED` / `BOT_FANOUT_EXCEEDED` |

委派成功写 `task.delegated` 事件，**走 `EventLog.append()`**（自动过脱敏闸）。新增 8 条测试。

## P2-B：manager session 绑定（`45ba575`）

新建 `bot-task/sessions.ts`（187 行）。持久化 `botId ↔ sessionRef` 映射，落 `bot-sessions.v1.json` 到 `pluginDataDir`，原子写 + 0600。

两个 action：`bot.session.get`（查不到返回 `{session:null}`，不是错误）、`bot.session.bind`（bot 为 paused/retired 时 `BOT_SESSION_UNAVAILABLE`）。

**「绝不静默新建」**：`sessionRef` 必须由调用方（host）提供，store 侧不生成。

**额外做的一件事**：实现时发现 `roster.ts` 的 `persist()` 没有并发锁，于是在新文件里补了 `queues` Map（`:29`）+ `transact()`（`:178`）。这是主动补既有缺陷。

## P2-C：kit 窄 agent 工具（`845f58f`）

新建 `packages/dsh-muweave-kit/src/bot-tools.ts`，4 个工具走 **HTTP RPC** 调 core（不直接 import 实现，避免循环依赖）：

| 工具 | 调的 RPC |
|---|---|
| `muweave_bot_roster` | `bot.roster` |
| `muweave_task_delegate` | `task.delegate` |
| `muweave_task_status` | `task.get` |
| `muweave_task_trace` | `task.trace` |

只有已绑定 manager 的 session 能调 `muweave_task_delegate`，worker 调返回 `BOT_DELEGATION_FORBIDDEN`。工具输出只含 task ref / 状态 / 脱敏摘要。

## P2-D：`@bot-id` 入口 + requester 显示（`2c31f3a`）

- `client/triggers.ts` 加 `@bot:` 域（`@bot:muweave-manager` 精确匹配、`@bot:manager` 按 role 匹配），补全源走 RPC `bot.roster`（不硬编码）
- 选中后 `openSession(sessionRef)`，**拿不到 session 显式报 `BOT_SESSION_UNAVAILABLE`**，不静默
- `client/generation-jobs.tsx` 优先显示 `job.requester?.botId`，没有才退回 `job.owner`——**用户终于能看见「谁派的活」**

## 实测

```
合并前（develop fdcc5f2）：36 文件 / 267 测试
合并后（develop 1423ff2）：39 文件 / 283 测试
TC=0，0 错误
```

| 新测试文件 | 覆盖 |
|---|---|
| `tests/bot-delegate.test.ts` | 五道闸各一条 + 幂等同摘要/异摘要 |
| `tests/bot-sessions.test.ts` | bind/get/unbind、workspace 隔离、持久化、损坏文件容错 |
| `tests/bot-kit-tools.test.ts` | 4 工具注册、入参校验、worker 越权、输出脱敏 |
| `tests/bot-trigger-entry.test.tsx` | `@bot:` 补全、无 session 显式提示、requester 显示回退 |

三路各自独立验收（`TC=0` + 37 文件 / 272–273 测试）后才合并。

## 合并记录

```
326a94e merge: P2 p2b   （+275 −1）
600e7cc merge: P2 p2c   （+337）
1423ff2 merge: P2 p2d   （+218 −7）
```

## 过程中的教训

**1. 长文本 `pane send-text` + Enter 在 codex TUI 里不可靠。** 我发了 15 行 API 指引，它进了输入框但没提交（屏幕显示 `tab to queue message`）。正确姿势：`send-keys Escape` + `C-u` 清空 → `send-text` 一句话 → `Enter`。

**2. 监控只读主仓，看不见 worktree。** P2-B/C/D 在监控里一直显示未完成，容易误判成「没开工」去重复派活。判断进度必须看 worktree 的 `git status`。

**3. `plugins.test.tsx` 失败 = `lib/` 没构建。** 新 worktree 没有构建产物，跑一次 `node scripts/build-all.mjs` 即可。

## 下一步（P3）

设计文档第八节的翻车点里还有几项没做：

1. **级联取消**：`task.cancel` 已级联子树，但 job 层未联动
2. **孤儿扫掠**：`orphaned` 状态有了，谁负责扫出来并提示用户（现在只在 load 时标）
3. **per-delegation 预算信封**：现在只有 root task 视图，P3 要下放到每条委派边
4. **跨日账本聚合**：`computeBudget` 只统计当天批准的
5. **断路器状态 UI 可见**：roster 的 `paused` 已存，但界面上没体现
