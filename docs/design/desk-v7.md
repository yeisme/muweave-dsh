# 幕织 DSH 工作台 v7：项目管理、composer 与工具集成

v7 由三条并行 lane（Codex `gpt-6.2-sol`，herdr 面板）+ 我做的布局重构组成。先有方案，再有实现——方案见 [project-management-plan](./project-management-plan.md) 与 [project-management-arch](./project-management-arch.md)。

## 1. 项目管理（P0 落地）

**推荐方案**（架构文档定稿）：轻量项目注册表 + 复用 `.muweave` 已有 `projectId` 聚合。

- 注册表 `pluginDataDir/projects.v1.json`：`id` / `title` / `status`（preparing / in_production / ready_to_publish / published / archived）/ `workspaceRefs` / `ownerBindings` / `coverRef` / 归档标记，0600 + 原子写 + 损坏隔离。
- 元件、场次、镜头、owner revision **一律实时读 bundle**，注册表只存身份与用户意图。派生字段（元件数、就绪度）不落盘。
- 新增 8 个 RPC：`project.list / create / update / archive / restore / bind / unbind / activate`。
- 实机验证：UI 新建项目 → 落盘 → 列表回显，`projects.v1.json` 内容正确（含 `activeProjectId`）。

### 布局重构（本轮关键）

项目面板原本被塞进 `leftTree`，而左栏在 v3 之后是**默认关闭的筛选浮层**——功能写了但看不见。

现在改为常驻**项目条**：舞台 hero 上方一行，显示当前项目 + 状态 + 元件数 + 新建入口，点开才展开完整列表（popover）。

### 两个真实回归（都已修）

1. **建项目后元件列表清空**：项目按 `projectId` 过滤，新项目没有对应元件 → 0 条，看起来像数据没了。修法：项目未匹配到元件时回退显示整个工作区的投影，并用 notice 说明“项目还没有自己的元件，当前展示整个工作区”。
2. **`project.*` 返回结构被无条件信任**：宿主或测试桩返回 `ok:true` 但没有 `projects` 数组时，`.projects.map()` 抛异常 → 整个房间白屏。修法：两处（workbench 与 panel）都做结构防御。

## 2. Composer（输入框）

- @ 内联 chip：`ElementChip` / `SkillChip` / `FileChip` / `GenerateChip`，可键盘删除，带状态点。
- 动作条：8 个动作（出图 / 配音 / 排期 / 同步 / 检查器 / 视图 / @ 引用 / / 技能），按上下文启用禁用。
- **布局修复**：动作条原本换行成两行、把浮窗撑到约 1/4 屏并压住内容。现在 `flex-wrap: nowrap` + 横向滚动 + 右侧渐隐遮罩，实测 **8 个动作单行 32px**。

## 3. 工具集成

- `tool-catalog.ts`：把能力目录渲染成三组（现在能用 / 需要你批准 / 暂不可用），可用性来自 `capability.catalog` 而非前端硬编码。
- `tool-run-card.tsx`：单次调用的可视化（进度点 + 取消 + 结果摘要），失败显示错误码，不吞异常。
- 会话「做剧」视图接入，工具调用按时间线串进既有工作流。
- 付费边界不变：前端任何路径都不能直接提交或批准，只能创建 `waiting_approval`。

## 4. 验证

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **110/110** |
| `pnpm build` / `pack:plugins` | 通过（2 core + 6 plugins） |
| 实机：项目条 | 出现，显示项目名 / 状态 / 元件数 / 新建入口 |
| 实机：新建项目 | UI 走通，落盘 0600，`activeProjectId` 正确 |
| 实机：建项目后元件 | **11 张卡**（回归修复前是 0） |
| 实机：动作条 | 8 个动作单行，高度 32px |
| `pnpm test:integration` | 检查全过（末行 PASSED），但 `passed=false`：`web_profile_untouched: false` |

### 关于 e2e 的 `passed=false`

`~/.dsh/profiles/web/cordis.patch.yml` 在 11:07（e2e 运行窗口）被改写。该文件里**没有任何 muweave / creator-e2e 字样**，同目录存在多份 `cordis.patch.yml.bak-magpie-*` 备份——判定为 **s101 上另一个主机侧自动化任务在改同一文件**，与本轮代码无关。这是环境干扰，不是功能缺陷；要拿到干净的 green，需要在无人改动该文件的时间窗重跑。

