# MuWeave DSH Creator Plugin Suite (`cli/muweave-dsh`)

面向 DeepSeek Harness（`engines.dsh`: `>=0.2.2-rc.2 <0.3.0`，rc.2 / rc.3 实测） 的幕织（MuWeave）创作辅助插件矩阵与 `.muweave/` 物化信息元件中心。

## 包结构

| 包名 | 角色 | 说明 |
| --- | --- | --- |
| `@yeisme/muweave-bundle` | 核心规范 / CLI / SDK | `.muweave/` 物化元件目录编译 CLI（`muweave-bundle`）与双端纯只读 Consumer SDK |
| `@yeisme/dsh-muweave-core` | 共享宿主与前端底座 | `/api/muweave-dsh/rpc`、短效 Range 媒体流、双模 Tab/Pane、`shell.overlay` 三态悬浮 Agent、阶段进度条 |
| `@yeisme/dsh-muweave-workbench` | DSH 插件 1 | `.muweave/` 原件总览、引用绑定向导、Pi 工件（Goal/Subagent/Plan）与 DSH 工件双栏对比 |
| `@yeisme/dsh-muweave-eikona` | DSH 插件 2 | Eikona 视觉信息元件画廊、2-up/4-up 缩放对比、评估分卡、角色/场景母版绑定与受控 Handoff |
| `@yeisme/dsh-muweave-script` | DSH 插件 3 | Auctra 剧本双时间轴、Scene Card 草稿保存/提交、渐进式 Context Graph、Candidate stale Diff |
| `@yeisme/dsh-muweave-drama` | DSH 插件 4 | Scaena 分镜摘要表、镜头卡、资产四轴状态徽章、剪辑时间线摘要与剧本—分镜对照 |
| `@yeisme/dsh-muweave-kit` | DSH 插件 5 | `muweave-creator` PTC 智能体预设、按需创作 Skills 与中文 `/` 检索、预设提示词插槽表单与白名单 CLI 卡 |
| `@yeisme/dsh-muweave-schedule` | DSH 插件 6 | 发布排期房间：月历 + 待排池、拖拽/点选排期、`schedule.list/plan/clear` RPC 与同名智能体工具 |

## 快速命令

```bash
cd cli/muweave-dsh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack:plugins
pnpm test:integration
```

在隔离 DSH profile 安装打包产物（严禁直接覆盖日常 `web` profile）：

```bash
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-workbench-0.1.0.tgz --offline
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-eikona-0.1.0.tgz --offline
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-script-0.1.0.tgz --offline
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-drama-0.1.0.tgz --offline
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-kit-0.1.0.tgz --offline
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-schedule-0.1.0.tgz --offline
```
