# 幕织 DSH 工作台 v5（3D 与动效 · 排期手速 · 命令面板记忆）

承接 [desk-v4](./desk-v4.md)。v5 不加房间、不加包、不加依赖，只把三件事做实：卡片与浮层的**厚度**（交给 CSS 3D，不是叠更多阴影）、排期的**键盘手速**与**拖拽反馈**、命令面板的**记忆**与操作组过滤。参考对象仍是 dsh-media-desk 的手感，只借鉴交互，没有复制文件或素材。

## 1. 3D 与动效系统

### 三个 hook（新文件 `packages/dsh-muweave-core/src/client/motion.ts`）

| hook | 作用 | 边界 |
| --- | --- | --- |
| `usePrefersReducedMotion()` | 订阅 `(prefers-reduced-motion: reduce)`，初始化即读一次 | SSR 下读不到 `matchMedia` 返回 `false`；`addEventListener` 不支持时回退 `addListener` |
| `useTilt({ disabled })` | 把指针在元素内的位置归一化到 `-1…1`，写进 `--mw-tilt-x` / `--mw-tilt-y` | 元素宽高为 0 直接跳过；`disabled` 或 reduced-motion 时变量归零且不挂监听 |
| `useParallax(strength = 0.35)` | 把视口指针位置按 `strength` 缩放后写进 `--mw-parallax-x` / `--mw-parallax-y` | 有 clamp；`strength` 给非有限数时回落 0.35；`blur` 时归零 |

三个 hook 都只写 CSS 自定义属性，几何全留在 CSS 里算（`perspective(60rem) rotateX(calc(var(--mw-tilt-y) * -3deg)) rotateY(calc(var(--mw-tilt-x) * 3deg))`）。好处是组件里没有一行动画逻辑，reduced-motion 只要在 CSS 里关掉一条就够了。三个 hook 已从 `client/index.tsx` 导出，房间/插件可以直接用。

### `styles.ts` 新增

- `.mw-tilt`：常驻 `transform-style: preserve-3d` 与 3deg 上限的 rotateX/rotateY（变量为 0 时是恒等变换），hover 抬到 `--mw-elev-3`，过渡走 `--mw-dur-base` + `--mw-ease-out`。
- `.mw-dsh-card.mw-tilt[data-interactive="true"]:hover`：单独一条，否则倾斜卡片的 hover 会被卡片通用抬升规则（`translateY(-0.125rem)`）覆盖掉。
- `.mw-parallax .mw-ambient`：背景光斑按变量做 `translate3d`，两个轴都 `clamp` 到 ±0.75rem——手感有，位移不夸张。
- `@keyframes mw-spring-in` + `.mw-spring-in`：`scale(0.985) translateY(0.375rem)` 收正，`var(--mw-dur-base)`（200ms）+ `--mw-ease-out`。是"有回弹感的缓动"，不是物理弹簧。
- 卡片 hover 原本重复的两条规则合并成一条（`data-interactive` 抬升 + `:active` 回位）。
- 新增 reduced-motion 块：`.mw-cmdk-panel`、`.mw-dsh-card`、`.mw-tilt`、`.mw-spring-in`、`.mw-parallax .mw-ambient` 一律 `animation/transition/transform: none`，连 hover 变换一起归零。

### 组件接入口

`editorial.tsx` 的 `MediaCard` / `NoteCard` 增加可选 `tilt?: boolean`（默认 `false`）：为 true 时挂 `.mw-tilt`、拿 `useTilt` 的 ref 和两个变量。

## 2. 排期房间：键盘与拖拽

### 纯函数（新文件 `packages/dsh-muweave-schedule/src/interactions.ts`）

`addDays`、`startOfWeek`（周一起始）、`addMonths`（月底夹取：`2026-01-31` 加一个月得 `2026-02-28`）、`moveDayFocus`（方向键 ±1/±7、Home/End 到本周首尾、PageUp/PageDown 换月）、`pushUndo`（默认上限 20）、`popUndo`。全是 `YYYY-MM-DD` 字符串进出的纯函数，不碰 Date 时区。

### 日历键盘

- **roving tabindex**：整块日历只有焦点日那格 `tabIndex=0`，其余 `-1`，`aria-selected` 跟随；Tab 进日历一次就停在焦点日。
- **方向键** ±1 天 / ±7 天；**Home/End** 本周周一/周日；**PageUp/PageDown** ±1 月（跨月自动把 `cursor` 一起切过去）。
- **Enter**：有选中待排项 → 排到焦点日；否则清掉焦点日第一条。
- **Delete / Backspace**：清掉焦点日第一条。
- **`t`** 回今天，**`[` / `]`** 换月，**Ctrl/Cmd+Z** 撤销上一步。
- **撤销栈**最多 20 条，覆盖"排期"与"取消"两种动作；撤销是反向再调一次 `schedule.plan` / `schedule.clear`（服务端仍是唯一真源，没有本地影子状态），并在日历下给一行「已排到 X · 撤销」。
- 键盘提示 `dayNavHint` 中英双语，跟 `legendHint` 一起显示在日历下方。

