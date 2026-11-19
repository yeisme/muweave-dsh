## 1. 剧场与座位

- [x] 1.1 `theater/registry.ts`：放在 `globalThis` 上的房间表、座位持有者与交接、活动房间与 `localStorage` 记忆
- [x] 1.2 `registerMuweaveCreatorPlugin` 改为登记房间；共享座位只由持有者注册
- [x] 1.3 悬浮助手面板识别改为 `muweave-theater`，`@` chip 打开时跳到对应房间

## 2. 切换器与页面

- [x] 2.1 `TheaterPage`：RoomSwitcher（menu / menuitemradio、方向键 / Enter / Esc、Alt+N）、「回到对话」
- [x] 2.2 `WorkspaceShell` 增加 `titleNode`；切换房间后焦点留在新的切换器上
- [x] 2.3 右栏合成一个「做剧」tab，按房间筛选
- [x] 2.4 五个插件改用短房间名，原全名作为说明

## 3. 会话 view 与做剧组件

- [x] 3.1 `drama-components.tsx`：摘要加载与四个展示组件；分镜生产房间改用这些组件
- [x] 3.2 `session-log.ts`：按会话记录的日志，`@` 插入和交接时写入，上限 50 条
- [x] 3.3 `DramaSessionView`：进度行、四个分区、空态；drama 注册 `conversation.view`
- [x] 3.4 `conversation.session.header.actions`「剧场」往返按钮

## 4. 修复、守护与验证

- [x] 4.1 `ClientGenerationGuard` 接受同代乱序响应，并加回归单测
- [x] 4.2 `test:integration` 先打包
- [x] 4.3 `tests/theater.test.tsx`：座位交接、五插件单入口、切换器键盘、会话 view
- [x] 4.4 变异抽查 3 条：去掉交接、去掉 Esc 关闭、不注册 view，每条都会让测试变红
- [x] 4.5 `npx tsc -b`、`vitest`、真实宿主 e2e 连续 6 次通过，并检查截图
- [x] 4.6 设计说明 `docs/design/theater-v1.md`；dsh-plugin-development skill 补充宿主事实
