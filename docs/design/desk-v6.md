# 幕织 DSH 工作台 v6：macOS 视觉 + keymap + 引用渲染

v6 是三件事的合集：视觉换成 macOS 26（详见 [visual-macos-v6](./visual-macos-v6.md)）、补一套 keymap 与帮助面板、把 @ 引用与 agent 工作流做成可看的状态。两路并行开发（Codex `gpt-6.2-sol`，herdr 面板），我负责契约、验收与收口。

## 1. 视觉（一句话版）

系统字体栈取代宋体；系统蓝 `#0A84FF` 取代墨黑胶囊；灰阶分层 + 发丝线取代深阴影堆叠；液态玻璃**只给浮层**（命令面板 / 生成抽屉 / 悬浮助手 / popover），正文与代码块保持不透明。细节与踩坑见 visual-macos-v6。

## 2. keymap 系统

`packages/dsh-muweave-core/src/client/keymap.ts`（新）：

- 一张声明式快捷键表（`id` / `keys` / `scope` / 中英标签），不执行副作用。
- `matchKey(event, binding)`：`mod+k`（meta 或 ctrl）、`shift+?`、方向键、单字符。
- 两段式序列（`g` → `d` 跳排期），300ms 超时重置，SSR 安全。
- `groupBindings()` 按 scope 分组，供帮助面板渲染。

`?` 打开快捷键帮助覆盖层（`data-muweave-keymap="true"`），Esc 关闭、焦点回位。

## 3. @ 引用与工作流

- 暂存的 @ 元素 chip 升级为「图标 + 标题 + 状态点 + 删除」结构，可键盘操作（Tab 进入、Backspace/Delete 移除、Enter 发送）；输入框下方显示「已引用 N 项」。
- 会话「做剧」视图把 `handoff` / `artifact` / `goal` 条目串成纵向流程：序号 + 图标 + 标题 + 时间 + 状态点，步骤之间用一条发丝线相连（`.mw-sv-log-row::before`）。
- 命令面板：最近执行命令（localStorage，5 条）、`>` 只搜操作、↑↓ 循环、Tab 补全（保留 `>` 前缀）、右键菜单（复制命令名）。

## 4. 倾斜（3D）

终于修好了，根因值得记一笔：

`.mw-masonry > *` 曾给**每张卡片**挂 `animation: mw-rise … both`。CSS 动画在运行期间独占 transform 通道，优先级高于普通声明、**也高于内联 style**——所以 `--mw-tilt-x/y` 算得再对，`transform` 也永远被压回 `none`。

修法：把入场动画移到**容器**（`.mw-masonry { animation: mw-fade-in }`），卡片本身不挂动画；委托式 tilt（`useTiltDelegation`）直接写内联 `transform`。

实机验证：`transform: matrix3d(0.999507, …)`、`animationName: none`、`--mw-tilt-x ≈ 0.8`。

## 5. 验证

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **110/110**（15 个文件） |
| `pnpm build` / `pack:plugins` | 通过（2 core + 6 plugins） |
| `pnpm test:integration` | **passed**，证据 `20261118155746807-muweave-dsh-178a6a38` |
| 实机：强调色 | `--mw-accent: #0A84FF`，主按钮 `rgb(10,132,255)` |
| 实机：倾斜 | `matrix3d(...)`，`animation: none` |
| 实机：keymap | `?` 覆盖层可打开 |

## 6. 不做

- 拖拽排序 / 框选多选：需要命中测试与键盘可访问的替代方案，本轮没做。
- 项目管理与分组视图：本轮没做（原计划第三路，被视觉与倾斜修复占满）。
- 真正的弹簧物理：CSS transition 足够，引入 spring 库会多一份运行时。
