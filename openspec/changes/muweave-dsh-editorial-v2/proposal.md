# 提案：幕织 DSH 做剧剧场视觉 v2（editorial）

## Why

剧场 v1 能用，但用户不想要现在的风格：暮紫主按钮、表格和等宽 ID 当正文、密集页签，看起来像工具后台，不像做剧的地方。用户指定参考 dsh-media-desk 的视觉语言（单色、宋体标题、柔和卡片、毛玻璃导航），各房间改成以作品为主，一次覆盖全部界面。

## What Changes

1. core token 改为单色。`--mw-accent` 取宿主 primary fill（墨色），删除暮紫。新增字体、玻璃、阴影、圆角、缓动 token，以及三团低彩度光斑背景。
2. 新增 editorial 原语：PillButton、RoomHero、HeroStat、CoverCollage、Poster、MediaCard、NoteCard、QuoteCard、Masonry、AmbientBackdrop。媒体逻辑提到 core（MediaPreview、useMediaUrl、useProjectCovers），所有房间的 hero 都能显示项目真实候选图，没有图片时显示宋体排版海报。
3. 外壳与剧场：
   - `WorkspaceShell` 新增 `hero`，侧栏和 stage 改为浮起卡片。
   - 宽屏时房间切换器改为玻璃胶囊导航（`aria-current="page"`，保留 Alt+N 和 `data-room-id`），窄屏仍用菜单。
   - 剧场模式下顶栏不再重复副标题。
4. 五个房间顶部都加 hero，正文改为卡片：
   - 总览：瀑布流加反色「下一步」卡。
   - 视觉：MediaCard 画廊。
   - 剧本：阅读卡加场次卡两栏。
   - 分镜：分镜网格和资产卡，可切回原表。
   - 工具箱：瀑布流。
5. 静态守护新增三条（禁止暮紫、accent 必须指向宿主墨色、光斑约束、backdrop-filter 只能写在 @supports 里）。新增 editorial 单测。e2e 改为用胶囊导航进房间，加上 hero、封面解码、分镜网格断言，以及四档宽度的浅色和深色截图。

## Impact

- 只改展示层。RPC、`.muweave/` 格式、宿主槽位、插件注册方式和可访问名都不变，e2e 依赖的 `data-*` 钩子全部保留。
- 每个插件的 `lib/client.js` 增加约 22–28KB，没有打包第二份 react。
- 参考仓库是 MIT 许可，只借鉴视觉规则，没有复制文件或素材。
