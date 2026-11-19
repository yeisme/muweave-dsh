# 提案：幕织 DSH 做剧剧场（v1）

## Why

视觉打磨 v1 之后还剩两个问题：

- **左栏太挤。** 五个插件各自注册一个侧栏入口：原件总览 / Eikona 视觉元件台 / 剧本编剧室 / 做剧分镜与生产台 / 创作工具箱。右栏也因此有五个 companion tab，Start 引导有五张卡。
- **会话里看不到做剧进度。** 会话的 tab 行（对话 / 轨迹）里没有任何做剧内容。

用户要的是：一个按钮就能进入做剧剧场；剧场顶部有一个 Codex / Claude 式的工作区切换按钮；会话 tab 里能看到做剧组件。

## What Changes

1. **剧场入口与房间。** core 新增剧场注册表（`theater/`），放在跨 bundle 共享的 `globalThis` 单例上。
   - 每个插件通过 `registerMuweaveCreatorPlugin` 登记一个房间，不再各自注册 `main`、`sidebar.panellist` 和右栏 tab。
   - 左栏只保留一个「做剧剧场」入口（`muweave-theater`）。
   - 下面这些共享座位都由一个持有者注册，持有者被 dispose 时交给下一个存活的插件：`main`、`sidebar.panellist`、右栏 tab、`shell.overlay`、会话标题按钮、`@` / `/` 触发源。
2. **房间切换器。** 剧场顶栏左侧放一个工作区按钮，点开是 `menu` 加 `menuitemradio`，每一项显示短房间名、说明和 `Alt+N` 提示。
   - 支持方向键、Enter、Esc（关闭后焦点回到按钮）。剧场激活时可以直接用 `Alt+N` 切换。
   - 上次的房间记在 `localStorage`。
   - 顶栏右侧放「回到对话」。
   - `WorkspaceShell` 新增 `titleNode` 参数，原来的标题改作视觉隐藏的 h1。
3. **右栏合并。** 五个 companion 合成一个「做剧」tab，可以按房间筛选。
4. **会话「做剧」view。** drama 插件注册 `conversation.view`（`muweave-drama`）。
   - 内容包括：进度行、「在剧场打开」，以及四个分区：本会话 / 分镜 / 剧本 / 资产。
   - 本会话分区读按会话记录的日志（`@` 插入和悬浮助手交接都会写入，最多 50 条）。
   - 没有日志时显示空态，并给出「进入做剧剧场」。
   - 做剧会话的标题旁加「剧场」header action。
5. **共享做剧组件。** 新增 `drama-components.tsx`：`loadDramaDigest` / `useDramaDigest`、`ShotStrip`、`ReadinessDots`、`SceneMini`、`ProgressLine`。剧场的分镜生产房间和会话 view 共用这些组件。
6. **修复：同代并行响应。** `ClientGenerationGuard` 不再丢弃同一 generation 下乱序到达的响应。之前分镜表会偶发为空，Eikona 会偶发显示「0 候选」。
7. **修复：集成测试的包过期。** `pnpm test:integration` 先构建、打包，再跑真实宿主 e2e，不再测试过期的 `.work/*.tgz`。

## Impact

- **数据与协议不变。** RPC 动作、`.muweave/` 物化格式、owner 读取和交接语义都不变。
- **侧栏入口的可访问名从 5 个变成 1 个。** 侧栏固定状态只存在宿主内存里，不需要做持久化迁移。e2e 已同步改成先进剧场、再切换房间。
- **体积增加。** 每个插件的 `lib/client.js` 约增加 44KB（未压缩），tgz 约增加 9KB。详见 `docs/design/theater-v1.md`。
