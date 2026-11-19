# 提案：幕织 DSH 工作台 v3（Desk）

## Why

editorial v2 解决的是"颜色和字体像不像自媒体工作台"，用起来仍然像控制台：左栏常驻 14rem 的领域筛选与上游就绪度，把创作区挤窄；页签行里同时挤着 stage 页签和三组布局控件（平衡/专注/对比、单屏/左右/上下、左右栏开关）；房间导航和 stage 页签是两层同重的药丸；点击任一元件卡后右栏检查器不出现（选中态没有回写 `showRight`）。参考对象 dsh-media-desk 的手感是：一层导航、全宽画布、卡片承载内容、控件收进浮层。

## What Changes

1. **舞台即页面。** `[data-muweave-pane="stage"]` 去掉 `--mw-card` 底色、圆角和阴影，页签条改透明吸顶（毛玻璃只在 `@supports` 内）。纸张层次只留给卡片。
2. **控件收成一层。** 布局、分屏、检查器开关全部进一个「视图」popover（宽窄屏一致）；stage 页签从药丸改下划线文字页签，视觉权重低于房间导航。移除窄屏专用的第二套 popover 分支。
3. **筛选变浮层。** `leftTree` 不再占列，默认关闭；「筛选」按钮打开 16rem 浮层（保留 `data-muweave-pane="left"` 钩子），点外部或 Esc 关闭。
4. **⌘K 命令面板。** 新增 `command-palette.tsx`：房间（剧场）、stage 视图、操作（生成台/助手/同步/筛选/布局）统一可搜索，↑↓ 选择、Enter 执行、Esc 关闭、关闭后焦点归位；portal 到 `document.body`，避免宿主 `container-type` 把 fixed 变成画布内定位；`.mw-cmdk` 加入 token 作用域。
5. **`/` 聚焦助手**：三态浮窗展开为 panel 并聚焦输入。
6. **检查器跟随选择**：`rightInspector` 由无到有时自动展开，由有到无时收起。
7. **宿主兼容**：`engines.dsh` 由固定 `0.2.2-rc.1` 放宽到 `>=0.2.2-rc.2 <0.3.0`（`semver.satisfies` 实测 rc.2/rc.3 均满足）；kit 的 PTC 预设补 `tool-office` 行；`tests/kit.test.ts` 改为从 PATH 上的 `dsh` 反查宿主预设（可用 `MUWEAVE_HOST_DSH_PRESET` 覆盖），不再写死 Homebrew 路径；`pnpm test` 在 Node 26 上补 `--localstorage-file`。
8. **e2e 与证据**：布局控件改为先开「视图」浮层；新增筛选浮层开合、⌘K 面板开合与筛选、全宽断言；新增 `desk-filter-popover-*.png`、`desk-command-palette-*.png`；证据里的宿主版本改为 `dsh --version` 实测。

## Impact

- 只改展示层与宿主版本范围。RPC、`.muweave/` 格式、宿主槽位、插件注册、可访问名与 e2e 现有 `data-*` 钩子全部保留。
- 每个插件 `lib/client.js` 约 +16KB，tgz 180–189KB，仍未打包第二份 react。
- `engines.dsh` 放宽后 rc.1 不再受支持；rc.1 与 rc.2/rc.3 的 PTC 预设差一行 `tool-office`，无法同时对齐。当前两套宿主（Mac rc.3、node1 rc.2）都是 rc.2+。
- 未新增排期/复盘/风格页，理由见 `docs/design/desk-v3.md`「不做」。
