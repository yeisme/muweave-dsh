# 幕织 DSH 插件视觉打磨 v1

> 配色与版式已被 [视觉 v2（editorial）](./editorial-v2.md) 取代：暮紫强调色改为宿主墨色，房间改为 hero + 卡片。rem、token、焦点环、状态标签等其余规矩仍然有效。

OpenSpec：`../../openspec/changes/muweave-dsh-visual-polish-v1/`。只改展示层，RPC 与 `.muweave/` 不变。

## 规矩

- 颜色只用 `--mw-*` token。token 在 `.mw-dsh-root`、`.mw-dsh-float-root`、`.mw-dsh-companion` 上声明，先取宿主 DSH alias（`--dsw-alias-*`），不行再用回退值。填充和线条从 label 色混出来，所以浅色和深色宿主都能直接用，不需要切主题。
- 暮紫 `--mw-accent`（oklch 色相 308）只用于主按钮和焦点环。选中态是中性填充加深一级的线，不画彩色竖条。不用橙色。
- 长度一律用 rem。px 只允许 1px/2px 发丝线。
- 内联 `style` 只允许三种：动态自定义属性（`--mw-*`、`--dr-*`）、工作区 `gridTemplateColumns`、悬浮助手坐标。
- 每个可交互控件都要有 `:focus-visible` 环（2px accent）。动效在 `prefers-reduced-motion: reduce` 下全部停掉。
- 原始枚举（`waiting_review`、`reconcile_required` 等）不直接显示。用 `StatusTag` 显示：`statusTone` 给色调，`statusLabel` 给中/英标签，原值留在 `data-status` 和 tooltip 里。

以上规矩由 `tests/styles-static.test.ts` 守护。抽查过三条：去掉对应修复后测试会变红。

## Token

| 组 | Token |
| --- | --- |
| 文字 / 底 | `--mw-label` `--mw-label-2` `--mw-label-3` `--mw-surface` |
| 填充 / 线 | `--mw-fill-1..3` `--mw-line` `--mw-line-strong` `--mw-selected` |
| 强调 | `--mw-accent` `--mw-accent-hover` `--mw-accent-text` `--mw-accent-fill` `--mw-on-accent` |
| 状态色调 | `--mw-ok`(155) `--mw-warn`(92) `--mw-bad`(25) `--mw-info`(245) `--mw-neutral`，组件内经 `[data-tone]` 设到 `--mw-tone` |
| 尺度 | `--mw-r-1..3` `--mw-r-pill` `--mw-s-1..6` `--mw-shadow-1/2` `--mw-dur-fast/base` `--mw-ease` |
| 其它 | `--mw-mono` `--mw-card-min`（`.mw-grid-auto` 最小卡宽） `--mw-bar`（meter 百分比） |

## 外壳

- 顶栏只有一行：左边是标题和副标题，右边是插件动作和“同步”（ghost 按钮，带“已同步 HH:MM”）。
- 布局（平衡/专注/对比）、左右栏开关和分屏（单屏/左右/上下）都放在 tab 行右端，用图标分段控件。宽度小于 860px 时，这些控件折进“视图”菜单。
- 对比栏没有内容时，只显示一条虚线放置提示。Inspector 只在插件传入内容时出现。回执显示在顶栏下方的可关闭 notice 条里。
- ProgressStrip 由状态点、文字和操作组成，空闲时降为低对比。悬浮助手的按钮全部改成图标，输入框最小宽度 6rem。

## 共享原语（`@yeisme/dsh-muweave-core/client`）

`Icon`、`IconButton`、`Segmented`、`StatusTag`、`ToneDot`、`EmptyState`、`SectionHead`、`Callout`、`CompanionList`。插件私有的少量样式也放在 core 的 CSS 里，用前缀区分：`ek-`、`dr-`、`sc-`、`kt-`。

## 体积

core 的 CSS 和原语会打进每个插件。`lib/client.js` 每个约增加 36KB（未压缩），tgz 每个约增加 7–8KB：

| 插件 | lib/client.js 前 → 后 | tgz 前 → 后 |
| --- | --- | --- |
| workbench | 76 954 → 112 689 | 89 409 → 97 109 |
| eikona | 81 097 → 118 905 | 88 041 → 96 392 |
| script | 79 944 → 116 570 | 87 616 → 95 389 |
| drama | 74 077 → 112 061 | 86 693 → 94 702 |
| kit | 74 927 → 106 405 | 94 548 → 101 330 |
