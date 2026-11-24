# MuWeave 项目管理架构计划

## 结论与边界

项目管理增加一个位于 DSH `pluginDataDir` 的轻量注册表，文件名为 `projects.v1.json`，建议路径为 `~/.dsh/plugin-data/muweave-dsh/projects.v1.json`。它只保存项目管理元数据和安全引用。

`.muweave/bundle.v1.json` 继续保存单个物化 workspace 的 `projectId`、标题、revision 和 owner bindings。`.muweave/index.v1.json` 继续保存该 bundle 的元件摘要。owner 真相仍由 Eikona、Auctra、Scaena、Sonora 和 template-registry 的既有合同提供。

项目注册表的职责是把多个已注册 workspace 和多个 owner 引用组织成可切换的作品上下文。它不保存元件 payload、owner 私有数据库、provider 请求、绝对路径、凭据或完整排期板。

## 数据模型

### 持久项目对象

| 字段 | 类型 | 持久性 | 规则 |
| --- | --- | --- | --- |
| `id` | `string` | 持久 | 稳定 `projectId`，创建后不可改。建议沿用 `proj_` 前缀和安全字符。 |
| `title` | `string` | 持久 | 用户可编辑的短标题，不能为空，长度上限由 RPC 校验。 |
| `status` | `preparing \| in_production \| ready_to_publish \| published \| archived` | 持久 | 只由项目操作显式改变。归档时必须为 `archived`。 |
| `workspaceRefs` | `string[]` | 持久 | 已注册 workspace 的 opaque id，不保存宿主绝对路径。至少一个时才可读取 bundle 元件。 |
| `ownerBindings` | `ProjectOwnerBindingV1[]` | 持久 | 只保存 owner 类型、opaque ref、绑定 workspace 和最后观察到的安全 revision。具体绑定仍由 bundle/owner 合同确认。 |
| `createdAt` | ISO 8601 `string` | 持久 | 创建时写入，不覆盖。 |
| `updatedAt` | ISO 8601 `string` | 持久 | 任一项目元数据或绑定意图变化时更新。 |
| `coverRef` | `elementId \| sha256 digest` | 持久，可选 | 只能引用当前项目 bundle 的安全元件/媒体引用。找不到时显示默认封面。 |
| `archivedAt` | ISO 8601 `string` | 持久，可选 | 归档时写入，恢复时清除。 |
| `archived` | `boolean` | 持久 | 与 `status` 保持一致。`true` 必须对应 `status=archived`。 |
| `lastSyncedAt` | ISO 8601 `string` | 持久，可选 | 最后一次成功 bundle sync 的观察时间，不代表 owner 已更新。 |
| `lastObservedRevisions` | `Record<string,string>` | 持久，可选 | `workspaceId/owner` 到 revision 的小型诊断摘要，不是内容快照。 |

