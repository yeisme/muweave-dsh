## 1. 动效系统

- [x] 1.1 新增 `client/motion.ts`：`usePrefersReducedMotion`（matchMedia 订阅 + `addListener` 回退 + SSR 保护）
- [x] 1.2 `useTilt({disabled})`：指针位置归一化到 `-1…1` 写 `--mw-tilt-x`/`--mw-tilt-y`，宽高为 0 跳过，`disabled`/reduced-motion 归零且不挂监听
- [x] 1.3 `useParallax(strength=0.35)`：视口指针写 `--mw-parallax-x`/`--mw-parallax-y`，clamp，`blur` 归零
- [x] 1.4 三个 hook 从 `client/index.tsx` 导出
- [x] 1.5 `styles.ts` 新增 `.mw-tilt`（3deg 上限、`preserve-3d`、hover `--mw-elev-3`）与 `.mw-dsh-card.mw-tilt[data-interactive="true"]:hover` 防覆盖
- [x] 1.6 `styles.ts` 新增 `.mw-parallax .mw-ambient`（`clamp` ±0.75rem）与 `@keyframes mw-spring-in` + `.mw-spring-in`（`--mw-dur-base` + `--mw-ease-out`）
- [x] 1.7 `MediaCard`/`NoteCard` 增加可选 `tilt`（默认 false），挂类名 + ref + 变量
- [x] 1.8 合并重复的卡片 hover 规则；`prefers-reduced-motion` 块覆盖 `.mw-tilt`/`.mw-spring-in`/`.mw-parallax .mw-ambient`，hover 变换一并归零

## 2. 排期键盘与拖拽

- [x] 2.1 新增 `interactions.ts`：`addDays`/`startOfWeek`/`addMonths`（月底夹取）/`moveDayFocus`/`pushUndo`（20 条）/`popUndo`
- [x] 2.2 日历 roving tabindex + `aria-selected`，只留焦点日 `tabIndex=0`，聚焦即同步焦点日
- [x] 2.3 方向键 ±1/±7、Home/End 本周首尾、PageUp/PageDown ±1 月并同步 `cursor`
- [x] 2.4 Enter 排入或清除焦点日、Delete/Backspace 清除、`t` 回今天、`[`/`]` 换月
- [x] 2.5 撤销栈（20 条）+ Ctrl/Cmd+Z，撤销反向再调 `schedule.plan`/`schedule.clear`，并渲染「已排到 X · 撤销」
- [x] 2.6 拖拽三态：源 `data-dragging`、可落格 `data-drop-ready`、落点 `data-drop-active`，`dragleave`/`dragend` 清理
- [x] 2.7 空态引导：待排池空 + 「去总览同步 `.muweave/`」动作；本月无排期单独一行
- [x] 2.8 键盘提示 `dayNavHint` 中英双语，与 `legendHint` 同行展示

## 3. 命令面板

- [x] 3.1 最近命令：localStorage `muweave.cmdk.recent.v1`、上限 5、执行时前插去重、读写失败静默降级
- [x] 3.2 「最近」分区（`commandGroupRecent`）置顶，命中项从原分组剔除避免重复
- [x] 3.3 `>` 前缀只筛操作组（`commandGroupActions`），placeholder 换 `commandActionHint`
- [x] 3.4 上下键循环、Tab 补全 label、Enter 执行、Esc 关闭并还焦点
- [x] 3.5 `command-dict.ts` 补 `commandGroupRecent`/`commandActionHint`/`commandUndoHint`，页脚加「Tab 补全」，中英同步

## 4. 验证与文档

- [x] 4.1 `pnpm typecheck` 通过（`tsc -b`）
- [x] 4.2 `pnpm test` 98/98（14 文件；= 本轮前基线，无新增单测）
- [x] 4.3 `pnpm build`（2 core + 6 plugins）、`pnpm pack:plugins`（6 个 tgz）
- [x] 4.4 `pnpm test:integration` passed（离线，25 条 Verified，29 张截图；证据目录见 `docs/design/desk-v5.md`）
- [x] 4.5 小修：删 `shiftMonth` 死代码；拖拽态选择器对齐 `.mw-sched-row`；`summary.json.plugins_verified` 补 schedule
- [x] 4.6 `docs/design/desk-v5.md` 新建、`docs/README.md` 索引加一行
