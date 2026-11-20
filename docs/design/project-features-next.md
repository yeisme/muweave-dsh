# MuWeave 项目功能下一步设计

> 状态横幅：F1 ✅ 已交付（cdb732c） · F2 ✅ 已交付（866ec4d） · F3 ⬜ 待做。

> 范围：F1 绑定维护与派生分组、F2 旧 bundle 认领向导、F3 项目诊断。
> 本文保留 F1/F2 的设计依据，并作为 F3 的实施设计，不把未提交工作树变更视为交付。
> 标记约定：**文档已有事实**来自当前架构/spec/实现，**我的判断**是本设计新增的选择。

## 一页结论

| 功能 | 结论 | 现在做的原因 | 依赖 |
| --- | --- | --- | --- |
| F1 绑定维护与派生分组 | 在 Workbench 的“绑定”检查器维护 owner ref，并在“元件”区用当前 bundle 元素摘要做四种本地分组。分组只改变视图，绑定写入走 project.bind/unbind。 | P1-1 已有 RPC 和 ProjectOwnerBindingV1 数据边界，但没有可见的维护入口，也没有分组控件。 | 现有 project.bind/unbind、bundle.status、bundle.elements.list，以及后端补齐 bundle 合同调用和 revision 校验。 |
| F2 旧 bundle 认领向导 | 从 bundle.status 发现“manifest 有 projectId、注册表没有同 ID 项目”的 workspace，要求用户确认后用原 projectId 登记，认领过程不改写 bundle。 | 当前只有 projectUnclaimed 的工作区回退 notice，用户无法把旧 bundle 安全登记到项目注册表。 | workspace.list、bundle.status、显式 project.claim RPC、项目列表与回退显示的区分。 |
| F3 项目诊断 | 提供只读 project.diagnose，把注册表损坏、bundle 缺失、owner unavailable、revision conflict、unknown operation 映射成可见状态和下一步。 | P2 要求异常有下一步，当前错误主要是瞬时 notice，缺少稳定状态映射。 | project.list/bundle.status、owner readiness、operation.reconcile、错误 envelope 的 operationRef。 |

## F1：绑定维护与派生分组（P1-1）

### 用户故事

作为项目负责人，我想在当前项目的绑定检查器中看到每个 workspace/owner 的 ref、最近观察状态和 bundle revision，并能替换或解除一个 ref；我还想按场次、角色、状态或素材类型查看元件，而不让一次视图切换产生新的 bundle 版本。

### 现状 → 缺什么 → 怎么补

**文档已有事实**

- 项目注册表持久化 workspaceRefs 和 ownerBindings。每条 ProjectOwnerBindingV1 有 workspaceId、owner、refs、bindingState、updatedAt。
- bundle.v1.json 和 index.v1.json 以 projectId、revision 为连接键。元素摘要已有 sceneRef、characterRefs、role、status、kind、sourceOwner、updatedAt、elementId。
- project.bind、project.unbind 已在 RPC allowlist 和 ProjectStore 中存在。当前 host dispatch 直接调用 ProjectStore.bind/unbind，尚未在该分支中串接架构文档要求的 bundle/owner 合同。
- project-panel.tsx 目前只有项目列表、新建、复制、归档/恢复和初始 owner ref 输入。client.tsx 只有 bundle.bind 的通用绑定表单。

**缺什么**

1. 右侧项目检查器没有绑定清单、状态说明、替换和解除操作。
2. project.bind 的 UI 没有显示或提交 expectedBundleRevision，revision 冲突无法指导用户重载后重试。
3. 元件工作区没有分组/排序状态，当前 domainFilter 只负责过滤。
4. 需要把“注册表意图变化”和“bundle 物化变化”显示为两个可观察步骤，避免 UI 把只写 registry 当成 owner 绑定成功。

**怎么补**

**我的判断**

