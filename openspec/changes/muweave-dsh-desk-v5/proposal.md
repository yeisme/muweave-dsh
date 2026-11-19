# 提案：幕织 DSH 工作台 v5（3D 与动效 · 排期手速 · 命令面板记忆）

## Why

v4 把排期房间、`@`/`/` 排序与浮层深度补齐了，但三件事没闭环：

1. **"浮起来"只在阴影上**。v4 的三层阴影解决的是层次，没解决空间感：卡片是贴纸，不是可以偏一点的纸。动效也没有统一闸门，`prefers-reduced-motion` 靠一条条 CSS 各自处理，新加动效极易漏。
2. **排期只能靠鼠标**。键盘用户无法按日移动、排入、取消，换月要点按钮；拖动待排项时拖拽源和落点都没有任何视觉反馈，拖到哪儿全靠猜。
3. **命令面板每次都从零找**。高频操作（同步、打开生成台、开助手）每次都要在房间和视图里滚一遍；也没有"只看操作"的收窄手段。

## What Changes

1. **动效系统**：新增 `packages/dsh-muweave-core/src/client/motion.ts`——`usePrefersReducedMotion`（matchMedia 订阅 + SSR 保护）、`useTilt`（指针位置归一化写 `--mw-tilt-x`/`--mw-tilt-y`，`disabled`/reduced-motion 归零）、`useParallax`（视口指针写 `--mw-parallax-x`/`--mw-parallax-y`），三个 hook 从 `client/index.tsx` 导出。hook 只写 CSS 变量，几何全在 CSS：`styles.ts` 新增 `.mw-tilt`（3deg 上限的 CSS 3D 倾斜 + `preserve-3d` + hover `elev-3`）、`.mw-parallax .mw-ambient`（光斑 ±0.75rem 视差）、`@keyframes mw-spring-in` + `.mw-spring-in`（200ms 收正缓动）。`MediaCard`/`NoteCard` 增加可选 `tilt`。卡片 hover 的重复规则合并，reduced-motion 块覆盖上述全部新类。
2. **排期键盘与拖拽**：新增 `packages/dsh-muweave-schedule/src/interactions.ts`（`addDays`/`startOfWeek`/`addMonths`/`moveDayFocus`/`pushUndo`/`popUndo`，纯字符串日期函数，月底夹取）。日历改 roving tabindex：方向键 ±1/±7、Home/End 到本周首尾、PageUp/PageDown 换月、Enter 排入或清除、Delete/Backspace 清除、`t` 回今天、`[`/`]` 换月、Ctrl/Cmd+Z 撤销（20 条栈，撤销走反向 RPC）。拖拽给出三态钩子：源 `data-dragging`、可落格 `data-drop-ready`、落点 `data-drop-active`。两处空态补引导（含「去总览同步 `.muweave/`」动作）。
3. **命令面板**：最近命令落 localStorage `muweave.cmdk.recent.v1`（最多 5 条，前插去重，读写失败静默降级），置顶成「最近」分区；`>` 前缀只筛操作组并换 placeholder；上下键循环、Tab 补全。`command-dict.ts` 补 `commandGroupRecent`/`commandActionHint`/`commandUndoHint`，页脚加「Tab 补全」，中英同步。
4. **验收**：五个命令串行跑通；顺手修三处（`shiftMonth` 死代码、拖拽态 CSS 选择器与实际 DOM 不一致、e2e `summary.json.plugins_verified` 漏了 schedule）。

## Impact

- 不改 `.muweave/` 契约、不改 RPC、不加包、不加依赖；`README.md` 包表与 `package.json` 不变。
- 体积：7 个 `lib/client.js` 全部上涨——script/kit 各 +3.9KB（只吃到共享 CSS），eikona +6.4KB，workbench/drama 各 +6.7KB（多吃进 `motion.ts`），core +7.9KB，排期包 +14.8KB（键盘/撤销/拖拽）。tgz 188 659–198 089 字节，无第二份 react。
- `tilt` / `useParallax` / `mw-spring-in` 已导出但暂无消费方，界面暂不显示倾斜与视差——先把 API 与样式定稿，房间接入下一轮。
- 未做真物理弹簧、3D 场景（WebGL）、跨月拖拽手势；新逻辑暂无单测，e2e 仍只覆盖 v4 旅程。
