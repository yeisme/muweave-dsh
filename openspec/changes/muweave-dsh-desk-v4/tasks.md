## 1. 排期存储与接口

- [x] 1.1 新增 `schedule-store.ts`：`muweave.schedule.v1`、真实日历校验、`ref` 去重（改期=移动、保留未重述的 label/kind/note）、500 条上限、tmp+rename 0600 原子写、损坏改名隔离
- [x] 1.2 `protocol.ts` 增加浏览器安全类型 `ScheduleEntryV1`/`ScheduleBoardV1`，RPC allowlist 增加 `schedule.list/plan/clear`
- [x] 1.3 `host.ts` 接入 store 与三条 RPC，非法入参返回 `muweave/invalid_ref`/`muweave/invalid_date`

## 2. 排期房间

- [x] 2.1 新包 `@yeisme/dsh-muweave-schedule`（package.json / cordis.patch.yml / host 薄壳 / client `inject` 声明）
- [x] 2.2 月历（周一起始、今天描边、6×7 网格）+ 待排池（按场次→分镜→剧本→视觉排序）+ hero 三统计
- [x] 2.3 交互：点选后点某天排期、拖拽到某天、点 chip 取消、备注输入、窄屏单列
- [x] 2.4 `build-all`/`pack-plugins`/`tsconfig`/`vitest.config`/e2e 安装列表纳入新包

## 3. 智能体工具

- [x] 3.1 kit 新增 `muweave_schedule_list/plan/clear`（走共享 RPC，含 from/to 过滤）
- [x] 3.2 新增 `muweave-schedule-plan` 运行时技能，写入"本地可逆不花钱可直接写、付费仍需界面批准"的边界
- [x] 3.3 `/` 中文词表补 `muweave-schedule-plan`（排期/档期/发布/日历）

## 4. 触发器体验

- [x] 4.1 相关度打分 `scoreTriggerMatch`（精确/前缀/包含/字段/子序列）
- [x] 4.2 最近使用（localStorage 各 6 条）置顶分区，含测试用 seam
- [x] 4.3 `@` 前缀过滤 `parseAtQuery`（domain/kind/owner/scene/episode），状态改 `statusLabel`
- [x] 4.4 `/` 技能优先于模板、模板按分类分组

## 5. 悬浮分层

- [x] 5.1 `--mw-elev-4` 三层阴影 + `--mw-bevel` 内高光；面板/抽屉/助手三态分层
- [x] 5.2 `mw-pop` 微 3D 入场（perspective + rotateX）+ 卡片 hover 抬升，`prefers-reduced-motion` 全停
- [x] 5.3 助手面板去掉重复占位文案，改为等宽快捷键提示，并加回归断言

## 6. 验证与文档

- [x] 6.1 `pnpm typecheck` / `pnpm test`（92/92）/ `pnpm build`（2 core + 6 plugins）/ `pnpm pack:plugins`
- [x] 6.2 `pnpm test:integration`：排期旅程（选待排项 → 点某天 → chip 出现 → 截图 → 点 chip 取消 → chip 消失）
- [x] 6.3 `docs/design/desk-v4.md`、`docs/README.md`、`README.md`、`AGENTS.md` 同步