- 派生分组必须是**纯前端派生**，不写 registry，不写 .muweave/index.v1.json，不增加 bundle revision。理由是架构已经把场次、角色、状态、素材类型列为“不落盘的派生视图字段”，且 index 元件摘要是唯一读取源。
- 绑定替换才是写操作。替换按“精确移除旧 ref → 以新 ref 提交一次绑定意图/物化绑定”的用户动作实现，服务端使用一个新的幂等 key；不把多个 ref 的隐式合并交给前端。
- 绑定面板放在 Workbench 的页内“绑定”tab/右侧检查器。项目条继续只做当前项目切换，不在项目条再造一套绑定面板。

### 交互流程

1. 用户在当前项目打开“绑定”检查器。界面先调用 project.list 获取项目记录，再按 workspaceRefs 调用 bundle.status。
2. 每个 workspace 显示 bundle 是否已初始化、manifest/index 的 projectId、当前 revision、最近读取时间。每个 owner 行显示 owner 名、ref 列表、bindingState、updatedAt。状态同时显示文字和图形标记。
3. 用户点击某个 ref 的“替换”。表单预填旧 ref，选择 allowlisted owner 类型和新 opaque ref。提交前显示 workspace、owner、旧 ref、新 ref、当前 revision。
4. 提交 project.bind，payload 至少包含 { projectId, workspaceId, owner, refs: [newRef], expectedBundleRevision, idempotencyKey }。服务端先确认 workspace、owner marker、ref 形状、projectId 和 revision，再调用现有 bundle/owner 合同。
5. 成功响应必须带最新 binding 和观察到的 manifest/revision。UI 刷新 project.list、bundle.status、bundle.elements.list，再显示成功回执。
6. 用户点击“解除”。若未指定单个 ref，先显示将移除的 refs 列表和“不会删除 owner 原件”的确认。提交 project.unbind，携带 { projectId, workspaceId, owner, refs?: [targetRef], idempotencyKey }。
7. 解除成功只移除 bundle 的对应绑定意图/物化绑定，不调用 owner 删除命令。若仍有其他 ref，保留该 owner 行；全部解除时显示 unavailable/“未绑定”这一事实状态，不把 owner 原件标成删除。
8. 若返回 muweave/bundle_revision_conflict，保留表单输入，显示 expected/current revision，并提供“重新读取并重试”按钮。按钮只重新读 bundle.status，用户再次提交前不自动覆盖。
9. 元件区提供“分组”下拉：无、场次、角色、状态、素材类型；“排序”下拉：最近更新、状态优先、标题。改变控件只重新运行本地派生函数，不发写 RPC。
10. 分组键规则固定且可测试：场次取 sceneRef，空值为“未分场”；角色取 role，空值为“未设角色”；状态取 status，空值为“未知状态”；素材类型取 kind，空值为“未知类型”。一个元素的 characterRefs 不展开成多个角色组，避免一行重复计数。
11. 组内排序先按所选排序键，再以 elementId 升序稳定打破平局。空分组永远排在有值分组后面。

### 数据来源与未来改动点

| 目的 | 数据来源 | 未来实现落点 |
| --- | --- | --- |
| 当前项目与绑定意图 | project.list → projects[].id/title/workspaceRefs/ownerBindings/updatedAt | packages/dsh-muweave-workbench/src/project-panel.tsx、client.tsx |
| bundle 健康与 revision | bundle.status → initialized、index.projectId、index.revision、index.ownerStates | packages/dsh-muweave-core/src/host.ts 的 bundle status 投影与 Workbench 检查器 |
| 替换/解除 | project.bind、project.unbind，按架构契约带 expectedBundleRevision、idempotencyKey | packages/dsh-muweave-core/src/protocol.ts、host.ts、project-store.ts、Workbench UI |
| 元件摘要 | bundle.elements.list → elements[] 和 revision | packages/dsh-muweave-workbench/src/client.tsx 的 useMemo 派生函数及其纯函数单测 |
| owner 原件 | owner 官方合同通过 allowlisted host 调用 | packages/dsh-muweave-core/src/host.ts，不得直接读 owner 私有目录 |

### 验收标准（可机器验证）

