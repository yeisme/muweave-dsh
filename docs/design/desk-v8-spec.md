# MuWeave 工作台 v8 Spec：任务、美化与收尾

> 状态：P0/P1 已交付（`49e1f72`、`1e196c3`），本 spec 覆盖 P2/P3 与全量收尾
> 调研限制：`web_search` 因 API 余额不足（HTTP 402）不可用；以下引用均来自 `web_fetch` 实际取到的正文。

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

## 2. 任务清单（P2 + P3）

### P2：键盘导航与加速器

按 NN/g 1.3 的三条约束：

| 键 | 行为 | 鼠标替代路径（必须有） |
| --- | --- | --- |
| `c` | 对当前 L1 主产物执行「对比基线」 | 「对比基线」按钮 |
| `j` / `k` | 阶段纵轴上下移动 | 点击阶段行 |
| `G` + `1..5` | 跳到第 N 阶段 | 点击阶段行 |
| `Tab` / `Shift+Tab` | 在纵轴 → L1 → L2 → L3 → 检查器之间移动 | 点击 |
| `Esc` | 退出对比 / 关闭抽屉 | `×` 按钮 |

**内联提示**：键位提示按 NN/g 建议放在操作旁、样式区分（`mw-stage-axis-keys` 已有 `j k` 提示，扩展到全局）。
**平台化**：`⌘`/`Ctrl` 已由 `formatKeyHint` 处理（`65e3b74`）。

### P3：清死代码

| 对象 | 判定 | 动作 |
| --- | --- | --- |
| `DramaSessionView`（`session-view.tsx`） | 只被 `index.tsx` 导出，**零挂载** | **删除**：占用思路已由右栏工具目录承载 |
| `ToolRunCard` | 已接进生成台任务列表（`generation.tsx:305`） | **保留** |
| `ProjectPanel` | 已挂项目条 | 保留 |

删 `DramaSessionView` 时同步删 `index.tsx` 的导出与 `styles.ts` 里只有它用的 `mw-sv-*` 样式（先 grep 确认无其他引用）。

## 3. 美化收尾（全量）

### 3.1 视觉一致性审计

逐项核对，不靠感觉：

| 检查 | 方法 |
| --- | --- |
| 所有颜色来自 `--mw-*` | `styles-static.test.ts` 已有断言 |
| 所有长度是 rem（1px/2px 例外） | 同上 |
| 无内联样式（`--mw-*` 例外） | 同上 |
| 阶段纵轴与 L1/L2/L3 的间距一致 | 目测 + 量 `getBoundingClientRect` |
| 三档分屏（single/horizontal/vertical）下都不溢出 | Playwright 三个视口各截一次 |
| `prefers-reduced-motion` 下无动画 | 用 `emulateMedia` 验证 |

### 3.2 窄屏（1024 / 768 / 390）

现有 e2e 已覆盖四档视口。v8 新增的阶段纵轴在 1024 下会挤压工作面，需要：
- 1024：纵轴收窄到 9rem，阶段名可能截断 → 用 `title` 补全
- 768 及以下：纵轴折叠成一个横向 chips 行，置于工作面顶部

### 3.3 空态与降级

| 场景 | 期望 |
| --- | --- |
| 无元件 | 「本阶段还没有产物」+ 去同步按钮 |
| 无 cover | 「暂无封面」占位（已有） |
| 无 slots | 不渲染变体带（已有） |
| 无 revision | 版本带只显示当前版（已有） |
| 无项目 | 显示全量、不显示归属标签（已有测试锁定） |

## 4. 验收标准

| 项 | 门槛 |
| --- | --- |
| typecheck | 通过 |
| `pnpm test` | 基线 150 全绿，且新增 P2 键位测试 |
| 静态守卫 | 11/11 |
| build / pack | 通过 |
| e2e | `passed=true` |
| 四档视口 | 1440/1024/768/390 均无横向溢出 |
| 死代码 | `DramaSessionView` 零引用（含样式） |
| 键盘 | 全流程可不用鼠标走完：看阶段 → 开产物 → 对比 → 审批 |
| 鼠标 | 每个键位动作都有对应按钮 |
