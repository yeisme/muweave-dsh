# 提案：幕织 DSH 插件视觉打磨（v1）

## Why

五个 DSH 插件功能 v1 已齐，但视觉仍是脚手架水平：顶栏十余个同权重按钮挤成两行；Eikona 4-up 卡片文字重叠；空的对比栏与 Inspector 仍各占一列；状态徽标直接露出 `waiting_review` 等原始枚举；约 90 处内联 `style={{}}`，没有 token、没有 `:focus-visible`；悬浮输入条按钮是“▴ Expand Panel”式文字，窄屏下输入框被挤没。

## What Changes

1. `dsh-muweave-core` 新增 `--mw-*` 设计 token 层（颜色取自宿主 DSH alias 并带回退，填充与线条由 label 色混出，浅深色主题通用）与一组通用类（布局、按钮四变体、分段控件、状态标签、表格、空态、骨架、表单、指标卡、callout）。
2. 外壳重排：顶栏一行（标题、副标题、插件动作、同步）；布局、左右栏开关和分屏收进 tab 行右端的图标分段控件，窄屏（<860px）时折进“视图”菜单；对比栏为空时只显示细的放置提示；Inspector 只在有内容时出现；回执改用顶栏下的可关闭提示条。
3. 新增共享 UI 原语：`Icon`、`IconButton`、`Segmented`、`StatusTag`（原始枚举经 i18n 转成中/英标签和色调）、`EmptyState`、`SectionHead`、`Callout`、`CompanionList`。
4. 五个插件逐个改用通用类与原语，数据与 RPC 行为不变：Eikona 三段候选卡与评分条；Drama 粘性表头分镜表、资产四轴圆点、片段轨道；Script 双轨时间轴、字段化场次卡表单、过期 warn 提示；Workbench 指标卡、领域导航、按需 Inspector；Kit 模板卡片网格、技能网格、CLI 卡输出块。
5. 新增静态守护测试 `tests/styles-static.test.ts`。

## Impact

- 只改展示层；RPC、`.muweave/` 物化格式、宿主路由与插件注册方式不变。
- e2e 依赖的可访问名（`左右对比`、`同步 .muweave/`、`展开对话浮窗`、`最小化为胶囊`、`在对话页打开完整会话`）、`data-*` 钩子与面板标题匹配全部保留。
- 单测中依赖界面文字的断言改用 i18n 键。