- 渲染一个项目含两个 owner binding 的 fixture，DOM 中存在 data-binding-inspector，每行包含 workspaceId、owner、ref 和 bindingState 的文字值。
- 替换动作的 RPC 记录严格包含 project.bind、expectedBundleRevision 和非空 idempotencyKey。成功后再次 bundle.status 的 revision 只能按 bundle 合同返回，不能由前端自行递增。
- 解除动作的 RPC 记录包含 project.unbind，owner 删除命令调用次数为 0，且返回的 binding refs 不再包含目标 ref。
- 对同一元素列表依次切换四种分组和三种排序，project.list、project.bind、project.unbind、bundle.bind、bundle.sync 调用次数均不增加，快照中的 bundle revision 不变，元素集合和元素顺序符合稳定排序规则。
- 组键为空值时快照出现“未分场”“未设角色”“未知状态”或“未知类型”，并且空值组排在非空组之后。
- 用旧 revision 提交绑定时，响应 ok=false 且 error.code=muweave/bundle_revision_conflict，界面存在“重新读取并重试”操作；不得显示成功 toast。
- 用相同幂等 key 和相同 request digest 重放替换操作只产生一次物化写入；相同 key 配不同 digest 显示 muweave/idempotency_conflict。

### 风险

- 当前 host 的 project.bind/unbind dispatch 与架构要求存在实现落差。若先做 UI，可能出现注册表显示 bound 但 bundle 未更新。实施时必须先补齐 host 的 allowlisted 合同调用和未知回执保留。
- 一个 workspace 可能出现同一 projectId 的多份 bundle。检查器必须把 workspace 维度保留在每行，不能按 projectId 自动合并。
- 元件字段来自不同 owner，role 或 sceneRef 为空是正常情况。空值分组和稳定排序必须固定，否则用户每次刷新都会看到跳动。

## F2：旧 bundle 认领向导（已交付，P1-2）

### 用户故事

作为打开旧工作区的用户，我想确认这个已有 bundle 应登记到哪个项目，并保留它原来的 projectId、revision 和内容；确认前我可以查看冲突，确认后项目列表和元件过滤应与 bundle 对齐。

### 现状 → 缺什么 → 怎么补

**文档已有事实**

- 架构规定先枚举 workspace.list，再读 bundle.status。没有 bundle 的 workspace 不自动创建项目。
- 有效 manifest projectId 可生成待认领候选。相同 projectId 出现在多个 workspace 时必须保留候选并标记 conflict，禁止自动合并。确认后写注册表，不能修改既有 bundle projectId。
- bundle manifest 的 projectId、title、revision 是必填且会被 consumer 校验。
- 当前 client.tsx 的 projectUnclaimed 只在已选项目没有自己的元素、但工作区回退列表有元素时显示 notice。它不是“未注册 bundle 认领”状态。

**缺什么**

1. 没有“bundle 有效但注册表没有同 ID 项目”的触发器和候选列表。
2. 没有显示 manifest projectId/title/revision 的确认页。
3. 没有处理同 projectId 多 workspace 冲突的明确选择。
4. 没有落实“不能静默重写 projectId”的交互边界。

**怎么补**

**我的判断**

- 新增显式只读发现加写入确认的 project.claim RPC，比让 project.create 隐式接受旧 ID 更清楚。核心不变量是 claimedProject.id === bundleManifest.projectId。
- 向导不提供“改成新 projectId 后继续”的按钮。若用户希望另一个 ID，必须离开认领流程，走新的 bundle/项目创建或受控迁移流程；本向导不修改 manifest。
- 认领默认采用 manifest title 作为建议值，允许用户先编辑注册表项目标题。标题编辑不改写 bundle manifest title。

### 触发条件

对每个 workspace.list 返回的 workspace：

1. bundle.status 返回 initialized=true，且 index.projectId/manifest projectId 是有效安全 ref。
2. project.list(includeArchived=true) 中不存在同 ID 项目。
3. 该 workspace 没有 bundle 读取错误。读取错误进入 F3 诊断，不进入认领。

满足三项时在项目条下显示持久 notice“发现未登记的 bundle”，并提供“查看认领”按钮。若同一 projectId 对应多个 workspace，候选卡显示“多 workspace 冲突”，默认不选中任何一个。

### 交互流程

