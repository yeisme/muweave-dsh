# P0 实施记录：任务可追踪、账目可对账（2026-11-26）

对应设计 `docs/design-agent-bots-final-2026-11-26.md` 的 P0。提交 `b7772f9`。

P0 不是加功能，是修 5 个**既有缺陷**——它们在建 bot 机制之前就在造成账目错误。

## 五项改动

### 1. 幂等不再静默返回旧 job

**缺陷**：`capabilities/service.ts` 的幂等冲突检测依赖内存里的 estimate（15 分钟 TTL）。重启后 estimate 没了，同一个 `idempotencyKey` 传不同内容会静默返回旧 job——用户以为提了新任务，其实拿到旧的。

**修法**：`payloadDigest(capabilityId, promptDigest, slots, anchor)` 用 sha256 + canonicalJson 算出请求摘要，持久化到 estimate 记录。查幂等时无条件比摘要：
- 摘要相同 → 返回原记录
- 摘要不同 → `JobError('IDEMPOTENCY_CONFLICT')`
- **不再依赖内存 estimate 是否还在**

关键代码：`service.ts:54,206,237-243`。`:237` 有 `prior.payloadDigest ?? payloadDigest(...)` 兜底，处理 P0 之前落盘的老记录。

### 2. 幂等索引与展示裁剪解耦

**缺陷**：`MAX_JOB_RECORDS = 200`，`trimmed()` 把终态记录从内存 `delete`。而 `findByIdempotencyKey` 和 `computeBudget` 读同一份被裁过的列表。后果：① 记录被裁后幂等查询失效 ② **已承诺金额少算**——真金白银的账目错误。

**修法**：
- 独立 schema `muweave.idempotency.v1`（`jobs.ts:23`）
- 独立内存结构 `private readonly idempotency = new Map<string, JobRecordV1>()`（`:74`）
- 独立文件 `idempotency.v1.json`（`idempotencyFile()`，`:187-188`）
- `:257` 注释明确：「All records needed for idempotency and accounting, including display-trimmed terminal jobs」
- 索引文件读不出来时记 `jobs.idempotency_load_failed` + `IDEMPOTENCY_INDEX_UNREADABLE`（`:173`），不静默吞掉

### 3. 归因：能回答「谁派的活」

**缺陷**：`requestedBy` 只有 `'ui' | 'agent'`，`owner` 是能力所有者（eikona/scaena/…）。分不出是哪个 bot、哪个会话、哪个父任务派的。

**修法**：加可选字段（`capability-protocol.ts:139-160`）：
```ts
export interface JobRequesterRefV1 {
  botId?: string
  sessionId?: string
  taskId?: string
  parentJobId?: string
}
export interface JobRecordV1 {
  payloadDigest?: string   // Optional for pre-P0 records
  requestedBy: JobRequester
  requester?: JobRequesterRefV1
  traceId?: string
  // ...
}
```
全部可选，P0 之前落盘的记录照常读。

### 4. job 状态进 timing 投影

**缺陷**：投影只投 `this.operations`，jobs 不在里面。用户在进度条上看不到在途任务。

**修法**：job 进入同一投影（`host.ts`）：
- `spanId: span_job_${job.jobId}`
- `operationRef: job.jobId`
- `stageLabel: job.capabilityId`
- `status: job.status`
- 起止时间按 `createdAt` / `updatedAt`，未终态算到当前
- 关联 `payload.jobId → jobRef`

### 5. 结构化日志（原为 0 调用）

**缺陷**：`host.ts:77` 只声明了 `logger?(name)`，**全仓 0 处调用**。未知异常被压成 160 字 `muweave/internal_error`，没有关联 id，出错无法复盘。

**修法**：7 处真实调用：
| 位置 | 事件 |
|---|---|
| `host.ts:356` | 统一注入，带 `hostInstanceId` |
| `host.ts:671` | warn（错误路径） |
| `jobs.ts:83` | job 级通用记录 |
| `jobs.ts:173` | `jobs.idempotency_load_failed` |
| `service.ts:133` | `capability.estimate_digest_load_failed` |
| `service.ts:361,368` | `capability.error` |

约束：只记 `event` / `errorCode` / ref / 计数，**不记**原始 prompt、凭据、绝对路径、owner 原始响应。

## 实测（我独立跑的，不采信自述）

```
npx tsc -b tsconfig.json          → TC=0，错误 0 行
串行全量 --no-file-parallelism    → 32/32 文件，245/245 测试全过
```

对比基线 241 个测试，**新增 4 个**，全部覆盖本次行为：
- `replays the same idempotency key to the same job and flags a different payload`
- `rechecks the persisted digest after restart and never silently replays an old job`
- `replays same key and same estimate digest after restart`
- 以及裁剪后幂等/预算可用性的覆盖

## 一个测试环境的坑（已定性，非回归）

并发跑全量时会随机出现 1 个失败，位置在 `theater.test.tsx` 或 `kit.test.ts` 之间跳。查证：
- 孤立跑各文件全过
- 串行跑 `--no-file-parallelism` 全过

根因：多个 vitest 进程抢同一个 `localStorage` 文件。

**正确判定跑法**：
```bash
NODE_OPTIONS=--localstorage-file=temp/vitest-$(date +%H%M%S).json \
  node_modules/.bin/vitest run --no-file-parallelism
```

## 顺便修掉的一个判断错误

此前记的「`kit.test.ts` 因本机未装 `@deepseek-ai/dsh-web-app` 必红」不成立——该文件实际 3/3 通过。基线那个红是同一个 localStorage 竞争。

## 下一步

P1 起点（见设计文档第七节）：roster（1 manager + 2 worker）、`bot.delegate` / `task.*` RPC、manager session 绑定、`@bot-id` 入口。