### 拖拽状态

- 待排行 `draggable`，拖动中挂 `data-dragging="true"`（`.mw-sched-row[data-dragging="true"]`：透明度 0.72 + `rotate(-1deg)`）。
- 有选中项时所有格子挂 `data-drop-ready="true"`；`dragover` 的那格挂 `data-drop-active="true"`（2px 内描边 + 抬 `0.0625rem`），`dragleave` / `dragend` 清掉。
- 落下复用同一条 `plan()`；跨月落在目标月的同一天（落盘按日期，不跟随滚动）——与 v4 行为一致。
- 空态两处：待排池空 → 「没有待排内容」+ 「去总览同步 `.muweave/`」按钮；本月无排期 → 「这个月还没有任何排期。」单独一行。

## 3. 命令面板：最近使用与 `>` 前缀

- **最近命令**：localStorage key `muweave.cmdk.recent.v1`，最多 5 条；执行时前插去重，读写失败（隐私模式/嵌入环境）静默降级为空。
- 上次执行过的项**置顶成「最近」分区**（`commandGroupRecent`），其余按原分组顺延；分区按连续分组渲染。
- **`>` 前缀**：只筛操作组（`t('commandGroupActions')`），输入框 placeholder 换成 `commandActionHint`。
- **上下键循环**（`(n + delta + len) % len`）、**Tab 补全**（把当前项 label 填进输入框）、Enter 执行、Esc 关闭并把焦点还给打开它的元素。面板 portal 到 `document.body`，避开 `.mw-dsh-root` 的 `container-type` 造成的 fixed 定位陷阱（v3 的结论继续成立）。
- `command-dict.ts` 新增 `commandGroupRecent`、`commandActionHint`（`> 仅搜索操作`）、`commandUndoHint`，页脚改成 `↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭`，中英同步。

## 4. 规矩（本来就有，这轮继续守住）

- 只用 `--mw-*` token 与 `rem`；px 只允许 1px/2px 描边。`tests/styles-static.test.ts` 静态守着（10 项，本轮全绿）。
- `backdrop-filter` 只能在 `@supports` 里出现，无支持时有实色回退。
- 每个 `--mw-*` token 必须先声明再使用（静态测试会扫 CSS 里的 `var()` 和 TSX 里的 `'--mw-…'` 字面量）。
- `prefers-reduced-motion: reduce` 下动效必须**全停**：本轮新增的 `.mw-tilt`、`.mw-spring-in`、`.mw-parallax .mw-ambient`、拖拽态变换全部进 media 块归零。
- 内联样式只准写动态自定义属性、`gridTemplateColumns`、浮层坐标。

## 4.5 本轮真机实测（预览 profile `muweave-lan`）

- 视差：指针从左上移到右下，`.mw-ambient` 上的 `--mw-parallax-x` 由 `-0.43` 变到 `0.40`，`--mw-parallax-y` 由 `-0.33` 变到 `0.44`。
- 倾斜：委托监听生效，`data-mw-tilting="true"`，`--mw-tilt-x` 由 `-0.76` 变到 `0.76`；但 `transform` 未随之变化（见已知问题 1）。
- 排期键盘：`role="row"` 共 6 行；方向键把焦点从 `2026-11-01` 移到 `2026-11-03`。
- 单测：**110 项全过**（新增 `tests/interactions.test.ts` 6 项 + 反引号守卫 1 项）。
- e2e：`20261118103121162-muweave-dsh-b3936550`，`passed=true`。

## 5. 体积

`ls -l packages/*/lib/client.js`（未压缩，esbuild + tree-shaking；宿主只提供 react 等 seed，其余都打进各自那份）：

| 包 | v4 | v5 | Δ |
| --- | --- | --- | --- |
| core | 235 120 | 243 526 | +8 406 |
| workbench | 269 334 | 277 987 | +8 653 |
| drama | 264 279 | 272 851 | +8 572 |
| eikona | 263 219 | 271 520 | +8 301 |
| schedule | 253 051 | 270 341 | +17 290 |
| script | 259 523 | 266 046 | +6 523 |
| kit | 251 285 | 257 795 | +6 510 |

怎么读这组数：每个 `client.js` 都自带一份共享 CSS，所以新增样式会均摊到所有包——script 与 kit 各 +3 950 且分毫不差，基本就是"只吃到新样式"；用到 `motion.ts` 的房间再各多 +2.6~2.9KB；排期包另含 `interactions.ts`、键盘导航与撤销逻辑，涨得最多（+15 112）。tgz 六个包 188 659–198 089 字节（v4 是 187 740–196 888）。

## 6. 验证

