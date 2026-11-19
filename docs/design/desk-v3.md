# 幕织 DSH 工作台 v3（Desk）

参考对象：[自媒体工作台 dsh-media-desk](https://github.com/woniuniuniu/dsh-media-desk)（MIT）的**版面手感**：一层导航、全宽画布、卡片承载内容、浮层承载控件。只借鉴交互与版式，没有复制它的文件、CSS 或素材。

v2（[editorial](./editorial-v2.md)）解决的是"颜色和字体像不像"，这一轮解决的是"用起来像不像工作台"：把**元件控制台**的三栏骨架改成**创作画布**的单栏骨架。

## 之前的问题

| 现象 | 原因 |
| --- | --- |
| 内容区被挤到中间 | 左栏 14rem 常驻，装的是「按领域筛选」和「上游 owner 就绪度」——工程信息占了创作区 |
| 一行里三组控件 | stage 页签、Balanced/Focus/Compare、单屏/左右/上下 全挤在页签行右侧 |
| 两层药丸 | 房间切换一层药丸，stage 页签又一层药丸，视觉重量相同，分不清主次 |
| 点了卡片没反应 | 右栏检查器初始 `showRight=false`，选中元素后状态不回写，检查器永远不出现（缺陷） |
| 桌面舞台像张卡 | 舞台自带 `--mw-card` 底色、圆角和阴影，卡片在卡里，层次失真 |

## 这一轮的规矩

- **舞台即页面。** `[data-muweave-pane="stage"]` 去掉底色、圆角和阴影；纸张阴影只留给卡片（`--mw-elev-1/2`）。页签条改为毛玻璃吸顶，滚动时内容从它下面穿过。
- **一层控件。** 布局（平衡/专注/对比）、分屏（单屏/左右/上下）、检查器开关，全部收进一个「视图」popover，宽窄屏一致。stage 页签从药丸改成**下划线文字页签**，选中态用 1px 下划线而不是白底阴影——它比房间导航低一级。
- **筛选变浮层。** `leftTree` 不再占列，默认关闭；「筛选」按钮打开 16rem 浮层（`[data-muweave-pane="left"]`），点外部或 Esc 关闭。内容区因此拿到全部宽度。
- **⌘K 命令面板。** 一个可搜索列表装下：房间（剧场）、stage 视图、操作（打开生成台 / 幕织助手 / 同步 `.muweave/` / 筛选 / 布局）。↑↓ 移动、Enter 执行、Esc 关闭；关闭后焦点回到打开它的按钮。子序列匹配，中文和拼音串都能命中。
- **`/` 聚焦助手。** 不在输入框里时按 `/`，把三态浮窗展开成 panel 并聚焦它的输入。
- **检查器跟着选择走。** `rightInspector` 从无到有时自动展开，从有到无时收起——修掉上面那条缺陷。
- **仍然只用 token 与 rem。** 新增样式全部走 `--mw-*`；`backdrop-filter` 只在 `@supports` 块里；`prefers-reduced-motion` 下关闭遮罩与入场动画。

## 新增字符串

`command-dict.ts` 单独一份中英词表（`commandPalette`、`commandPlaceholder`、`commandEmpty`、`commandGroupRooms`、`commandGroupViews`、`commandGroupActions`、`commandFooter`、`commandOpenHint`、`filterPane`、`filterPaneLabel`、`palette*`），分别 spread 进 `zhDict` / `enDict`，`MuweaveDictKey` 自动扩展。

## 宿主兼容（顺带修掉）

- `engines.dsh`：`0.2.2-rc.1` → `>=0.2.2-rc.2 <0.3.0`。rc.1 之后宿主没有别的破坏性变化，但 rc.2/rc.3 的 `ptc.patch.yml` 多了 `tool-office`；写死 rc.1 会让插件**在任何当前宿主上都装不上**（`dsh` 用 `semver.satisfies` 判定，实测 rc.2、rc.3 都满足新范围）。
- kit 的 `preset-muweave-creator` 补上 `tool-office` 行，与 rc.2/rc.3 的 PTC 预设对齐。
- `tests/kit.test.ts` 不再写死 `/home/linuxbrew/...`，改为从 PATH 上的 `dsh` 反查包根，找不到再退回两个常见前缀；可用 `MUWEAVE_HOST_DSH_PRESET` 直接指定。
- `pnpm test` 在 Node 26 上加 `--localstorage-file`：Node 22+ 自带 `localStorage` 全局，未给文件时会盖掉 jsdom 的实现，导致做剧剧场用例报 `reading 'getItem'`。
- e2e 证据里的宿主版本改为实测（`dsh --version`），不再写死 rc.1。

## 体积

`lib/client.js`（未压缩，每个插件各带一份 core）：

| 包 | v1 creator platform 后 → 本轮后 |
| --- | --- |
| core | 207 981 → 224 511 |
| workbench | 241 519 → 258 783 |
| eikona | 235 404 → 252 668 |
| script | 231 708 → 248 972 |
| drama | 236 464 → 253 728 |
| kit | 223 470 → 240 734 |

每个插件约 +16–17KB（命令面板 + 浮层样式），tgz 约 181–189KB。

## 验证

- `pnpm typecheck`、`pnpm build`、`pnpm pack:plugins` 通过。
- `pnpm test`：**84/84 通过**（此前 83/84，唯一失败项就是这个 kit 版本对齐）。
- `pnpm test:integration`（离线、真实宿主、假 owner）：截图新增 `desk-filter-popover-1440x900.png`、`desk-command-palette-1440x900.png`；断言新增"筛选浮层开合""⌘K 面板搜到分镜行后 Esc 关闭"。
- 单测新增：`core-client.test.tsx` 覆盖"左栏默认不渲染 → 点筛选出现 → Esc 消失"与"⌘K 打开 → 选主视图B 切换 → 面板关闭"。

## 不做（下一轮）

- **排期 / 复盘 / 风格** 三页。它们要有真实数据源（发布记录、平台数据、风格卡）才成立，现在照抄版式只会造空壳。
- **元素全文搜索进 ⌘K**。需要一条"全局选中元件 → 对应房间定位"的通道，插件分属不同 bundle，得先在 core 立一个 seat，本轮没做。
- **拖拽绑定**。`.muweave/` 绑定的写入路径已经够用，拖拽要先定"非法投放"的反馈规范。