## 5. 不做

- 项目复制（`project.clone`）与多 workspace 冲突合并：契约已写，未实现。
- 排期按项目过滤：`schedule.*` 还没有 projectId 维度。
- 拖拽排序、框选多选。
- 快捷键的 `⌘`/`Ctrl` 平台化显示。

## 6. 本轮后续（11-19 11:xx）：排期项目上下文 + 一次仓库抢救

### 排期项目上下文（P0-4 剩余部分）

- 新增 `packages/dsh-muweave-schedule/src/project-scope.ts`（纯函数）：`refBelongsToProject` 按三条规则判定（`projectId` 前缀 / `workspaceRefs` 命中 / 归属未知），`scopeScheduleEntries` 分成 `mine / unknown / others` 三组。
- **归属未知单列一组**，不当成属于也不当成不属于——这是关键设计：宁可显示并标注，也不要静默隐藏用户的内容。
- 排期房间读 `project.list` 时做结构防御（上一轮因为没防御白屏过一次）。
- 实机：排期房间正常渲染，待排池 9 条，未因项目过滤清空。

### 仓库被并发写入破坏后的抢救（重要教训）

本轮开工时仓库处于**不可编译**状态，三处破坏都是同一批并发写入造成的：

1. `protocol.ts` 丢了 8 个 `project.*` RPC action 与 4 个项目类型定义（`ProjectRecordV1` / `ProjectOwnerBindingV1` / `ProjectStatus` / `ProjectsRegistryV1`）→ 20 个测试失败。
2. `project-store.ts` 被压成 88 行（单行 893 字符），TS 无法推断参数类型 → 隐式 any 报错。`prettier --write` 后恢复到 505 行。
3. `workspace-shell.tsx` 引用了 `floating-agent.tsx` **没有导出**的 `focusFloatingComposer` / `mountComposerWorkspace`（composer lane 只改了调用侧）。

修完之后：`pnpm typecheck` 通过、`pnpm test` **110/110**、`pnpm build` + `pack:plugins` 通过。

**教训**：多条 lane 并发改同一个仓库时，「文件白名单」不足以保证一致性——跨文件的契约（RPC allowlist、类型定义、导出符号）必须由单一负责人维护，或者每轮合并后立刻跑 typecheck 而不是等全部 lane 收工。

### 本轮遗留（11-19 12:0x）

`packages/dsh-muweave-schedule/src/project-scope.ts` 的纯函数（`refBelongsToProject` / `scopeScheduleEntries`）已落地并有判定规则，但**排期房间的 UI 接入丢失**：`client.tsx` 被我的一次全量 `rsync` 覆盖回旧版本，`projectBar` 与三组分组渲染都没接上。实测 `projectBar: 0`（其余正常：board 渲染、待排池 9 条）。

**根因已定位**：本地镜像 `~/work/muweave-dsh` 是旧快照，我用 `rsync -a ./ s101:...` 做全量推送时，反复用旧文件覆盖 s101 上的新工作——`protocol.ts` 的类型与 action、`project-store.ts` 的排版、`floating-agent.tsx` 的导出、排期房间的接入，四次破坏都是这一个原因。**镜像方向已改为从 s101 拉取**，后续不再从本地推送。

## 7. 排期美化 + 项目 RPC 真正接通（11-19 13:xx，Claude 执行 + 我收口）

### Claude 做的（lane `v9-sched-polish`）

**布局重塑**
- 日历成主体（`--mw-card` + elev-1），待排池降为侧栏：去掉卡片、小号字 + 发丝线，可折叠，选择存 `localStorage`（键 `muweave.schedule.backlog`）；宽度 < 52rem 变浮层抽屉（玻璃只在 `@supports` 内），Esc 关闭。
- 格子四档层次：跨月 0.48 透明度 → 空白（卡片底 + 发丝线）→ 有排期（`color-mix` 6% 深底 + 加强线）→ 今天（系统蓝描边 + 8% 淡蓝底 + 蓝底白字日期圆点）。
- chip 只用状态色（`--mw-tone` 12% 柔底、中性文字、左侧 2px 色边），`others` 组虚线边框。
- 顶部工具栏一行：折叠按钮 + 月份 + 切月 + 三项统计（`--mw-mono` + `tabular-nums`）。
- 新增 `mw-sched-toolbar* / -month* / -backlog-toggle / -stats / -others-toggle / -layout / -side / -main / -group* / -week / -legend / -undo`；新状态用 `data-*`。