1. 用户点击“查看认领”。向导列出候选 workspace，卡片显示 opaque workspaceId、workspace label、manifest projectId、manifest title、manifest revision、bundle updatedAt 和元素数量。界面不显示绝对路径。
2. 用户选择一个候选。若同一 projectId 有多个 workspace，必须逐个选择或取消；向导明确“不会自动合并”。
3. 用户确认项目标题。默认值是 manifest title，可改为 1–120 字符的注册表标题。此字段只写项目注册表。
4. 确认页显示固定不变的“bundle projectId”和可编辑的“注册表项目标题”，并用醒目文字说明：
   - 将登记项目 ID 设置为 bundle 的原 projectId。
   - 不会改写 .muweave/bundle.v1.json.projectId。
   - 不会复制或删除 owner 原件、元素 payload 或排期。
5. 用户提交 project.claim，payload 为 { workspaceId, projectId: manifest.projectId, title, expectedBundleRevision: manifest.revision, idempotencyKey }。服务端重新读取 manifest/status，校验 revision 未变，再以该 ID 写入注册表。
6. 成功后调用 project.activate，再调用 bundle.elements.list({ workspaceId, projectId })。只有返回的 projectId 与新项目 ID 相等时，才结束回退显示。
7. 若 revision 在确认期间变化，返回 muweave/bundle_revision_conflict，向导停在确认页，提供“重新读取”并重新展示 title/revision。
8. 若已有注册表项目占用该 ID，返回 muweave/project_exists 或稳定的 muweave/project_claim_conflict，向导显示该项目摘要和 workspace 列表，不创建第二条记录。
9. 若用户取消，旧 bundle 保持可读。当前项目若没有自己的元素，继续使用现有整个工作区回退 notice，并把“认领”作为入口；新建项目为空元件时仍显示现有“项目没有自己的元件”提示，两种 notice 必须用不同的状态标识。

### 数据来源与未来改动点

| 目的 | 数据来源 | 未来实现落点 |
| --- | --- | --- |
| 候选发现 | workspace.list → workspaces[].workspaceId/label/hasBundle；逐个 bundle.status → initialized/index.projectId/index.title/index.revision/index.counts | packages/dsh-muweave-workbench/src/project-panel.tsx 或独立向导组件；host 只返回安全投影 |
| 已登记项目比对 | project.list({ includeArchived: true }) → projects[].id/title/workspaceRefs | project-panel.tsx 的候选计算 |
| 确认认领 | 新增 project.claim RPC，返回 { project, workspaceId, bundleProjectId, revision } | packages/dsh-muweave-core/src/protocol.ts allowlist、project-store.ts claim 方法、host.ts 读后校验与原子写入 |
| 认领后元件过滤 | bundle.elements.list({ workspaceId, projectId }) → projectId/elements/revision | packages/dsh-muweave-workbench/src/client.tsx |
| 回退衔接 | 现有 projectUnclaimed notice 与新增 bundleUnregistered 状态分开 | client.tsx 的 notice 投影和 E2E fixture |

### 验收标准（可机器验证）

- fixture 含一个 manifest projectId=proj_old、无对应 registry 项目。打开 Workbench 必须出现 data-bundle-unregistered=true 和“查看认领”，不能自动发 project.claim。
- project.claim 仅接受 payload.projectId === bundle.status.index.projectId。故意提交不同 ID 时返回 muweave/project_id_conflict，并验证 manifest 文件内容和 revision 未变化。
- 成功认领后 project.list 存在 id=proj_old，bundle.status 仍返回 projectId=proj_old 和原 revision，且调用顺序包含 project.claim → project.activate → bundle.elements.list。
- 两个 workspace 使用同一 projectId 时，DOM 显示 conflict，自动调用 project.claim 次数为 0；用户明确选择一个 workspace 后才允许提交。
- 认领确认页中同时存在固定 bundle projectId 和注册表标题输入，且存在“不改写 bundle projectId”的文案。自动化点击“编辑标题”不能改变固定 ID 字段。
- 在确认期间把 bundle revision 提高后提交，响应为 ok=false、error.code=muweave/bundle_revision_conflict，界面仍停在向导，不能显示认领成功。
- 取消认领后原有 workspace 元件仍可读；新建空项目的 fallback notice 不出现“认领”错误文案，未登记旧 bundle 的 notice 不冒充项目空态。

