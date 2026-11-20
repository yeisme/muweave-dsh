# F1 交付报告：绑定维护与派生分组

> 交付日期：2026-11-20
> 依据：`project-features-next.md` 的 F1 一节
> v8 状态基线：`desk-v8-spec.md` 的结构线与功能线交付清单。
> 实施：pi（后端合同）+ Claude（前端检查器与分组），我收口验证
> 提交：见文末

## 1. 一句话结论

F1 做完了：**能在项目条里维护 owner 绑定，也能按场次/角色/状态/素材四种维度分组看元件**，且分组是纯前端派生、不触发任何写 RPC。

## 2. 后端（pi 实施）

| 改动 | 文件 | 说明 |
| --- | --- | --- |
| `project.bind` 增 `expectedRevision` | `project-store.ts` | 与 `lastObservedRevisions[workspaceId/owner]` 比对，不符返回 `muweave/revision_conflict`（带 `expected`/`actual`） |
| `project.bind` 增 workspace 注册校验 | `project-store.ts` + `host.ts` | host 传 `workspaceRegistered: this.workspaces.has(id)`；未注册返回 `muweave/workspace_unknown` |
| `project.unbind` 返回 `{ project, removed }` | `project-store.ts` | `removed=false` 表示原本就没有（幂等，不报错） |
| 错误码统一 | `project-store.ts` + `host.ts` | `revision_conflict` / `workspace_unknown` / `project_archived` / `invalid_owner_ref` |

**设计上做对的一点**：`workspaceRegistered` 由 host 层判断后传入，store 自己不查注册表——保持了存储层的纯粹（store 只知道文件，不知道 workspace 生命周期）。

## 3. 前端（Claude 实施）

| 改动 | 文件 | 说明 |
| --- | --- | --- |
| 绑定检查器 | 新建 `binding-inspector.tsx` | 位置：项目条 popover 内「绑定」区；每行 owner 徽章 + workspace + refs + 状态胶囊 |
| 替换 ref | 同上 | 输入框 + 确认，走 `project.bind`（带非空幂等 key） |
| 解绑 | 同上 | 二次确认后走 `project.unbind`，只删注册表记录 |
| revision 冲突处理 | 同上 | 保留用户输入 + 显示「重新读取并重试」 |
| 四种派生分组 | `stage-map.ts` 加 `groupElements()` | scene / character / status / media，纯函数 |
| 分组切换 UI | `client.tsx` | 「全部」视图顶部 Segmented：不分组 / 场次 / 角色 / 状态 / 素材 |

## 4. 实机验证（1440×900）

| 项 | 结果 |
| --- | --- |
| 绑定检查器容器 | `[data-binding-inspector]` 存在 |
| 空态 | 显示「这个项目还没有绑定 owner」（当前两个项目的 `ownerBindings` 都是空，行为正确） |
| 分组控件 | 五个按钮齐全：`None / Scene / Character / Status / Media` |
| 分组位置 | 仅在「全部」视图（「按阶段」视图用自己的三级密度布局，不叠加分组） |
| JS 报错 | 零 |

## 5. 我修的两个问题（都是测试层，不是产品层）

### 5.1 旧 bind 测试被契约收紧打断

pi 给 `bind` 加了 `workspace_unknown` 校验后，我此前写的两个测试用虚构 id（`ws_alpha`/`ws_a`）调用 bind，直接失败。

**这是契约收紧的正确结果**，修法是让测试先注册一个真实 workspace，而不是放宽断言。期间还踩了两步：
1. `workspace.register` 会 `realpathSync` 校验真实路径 → 测试必须先 `mkdir`
2. 返回字段是 `workspace.workspaceId`，不是 `workspace.id` —— 我一度写成 `.id` 拿到 `undefined`，误判成「产品代码有 bug」，实为我测试代码写错

### 5.2 教训

**探测产品代码时，字段名要照类型定义写，不要凭印象。** 我为此多花了两轮。

## 6. 验收对照（F1 文档要求）

| F1 要求的验收 | 状态 |
| --- | --- |
| 分组切换不改变 bundle revision | ✅ 纯前端派生；测试断言切分组后 RPC 调用数不变 |
| 解绑不删除 owner 原件 | ✅ 只删注册表 binding 记录 |
| revision 冲突给出可执行提示 | ✅ 保留输入 + 「重新读取并重试」 |
| 绑定写入走 project.bind/unbind | ✅ |
| 未注册 workspace 被拒 | ✅ `muweave/workspace_unknown` |

## 7. 验证数字

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **187/187**（26 文件，170 → 187） |
| 静态守卫 | 11/11 |
| `pnpm build` + `pack:plugins` | 通过 |
| `pnpm test:integration` | `passed=true`（`20261120024206369-muweave-dsh-f2c857b3`） |

## 8. 已知未做

- **单条 ref 移除**：解绑只能整行移除（会列出数量），没做单个 ref 的删除
- **Pi/DSH 工件 tab 无分组**：分组只在「全部」视图
- **检查器位置**：按我的指示放在项目条 popover；F1 文档原本建议放 Workbench 检查器或独立 tab。当前实现更贴近「项目上下文」的心智，但项目多时 popover 会变长
- **认领向导（F2）未做**：需要新增 `project.claim` RPC，是下一步

## 9. 提交

见 `git log`：`feat: v8 F1 绑定检查器 + 四种派生分组（pi 后端 + Claude 前端）`
