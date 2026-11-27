# MuWeave DSH v9：模块化顶栏架构与 4 大专业工作室插件设计规格

> 对应 OpenSpec 变更：[muweave-dsh-modular-studio-tabs-v9](../../openspec/changes/muweave-dsh-modular-studio-tabs-v9/proposal.md)  
> 房间与 Tab 权威映射：[tab-room-mapping.md](./tab-room-mapping.md)（10 个 DSH 插件包 / 12 个房间）。

## 1. 目标与模块化演进

v9 在保持零第三方重型图形/音频依赖与 `--mw-*` 静态样式门禁的前提下，将 MuWeave DSH 扩展为**10 插件 / 12 房间**的可定制创作者工作室：
1. **3 分组可定制顶栏 + 内置模块台（`muweave-modules`）**：顶栏按 `pipeline`（核心流水线）/ `studio`（4 大专业工作室）/ `ops`（工具箱与排期）分组渲染，支持 5 套角色预设（`all` / `director` / `art_canvas` / `audio_edit` / `producer`）、图钉置顶/隐藏、顺序调整与 `Alt+1..9` 跟随定制顺序。
2. **空间画布（`@yeisme/dsh-muweave-canvas` · `画布`）**：无限平移/缩放（`25%–200%`）节点画布，支持从当前集一键自动铺开（母版、连续性圣经色卡、场次、分镜与有向连线）、节点拖拽与连接、Mermaid 流程图导出及 `@` 注入助手。
3. **3D 导演预演台（`@yeisme/dsh-muweave-stage3d` · `3D导演台`）**：零依赖纯 Canvas2D 3D 透视投影（`24/35/50/85/135mm`）、5 套经典机位预设（`ots` / `hero_low` / `two_shot` / `ecu` / `birds_eye`）、俯视片场走位图、**180° 越轴预警**、结构化机位提示词编译，以及 **3D 灰模 PNG 一键渲染入 CAS 并绑定至镜头 `reference`**。
4. **多轨音画台（`@yeisme/dsh-muweave-audio` · `音画台`）**：Master + 3 轨（`voice`/`music`/`sfx`）Mute/Solo/Gain（`0–150%`）/Fade（`0–10000ms`）混音配置、缺配音一键唤起 `sonora.voice.tts`、台词字幕卡点与 `>8s` 口型漂移预警、SRT/VTT 快捷导出。
5. **中央资产库（`@yeisme/dsh-muweave-assets` · `资产库`）**：跨领域资产目录（角色/场景/道具/视觉/音频）、4 轴就绪点、绑定镜头、`@` 注入助手与跨集资产↔镜头双向引用矩阵。

## 2. 后端存储、RPC 与三端扩展（`packages/dsh-muweave-core`）

### 2.1 4 个乐观锁持久化存储与 13 条新 RPC
全部采用 `pluginDataDir` 下 `0600` 原子写 + `.corrupt-<ts>` 隔离 + `expectedRevision` 乐观锁 + `findPlaintextCredential` / `containsHostPath` 校验：

| 存储文件 | RPC Actions | 冲突码与专项逻辑 |
| --- | --- | --- |
| `workspace-tabs.v1.json` | `workspace.tabs.get / save / reset` | `muweave/tabs_revision_conflict`；持久化 `preset`、`pinnedRoomIds`、`orderIds`。 |
| `canvas-board.v1.json` | `canvas.board.get / save / reset` | `muweave/canvas_revision_conflict`；纯函数 `exportCanvasMermaid(board)` 输出脱敏 `flowchart LR`。 |
| `stage3d-scenes.v1.json` | `stage3d.scene.get / save / reset` · `stage3d.snapshot.save` | `muweave/stage3d_revision_conflict`；`compileStage3dPrompt`、`detectAxisCrossing`；`stage3d.snapshot.save` 严格校验 `data:image/png;base64,`、8 字节 PNG 魔数与 `<= 2 MiB` 上限，写入 CAS 并可选绑定镜头 `reference`。 |
| `audio-mix.v1.json` | `audio.mix.get / save / reset` | `muweave/audio_revision_conflict`；自动钳位 `gainPct`（`0..150`）与 `fadeInMs/fadeOutMs`（`0..10000`）。 |

### 2.2 CLI 与 MCP（22 Tools / 12 Live Resources / 3 Prompts）
- **CLI**：新增 `muweave tabs show|preset <id>|reset`、`muweave canvas show|export-mermaid`、`muweave stage3d show|export-prompts`、`muweave audio show`。
- **MCP**：新增 4 工具（`muweave_workspace_tabs`、`muweave_canvas_board`、`muweave_stage3d_scene`、`muweave_audio_mix` → 合计 **22 工具**，仍零 `job.approve`）与 4 实时资源（`muweave://workspace/tabs`、`muweave://canvas/board`、`muweave://stage3d/scenes`、`muweave://audio/mix` → 合计 **12 资源**）。

## 3. 安全与样式红线

- `muweave-modules` 为 `TheaterPage` 内置视图，**不注册进 `getTheaterRooms()`**，保证既有插件房间列表与座位交接测试不破坏。
- `tests/styles-static.test.ts` 覆盖全部 10 个 DSH 插件，动态定位仅允许 `--mw-*` CSS 自定义属性（`--mw-pan-x`/`--mw-pan-y`/`--mw-zoom`/`--mw-x`/`--mw-y`/`--mw-w`/`--mw-h`/`--mw-start`/`--mw-len`/`--mw-level`），零字面颜色、零 `px > 2`、零橙色色相。
- `scripts/inner-e2e-runner.mjs` 离线安装全部 10 个插件 `.tgz` 并新增 5 张 `1440×900` 真机截图（`modules`、`canvas`、`stage3d`、`audio`、`assets`）。
