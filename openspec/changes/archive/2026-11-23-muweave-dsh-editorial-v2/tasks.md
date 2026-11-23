## 1. 宿主 token 与 core

- [x] 1.1 e2e 读取 DSH 0.2.2-rc.1 浅色和深色主题的 elevation、radius、primary fill、inverted label、bg-layer-2，写入 `host-tokens.json`
- [x] 1.2 `styles.ts` 改为单色 token，加字体、玻璃、阴影、圆角、缓动、光斑，删除暮紫
- [x] 1.3 新增 `editorial.tsx` 和 `media.tsx` 原语并导出

## 2. 外壳与剧场

- [x] 2.1 `WorkspaceShell` 加 `hero` 参数和浮起卡片；剧场模式下 hero 接管副标题
- [x] 2.2 `RoomNav` 玻璃胶囊导航（宽屏），窄屏保留菜单

## 3. 五个房间

- [x] 3.1 总览：hero 加内联缩略图，瀑布流加反色「下一步」卡
- [x] 3.2 视觉：hero 封面拼贴，MediaCard 画廊
- [x] 3.3 剧本：hero，阅读卡加场次卡两栏
- [x] 3.4 分镜：hero，分镜网格、资产卡，卡片和表格可切换
- [x] 3.5 工具箱：hero，反色推荐模板，瀑布流

## 4. 守护与验证

- [x] 4.1 静态守护：禁止暮紫，accent 指向宿主，光斑约束，backdrop-filter 只能写在 @supports 里
- [x] 4.2 `tests/editorial.test.tsx`
- [x] 4.3 e2e：胶囊导航、hero、封面解码、分镜网格、四档宽度浅色和深色截图、可见区域重叠检查
- [x] 4.4 typecheck、build、pack 通过；集成测试连续三次通过；三条变异抽查都先变红再恢复
- [x] 4.5 `docs/design/editorial-v2.md`、README 索引，并在 v1 文档注明已被取代
