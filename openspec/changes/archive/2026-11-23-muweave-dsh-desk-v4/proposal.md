# 提案：幕织 DSH 工作台 v4（排期 · 触发器 · 悬浮分层）

## Why

v3 把外壳改成了全宽画布，但三件事仍然缺：

1. 用户问"这些东西排到哪天"时没有任何落脚点——`.muweave/` 只有元件，没有档期；上游排期工具也没有回写口。
2. `@` 与 `/` 的候选质量差：只做 `includes` 过滤、按索引顺序输出、没有记忆、直接吐原始枚举；`/` 里模板还可能压过技能。
3. 浮层（命令面板/生成抽屉/悬浮助手）只有单层阴影，浮起来像贴纸，不像浮在纸上。

## What Changes

1. **排期房间**：新插件 `@yeisme/dsh-muweave-schedule`。新增 `ScheduleStore`（`schedule.v1.json`，0600，原子写，损坏改名隔离，500 条上限，`ref` 精确去重、改期是移动）与三条 RPC（`schedule.list`/`plan`/`clear`，日期按真实日历校验，错误码 `muweave/invalid_ref`、`muweave/invalid_date`）。界面为待排池 + 月历（周一起始、今天高亮、拖拽或点选排期、点 chip 取消），窄屏自动单列。
2. **智能体工具**：kit 新增 `muweave_schedule_list`/`muweave_schedule_plan`/`muweave_schedule_clear` 与 `muweave-schedule-plan` 运行时技能；工具说明写明"排期本地、可逆、不花钱，因此可直接写；付费生成仍只能由用户在生成台批准"。
3. **`@` / `/` 体验**：相关度打分（精确 > 前缀 > 包含 > 其他字段 > 子序列）、最近使用（localStorage 各 6 条，置顶分区）、`@` 支持 `domain:`/`kind:`/`owner:`/`scene:`/`episode:` 前缀过滤、状态走 `statusLabel`、`/` 技能恒优先于模板并按分类分组、24 条封顶。插入格式与 32KB 序列化预算不变。
4. **悬浮分层**：新增 `--mw-elev-4`（三阴影叠加）与 `--mw-bevel`（1px 内高光）；命令面板/抽屉用 elev-4、助手 panel 用 elev-3、bar/pill 用 elev-2；浮层入场 `mw-pop`（perspective + rotateX 1.2deg 收正）；卡片 hover 抬升；`prefers-reduced-motion` 下全部关闭。
5. **构建与证据**：`build-all`/`pack-plugins`/e2e 安装列表纳入第 6 个插件；e2e 新增排期旅程（选待排项 → 点某天 → 出现 chip → 截图 → 点 chip 取消）与房间数断言。

## Impact

- `.muweave/` 契约、既有 RPC、宿主槽位、可访问名、e2e 既有 `data-*` 钩子全部不变；新增的只是 `schedule.*` 与一个新包。
- 体积：core 与 5 个旧插件各 +10–11KB；新增 schedule 插件 `lib/client.js` 252KB，未打包第二份 react。
- 排期板是本机计划数据，不进 `.muweave/`，也不改任何 owner 目录。
- 未做跨设备同步、发布后数据回填与复盘页——没有真实数据源之前不做空壳。