按顺序串行跑，每步都过了才进下一步：

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（`tsc -b`，无输出） |
| `pnpm test` | **98/98**，14 个测试文件全绿（= 本轮前基线，本轮代码没带新增单测） |
| `pnpm build` | `Built 2 core packages + 6 DSH plugins successfully.` |
| `pnpm pack:plugins` | 6 个 tgz 落到 `.work/` |
| `pnpm test:integration` | **passed**，末行 `ALL OFFLINE REAL-HOST DSH PLAYWRIGHT E2E CHECKS PASSED.` |

e2e 证据目录：`temp/integration-test-runs/20261118100643753-muweave-dsh-06c4b7ec`（`summary.json`：`passed=true`、`provider_calls=0`、`web_profile_untouched=true`、`plugins_verified` 六个插件齐全；25 条 `Verified`；`artifacts/` 27 张截图 + `host-tokens.json`，含 `schedule-room-1440x900.png`、`desk-command-palette-1440x900.png`，以及 1440/1024/768/390 四档 light/dark。日志里排期旅程仍是 `Verified schedule room: planned "分镜摘要表 · breakdown:ep01" onto a day and cleared it again.`）

### 本轮验收里做的小修（行为不变）

1. 删掉 `schedule/src/client.tsx` 里未被引用的 `shiftMonth()`：月切换实际走 `addMonths`，这段是死代码。
2. `styles.ts` 的拖拽态选择器从 `.mw-sched-chip[data-dragging="true"]` 改成 `.mw-sched-row[data-dragging="true"]`：`data-dragging` 实际挂在待排行上，chip 不可拖，原选择器永远不生效（reduced-motion 块同步改）。
3. `scripts/run-integration-e2e.mjs` 的 `summary.json.plugins_verified` 补上 `@yeisme/dsh-muweave-schedule`：v4 加了排期插件却没更新这份硬编码清单，证据与实际验证的 7 个房间不一致。

## 7. 已知问题（没解决的，如实列）

1. **倾斜的 transform 仍未落到画面上（本轮已定位到机制，但没修掉）**：卡片身上有一个持续 `running` 的 `mw-rise` 入场动画（`fill-mode: both`）。CSS 动画在运行期间独占 transform 通道，优先级高于普通声明**也高于内联 style**，所以 `--mw-tilt-x/y` 无论怎么算、`transform` 写在哪一层都会被压回 none。已试过并**排除**：`.mw-dsh-root` 前缀提高特异性、把入场动画换成只动 opacity 的 `mw-fade-in`、由委托 hook 直接写内联 transform。下一步方向：找出给交互卡片挂 `mw-rise` 的那条规则（不是 `.mw-dsh-card[data-interactive]`，另有其处）、确认 `--mw-dur-base` 是否未定义导致动画永不结束，或把入场动画整体挪到容器层。
2. **chip 上的键盘语义不精确**：Enter/Delete 由日历容器的 `keydown` 统一处理，作用对象是"焦点日的第一条"（`rows[0]`），不是你聚焦的那条 chip；`preventDefault` 之后按钮自身的激活不再发生。同一格排多条时键盘容易清错条目，有选中待排项时 Enter 又变成"排入"而不是"清除"。属交互设计问题，本轮没动。
3. **新逻辑没有单测**：`motion.ts` 与 `interactions.ts` 都没有测试；新快捷键、撤销、最近命令、`>` 前缀、`tilt` 也都没有 e2e 覆盖（e2e 仍只跑 v4 的排期旅程与命令面板基本项）。
4. `commandUndoHint` 键名与内容不符（值是"Tab 补全"），当前无消费方。
5. `savedNotice` 与 `undoNotice` 文案重复；`MoveDayOptions.monthStart` 传了但函数没用。
6. `>` 模式下 Tab 补全会把 `>` 前缀吃掉（补全成完整 label 后回到全量列表）。
7. 日历无障碍还差一层：`role="grid"` 下直接是 `gridcell`，没有 `row`。
8. 预览服务（隔离 profile `muweave-lan`，4283）里装的还是上一轮的 tgz，本轮没重装也没重启它；要看 v5 效果得按 desk-v4.md 的「刷新已安装的预览」重新解包覆盖并重启该 profile。

## 8. 不做（说清楚为什么）

- **真物理弹簧**：要引动画库或自己写 rAF 积分器，为一个 200ms 的入场不值当；`--mw-ease-out` 近似已经够。
- **3D 场景（WebGL / Three.js）**：卡片倾斜用 CSS 3D 就够，引引擎等于给每个包加几百 KB 和一层 GPU 预算。
- **跨月拖拽手势**：拖到边缘自动翻月要处理悬停计时、滚动同步、拖拽中重挂 DOM，本轮只做"落到目标月同一天"。
- **把倾斜/视差接进房间**：房间版式还在动，先把 hook 与样式定稿，接进去又改一遍不划算。
