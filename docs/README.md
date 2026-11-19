# MuWeave DSH 文档索引

- [架构与跨端复用边界](./architecture/muweave-bundle-and-dsh-surfaces.md)：`.muweave/` 物化信息元件包规范、官方契约采集流水线、DSH 五插件职责切分及 `client/muweave-frame-studio` 只读复用接口。
- [视觉打磨 v1](./design/visual-polish-v1.md)：`--mw-*` token、外壳一行顶栏与按需栏位、共享 UI 原语、静态守护规则与体积变化。
- [做剧剧场 v1](./design/theater-v1.md)：一个左栏入口与座位交接、Codex 式房间切换器（Alt+N）、合并右栏、会话「做剧」view 与共享做剧组件、宿主事实与体积。
- [视觉 v2（editorial）](./design/editorial-v2.md)：改用 dsh-media-desk 式单色视觉（墨色胶囊、宋体标题、柔和卡片阴影、毛玻璃导航），五个房间改为 hero + 作品卡片版式，真实候选图做封面；守护规则、宿主 token 实测与体积。
- [创作者平台 v1](./design/creator-platform-v1.md)：生成台把 Eikona、Sonora 等 owner CLI 接进同一条链（能力目录 → 零调用估价 → 界面审批上限 → 幂等提交 → 逐格审阅 → 关联到镜头）；付费默认关闭，智能体只能申请不能批准；新增成稿房间。
- [工作台 v7（项目管理 · composer · 工具集成）](./design/desk-v7.md)：项目注册表与常驻项目条、@ 内联 chip 与动作条、工具目录与运行卡；含两个真实回归（建项目清空列表、RPC 结构未防御）。
- [项目管理方案](./design/project-management-plan.md) / [架构计划](./design/project-management-arch.md)：方案对比与推荐、数据模型、RPC 契约、P0 实施顺序。
- [工作台 v6（macOS 视觉 · keymap · 引用渲染）](./design/desk-v6.md)：系统蓝强调色、系统字体栈、玻璃只给浮层；`?` 快捷键帮助、@ chip 结构化、会话工作流纵向连线；倾斜 3D 修复（动画独占 transform 的坑）。
- [视觉 v6（macOS 液态玻璃）](./design/visual-macos-v6.md)：token 表、玻璃边界、强调色不链宿主 alias 的踩坑记录。
- [工作台 v4（排期 · 触发器 · 悬浮分层）](./design/desk-v4.md)：新增排期房间（日历 + 待排池 + `schedule.*` RPC + 3 个 agent 工具）、`@`/`/` 的相关度排序与最近使用、浮层的三层深度与微 3D 入场。
- [工作台 v3（Desk）](./design/desk-v3.md)：舞台改成全宽画布（不再是卡片）、布局控件收进一个「视图」浮层、房间筛选变浮层、⌘K 命令面板与 `/` 聚焦助手、检查器跟随选择；顺带把 `engines.dsh` 放宽到 rc.2+ 并修正 kit 预设对齐。
- OpenSpec 变更真源：`../openspec/changes/muweave-dsh-creator-suite-v1/`。
