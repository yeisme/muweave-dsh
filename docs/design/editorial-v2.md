# 幕织 DSH 做剧剧场 视觉 v2（editorial）

OpenSpec：`../../openspec/changes/muweave-dsh-editorial-v2/`。本次只改展示层；RPC、`.muweave/` 格式、宿主槽位、可访问名都没有动，e2e 用到的 `data-*` 钩子也全部保留。

视觉规则参考 dsh-media-desk（MIT），没有复制它的文件、CSS 或素材。v1 的暮紫强调色和表格优先的版式由本文取代，见 [visual-polish-v1](./visual-polish-v1.md)。

## 规矩

- **单色。** 主按钮用墨色胶囊：`--mw-accent` 取宿主 `--dsw-alias-button-primary-fill`，文字用 `label-primary-inverted`；次级按钮是玻璃胶囊加 0.5px 内描边。没有品牌强调色，也不用橙色。状态色保留 oklch，但只做 14% 的柔底，文字仍用中性色。
- **字体。** 标题用宋体（`--mw-serif`）；西文和数字用斜体衬线（`--mw-latin-serif`）；统计数字用 `tabular-nums`。
- **层次。** 卡片用 `--mw-r-xl` 圆角，阴影用 `--mw-elev-1`，悬停时升到 `--mw-elev-2`。媒体区在卡片里缩进，有自己的圆角。卡片上的操作是圆形玻璃按钮，悬停或 `:focus-within` 时出现。
- **氛围。** 背景有三团低彩度光斑（色相 255 / 345 / 150，chroma 不超过 0.06），缓慢漂移，`prefers-reduced-motion` 时停止。顶部房间导航和悬浮输入条用毛玻璃。内容进场时上浮一点（`mw-rise`）。
- v1 的约束继续有效：只用 rem（px 只允许 1px、2px 发丝线）；内联 style 只能写 `--mw-*` 自定义属性；选中态保持中性；每个控件都有 `:focus-visible`。

`tests/styles-static.test.ts` 新增了三条守护：

1. 不许出现 oklch 色相 290–320 且 chroma 大于 0.08 的颜色，防止暮紫回来。
2. `--mw-accent` 必须指向宿主 primary fill；光斑恰好三个，每个 chroma 不超过 0.06。
3. `backdrop-filter` 只能写在 `@supports (backdrop-filter…)` 块里，块外先给不透明底色。

## Token（新增）

| 组 | Token |
| --- | --- |
| 字体 | `--mw-serif` `--mw-latin-serif` |
| 面 | `--mw-card`（bg-layer-2） `--mw-glass`（card 72%） `--mw-glass-solid` |
| 阴影 | `--mw-elev-1/2/3`，对应宿主 `--dsw-elevation-soft/prominent/panel`，带 rem 回退 |
| 圆角 | `--mw-r-xl` `--mw-r-panel` |
| 缓动 | `--mw-ease-out` |
| 版式 | `--mw-media-ratio`（MediaCard） `--mw-card-min`（Masonry 列宽） |

## 共享原语（`@yeisme/dsh-muweave-core/client`）

- `editorial.tsx`：`PillButton`（primary / quiet）、`RoomHero`、`HeroStat`、`CoverCollage`、`Poster`、`MediaCard`、`NoteCard`（`ink` 为反色卡）、`QuoteCard`、`Masonry`、`AmbientBackdrop`。
- `media.tsx`：`MediaPreview`、`useMediaUrl`、`useProjectCovers`。
  - `useProjectCovers` 从 Eikona 候选组里取前几张真实图片。候选摘要每个 rpc 客户端只读一次；媒体 URL 会过期，所以每次挂载都重新解析。
  - 没有图片时显示宋体排版海报，不放假图。
- `RoomNav`：宽屏时的玻璃胶囊房间导航，当前房间有 `aria-current="page"`，保留 `data-room-id` 和 Alt+N。窄屏仍用菜单。
- `WorkspaceShell` 新增 `hero` 参数。hero 跟着 stage 一起滚动，页签条吸顶。剧场模式下由 hero 显示副标题，顶栏不再重复，免得工具条被挤到第二行。

## 五个房间