**验证（Claude 自报，我复核一致）**：typecheck 通过、`pnpm test` 110/110、静态守卫 11/11。

### 我做的收口

1. **格子高度 5.75rem → 4.75rem**：原来 6 行撑出视口、空月显空；收紧后一屏完整 6 行。
2. **补上宿主 project RPC（关键）**：`host.ts` 里 **8 个 project 分支一个都没有**，`ProjectStore` 也没实例化——所以 `project.list` 必然失败、界面一直显示「该宿主未启用项目管理」。补齐字段 + 构造 + 8 个 dispatch 分支后，项目条显示真实项目 `雨夜重逢 · 第一集 · Preparing`。

### 验证（我实机）

| 项 | 结果 |
| --- | --- |
| typecheck / test | 通过 / **110/110** |
| 静态守卫 | 11/11 |
| build / pack | 通过（2 core + 6 plugins） |
| e2e | **passed=true**（`20261119050922195-muweave-dsh-71f068a6`） |
| 实机·项目条 | `Project 雨夜重逢 · 第一集 [Preparing] · Switch projects from Overview` |
| 实机·排期 | 工具栏 1、42 个格子、待排池 9 条 |

### 已知问题（Claude 报的，我确认仍存在）

- 窄屏抽屉点外面不关闭（只能 Esc / 选中 / 拖放）。
- 项目有多个 workspace 时进房间会多次调 `bundle.elements.list`，workspace 多则偏慢。
- 待排池每组最多 40 行，「待排」统计的是截断后数量。
- 排期房间没有 UI 测试，三组渲染只被一次临时冒烟覆盖（已删）。

## 8. 排期收尾（11-19 14:xx）：UI 测试 + 三处修复

上一节列的四个已知问题，这轮处理了三个，并补上了最大风险缺口（没有 UI 测试）。

### 新增 `tests/schedule-room.test.tsx`（4 项）

排期房间此前**零 UI 测试**，三组渲染只被一次临时冒烟覆盖。新增测试全部用 `data-*` 结构断言，不依赖文案（房间字典是插件运行时注册的，单测里传 key-echo translator）：

| 测试 | 断言 |
| --- | --- |
| 宿主返回 `{}`（无 projects 数组） | 日历 42 格渲染，不白屏 |
| `project.list` 返回失败 | 同上，不白屏 |
| 有当前项目 | 行带 `data-ownership`，`others` 默认不出现，展开后出现 |
| 折叠待排池 | `localStorage['muweave.schedule.backlog']` 写入 `collapsed`/`expanded` |

顺手修了一个**测试基础设施缺陷**：`vitest.config.ts` 里 `@yeisme/dsh-muweave-schedule` 的别名顺序反了（包根在前、`/client` 在后），导致 `/client` 永远解析到包根、新测试收集不到任何用例。改为 `/client` 在前，与其它五个插件一致。

### 三处修复

1. **统计口径**：`BACKLOG_LIMIT = 40` 只该限制渲染行数，但统计与折叠计数用的是截断后的 `backlog.length`。改为 `useMemo` 同时返回 `totals`（完整计数）与截断行，统计读 `totals`。实机：`Backlog 9`。
2. **窄屏抽屉点外部不关闭**：`useBacklogPanel` 只处理了 Esc / 选中 / 拖放。补 `pointerdown` capture 监听，按点击是否落在 layout 根之外判定关闭。
3. **（顺带）** 上一节已修的宿主 project RPC，本轮实机确认项目条能显示真实项目。

### 验证

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **114/114**（16 文件，+4 排期 UI） |
| `pnpm build` / `pack:plugins` | 通过 |
| `pnpm test:integration` | **passed=true**（`20261119055520877-muweave-dsh-6925bf09`） |
| 实机·项目条 | `Project 雨夜重逢 · 第一集 Preparing · Switch projects from Overview` |
| 实机·统计 | `Planned 1 / Backlog 9 / Overdue 1`，与行数一致 |
| 实机·折叠 | `localStorage` 写入 `collapsed` |

### 仍未做

- 多 workspace 项目的元素加载仍是「每个 workspace 一次 `bundle.elements.list`」，workspace 多时偏慢（未做批量或缓存）。
- 无当前项目时待排池是否应显示默认工作区元素，测试里退化为「日历渲染即可断言」——这个语义还没定，属于设计问题而非缺陷。