### 风险

- 当前 ProjectStore.create 虽有可选 id 参数，但 host 的 project.create dispatch 没有透传它。project.claim 应使用专用方法，避免普通新建项目意外占用旧 bundle ID。
- 认领是注册表写入与 bundle 读校验的跨对象流程，不能假设两者同事务。写入前必须以 expectedBundleRevision 做最后一次检查；未知结果必须保留 operation/ref 或标成待诊断，不可自动重试创建。
- 多 workspace 同 ID 可能代表复制或冲突。首版只允许用户明确选择 workspace，不能自动合并绑定、元素或排期。

## F3：项目诊断（P2）

### 用户故事

作为项目负责人，我想在项目检查器看到当前异常的准确状态和下一步操作，尤其在操作超时或 owner 不可用时，我需要知道系统仍然未知，而不是看到一个误导性的成功状态。

### 现状 → 缺什么 → 怎么补

**文档已有事实**

- 架构列出五类异常：注册表损坏、bundle 缺失、owner unavailable、revision conflict、未知 operation。
- ProjectStore 在注册表损坏时会把原文件改名为带时间戳的 .corrupt-* 文件并以空注册表启动，但 project.list 当前只返回普通 registry 结构，未公开 diagnostics 字段。
- bundle.status 能区分 initialized=false 和读取 manifest/index 后的初始化 bundle。
- RPC 错误 envelope 可带 code、retryable、operationRef。operation.reconcile 是未知 owner/CLI 操作的既有入口。
- TimingSpanStatus 明确包含 unknown 和 reconcile_required，架构要求未知/超时不能重试创建动作。

**缺什么**

1. 缺少统一诊断入口和稳定的状态/下一步映射。
2. registry 损坏、bundle 缺失和 owner unavailable 目前无法在同一检查器中比较。
3. revision conflict 只有错误消息，没有 expected/current revision 和重试路径。
4. unknown operation 可能被通用错误 toast 覆盖，用户看不到 operationRef 和 reconcile 入口。

**我的判断**

**怎么补**
- 新增只读 project.diagnose RPC，返回 ProjectDiagnosticV1[]。project.list 可继续附带轻量 diagnostics 摘要，但检查器以 project.diagnose 为详细来源。
- 诊断状态使用固定枚举，UI 不根据 HTTP 200 或 ok=true 推断成功。只有明确的健康观察才是 healthy；unknown 永远映射为“未知/需核对”。
- 每条诊断必须同时有机器字段 code/state/nextAction 和用户可读的 message。没有可安全执行的修复时，nextAction=inspect，不伪造“修复完成”。

### 具体状态映射表

| 异常 | 触发证据 | state | 显示什么 | 下一步 nextAction | 可调用 RPC/动作 |
| --- | --- | --- | --- | --- | --- |
| 注册表损坏 | ProjectStore.corruptFile 有值，或 project.list 返回 muweave/project_registry_corrupt | corrupt | “项目注册表无法读取”；显示受影响项目数为未知，不显示宿主绝对路径 | inspect | 重新调用 project.diagnose；保留 .corrupt-* 供管理员处理。首版不提供自动覆盖/删除按钮 |
| bundle 缺失 | bundle.status.initialized=false，或项目 workspace 无可读 bundle | missing | workspace label、项目标题、bundle 缺失；元件数显示“未知” | sync_bundle | 用户点击后调用 bundle.sync({ workspaceId })；随后重新调用 bundle.status。只有 status 变为 initialized 才能显示健康 |
| owner unavailable | ownerBindings[].bindingState=unavailable，owner readiness 不可用，或 owner marker 缺失 | unavailable | owner、workspace、ref、原因；若有 operationRef 一并显示 | retry_owner_read 或 reconcile_original | 无 operationRef 时重读 bundle.status/官方只读 owner projection；有 operationRef 时只能调用 operation.reconcile({ operationRef }) |
| revision conflict | muweave/bundle_revision_conflict，或 expected revision 与最新 bundle.status.index.revision 不一致 | conflict | expected revision、current revision、受影响 owner/ref | reload_revision | 调用 bundle.status，用户确认后再次 project.bind/project.claim；不自动覆盖 |
| unknown operation | 响应 error.operationRef，或 timing status 为 unknown/reconcile_required | unknown | “操作结果未知”；显示 action、operationRef、最近更新时间；不显示成功/失败 | reconcile_original | 调用 operation.reconcile 查询原始 operationRef；在得到明确 completed/failed 前保持 unknown |

