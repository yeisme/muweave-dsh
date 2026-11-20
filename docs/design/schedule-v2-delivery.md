# Schedule v2 交付报告：排期项目维度

> 交付日期：2026-11-20
> 依据：`project-management-arch.md`「与排期板 schedule.v1.json 的关系」
> 实施：pi（schema + 迁移）+ Claude（前端归属判定），我收口验证
> 前置：F1/F2/F3 已交付，tag `v0.2.0-v8`

## 1. 一句话结论

修掉了最后一个会让用户困惑的问题：**切项目时排期不再串线**——因为排期条目现在能明确记住自己属于哪个项目，不再靠猜。

## 2. 修的是什么（问题定义）

`ScheduleEntryV1` 原本只有 `ref / label / kind / date / note / updatedAt`，**没有 `projectId`**。

于是前端只能靠两种方式猜归属：
- `ref` 里恰好带 `proj_x:` 前缀
- 条目的 workspaceId 命中项目的 `workspaceRefs`

猜不中的一律归 `unknown`。切项目时，两个项目绑同一 workspace 就会互相看到对方的排期——这就是「串线」。

## 3. 后端（pi）

| 改动 | 说明 |
| --- | --- |
| `ScheduleEntryV1` 加 `projectId?: string` | **可选字段**，v1 兼容扩展 |
| `ScheduleBoardV1` 不加版本号 | 可选字段本身就是 v1 的兼容扩展，加 `schemaVersion: 2` 反而制造迁移负担（注释写明这个决定） |
| `schedule.plan` 接受可选 `projectId` | 给了就存；**没给就留空，不猜** |
| 存量条目 | 原样保留，**绝不补值**；`list()` 额外返回派生字段 `legacy: true`（不落盘） |
| 校验 | `projectId` 必须 `proj_` 前缀 + 安全字符，否则 `muweave/invalid_schedule_entry` |

## 4. 前端（Claude）

**判定优先级**（核心改动，写进函数注释）：

1. 条目有 `projectId` → 直接按它比，`basis: 'explicit'`（**不再猜**）
2. 无 `projectId` 但有 `legacy` → 若 ref 前缀能明确匹配，`basis: 'inferred'` 并**标注「由 ref 推断」**；否则 `unknown`
3. 完全没信息 → `unknown`

**UI 区分三态**：
- `explicit`：正常显示
- `inferred`：极轻标记（`--mw-label-3` 小字「推断」），**不用警告色**——推断不是错误
- `unknown`：保留「归属未知，可能属于其它项目」说明

**新建排期带 projectId**：从待排池拖到日历、点选日期排期时，有当前项目就传。

**不做批量补**：存量 `legacy` 条目只提示「N 条是加项目维度之前排的」，**不提供「自动补项目」**——猜归属正是要避免的。

## 5. 实机验证（1440×900）

| 项 | 结果 |
| --- | --- |
| 排期房间 | 正常，项目条显示当前项目 |
| 待排池 | 9 条 |
| 排期 chip | 1 个 |
| `inferred` 标记数 | 0（正确：现存条目 ref 能明确归属当前项目，不需要推断） |
| legacy 提示 | 无（正确：没有 legacy 条目） |
| JS 报错 | 零 |

## 6. 顺手修的一个仓库污染

pi 在仓库里创建了 `.pi/`（agent-memory、subagent-runs，644K）——这是 pi 的运行时状态，不该进仓库。已加进 `.gitignore`。

## 7. 验证数字

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **239/239**（32 文件，221 → 239） |
| 静态守卫 | 11/11 |
| `pnpm build` + `pack:plugins` | 通过 |
| `pnpm test:integration` | `passed=true`（`20261120052014810-muweave-dsh-dc5a5e4d`） |

## 8. 已知未做

- **legacy 条目补项目**：只提示不补（有意）
- **跨项目排期视图**：现在只能看当前项目；「全部项目排期」没做
- **排期与项目的双向导航**：从排期条目跳回项目没做

## 9. 提交

`feat: schedule v2 排期项目维度（pi 后端 + Claude 前端）+ 忽略 .pi 运行时目录`
