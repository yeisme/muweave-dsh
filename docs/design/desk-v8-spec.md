# MuWeave 工作台 v8 Spec：交付状态与后续待做

> 状态：v8 P0、P1、P2，M1-M4，F1、F2、F3 与 schedule v2 已交付。项目管理架构 P2 只剩注册表迁移报告。
> 事实依据：每项已交付状态都对应下表中的提交号或文件路径。
> 调研限制：`web_search` 因 API 余额不足（HTTP 402）不可用。以下 NN/g 引用均来自 `web_fetch` 实际取到的正文。

## 1. 市场调研（可引用依据）

### 1.1 NN/g《8 Design Guidelines for Complex Applications》(2020-11-08)

对「复杂应用」的定义与本项目高度吻合：*"any application supporting the broad, unstructured goals or nonlinear workflows of highly trained users in specialized domains"* —— 内容生产正是非线性工作流。

八条准则里，v8 直接对应的四条：

| NN/g 准则 | v8 落点 |
| --- | --- |
| **Reduce Clutter Without Reducing Capability** | 三级密度（L1/L2/L3）：信息不全删，只分层 |
| **Make Important Information Visually Salient** | L1 主产物独占大图，其余降级 |
| **Help Users Track Actions and Thought Processes** | 阶段纵轴 + 版本带（知道做到哪、改过几版） |
| **Ease Transition Between Primary and Secondary Information** | 检查器未选中看工具目录、选中看详情 |

来源：https://www.nngroup.com/articles/complex-application-design/

### 1.2 NN/g《Progressive Disclosure》(2006-12-03，经典准则)

*"Initially, show users only a few of the most important options. Offer a larger set of specialized options upon request."*

两条硬要求（v8 必须满足）：
1. **初次披露与二次披露的切分要正确** —— 常用功能必须首屏可见，否则用户被迫频繁深入
2. **进入二次披露的路径必须明显** —— 按钮位置显眼、标签让用户能预期后面有什么

v8 的检验：
- 待排池 40 行截断 = 一次披露（正确：常用）
- 工具目录「另 5 项不可用」折叠 = 二次披露（正确：低频）
- 变体带只在 `slots > 1` 时出现 = 条件披露（正确：有才显示）

来源：https://www.nngroup.com/articles/progressive-disclosure/

### 1.3 NN/g《Accelerators Maximize Efficiency in User Interfaces》(2024-10-18)

*"Accelerators should be additional, alternate ways to accomplish a task — something that expert users can take advantage of, but that others can ignore completely."*

对 P2 键盘导航的三条直接约束：
1. **快捷键不是学会用界面的前提** —— 所有功能必须有鼠标路径
2. **随时可用但容易忽略** —— 内联显示、样式与主标签区分（NN/g 举例 Intercom 右对齐）
3. **上下文化提示** —— 用户用常规方式做完某动作后，再提示更快的做法

来源：https://www.nngroup.com/articles/ui-accelerators/

### 1.4 本地参考：`media-workbench` 的物理目录模型

`inbox/ drafts/ assets/{images,videos}/ exports/ refs/ notes/` —— 这是内容生产的**物理流水线**。v8 的阶段纵轴（灵感→剧本→视觉→分镜）与之对应，但阶段是**逻辑视图**，目录是**物理落点**，两者不该混为一谈。

### 1.5 调研没做到的

- 无法访问 Runway / Krea / Weavy / Frame.io 的产品界面（跨域重定向被拦）
- 没有抓取到任何竞品的实际截图或交互规格
- 因此**本 spec 不包含竞品功能对比表**，不编造

## 2. 任务清单与验收状态

下表只记录当前真实状态。✅ 项带提交号，⬜ 项是未交付工作。

### 2.1 结构线

| 项目 | 状态 | 可核实内容 |
| --- | --- | --- |
| P0 阶段纵轴与三级密度 | ✅ 已交付（`49e1f72`） | `stage-axis.tsx`、`stage-workbench.tsx`、`stage-map.ts` 与对应测试已加入 |
| P1 版本条与并排对比 | ✅ 已交付（`1e196c3`） | 对比栏出真实缩略图、差异摘要、变体入口和 Esc/关闭路径 |
| P2 键盘导航与窄屏适配 | ✅ 已交付（`fb4414e`） | `j/k`、`G+1..5`、`c`、Tab、Esc 和 1440/1024/768/390 视口适配已实现 |
| P3 死代码核查 | ✅ 已交付（`fb4414e`、`f2560d7`） | `DramaSessionView` 已核实为真实挂载代码并保留，`useTilt` 与 `useParallax` 两个死 hook 已删除 |