state=healthy 只允许在 project.diagnose 明确观察到 registry、bundle、owner 和 revision 均可读且无 pending unknown 时使用。HTTP 200、RpcEnvelope.ok=true、存在旧缓存或 UI 已发起请求都不能单独产生 healthy。

### 交互流程

1. 打开项目检查器或点击“诊断”。调用 project.diagnose({ projectId, includeArchived: true })。
2. 顶部显示总状态。若有 unknown，总状态至少为“需核对”；不能因为同时存在一条 healthy 而显示“全部正常”。
3. 每条诊断卡显示状态文字、代码、workspace/owner/ref 范围、观察时间、revision 对比和下一步按钮。状态颜色只作辅助，文字和图形标识同时存在。
4. 点击“同步 bundle”只针对 missing 卡调用 bundle.sync，完成后重新诊断。同步失败保留原异常并显示 RPC error code。
5. 点击“重新读取 revision”只做 bundle.status 读操作，将新 revision 放入冲突卡，等待用户再次提交。
6. 点击“核对原操作”调用 operation.reconcile 原始 ref。返回 completed、failed、cancelled 等明确状态后更新卡片；返回 unknown/reconcile_required 继续保持 unknown。
7. 注册表损坏卡只提供重新读取/导出诊断信息，不提供覆盖损坏文件或删除备份的 UI。
8. 项目切换或 workspace 变更后清空旧诊断，重新按当前 projectId 查询，避免把旧项目异常投影到新项目。

### 数据来源与未来改动点

| 目的 | 数据来源 | 未来实现落点 |
| --- | --- | --- |
| 诊断读取 | 新增 project.diagnose → diagnostics[] | packages/dsh-muweave-core/src/protocol.ts、host.ts、Workbench 检查器 |
| registry 损坏 | ProjectStore.corruptFile 的安全布尔/代码投影，不返回路径 | packages/dsh-muweave-core/src/project-store.ts、host.ts |
| bundle 缺失/当前 revision | bundle.status → initialized/index.projectId/index.revision | host.ts 与诊断聚合函数 |
| owner 状态 | bundle.status.index.ownerStates 与 ProjectOwnerBindingV1.bindingState | project.diagnose 聚合逻辑 |
| conflict | project.bind/project.claim 的 muweave/bundle_revision_conflict，或重新读取的 revision | host error projection、Workbench action button |
| unknown | RpcErrorShape.operationRef、TimingSpanStatus、operation.reconcile | protocol.ts 类型、诊断卡、reconcile 流程 |

### 验收标准（可机器验证）

- 五个 fixture 分别只注入一种异常。每个 fixture 的 project.diagnose 返回稳定 code/state/nextAction，并在 DOM 产生 data-diagnostic-state 与对应状态文字。
- registry 损坏 fixture 的响应包含 state=corrupt，不包含绝对路径，且不存在“成功/已修复”文案。
- bundle 缺失 fixture 点击下一步只产生 bundle.sync，随后重新读 bundle.status；在 initialized 仍为 false 时 data-diagnostic-state 不能变为 healthy。
- owner unavailable fixture 显示 owner 和 ref；有 operationRef 时按钮调用 operation.reconcile，没有 operationRef 时不调用 reconcile。
- revision conflict fixture 显示 expected/current 两个 revision；自动化检查确认不会调用覆盖式 bundle.bind，只有用户明确重试后才发新的写操作。
- unknown fixture 的 error.operationRef 在 DOM 可见，初始状态严格为 unknown，不能映射为 completed、failed 或 healthy；reconcile 再次返回 unknown 时状态仍为 unknown。
- reconcile 返回明确 completed 后才允许状态变为 healthy 或 completed 对应的终态；返回 failed/cancelled 则显示失败/取消和下一步，不显示成功。
- 项目切换后旧诊断卡从 DOM 移除，新 projectId 的 project.diagnose 请求可被测试桩观察到。

