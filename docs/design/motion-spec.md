# MuWeave 动效规格（v8 收尾）

> 状态：定稿，Lane B 的实施依据
> 前置：v8 P0/P1/P2 已交付（`fb4414e`）
> 调研限制：`web_search` 不可用（DeepSeek HTTP 402 余额不足）；以下引用均经 `web_fetch` 实际取到正文。

## 1. 依据（可引用）

### 1.1 NN/g《The Role of Animation and Motion in UX》(2020-01-12)

原文结论：*"Animation in UX must be unobtrusive, brief, and subtle. Use it for feedback, state-change and navigation metaphors, and to enhance signifiers."*

三条对我们直接生效：

1. **动效是反馈，不是装饰** —— 原文强调动效最合适的用途是「microinteractions 的 subtle feedback」，而不是 "induce delight or entertain users"。所以我们的动效只做「告诉你发生了什么」，不做「让界面显得高级」。
2. **动效会抢占注意力** —— 原文说明人类周边视觉对运动天生敏感（进化上用于发现危险），所以「无关任务的动效会显著降低体验」。这是「克制」的生理依据，不是审美偏好。
3. **动效可对抗 change blindness** —— 静态变化容易被忽略，短动效能确保用户看见反馈。这让「阶段切换要有过渡」有了功能性理由，而非为了好看。

来源：https://www.nngroup.com/articles/animation-purpose-ux/

### 1.2 NN/g《8 Design Guidelines for Complex Applications》(2020-11-08)

其中两条在本规格里被用来**限制**动效范围：

- *"Promote Learning By Doing"* —— 用户要能立即动手，动效不能挡住操作
- *"Make Important Information Visually Salient"* —— 重要性靠**尺寸与位置**建立，不靠动效（我们已经在 L1/L2/L3 三级密度里落实）

来源：https://www.nngroup.com/articles/complex-application-design/

### 1.3 NN/g《Accelerators Maximize Efficiency》(2024-10-18)

*"Accelerators should be readily available, yet easy to ignore."* —— 键位提示（P2 已做）与动效同理：可见但不打扰。动效不能做成「必须等它播完才能操作」。

来源：https://www.nngroup.com/articles/ui-accelerators/

### 1.4 未获取的部分（不编造）

- 未能访问 Runway / Krea / Weavy / Frame.io 的实际界面（跨域重定向被拦）
- 未获取 Google Material Motion / Apple HIG Motion 的正文（页面由 JS 渲染，`web_fetch` 只拿到标题）
- 因此**本规格不含这些体系的具体参数**，所有时长/曲线由本项目现有 token 推导

## 2. 动效原则（四条，全部可核）

| 原则 | 含义 | 违反的后果 |
| --- | --- | --- |
| **反馈优先** | 每个动效必须回答「刚才发生了什么」 | 纯装饰 → 删掉 |
| **不挡操作** | 动效进行中用户仍可点击/键入 | 阻塞 → 时长减半或改 `will-change` |
| **时长上限 240ms** | 最长不超过 `--mw-dur-base` 的 1.2 倍 | 超时 → 违反「brief」 |
| **无动效也可用** | reduced-motion 下功能完全等价 | 信息丢失 → 改为静态可读 |

## 3. 现有基础设施（不新造）