### 2.2 动效线

| 项目 | 状态 | 可核实内容 |
| --- | --- | --- |
| M1 阶段切换 | ✅ 已交付（`f2560d7`） | 阶段工作区使用受 reduced-motion 约束的淡入 |
| M2 变体悬停 | ✅ 已交付（`f2560d7`） | 变体 hover 使用受时长约束的轻微缩放与边线反馈 |
| M3 对比栏进入 | ✅ 已交付（`f2560d7`） | 对比栏使用水平进入动画，reduced-motion 下关闭 |
| M4 L3 待办出席 | ✅ 已交付（`f2560d7`） | 队列采用有限 stagger，长列表不累积延迟 |

### 2.3 功能线

| 项目 | 状态 | 可核实内容 |
| --- | --- | --- |
| F1 绑定维护与四种派生分组 | ✅ 已交付（`cdb732c`；见 [f1-delivery.md](./f1-delivery.md)） | 绑定检查器支持替换/解绑，分组按场次、角色、状态、素材派生 |
| F2 旧 bundle 认领向导 | ✅ 已交付（`866ec4d`；见 [f2-delivery.md](./f2-delivery.md)） | 发现未登记 bundle 并用原 `projectId` 登记，认领不改写 bundle |
| F3 项目诊断 | ✅ 已交付（54d1374；见 [f3-delivery.md](./f3-delivery.md)） | project.diagnose 只读 RPC、五类 finding、unknown 保持核对态，Workbench 诊断面板与测试已加入 |

## 3. 已核实的实现边界

- `DramaSessionView` 是活代码。`packages/dsh-muweave-core/src/client/index.tsx` 真实挂载它，`packages/dsh-muweave-drama/src/client.tsx` 传入 props，测试与 e2e 也覆盖它。该事实由 `fb4414e` 的核查记录确认。
- F1 的分组是前端派生，不写 registry、不写 `.muweave/index.v1.json`、不增加 bundle revision。实现位于 `packages/dsh-muweave-workbench/src/stage-map.ts`，交付事实见 `cdb732c`。
- F2 的 `project.claim` 使用 bundle 原有 `projectId`。`packages/dsh-muweave-core/src/host.ts` 会读取 manifest 并拒绝不一致的 ID，交付事实见 `866ec4d`。
- 未知操作仍必须进入核对流程。现有 `TimingSpanStatus` 含 `unknown` 与 `reconcile_required`，`operation.reconcile` 是既有 RPC。F3 不能把 HTTP 200、`ok=true`、缓存或发起请求当成健康。

## 4. 后续待做与边界

### 4.1 F3 项目诊断（已交付）

project.diagnose 已在 54d1374 交付。它把注册表损坏、bundle 缺失、owner unavailable、revision conflict 和 unknown operation 映射为稳定的 state、code、nextAction 与安全展示字段。实现证据见 packages/dsh-muweave-core/src/host.ts、packages/dsh-muweave-workbench/src/diagnosis-panel.tsx、tests/diagnosis-panel.test.tsx 与 tests/project-diagnose.test.ts。契约和验收以 f3-spec.md 为准，交付结论见 f3-delivery.md。

### 4.2 项目管理架构 P2 剩余项

project-management-arch.md 的 P2 目前只剩一项未交付工作。

- 注册表迁移报告仍未交付，当前没有对应实现入口或提交。
- schedule v2 已由 fadbe67 交付，采用 schedule.v1.json 的可选 projectId 兼容扩展，不增加 board-level v2 marker。详情见 schedule-v2-delivery.md。

注册表迁移报告与 F3、schedule v2 是独立交付物，不能互相替代。

## 5. 事实与判断

**事实** 是提交号、文件路径和 arch 文档中已写明的 RPC/状态。**判断** 是本 spec 对主入口和后续顺序的归纳。判断部分不改变已发布 RPC、bundle schema 或 owner 边界。

当前 v8 已交付项的提交级验证记录保留在 git show --stat <commit>、对应测试文件和交付报告中。F3 的提交是 54d1374，schedule v2 的提交是 fadbe67。注册表迁移报告仍没有对应实现提交，因此保持未交付。历史上曾出现的 F3 工作树草稿已经由 54d1374 纳入提交，不能再作为当前未提交状态描述。
