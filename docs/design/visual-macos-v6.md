# MuWeave DSH 视觉 v6：macOS 液态玻璃

v6 把工作台从 v5 的墨黑胶囊与衬线编辑感迁移到 macOS 26 的中性灰阶与系统蓝。布局、class 名、data 属性和插件交互保持不变，变化集中在共享 token 和样式层。

## Token

| 组 | Token | v6 用途 |
| --- | --- | --- |
| 字体 | `--mw-font` | `-apple-system`, `SF Pro Text`, `PingFang SC`, `system-ui` 系统字体栈 |
| 字体兼容 | `--mw-serif`, `--mw-latin-serif` | 保留旧变量名，均指向 `--mw-font`，避免调用方失效 |
| 灰阶 | `--mw-surface`, `--mw-card`, `--mw-fill-1/2/3` | 页面、卡片和控件的中性层级，使用 `color-mix` 从 `--mw-label` 派生 |
| 标签 | `--mw-label`, `--mw-label-2`, `--mw-label-3` | 主文字、次文字和弱文字 |
| 分隔 | `--mw-line`, `--mw-line-strong` | 8% 与 16% 的发丝线透明度 |
| 强调 | `--mw-accent`, `--mw-accent-hover`, `--mw-on-accent` | 系统蓝 `#0A84FF` / `#0066CC` / 白字，**字面量直给，不链宿主 alias** |
| 玻璃 | `--mw-glass`, `--mw-glass-solid` | 浮层的半透明底和不透明回退 |
| 阴影 | `--mw-elev-1/2/3/4`, `--mw-bevel` | 接触阴影、柔光和 1px 内高光，减少深色多层堆叠 |
| 圆角 | `--mw-r-1/2/3`, `--mw-r-xl`, `--mw-r-panel` | 0.25rem、0.5rem、0.75rem、0.75rem、1rem |

所有长度继续使用 rem，1px 和 2px 只用于发丝线与焦点环。数字和时间使用 `font-variant-numeric: tabular-nums`。

## 液态玻璃边界

玻璃只用于需要脱离正文层级的浮层。命令面板 `.mw-cmdk-panel`、生成台抽屉 `.mw-gen-drawer`、悬浮助手 `.mw-dsh-float-root`、视图 popover `.mw-dsh-viewctl[data-popover="true"]` 和房间菜单 `.mw-room-menu` 使用不透明底作为回退，并在 `@supports (backdrop-filter: blur(1rem))` 内启用 `blur(1.5rem) saturate(1.8)` 一类的磨砂效果。浮层保留 1px 内高光和克制的接触阴影。

正文工作区、左右栏、阶段栏、卡片、媒体内容、表格、代码块、排期网格和按钮内容都保持不透明。这样在玻璃不可用、背景复杂或高对比度模式下，文字和代码仍有稳定的可读背景。

## 强调色的实现要点（踩坑）

`--mw-accent` 一开始写成 `var(--dsw-alias-button-primary-fill, #0A84FF)`，本意是「跟随宿主」。实际结果是**所有主 CTA 变成墨黑**——宿主把 `button-primary-fill` 定义为墨色，fallback 永远不生效。实机读 computed style 才暴露：`--mw-accent: #0f1115`、主按钮背景 `rgb(15,17,21)`。

正确做法是**直接写字面量**：

```css
--mw-accent: #0A84FF;
--mw-accent-hover: #0066CC;
--mw-on-accent: #ffffff;
```

静态守卫因此开了一条**受控例外**：只允许 `--mw-accent*` / `--mw-on-accent` 使用字面量色值，其余仍必须走 token；同时把旧的「accent 必须指向宿主 primary fill」断言改写为「必须是系统蓝、且不得再链宿主 alias」，防止回退。

## 「反色卡」的处理

`[data-ink="true"]` 原来是整块墨色卡片。换成系统蓝后如果直接映射成 `background: var(--mw-accent)`，会出现一整片亮蓝块（实测截图就是如此）——太重，不像 macOS。改为：白底 + 蓝色 1px 描边 + 蓝色 eyebrow + 蓝色主按钮，只保留小面积强调。

## 与 v5 的差异

- 主 CTA、焦点环、链接、当前房间状态改用 `--mw-accent` 系统蓝，不再用宿主墨色作为主强调。
- `--mw-serif` 与 `--mw-latin-serif` 不再加载宋体或斜体衬线，标题、正文和数字统一回到系统字体。
- 卡片圆角收敛到 0.75rem，浮层为 1rem，按钮为 0.5rem。
- 页面卡片和侧栏由透明玻璃改为 `--mw-card` 不透明灰阶，分隔由粗边界和重阴影改成 `color-mix` 发丝线。
- 玻璃保留在命令面板、生成台、悬浮助手和 popover 这类浮层，正文内容不再透出背景。
- 选中态仍使用中性灰阶，系统蓝只承担操作、焦点、链接和当前房间识别。

## 动效

现有淡入、悬停抬升、倾斜和视差保留原有 class 与 data 属性。`prefers-reduced-motion: reduce` 会关闭动画、过渡和变换，玻璃效果本身不依赖动效。
