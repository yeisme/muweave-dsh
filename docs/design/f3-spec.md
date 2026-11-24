# F3 项目诊断实施规格

> 状态：✅ 已交付（54d1374）。F3 是 project-management-arch.md P2 的项目诊断部分。本文是已交付契约与交互规格。
> 标记：提交号和现有 RPC/类型是事实。新增 project.diagnose 的字段、状态映射和交互是本规格的判断。
> 实现证据：packages/dsh-muweave-core/src/host.ts、packages/dsh-muweave-workbench/src/diagnosis-panel.tsx、tests/diagnosis-panel.test.tsx、tests/project-diagnose.test.ts。

## 1. 结论

已交付只读 project.diagnose RPC，由 host 聚合注册表、bundle、owner readiness、revision 和 operation ledger 的安全投影。前端只负责展示和发起明确的下一步动作，不凭 HTTP 200、ok=true、旧缓存或“请求已发出”推断健康。未知状态必须保持 unknown，不能标成成功。

## 2. 五类异常状态映射

| 异常 | 检测方式 | 显示什么 | 下一步可点动作 | 建议状态 |
| --- | --- | --- | --- | --- |
| 注册表损坏 | 读取 ProjectStore 的安全损坏标记。当前 store 在注册表无效时隔离原文件并设置 corruptFile。诊断 RPC 只返回布尔值和稳定 code，不返回路径 | “项目注册表无法读取”。受影响项目数显示“未知”，不显示绝对路径 | “重新诊断”调用 project.diagnose。首版不提供覆盖、删除备份或自动修复 | corrupt，nextAction=inspect |
| bundle 缺失 | 调 bundle.status。initialized=false 或项目 workspace 没有可读 bundle 时触发 | workspace label、项目标题、bundle 缺失，元件数为“未知” | “同步 bundle”调用 bundle.sync({ workspaceId })，之后重新调 bundle.status 和诊断 | missing，nextAction=sync_bundle |
| owner unavailable | 读取 bundle.status 的 owner 状态和项目 ownerBindings[].bindingState。owner marker 缺失或状态为 unavailable 时触发 | owner、workspace、ref、原因。若存在 operationRef，同时显示它 | 无 operationRef 时“重新读取 owner 状态”。有 operationRef 时“核对原操作”，只调 operation.reconcile({ operationRef }) | unavailable，nextAction=retry_owner_read 或 reconcile_original |
| revision conflict | 读取绑定/认领返回的 muweave/bundle_revision_conflict，或比较 expected revision 与最新 bundle.status.index.revision | expected revision、current revision、受影响 owner/ref | “重新读取 revision”只调 bundle.status。用户明确确认后才再次提交 project.bind 或 project.claim | conflict，nextAction=reload_revision |
| unknown operation | 读取错误 envelope 的 operationRef，或 operation ledger 的 unknown / reconcile_required。现有类型事实见 protocol.ts | “操作结果未知”、action、operationRef、最近更新时间。不显示成功或失败 | “核对原操作”调用 operation.reconcile({ operationRef })。未得到明确回执前保持 unknown | unknown，nextAction=reconcile_original |

健康状态只能在诊断明确观察到 registry、bundle、owner、revision 均可读且没有 pending unknown 时返回 healthy。未知不能标成成功。

## 3. 数据契约

### 3.1 建议新增只读 RPC

请求：project.diagnose({ projectId, includeArchived? })。响应建议为 `{ projectId, capturedAt, overallState, diagnostics[] }`。

每条 diagnostics 只包含安全字段：`{ diagnosticId, state, code, message, workspaceId?, workspaceLabel?, owner?, ref?, operationRef?, expectedRevision?, currentRevision?, nextAction, observedAt }`。

固定 state：healthy、corrupt、missing、unavailable、conflict、unknown。固定 nextAction：none、inspect、sync_bundle、retry_owner_read、reload_revision、reconcile_original。

- host 负责读取和聚合，沿用已有 workspace.list、bundle.status、project.list、operation.reconcile 的边界。
- 不返回绝对路径、owner 私有数据库、provider payload、原始 prompt、cookie、凭据或完整错误堆栈。
- project.diagnose 只读，不写 registry、bundle、owner 或 schedule。bundle.sync、project.bind、project.claim 等写动作只由用户点击对应动作后触发。

### 3.2 纯前端聚合的边界判断

纯前端聚合可以复用已读到的结果，但无法可靠观察注册表损坏的隔离标记、跨请求 revision 时序和 operation ledger 的未知状态。因此本规格判断应新增只读 RPC，前端只做安全投影和动作编排。

## 4. 交互契约

1. 打开项目检查器或点击“诊断”后调用 project.diagnose。
2. 顶部显示 overallState。只要任一条为 unknown，整体至少显示“需核对”，不能显示“全部正常”。
3. 每张异常卡同时展示状态文字、稳定 code、受影响范围、观察时间和 nextAction 按钮。颜色只作辅助。
4. “同步 bundle”只针对 missing 卡调用 bundle.sync，完成后重新诊断。仍未 initialized 时不得显示 healthy。
5. “重新读取 revision”只读 bundle.status，不覆盖用户输入，也不自动提交写操作。
6. “核对原操作”只调用原 operationRef。返回 unknown 或 reconcile_required 时卡片仍为 unknown。
7. 注册表损坏只允许重新诊断或查看安全摘要。不能提供覆盖 corrupt 文件、删除备份或重建私有目录的按钮。
8. 切换项目后清空旧卡片并按新 projectId 重新诊断。

## 5. 验收标准（可机器验证）

- 五个 fixture 分别只注入一种异常。每个 fixture 的 project.diagnose 返回稳定 code/state/nextAction，DOM 产生 data-diagnostic-state 与状态文字。
- 注册表损坏响应为 state=corrupt，不含绝对路径，不出现“成功”或“已修复”。
- bundle 缺失点击动作只产生 bundle.sync，随后重新读 bundle.status。仍为 initialized=false 时不得变为 healthy。
- owner unavailable 显示 owner/ref。有 operationRef 时按钮调用 operation.reconcile，没有时不调用 reconcile。
- revision conflict 显示 expected/current 两个 revision。未获用户确认前不得调用覆盖式写操作。
- unknown 初始状态严格为 unknown，operationRef 可见，不得映射为 completed、failed 或 healthy。reconcile 再次返回 unknown 时仍为 unknown。
- reconcile 返回明确 completed、failed 或 cancelled 后，诊断才可进入相应明确终态。点击动作本身不能让卡片变绿。
- 项目切换后旧诊断卡从 DOM 移除，新 projectId 的 project.diagnose 请求可被测试桩观察到。

## 6. 不做

- 不把未知映射为成功或失败。
- 不用前端 HTTP 状态、缓存或请求发起作为健康证明。
- 不自动重试未知写操作，不自动覆盖 revision。
- 不修改 bundle projectId，不删除 owner 原件，不读 owner 私有数据库。
- 不在 F3 中实现注册表迁移报告。schedule v2 已由 fadbe67 交付，仍与 registry migration report 保持独立边界。