### 风险

- project.diagnose 是新 RPC，必须加入共享 allowlist 和 host dispatch；若只改 UI，无法满足“未知不能成功”的机器约束。
- bundle.status 当前遇到损坏 manifest/index 会通过统一异常返回，诊断聚合必须保留原始稳定错误码，不把所有读取失败都归入 bundle missing。
- operation.reconcile 的结果可能仍未知。诊断卡不能因为按钮点击完成就变绿，必须以原始回执状态为准。
- 诊断内容只能使用安全 ref、digest、workspace label 和 operationRef，不输出绝对路径、凭据、provider payload 或 owner 私有数据库内容。

## 依赖与顺序

1. **先做 F1 的绑定合同与检查器基础**。F2 认领需要同一套 bundle.status、revision 展示和项目上下文，F3 也需要绑定状态和 revision 作为诊断输入。先把 project.bind/unbind 的物化边界和错误码做稳定，能减少后续三套 UI 各自解释错误。
2. **再做 F2 认领向导**。认领要求新增 project.claim，并且必须在 F1 已能显示 bundle projectId/revision 后才能让用户做安全确认。
3. **最后做 F3 诊断聚合与统一状态卡**。诊断会消费 F1/F2 的 revision conflict、unavailable、claim conflict 和 unknown operation 投影，过早实现会重复定义状态。
4. F1 的纯前端分组函数可以与 F1 绑定检查器并行实现，但验收应在绑定合同完成后统一跑，确保分组切换不会触发任何写 RPC。

## 不做清单

- **不把分组写入 registry 或 bundle revision**。分组是当前元素摘要的视图投影，持久化会引入第二份索引真相。
- **不让认领向导静默重写 bundle projectId**。这会切断旧 bundle 与其 index/element scope 的连接，也违反架构的明确边界。
- **不把“绑定 registry 意图成功”当成 owner 物化成功**。跨 owner/CLI 的写入可能未知，必须保留 operationRef 并进入诊断。
- **不自动合并同 projectId 的多个 workspace**。用户必须明确选择 workspace，避免复制 bundle 被误合并。
- **不在诊断里增加自动覆盖 revision、删除 corrupt 备份或重建 owner 私有目录**。这些动作超出当前安全合同，且无法由只读诊断证明其正确性。
- **不把排期条目复制进项目记录或为本功能提前引入 schedule v2**。继续使用 schedule.list/plan/clear 和 bundle index 做归属解析，未归属条目保持诊断状态。
- **不提供“未知即失败”或“未知即成功”的快捷映射**。未知必须先 reconcile 原操作，直到得到明确回执。
- **不新增竞品 UI 结论**。Runway、Krea、Weavy、Frame.io 和 Apple HIG 正文本轮未获取，设计只依据本仓库事实与已有本地 spec。

## 调研引用

本轮未使用外部资料。

设计依据的本地文档和实现文件包括：

- docs/design/project-management-arch.md 的 P1-1、P1-2、P2、RPC 契约、bundle 关系与测试策略。
- docs/design/desk-v8-spec.md 的项目条、空态/降级和当前 spec 结论。
- docs/design/motion-spec.md 的反馈优先、reduced-motion 和不阻塞操作约束。
- packages/dsh-muweave-workbench/src/project-panel.tsx、client.tsx 的当前项目 UI、projectUnclaimed 回退 notice 与已有 RPC 调用。
- packages/dsh-muweave-core/src/project-store.ts、protocol.ts、host.ts、schedule-store.ts 的项目类型、RPC、revision、排期和错误边界。
- packages/muweave-bundle/src/schema.ts、consumer.ts 的 manifest/index/element 字段和安全解析规则。