| 资源 | 值 | 用途 |
| --- | --- | --- |
| `--mw-dur-fast` | 120ms | 悬停、按压等即时反馈 |
| `--mw-dur-base` | 200ms | 内容切换、进入 |
| `--mw-ease` | `cubic-bezier(0.2, 0, 0, 1)` | 位移类（快出慢入） |
| `--mw-ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | 淡入类 |
| `@keyframes mw-fade-in` | 已有 | 透明度进入 |
| `@keyframes mw-rise` | 已有 | 轻微上移 + 淡入 |

**约束**：不新增时长/easing token。上面 6 项是全部时长素材。

**keyframes 约束的偏离（已实施，记录在案）**：原规格写「不新增 keyframes」，实施时发现 M3 需要**水平**进入，而现有 keyframe 全部沿 Y 轴（`mw-fade-in` 是 `translateY(0.25rem)` 上移、`mw-rise` 是 `translateY(0.5rem)`）。
强行复用会让对比栏「从下方升起」，与「从右侧滑入」的空间隐喻相反 —— 这违反 NN/g 关于动效应传达空间隐喻的要求。

因此**新增 1 个 `mw-compare-in`**（`translateX(0.5rem)` + 淡入，200ms `--mw-ease`），总数 7 → 8。
`tests/motion.test.tsx` 的 keyframe 白名单同步加 1 项并注明理由 —— 白名单保持精确，防止无意识膨胀。

## 4. 四组动效（实施清单）

### M1 阶段切换

- **触发**：点阶段行 / `j` `k` / `G+数字`
- **行为**：工作面（`mw-stage-work`）内容整体 `mw-fade-in`
- **参数**：`180ms`，`--mw-ease-out`
- **不做**：不做左右滑动（阶段不是横向分页），不做高度动画（会引起列表跳动）
- **理由**：状态变化需要「可感知但不打断」，纯淡入最省注意力

### M2 L2 变体悬停

- **触发**：鼠标悬停变体卡
- **行为**：`transform: scale(1.02)` + 边线由 `--mw-line` 加深到 `--mw-line-strong`
- **参数**：`120ms`，`--mw-ease-out`
- **不做**：不做缩放超过 1.03（会引起相邻卡重排感），不做阴影浮起（与 v6「少用阴影」冲突）

### M3 对比栏进入

- **触发**：点「对比基线」/ `c` / 变体角标
- **行为**：从右侧 `translateX(0.5rem)` + 淡入
- **参数**：`200ms`，`--mw-ease`
- **退出**：立即（无动画）——退出需要「快」，因为用户已经决定离开
- **理由**：进入需要空间隐喻（从右边来），退出不需要

### M4 L3 待办出席

- **触发**：阶段切换后列表重排
- **行为**：`mw-rise`，逐条 `40ms` stagger
- **上限**：**只对前 6 条 stagger**，第 7 条起统一无延迟
- **理由**：NN/g 指出「无关任务的动效降低体验」，长列表逐条 stagger 会让用户等 1 秒以上，属于「time-filling」而非反馈

## 5. 明确不做

| 不做 | 理由 |
| --- | --- |
| 视差滚动 | v6 已定克制路线；且与「禁 3D 霓虹」冲突 |
| 3D 翻转 / 粒子 / 光效 | 同上 |
| 骨架屏 | 本地 RPC 几十毫秒，骨架屏只会闪一下，比空白更差 |
| 页面级转场 | 房间切换是标签页语义，不是路由跳转 |
| 按钮涟漪 | 非 macOS 惯例；v6 用 `--mw-fill-2` 按压态已足够 |

## 6. 顺带处置：两个死 hook

勘察结果：`useTilt`、`useParallax` 在 `motion.ts` 定义并由 `index.tsx` 导出，但**仓库内零调用方**；实际生效的是 `workspace-shell.tsx:125` 的 `useTiltDelegation`。

**决定：删除 `useTilt` 与 `useParallax`**（含 `index.tsx` 的导出），保留 `useTiltDelegation` 与 `usePrefersReducedMotion`。

理由：3D 倾斜只应有一处实现（委派版，能覆盖动态内容），两个未用的单元素版本只会让后来者选错。这是删代码而不是加功能。

风险：若未来有外部插件 import 了这两个 hook 会断。当前仓库零引用，接受；已在提交信息里记录。

## 7. 验收

| 项 | 门槛 |
| --- | --- |
| 四组动效 | 各自在实机可见，且时长 ≤ 240ms |
| 只用既有 token | `grep` 确认无新时长/easing 字面量 |
| reduced-motion | `emulateMedia({reducedMotion:'reduce'})` 下动画全停，功能不变 |
| 不挡操作 | 动效期间点击阶段行仍能切换 |
| 死 hook | `grep -rn "useTilt\b\|useParallax" packages/` 零命中 |
| 既有门槛 | typecheck / test 158 全绿 / 守卫 11/11 / e2e passed |
