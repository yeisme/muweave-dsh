# F2 交付报告：旧 bundle 认领向导

> 交付日期：2026-11-20
> 依据：`project-features-next.md` 的 F2 一节
> v8 状态基线：`desk-v8-spec.md` 的结构线与功能线交付清单。
> 实施：pi（`project.claim` RPC）+ Claude（认领向导 UI），我收口验证
> 前置：F1 已交付（`cdb732c`）

## 1. 一句话结论

F2 做完了：**系统能发现「bundle 里有 projectId 但注册表没有」的 workspace，并提供两步认领向导把它登记成项目，且认领绝不改写 bundle 的 projectId。**

## 2. 后端（pi 实施）

新增 `project.claim` RPC：

| 项 | 内容 |
| --- | --- |
| 入参 | `{ workspaceId, projectId, title, status?, idempotencyKey }` |
| 返回 | `{ project, workspaceRefs, claimed: true }` |
| 语义 | 用 bundle **原有** `projectId` 在注册表登记，承认既成事实 |
| 硬约束 | **绝不改写** bundle 的 `projectId`（arch 文档原话） |
| 错误码 | `workspace_unknown` / `project_exists` / `invalid_project_title` |

实现：`ProjectStore.claim()` 复用 `create` 的校验与落盘，但显式指定 `input.id`（`create` 本就支持）。

改动量：`host.ts` +38 行、`project-store.ts` +58 行。

## 3. 前端（Claude 实施）

| 项 | 内容 |
| --- | --- |
| 待认领发现 | 遍历 `workspace.list` → 对每个调 `bundle.status` → manifest 有 `projectId` 且 `project.list` 无同 id → 待认领 |
| **懒查询** | 只在用户打开认领入口时才查，不在启动时全查（避免启动慢，已写进代码注释） |
| 向导 | 两步：① 列出待认领项（workspace 名 + projectId 截断 + 元件数）② 确认页（标题预填、状态选择、明确说明「认领只登记，不改 bundle 的 projectId」） |
| 入口 | 项目条 popover 底部「认领旧 bundle」，有 N 项时显示 N，0 项时禁用 + tooltip |
| 与 F1 衔接 | 未认领 notice 里加「认领此 bundle」按钮 → 直接进步骤 2 |
| data 钩子 | `data-claim-wizard` / `data-claim-step` / `data-claim-item` / `data-claim-submit` |

## 4. 实机验证（1440×900）

| 项 | 结果 |
| --- | --- |
| 入口 | 「认领旧 bundle **1**」——正确检出 1 个待认领项，可点击 |
| 点开后 | `wizard: true`、`step: "1"`、`items: 1` |
| 步骤 1 无提交按钮 | 正确（必须先选中才能进步骤 2） |
| 绑定检查器共存 | 正常 |
| JS 报错 | 零 |

## 5. 本轮踩的两个坑（都是我的）

### 5.1 一次测试 flake

全量跑 `pnpm test` 时 `theater.test.tsx` 挂了 1 项，但**单独跑该文件 4/4 通过**，重跑全量 **203/203 通过**。

判定：测试间干扰（jsdom 共享状态/时序），非产品缺陷。**但不能当作没发生**——记录了，若再现需要查 shared localStorage。

### 5.2 e2e 跑错目录

我把 `pnpm test:integration` 写在了 `cd ~/.dsh/profiles/...` 之后，报 `Command "test:integration" not found`。回到项目目录重跑才成功。

**教训**：串起来的命令里 `cd` 之后必须确认 pnpm 在项目根，别在 `&&` 链条里切目录后还调项目脚本。

## 6. 验收对照（F2 文档要求）

| F2 要求 | 状态 |
| --- | --- |
| 发现「manifest 有 projectId、注册表没有」的 workspace | ✅ |
| 认领后用原 projectId 登记 | ✅ |
| 认领不改写 bundle | ✅ 测试断言 bundle 内容未变 |
| 与未认领回退衔接 | ✅ notice 里直接进步骤 2 |
| 不把未知标成成功 | ✅ 认领失败停在步骤 2 并可重试 |

## 7. 验证数字

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **203/203**（28 文件，187 → 203） |
| 静态守卫 | 11/11 |
| `pnpm build` + `pack:plugins` | 通过 |
| `pnpm test:integration` | `passed=true`（`20261120032918062-muweave-dsh-61a87b97`） |

## 8. 已知未做

- **批量认领**：一次只能认领一个
- **认领后回填 owner 绑定**：认领只登记项目与 workspace，owner bindings 仍要手动加
- **F3 项目诊断**未做：需要统一状态映射表

## 9. 提交

`feat: v8 F2 旧 bundle 认领向导（pi 后端 + Claude 前端）`