| 房间 | hero | 默认正文 |
| --- | --- | --- |
| 总览 | 「今天的片场」+ 带内联缩略图的长句；统计：元素、Pi、DSH、过期 | 瀑布流元素卡，第一张是反色「下一步」卡 |
| 视觉 | 当前候选组；统计：候选、组、母版、评分；封面拼贴；「引用整组」 | 瀑布流 MediaCard：采纳用墨色胶囊，拒绝用玻璃胶囊，收藏、交接、固定、@ 在悬停时出现；2-up / 4-up 控制列宽 |
| 剧本 | 时间线或场次标题；统计：场次、改写、过期基线 | 场次卡页签改成左右两栏，左边是阅读卡（目标 / 阻碍 / 转折），右边是场次卡 |
| 分镜生产 | 分镜表标题；统计：镜数、总秒数、就绪资产 | 分镜网格「01 · 3.5 秒」加镜号海报；资产用 NoteCard 显示四轴；「卡片 / 表格」切换，表格就是原表 |
| 工具箱 | 「Creator Toolkit」；统计：模板、技能、CLI | 第一个模板是反色卡；技能和 CLI 用瀑布流 |

## 宿主 token 实测（P0）

e2e 在 DSH 0.2.2-rc.1 的浅色和深色主题下各读一次 computed style，结果写进证据目录的 `host-tokens.json`：

- 除 `--dsw-alias-button-primary-fill-hover` 外，所有 token 在两种主题下都有值。hover 为空时，用 `color-mix` 回退。
- elevation-soft 在浅色主题下是 0.5px 黑色描边环加两层大模糊浅阴影；深色主题的描边环换成浅色。
- radius 依次为 sm 8 / md 12 / lg 16 / xl 20 / panel 28（px）。
- primary-fill 浅色为近黑，深色为近白；label-inverted 与之相反。bg-layer-2 浅色为白，深色为深灰。

## 体积

editorial 原语和 CSS 打进每个插件，`lib/client.js` 每个约增加 22–28KB（未压缩），没有打包第二份 react：

| 包 | lib/client.js 前 → 后 |
| --- | --- |
| core | 138 503 → 161 368 |
| workbench | 158 562 → 181 737 |
| eikona | 164 786 → 187 645 |
| script | 162 447 → 182 843 |
| drama | 157 254 → 184 821 |
| kit | 155 779 → 174 266 |

tgz 约 116–122KB。

## 验证

- `pnpm typecheck` 通过；`pnpm build`、`pnpm pack:plugins` 通过。
- `pnpm test`：39 项中 38 项通过。新增 `tests/editorial.test.tsx`（6 项）；静态守护共 10 项。唯一失败的是 `tests/kit.test.ts` 的 preset 对齐检查。它对比的是本机安装的 dsh，与本次改动无关，见下节。
- `pnpm test:integration` 连续三次通过（最后一次在最终代码上）。e2e 新增了以下检查：
  - 通过胶囊导航进入房间，并核对 `aria-current`；
  - 每个房间都显示 hero；
  - 分镜默认是网格；
  - Eikona 封面图解码成功（`naturalWidth > 0`）；
  - 1440 / 1024 / 768 / 390 四档的浅色、深色截图；
  - 设置入口按可见区域做重叠检查。
- 变异抽查三条，每条都先变红再恢复：
  1. `--mw-accent` 改回色相 308，静态守护变红。
  2. 去掉 RoomNav 的 `aria-current`，单测变红。
  3. 让 hero 不使用真实封面，e2e 封面断言超时变红。

## 宿主版本说明

插件的 `engines.dsh` 固定为 `0.2.2-rc.1`。如果本机全局 dsh 已经升级到更新的 rc，安装会被拒绝，preset 对齐单测也会失败（新宿主调整了 `tool-office` 的位置）。**这条限制已由 [工作台 v3](./desk-v3.md) 解除**：范围放宽到 `>=0.2.2-rc.2 <0.3.0`，kit 预设补上 `tool-office`，单测改为解析本机安装的 dsh；仍要跑 rc.1 的集成测试时，可把 rc.1 装到临时前缀并放到 PATH 前面。
