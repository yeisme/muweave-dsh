## 1. 外壳

- [x] 1.1 `WorkspaceShell` 去掉左栏列与三组常驻控件；新增「筛选」「视图」两个 popover 触发按钮（`mw-dsh-pop` 包裹）
- [x] 1.2 stage 去底色/圆角/阴影，页签条透明吸顶，页签改下划线文字样式
- [x] 1.3 检查器随 `rightInspector` 出现自动展开、消失自动收起（修 `showRight` 不回写的缺陷）
- [x] 1.4 popover 支持点外部关闭 + Esc 关闭（焦点在触发按钮时也生效）

## 2. 命令面板与快捷键

- [x] 2.1 新增 `command-palette.tsx`（子序列匹配、↑↓、Enter、Esc、焦点归位、`role="dialog"`/`listbox`）
- [x] 2.2 面板内容：房间（`getTheaterRooms`/`setActiveTheaterRoom`）、stage 视图、操作（生成台/助手/同步/筛选/布局）
- [x] 2.3 portal 到 `document.body`；`.mw-cmdk` 加入 token 作用域；`⌘K`/`Ctrl+K` 打开，`/` 聚焦助手输入
- [x] 2.4 新增 `command-dict.ts` 中英词表并 spread 进 `zhDict`/`enDict`

## 3. 宿主兼容

- [x] 3.1 六个包 `engines.dsh` 改为 `>=0.2.2-rc.2 <0.3.0`
- [x] 3.2 kit 预设补 `tool-office` 行，与 rc.2/rc.3 对齐
- [x] 3.3 `tests/kit.test.ts` 动态解析宿主 `ptc.patch.yml`（PATH 上的 `dsh` → 包根；`MUWEAVE_HOST_DSH_PRESET` 可覆盖）
- [x] 3.4 `pnpm test` 在 Node 26 下补 `--localstorage-file`，剧场用例恢复通过

## 4. 验证与文档

- [x] 4.1 `pnpm typecheck` / `pnpm test`（84/84）/ `pnpm build` / `pnpm pack:plugins` 通过
- [x] 4.2 `pnpm test:integration` 通过（离线真实宿主、假 owner），新增浮层与面板断言及截图
- [x] 4.3 `docs/design/desk-v3.md`、`docs/README.md`、`README.md`、`AGENTS.md`、`editorial-v2.md` 版本说明同步
