# 幕织 MuWeave · DeepSeek Harness 创作插件矩阵

一套跑在 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（下称 DSH）里的创作工作台插件：把「做一部漫剧 / 竖屏短剧」的六个阶段——**灵感 → 剧本 → 视觉 → 分镜 → 声音 → 成片**——做成一条可审核、可回滚、可排期的流水线，而不是一堆生成按钮。

面向的是一人或 2–3 人的创作小组：真正的瓶颈不是「生成不出一张好图」，而是生成之后的**挑、审、改版、排期**。

## 当前状态

| 项 | 现状（基线 `b38b414`） |
| --- | --- |
| 类型检查 | `pnpm typecheck` 0 错误 |
| 测试 | 39 个文件 / 283 条全部通过（须串行跑，见下） |
| 打包 | 6 个插件 tarball 产出到 `.work/` |
| 结构 | v8 工作台结构已定（阶段脊柱 + 双模 Tab/Pane + 浮层 agent） |
| 视觉 | **进行中**：首屏仍在收口，去占位键、真图卡片、判定面板属于当前 P0 |
| 已知缺口 | `packages/dsh-muweave-schedule` 的依赖变更尚未同步到 `pnpm-lock.yaml`（`--frozen-lockfile` 会失败，用 `pnpm install --no-frozen-lockfile`） |

## 包结构

| 包 | 角色 | 说明 |
| --- | --- | --- |
| `@yeisme/muweave-bundle` | 规范 / CLI / SDK | `.muweave/` 物化元件目录的编译 CLI（`init`/`bind`/`sync`/`inspect`/`validate`/`doctor`）与浏览器安全的只读 Consumer SDK |
| `@yeisme/dsh-muweave-core` | 共享宿主与前端底座 | `/api/muweave-dsh/rpc` RPC 总线、短效 Range 媒体流、双模 Tab/Pane、`shell.overlay` 三态悬浮 agent、阶段进度条 |
| `@yeisme/dsh-muweave-workbench` | 插件 1 | `.muweave/` 原件总览、引用绑定向导、Pi 工件与 DSH 工件双栏对比 |
| `@yeisme/dsh-muweave-eikona` | 插件 2 | 视觉信息元件画廊、2-up/4-up 缩放对比、评估分卡、角色/场景母版绑定与受控 Handoff |
| `@yeisme/dsh-muweave-script` | 插件 3 | 剧本双时间轴、Scene Card 草稿保存/提交、渐进式 Context Graph、stale 候选 diff |
| `@yeisme/dsh-muweave-drama` | 插件 4 | 分镜摘要表、镜头卡、资产四轴状态徽章、剪辑时间线摘要与剧本—分镜对照 |
| `@yeisme/dsh-muweave-kit` | 插件 5 | `muweave-creator` 智能体预设、按需创作 Skills、中文 `/` 检索、预设提示词插槽 |
| `@yeisme/dsh-muweave-schedule` | 插件 6 | 发布排期房间：月历 + 待排池、`schedule.list/plan/clear` RPC 与同名智能体工具 |

## 环境要求

- Node.js `>=22.19.0`
- pnpm `10.16.1`（`packageManager` 字段已固定）
- DSH `0.2.2-rc.x`（`engines.dsh` 见根 `package.json`）

## 快速开始

```bash
pnpm install --no-frozen-lockfile   # 见上方「已知缺口」
pnpm typecheck
pnpm build                          # 必须先 build，测试会校验打包产物
pnpm test
pnpm pack:plugins                   # 产出 .work/*.tgz
```

装进一个**隔离的** DSH profile（不要直接覆盖日常 profile）：

```bash
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-workbench-0.1.0.tgz --offline
dsh plugin --profile creator add ./.work/yeisme-dsh-muweave-eikona-0.1.0.tgz --offline
# …其余插件同理
```

### 测试必须串行

并发跑时多个 vitest 进程会抢同一个 `localStorage` 文件，随机出现假失败：

```bash
mkdir -p temp
NODE_OPTIONS=--localstorage-file=temp/vitest-$(date +%H%M%S).json \
  pnpm exec vitest run --no-file-parallelism
```

## 外部集成是可选的

插件把生成能力交给**外部 owner CLI**（本仓库作者环境里是 `eikona` / `scaena` / `sonora`），通过能力目录 + 费用估算 + 幂等提交 + 逐格审阅接入。这些 CLI 不在本仓库内、也不是硬依赖：

- 没有对应 owner CLI 时，相关能力显示为 `blocked` 并写明原因，界面其余部分照常可用；
- 付费动作默认关闭，agent 只能发起申请、不能自行批准；
- 本仓库不包含任何凭据、密钥或私有端点。

## 设计文档

`docs/design/` 下有 24 篇设计文档（v3→v8 的演进、剧场/编辑器两条视觉线、动效与项目管理的架构决策），入口见 [`docs/design/README.md`](./docs/design/README.md)。跨端复用边界见 [`docs/architecture/`](./docs/architecture/)。

## 目录

```
packages/            # 6 个 DSH 插件 + core + bundle
scripts/             # 构建、打包、集成测试、截图自检
tests/               # vitest：宿主 RPC、bundle 契约、插件渲染
docs/                # 架构与设计文档
openspec/            # 变更与规格（历史归档）
```

## License

[MIT](./LICENSE)