`ProjectOwnerBindingV1` 字段如下。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workspaceId` | `string` | 对应 `workspace.list` 的 opaque id。 |
| `owner` | `eikona \| auctra \| scaena \| pi` | owner 类型。`pi` 表示纳入该 workspace 的 Pi 工件。 |
| `refs` | `string[]` | 官方 CLI/handoff 返回的安全引用，例如 run、collection、Auctra project、episode 或 breakdown ref。 |
| `bindingState` | `bound \| uninitialized \| unavailable \| conflict` | 最近一次观察结果。状态本身可持久，详细原因从重新读取获得。 |
| `updatedAt` | `string` | 这组绑定意图的更新时间。 |

### 派生视图字段

以下字段不落盘，每次通过当前 bundle 和 owner 状态计算。

- `elementCount`、`countsByDomain`、`countsByStatus`
- `ownerReadiness`、`bundleRevision`、`bundleDigest`
- `pendingReviewCount`、`staleCount`、`unscheduledCount`
- 场次、角色、状态和素材类型分组
- 项目在当前切换器中的最近使用排序
- 排期条目是否属于当前项目

派生字段过期时显示 `stale` 或 `unknown`，不能回写为新的项目事实。

### 与现有 bundle 的关系

| 对象 | 关系 |
| --- | --- |
| `.muweave/bundle.v1.json.projectId` | 必须等于注册表项目 `id`。它是 workspace bundle 的项目连接键。 |
| `.muweave/bundle.v1.json.title` | 初次认领时可作为标题建议。之后项目标题以注册表为准，bundle title 仍由 bundle CLI 维护。 |
| `.muweave/bundle.v1.json.bindings` | 绑定的物化结果。`project.bind` 通过现有 `bundle.bind`/官方 CLI 更新它，注册表只保存安全引用和状态。 |
| `.muweave/index.v1.json.projectId` | 元件索引的范围键。`bundle.elements.list` 返回该值，供当前项目过滤和冲突检查。 |
| `.muweave/index.v1.json.elements` | 元件摘要唯一读取源。项目注册表不得复制这些行。 |
| `.muweave/events/sync.jsonl` | bundle 的同步事件流水。项目注册表只记录最后成功观察时间，不复制流水。 |

旧 bundle 迁移时按以下顺序处理。

1. 枚举 `workspace.list` 返回的已注册 workspace。
2. 读取 `bundle.status`。没有 bundle 的 workspace 不自动创建项目。
3. 对每个有效 `projectId` 创建“待认领项目”候选，标题取 manifest title，状态初始为 `preparing`。
4. 若同一 `projectId` 出现在多个 workspace，保留候选但标记 `conflict`，禁止自动合并。
5. 用户确认后写入 `projects.v1.json`，不修改既有 bundle projectId。

### 与排期板 `schedule.v1.json` 的关系

- `schedule.v1.json` 仍是独立的本地计划板，位置和原子写入规则保持不变。
- P0 不复制排期条目到项目注册表，也不强行改变 `muweave.schedule.v1` 的既有行结构。
- `schedule.list` 在有项目上下文时读取当前项目 bundle index，以 `ref` 解析出属于该项目的条目。无法解析的旧条目显示为“未归属”，不能在项目视图中移动。
- `schedule.plan` 要求当前 `projectId` 和合法 element ref，服务端先确认 ref 属于该项目，再写入既有 schedule store。
- 如果未来允许同一 element id 跨 workspace 重复，新增 `muweave.schedule.v2`，为每行增加 `projectId` 和 `workspaceId`，迁移脚本依据当时 bundle index 填充。v2 之前不做静默猜测。

## 持久化与迁移

### 文件和写入规则

- 文件：`path.join(pluginDataDir, 'projects.v1.json')`。
- schema：`muweave.projects.v1`。
- 权限：创建目录后文件模式 `0600`。
- 写入：写入同目录临时文件，完成 JSON 校验后 `rename` 替换，避免半写。
- 损坏：无法解析时把原文件改名为 `projects.v1.corrupt-<timestamp>.json`，以空注册表启动，并在 `project.list` 返回诊断字段。不得静默覆盖原文件。
- 上限：P0 限制项目数量和绑定数量，超过上限返回稳定错误码，防止智能体无限写入。
- 并发：服务端以单个 store 串行化写操作，使用 `updatedAt` 与可选 `expectedRevision` 防止旧 UI 覆盖新状态。

### 版本和迁移

注册表顶层结构为 `{ schema: 'muweave.projects.v1', projects: ProjectRecordV1[], activeProjectId?: string, updatedAt: string }`。`activeProjectId` 只保存本地 UI 上次选择，不是项目事实，找不到或已归档时回退到最近的非归档项目。

- `v1` 首次创建，支持从已有 bundle 生成待认领候选。
- 新字段只能通过读取时默认值兼容，写回时统一输出当前 schema。
- 需要改变 id、状态语义或绑定结构时，新增 `projects.v2` 并提供 `v1 -> v2` 纯函数迁移。迁移前保留原文件副本，迁移失败不替换原文件。
- 不把 owner CLI 的数据库迁移和项目注册表迁移绑在同一个事务中。两者失败时分别报告，并要求通过原始 operation/ref 做 reconcile。

## RPC 契约

所有 action 继续挂在 `POST /api/muweave-dsh/rpc`，使用现有 `{ ok, generation, data | error }` envelope。所有写 action 必须接收 `idempotencyKey`，服务端按 `workspace scope + action + idempotencyKey + requestDigest` 去重。重复相同请求返回第一次结果，复用 key 但请求摘要不同返回 `muweave/idempotency_conflict`。写操作返回 `operationRef` 或明确的同步回执，未知/超时不重试创建动作，使用 `operation.reconcile` 查询原始操作。

### `project.list`

- 入参：`{ includeArchived?: boolean, query?: string, workspaceId?: string }`
- 出参：`{ schema: 'muweave.projects.v1', projects: ProjectSummaryV1[], activeProjectId?: string, diagnostics?: ProjectDiagnosticV1[] }`
- `ProjectSummaryV1` 包含 `id`、`title`、`status`、`archived`、`createdAt`、`updatedAt`、`coverRef?`、`workspaceCount`、派生 `elementCount?`、`pendingReviewCount?`、`bundleState?`。
- 只读，不要求幂等 key。默认隐藏归档项目。

### `project.create`

- 入参：`{ title: string, workspaceId?: string, status?: ProjectStatus, coverRef?: SafeRef, idempotencyKey: string }`
- 出参：`{ project: ProjectRecordV1, warnings: ProjectWarningV1[], operationRef?: string }`
- 行为：创建注册表项目并生成新的稳定 `id`。若提供 workspace，验证其 bundle projectId 为空或与新 id 一致；不接受任意宿主路径，不隐式创建 owner 私有目录。
- 错误：`muweave/invalid_project_title`、`muweave/project_exists`、`muweave/workspace_not_found`、`muweave/project_id_conflict`、`muweave/idempotency_conflict`。

### `project.update`

- 入参：`{ projectId: string, title?: string, status?: ProjectStatus, coverRef?: SafeRef | null, expectedUpdatedAt?: string, idempotencyKey: string }`
- 出参：`{ project: ProjectRecordV1 }`
- 行为：只更新项目管理字段。`archived` 与 `status` 必须保持一致，项目为 `archived` 时不能直接改成其他状态，必须走 `project.restore` 或等价恢复动作。
- 错误：`muweave/project_not_found`、`muweave/project_archived`、`muweave/project_revision_conflict`、`muweave/invalid_project_status`。

### `project.archive`

- 入参：`{ projectId: string, expectedUpdatedAt?: string, idempotencyKey: string }`
- 出参：`{ project: ProjectRecordV1, archivedAt: string }`
- 行为：设置 `status=archived`、`archived=true`、`archivedAt`。不删除 bundle、owner binding 或 schedule entry。
- 幂等：对已归档项目重复相同请求返回当前项目。
- 错误：`muweave/project_not_found`、`muweave/project_revision_conflict`。

### `project.restore`

- 入参：`{ projectId: string, status?: 'preparing' | 'in_production' | 'ready_to_publish' | 'published', idempotencyKey: string }`
- 出参：`{ project: ProjectRecordV1 }`
- 行为：清除归档标记并恢复到指定状态，默认 `preparing`。

### `project.bind`

- 入参：`{ projectId: string, workspaceId: string, owner: 'eikona' | 'auctra' | 'scaena' | 'pi', refs: string[], expectedBundleRevision?: number, idempotencyKey: string }`
- 出参：`{ project: ProjectRecordV1, manifest?: MuweaveBundleManifestV1, binding: ProjectOwnerBindingV1, warnings: ProjectWarningV1[], operationRef?: string }`
- 行为：校验 workspace、owner marker、ref 形状和 projectId 后，调用现有 allowlisted bundle/owner 合同。不得直接读写 owner 私有文件。需要人工批准或 owner 返回未知状态时，保留 `operationRef` 并返回 `bindingState=unavailable`/`conflict`。
- 错误：`muweave/project_not_found`、`muweave/workspace_not_found`、`muweave/owner_marker_missing`、`muweave/invalid_owner_ref`、`muweave/project_id_conflict`、`muweave/bundle_revision_conflict`、`muweave/operation_unknown`。

### `project.unbind`

- 入参：`{ projectId: string, workspaceId: string, owner: Owner, refs?: string[], idempotencyKey: string }`
- 出参：`{ project: ProjectRecordV1, binding: ProjectOwnerBindingV1 }`
- 行为：解除注册表中的绑定意图，并调用现有 bundle bind 合同更新物化绑定。不得删除 owner 原件。若仍有其他 ref，按指定 refs 精确移除。

### `project.clone`

- 入参：`{ sourceProjectId: string, title: string, workspaceId?: string, idempotencyKey: string }`
- 出参：`{ project: ProjectRecordV1, copied: { title: true, status: true, bindings: false, elements: false, schedule: false } }`
- 行为：创建新的 id，只复制项目管理元数据的初始值。不会复制 owner 目录、bundle 元件、payload、绑定 refs 或排期。

### `project.activate`

- 入参：`{ projectId: string, idempotencyKey?: string }`
- 出参：`{ activeProjectId: string, project: ProjectSummaryV1 }`
- 行为：只更新本地注册表中的 `activeProjectId`，不修改项目事实。归档项目必须显式 `includeArchived` 后才能激活。

### 与既有 action 的职责边界

- `workspace.list/register` 管理可访问 workspace 的注册和路径安全检查。项目 RPC 只引用返回的 `workspaceId`。
- `bundle.status/bind/sync/elements.list/element.get` 管理 `.muweave/` 的物化、绑定和读取。项目 RPC 不复制这些数据。
- `schedule.list/plan/clear` 管理本地排期行。项目上下文只用于解析 ref 和过滤展示，不把排期板嵌入项目对象。
- `operation.reconcile` 继续负责未知 owner/CLI 操作。`project.bind` 不自行重试未知写入。

## UI 结构

### 全局页与房间

1. **Workbench 全局页**继续使用 DSH 官方 `sidebar.panellist + main`。页面左侧是固定宽度的项目列表，中间是当前项目概览和元件工作区，右侧是项目检查器。右侧检查器是页内固定区域，不提供拖拽、分离或自建 dock。
2. **Eikona、Script、Drama、Schedule 房间**保留现有全局入口。每个房间从共享的当前项目上下文读取 `activeProjectId`，页面顶部提供项目标题和切换按钮。
3. **会话右栏**只显示当前会话关联项目的摘要、待审阅数和最近元件。它不重新承载完整项目管理，也不创建第二个项目切换系统。
4. **页内分段导航**使用无分离能力的 ARIA tablist，区分“概览、元件、绑定、排期”。不使用 URL 路由或自建窗口系统，遵循现有 DSH 页面表面。

### 项目列表与内容区

- 项目列表每行显示标题、状态文字、未归档标记和最近更新时间。状态使用文字与形状，不只依赖颜色。
- 列表顶部提供“新建项目”和“显示归档”。项目搜索只搜索注册表标题和安全 ref。
- 当前项目概览显示项目状态、owner readiness、bundle revision、元件计数、待审阅/过期摘要和最近同步时间。
- 元件区保留已有筛选，新增“分组”和“排序”两个控件。分组可选“无、场次、角色、状态、素材类型”，排序可选“最近更新、状态优先、标题”。控件作用于当前项目的派生摘要。
- 排期房间顶部显示当前项目上下文。待排池和月历只显示当前项目可解析的 ref，无法归属的旧条目进入单独诊断入口。

### 新建项目流程

1. **项目资料**：输入标题，选择初始项目状态，可选封面。标题和封面只接受安全文本、elementId 或 sha256 digest。
2. **选择 workspace**：从 `workspace.list` 选择已注册 workspace。若没有 workspace，先走现有 `workspace.register` 的受控目录选择流程；项目表单不直接保存路径。
3. **选择 owner 绑定**：按 Eikona、Auctra、Scaena、Pi 分组显示官方 CLI 返回的安全 refs。用户可跳过未初始化 owner，界面显示稍后绑定。
4. **检查与创建**：展示将要写入的项目元数据、workspace 和 owner refs，明确不复制目录。提交 `project.create`，再按顺序执行 `project.bind` 和 `bundle.sync`。每一步显示成功、需要人工处理或未知回执。
5. **进入项目**：创建成功后调用 `project.activate`，进入概览。若某个 owner 绑定失败，项目仍可进入，但显示下一步和原始 `operationRef`。

## 实施顺序与验收标准

### P0-1：注册表纯函数与存储

- 新增 schema 类型、状态枚举、输入校验、迁移函数、排序/过滤函数和原子 store。
- 验收：单测覆盖合法/非法标题、状态一致性、重复 id、归档恢复、损坏文件隔离、`0600`、临时文件 rename、上限和 v1 默认值。
- 机器检查：store 重启后读回同一项目，损坏文件旁存在带时间戳的隔离副本，输出不含绝对路径和凭据模式。

### P0-2：RPC allowlist 与幂等

- 将 `project.list/create/update/archive/restore/bind/unbind/activate` 加入共享 RPC allowlist 和 host dispatch。
- 验收：相同 idempotency key + 相同 digest 只产生一次写入；相同 key + 不同 digest 返回 `muweave/idempotency_conflict`；旧 `workspace.*`、`bundle.*`、`schedule.*` 行为不改变。
- 机器检查：无效 action 被拒绝，明文凭据继续被拒绝，所有异常都返回结构化 envelope，不产生裸 HTTP 400。

### P0-3：项目上下文与现有 bundle 元件

- 从 `projectId` 连接注册表项目、workspace bundle 和当前 active project。为 `bundle.elements.list` 增加项目上下文校验或由 host 在当前项目范围内调用。
- 验收：两个项目切换后元件数量、owner readiness 和标题只来自当前项目，bundle 删除后可重新 sync，未认领 bundle 显示冲突/待认领。
- 机器检查：同一 `projectId` 多 workspace 被标记冲突，注册表不包含元素 payload。

### P0-4：Workbench 与 Schedule 的项目体验

- 在 Workbench 加项目列表、当前项目概览、新建项目入口和项目级状态操作。Schedule 增加当前项目标识和 ref 归属过滤。
- 验收：新建项目旅程可完成“标题 → workspace → owner refs → 创建 → 进入项目”，切换项目后排期条目不串线，归档项目默认隐藏。
- 机器检查：DOM 中存在项目标题、状态文字、`新建项目` 操作和当前项目标识，RPC 调用顺序可由测试桩观察。

### P1-1：绑定维护与派生分组

- 增加绑定检查器、替换/解除操作、场次/角色/状态/素材类型分组和排序。
- 验收：分组切换不改变 bundle revision，解绑不删除 owner 原件，revision 冲突给出可执行提示。

### P1-2：复制、归档恢复与待认领

- 增加只复制管理元数据的 clone、归档恢复和旧 bundle 认领向导。
- 验收：clone 获得新 id，绑定和排期为空，旧项目仍可读；归档恢复不改变 bundle 内容。

### P2：诊断与长期兼容

- 项目诊断已由 54d1374 交付；注册表迁移报告仍未交付；schedule v2 已由 fadbe67 以 v1 兼容扩展交付。
- 验收：注册表损坏、bundle 缺失、owner unavailable、revision conflict 和未知 operation 都能显示下一步，不把未知状态标成成功。

## 测试策略

### 纯函数单测

- `validateProjectTitle`、`validateProjectStatus`、`normalizeProjectRecord`
- `migrateProjectsV1`、旧 bundle 生成待认领候选、同 `projectId` 冲突检测
- `deriveProjectSummary`、owner readiness 汇总、元件数量和状态摘要
- 按场次/角色/状态/素材类型分组，稳定排序和空值排序
- `resolveScheduleProject`、未归属 ref 处理和跨项目过滤
- 幂等 key + request digest 计算、同 key 冲突判断
- 安全 ref、digest、elementId 和明文凭据/绝对路径拒绝

### RPC/存储测试

- 注册表创建、更新、归档、恢复、激活和重启读回
- 并发旧 `expectedUpdatedAt` 被拒绝，新请求保留最新状态
- `project.bind` 只通过 allowlisted owner/bundle 合同，marker 缺失和 revision 冲突返回稳定错误码
- owner/CLI 未知或超时保留原始 `operationRef`，不重复创建
- 现有 `workspace.*`、`bundle.*`、`schedule.*` 回归测试继续通过

### E2E 旅程

1. 打开 Workbench，看到两个项目和当前项目标识。
2. 点击新建项目，输入标题，选择已注册 workspace，选择一个 Eikona ref 和一个 Auctra/Scaena ref。
3. 提交后观察 `project.create → project.bind → bundle.sync → project.activate`，进入概览并看到 bundle revision。
4. 在元件区依次切换场次、角色、状态和素材类型分组，确认只改变视图。
5. 进入 Schedule，安排当前项目的一个元件，切换到另一个项目，确认该排期 chip 不出现。
6. 将项目设为待发布，再归档。确认项目默认从列表隐藏，显示归档后可恢复，owner 和 bundle 仍可读取。
7. 模拟重复提交和未知回执，确认显示幂等结果或 reconcile 下一步，不把未知操作显示为成功。

E2E 和集成运行按仓库约定写入 `temp/integration-test-runs/<run-id>/` 的六文件脱敏证据包，不写入项目注册表、`.muweave/` 或 owner 私有目录。

## 不做什么

- 不修改 `.muweave` schema 来保存项目列表、分组、归档原因或排期副本。项目注册表已经提供这些用户管理字段的最小安全落点。
- 不改变已有 `bundle.v1.json` 的 owner binding 语义，不把项目 RPC 变成新的 owner CLI。
- 不在 P0 引入数据库、运行时依赖、跨设备同步或发布平台回填。
- 不实现物理目录复制、自动创建 `.eikona/.auctra/.scaena` 私有状态或任意路径写入。
- 不把项目状态自动计算成“所有元件都完成”。派生摘要用于提醒，显式项目状态用于生命周期判断。
- 不把自定义标签和手工分组作为首轮持久化能力。首轮按现有元件摘要派生，避免新增索引真相。