## 9. 多 workspace 加载优化（11-19 14:xx）

第 8 节遗留的第 1 项做完了。

### 问题

切回同一项目、或在剧场里重新进入排期房间，都会把该项目**所有 workspace 全量重拉一遍**：每个 workspace 一次 `bundle.elements.list`。workspace 越多越慢，而这些数据在会话内几乎不变。

### 做法

`workspaceCacheRef`：按 rpc 客户端维度缓存 `Map<workspaceId, elements>`。

- 只在 `cache.has(id) === false` 时才发请求（`missing`），已缓存直接复用；
- rpc 客户端变化（换 host / 换会话）时重置整个缓存，避免跨 host 串数据；
- 某个 workspace 请求失败时不写入缓存，下次进入自然重试（失败不污染缓存）；
- 项目切换时按 `workspaceRefs` 顺序从缓存拼装，保证渲染顺序稳定。

### 验证

新增测试 `schedule room: workspace element cache`：断言同一 workspace 在一次会话内只被请求一次。

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **115/115**（16 文件，排期房间 5 项） |
| `pnpm build` / `pack:plugins` | 通过 |
| `pnpm test:integration` | **passed=true**（`20261119060822705-muweave-dsh-45d9fae2`） |

### 代价与边界

- 缓存只活在当前房间实例内；整页刷新后重新读取（符合预期，`.muweave/` 可能被外部 CLI 更新）。
- 没有做「后台静默刷新」，所以长时间停留在房间时不会自动发现新元素——按需点 Sync 或重进房间即可。

## 10. 无项目语义、project.clone、拖拽排序判断（11-19 15:xx）

### 10.1 「无当前项目时待排池」语义已定并锁定

查清上一轮「无项目时行数为 0」不是缺陷：待排池行的 `data-ownership` 是 `data-ownership={project ? ownership : undefined}`，**没有项目时该属性根本不渲染**。我的测试用 `[data-ownership]` 统计行数，所以数出 0。行本身一直在。

**语义定为**：没有当前项目 = 所有条目都属于「我的」，全部显示、不带归属标签，与引入项目功能之前的行为完全一致。

测试已锁定这条语义（`tests/schedule-room.test.tsx`）：
- 无项目 / `project.list` 返回 `{}` / `project.list` 失败 → 待排池行数 = 元素总数，`[data-ownership]` 数量 = 0
- 有项目 → 行带 `data-ownership`，`others` 默认隐藏

### 10.2 `project.clone`（按 arch 文档契约实现）

- store：`ProjectStore.clone({ sourceProjectId, title, workspaceIds? })`，复用 `create`，只拷标题与状态；**归档项目克隆为 `preparing`**（新项目不该出生即归档）。
- RPC：`project.clone` 进 allowlist + host dispatch，返回 `{ project, copied }`，`copied` 恒为 `{ title: true, status: true, bindings: false, elements: false, schedule: false }`。
- UI：项目行加「复制」按钮，克隆后自动进入新项目。
- 测试（`tests/schedule.test.ts` 2 项）：不携带 binding/element/schedule；归档源克隆非归档。

### 10.3 顺手修掉一个真 bug：`project.create` 返回结构不一致

`project.create` 原本返回整个 registry，而 `archive/restore/activate` 返回 `{ project }`。前端 `project-panel.tsx` 读的是 `result.data.project.id`，所以**「创建时绑定 owner + 自动激活」这两步从来没有执行过**（之前实机看着正常，是因为 `load()` 会重新拉列表掩盖了异常）。

现在统一为 `{ project }`，create 与其它写操作对称。这是写 clone 测试时被逼出来的——契约测试的价值。

### 10.4 拖拽排序：明确不做

排期房间**已支持**把待排池条目拖到日历某一天（`draggable` + `onDrop` + `data-drop-active`），这是真正决定顺序的操作。

待排池内部的手工排序**决定不做**，理由：
1. 待排池是「待排内容池」而非手工清单，按 `kindRank` + 标题的自然序更稳定，手工序会随新元素加入而失效；
2. 真正表达优先级的是「排到哪一天」，该能力已存在；
3. 手工排序需要新的持久化字段，会突破「注册表只存项目身份与意图、不存内容索引」的边界（见 project-management-arch.md）。

### 验证

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **117/117**（16 文件） |
| `pnpm build` / `pack:plugins` | 通过 |
