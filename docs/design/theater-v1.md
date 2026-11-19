# 幕织 DSH 做剧剧场 v1

OpenSpec：`../../openspec/changes/muweave-dsh-theater-v1/`。在视觉打磨 v1 之上做。RPC 和 `.muweave/` 的格式都不变。

## 一个入口

- 左栏原有 5 个入口（原件总览 / Eikona 视觉元件台 / 剧本编剧室 / 做剧分镜与生产台 / 创作工具箱），现在合并成一个「做剧剧场」：`main` 和 `sidebar.panellist` 的 id 都是 `muweave-theater`，order 是 41。
- 每个插件不再注册自己的页面，而是通过 `registerMuweaveCreatorPlugin` 往剧场里登记一个「房间」：总览 / 视觉 / 剧本 / 分镜生产 / 工具箱。原来的全名留作房间说明，同时作为页面里视觉隐藏的 h1。
- 右栏的 5 个 companion 合成一个「做剧」tab（`muweave-theater/companion`），用房间筛选。
- 下面这些共享座位的注册方式相同：`main`、`sidebar.panellist`、右栏 tab、`shell.overlay`（悬浮助手）、会话标题按钮、`@` / `/` 触发源。

## 座位交接

- 五个插件各带一份 core。共享状态放在 `globalThis.__YEISME_MUWEAVE_THEATER__`，包括房间表、座位持有者和 React context。
- 每个共享座位只由一个插件注册，就是持有者。持有者被停用或热重载 dispose 时，下一个仍在运行的插件立即重新注册。这样座位不会重复，也不会消失。全部插件卸载后，所有座位清空。

## 房间切换器

- 剧场顶栏左边是 Codex/Claude 式的工作区按钮：图标、房间名、⌄，下面一行小字显示同步状态。点开是 `role="menu"`，每一项是 `menuitemradio`，包含房间名、说明和 `Alt+N` 键位提示。当前房间打 ✓，选中样式保持中性。
- 键盘操作：方向键移动，Enter 选中，Esc 关闭并把焦点还给按钮。剧场激活时，`Alt+1…5` 直接切换房间。
- 上次所在的房间记在 `localStorage['muweave.theater.room']`。如果这个房间的插件已经卸载，就回到第一个房间。
- 切换房间会重新挂载整个房间，切换器也随之重建。为了把焦点留在新的切换器上，用一个模块级的 pending 标记，在挂载时补一次 focus。
- 顶栏允许换行。窄屏（390）时，房间的插件动作换到第二行并右对齐，不再和切换器互相覆盖。
- 顶栏右边是「回到对话」（`selectPanel(null)`）。做剧会话的标题旁有「剧场」按钮（`conversation.session.header.actions`），两者是一对往返入口。

## 会话「做剧」view

- drama 插件注册一个 `conversation.view`：id 是 `muweave-drama`，标签是「做剧」，order 是 20，排在轨迹后面。这个 view 只显示本会话视角，不复制剧场的页面。
- 顶部是 `ProgressLine`（场次 · 镜头 · 资产就绪）和「在剧场打开」按钮。
- 分区（`Segmented`）有四个：
  - 「本会话 N」：这个会话里 `@` 过的元素，以及从悬浮助手交接进来的元素。数据存在 `localStorage['muweave.session-log.<sid>']`，最新的在前，最多 50 条。每行有状态标签、「在剧场定位」（打开该元素所属的房间）、「复制引用」。
  - 分镜 / 剧本 / 资产：只读的紧凑摘要，每段显示条数有上限，超出的部分点「在剧场看全部」。
- 空态文案是「这个会话还没碰过做剧内容。」，下面附「进入做剧剧场」。

## 共享做剧组件（`drama-components.tsx`）

`loadDramaDigest` / `useDramaDigest` 把 drama 和剧本场次元素读成摘要。另外有四个展示组件：`ShotStrip`、`ReadinessDots`（四个轴，每个点都有文字标注）、`SceneMini`、`ProgressLine`。剧场的分镜生产房间和会话 view 都用这几个组件。

## 宿主事实（DSH 0.2.2-rc.1 实测）

- `conversation.view` 注册时 `inject(sessionId)` 的返回值会展开成组件 props。宿主没有按会话隐藏 view 的开关，所以对非做剧会话显示空态。
- `conversation.session.header.actions` 在新建的空会话里也存在。会话的「更多」菜单归 `views.actions` 管。
- `ctx.slots.inject` 返回 disposer。
- 插件代码里的 `globalThis` 不是页面的 `window`，插件的 `console` 输出也被宿主吞掉。所以 e2e 拿不到插件状态，只能断言 DOM 和网络。

## 顺带修复

- **`ClientGenerationGuard` 误丢响应。** 同一代（generation）的并行读取可能乱序返回，旧逻辑会把先发后到的响应当成过期结果丢掉。结果是分镜表偶尔为空，Eikona 偶尔显示「0 候选」。现在同代的响应一律接受。`tests/core-host.test.ts` 加了回归测试。
- **`pnpm test:integration` 不重新打包。** `run-integration-e2e.mjs` 只安装 `.work/*.tgz`，所以改了代码以后测的仍是旧包。现在这个脚本会先跑 `pack-plugins.mjs`，后者自己会先构建。
- e2e 的 RPC 诊断只记录 action、ok、generation 和错误码，不记录响应体，因为媒体令牌一类内容可能出现在响应体里。

## 验证

- 单测在 `tests/theater.test.tsx`，覆盖：
  - 座位交接；
  - 五个真实插件只注册一个入口，且只有一个会话 view；
  - 切换器的键盘操作、Alt+N 和记住房间；
  - 会话 view 的空态和日志行。
- 变异抽查三条：去掉交接、去掉 Esc 关闭、不注册 view，每条都会让测试变红。
- 真实宿主 e2e 有以下断言：
  - 侧栏只有一个「做剧剧场」；
  - 通过切换器进入 5 个房间；
  - Alt+2 能切换房间；
  - 会话里有「做剧」tab 和进度行；
  - 「剧场」到「回到对话」的往返正常。

  另截了四档宽度的截图和切换器菜单打开时的截图。修复后连续跑 6 次全部通过；窄屏修正后又跑 2 次，也全部通过。

## 体积

剧场、会话 view 和做剧组件都放在 core 里，所以会打进每个插件。`lib/client.js` 每个大约增加 44KB（未压缩），tgz 每个大约增加 9KB：

| 插件 | lib/client.js 前 → 后 | tgz 前 → 后 |
| --- | --- | --- |
| workbench | 112 689 → 156 952 | 97 109 → 106 384 |
| eikona | 118 905 → 163 176 | 96 392 → 105 688 |
| script | 116 570 → 160 837 | 95 389 → 104 749 |
| drama | 112 061 → 155 644 | 94 702 → 103 942 |
| kit | 106 405 → 154 169 | 101 330 → 111 145 |
