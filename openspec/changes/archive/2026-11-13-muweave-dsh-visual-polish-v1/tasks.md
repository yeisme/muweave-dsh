## 1. Core token 与原语

- [x] 1.1 `styles.ts` 声明 `--mw-*` token 与通用类，样式属性版本升到 `v2`
- [x] 1.2 `i18n.ts` 补齐短标签、视图控件文案、`statusTone` / `statusLabel`
- [x] 1.3 `ui.tsx` 新增 Icon / IconButton / Segmented / StatusTag / EmptyState / SectionHead / Callout / CompanionList

## 2. 外壳

- [x] 2.1 WorkspaceShell 顶栏一行、视图控件进 tab 行、窄屏折叠为“视图”菜单
- [x] 2.2 空对比栏改细提示条；Inspector 按需出现；notice 提示条
- [x] 2.3 ProgressStrip 状态点 + 文字 + 操作，空闲态低对比
- [x] 2.4 FloatingAgent 图标按钮、输入框弹性宽度、内联样式只剩坐标

## 3. 五个插件

- [x] 3.1 Eikona
- [x] 3.2 Drama
- [x] 3.3 Script
- [x] 3.4 Workbench
- [x] 3.5 Kit

## 4. 守护与验证

- [x] 4.1 `tests/styles-static.test.ts`：内联样式白名单、无字面颜色、px ≤ 2、无橙色、token 先声明、焦点环与减少动效、选中态中性
- [x] 4.2 拿掉修复变红抽查 3 条（内联样式、橙色强调、焦点环/减少动效）
- [x] 4.3 `pnpm typecheck && pnpm test && pnpm build && pnpm pack:plugins`
- [x] 4.4 `pnpm test:integration` 四档截图与右栏 dockkit 截图人工检查
- [x] 4.5 设计说明 `docs/design/visual-polish-v1.md`
