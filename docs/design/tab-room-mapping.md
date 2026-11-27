# MuWeave DSH room / stage tab 映射

> 状态：现行事实映射（v9：10 个 DSH 插件包 / 12 个房间 / 29 个插件 stage tab + 内置模块台）。本文把剧场房间、分组、插件 owner 和页内 stage tab ID 固定在同一张表中；`room-1..9`（`Alt+1..9`）映射至顶栏前 9 个可见房间，不作为独立房间计数。
> 证据基线：`packages/dsh-muweave-core/src/client/index.tsx`（`registerMuweaveCreatorPlugin`）、`packages/dsh-muweave-core/src/client/theater/{registry.ts,module-manager.ts,ModuleManagerPage.tsx,TheaterPage.tsx}`，以及各插件 `src/client.tsx` 的 `registerMuweaveCreatorPlugin` 与 `stageTabs` 定义。

## 共享壳层与顶栏分组

所有插件通过 `registerMuweaveCreatorPlugin` 登记到一个全局剧场（`muweave-theater`）。共享座位包括 `main`、`sidebar.panellist`、一个右栏 companion tab、`shell.overlay`、会话 header action 和 `@` / `/` trigger source。

顶栏按 `group: TheaterRoomGroup` 分为 3 组并以 `.mw-room-nav-sep` 分隔：
- **`pipeline`**（核心流水线）：`muweave-workbench`、`muweave-eikona`、`muweave-script`、`muweave-drama`、`muweave-draft`
- **`studio`**（4 大专业工作室）：`muweave-canvas`、`muweave-stage3d`、`muweave-audio`、`muweave-assets`
- **`ops`**（工具与排期）：`muweave-kit`、`muweave-schedule`
- **内置模块台**：`muweave-modules`（`THEATER_MODULES_VIEW_ID`，由 `TheaterPage` 直接路由至 `ModuleManagerPage`，**不注册进 `getTheaterRooms()`**，支持 5 套角色预设 `all | director | art_canvas | audio_edit | producer`、置顶与排序）。

`packages/dsh-muweave-core/src/client/keymap.ts` 的 `room-1` 到 `room-9` 是快捷键槽位，动态对应当前顶栏定制顺序中的前 9 个可见房间。

## 实际 room 与 stage tab（12 个房间）

| room | group | plugin owner | room 注册证据 | stage tab ID | 源码位置 |
| --- | --- | --- | --- | --- | --- |
| `muweave-workbench` | `pipeline` | `@yeisme/dsh-muweave-workbench` | `pluginId` / `panelId` (`WorkbenchMainPage`) | `overview`、`pi-artifacts`、`dsh-artifacts`、`bind-wizard` | `packages/dsh-muweave-workbench/src/client.tsx` |
| `muweave-draft` | `pipeline` | `@yeisme/dsh-muweave-workbench` | `extraRooms[0].panelId` (`WorkbenchDraftPage`) | `draft` | `packages/dsh-muweave-workbench/src/client.tsx` |
| `muweave-eikona` | `pipeline` | `@yeisme/dsh-muweave-eikona` | `pluginId` / `panelId` (`EikonaMainPage`) | `gallery`、`masters`、`scores`、`spec-guard` | `packages/dsh-muweave-eikona/src/client.tsx` |
| `muweave-script` | `pipeline` | `@yeisme/dsh-muweave-script` | `pluginId` / `panelId` (`ScriptMainPage`) | `dual-timeline`、`scene-cards`、`context-graph`、`candidate-diff` | `packages/dsh-muweave-script/src/client.tsx` |
| `muweave-drama` | `pipeline` | `@yeisme/dsh-muweave-drama` | `pluginId` / `panelId` (`DramaMainPage`) | `storyboard`、`assets`、`timeline`、`side-by-side` | `packages/dsh-muweave-drama/src/client.tsx` |
| `muweave-canvas` | `studio` | `@yeisme/dsh-muweave-canvas` | `pluginId` / `panelId` (`CanvasMainPage`, `order: 44.6`) | `board`、`outline` | `packages/dsh-muweave-canvas/src/client.tsx` |
| `muweave-stage3d` | `studio` | `@yeisme/dsh-muweave-stage3d` | `pluginId` / `panelId` (`Stage3dMainPage`, `order: 44.7`) | `director-stage`、`camera-sheet` | `packages/dsh-muweave-stage3d/src/client.tsx` |
| `muweave-audio` | `studio` | `@yeisme/dsh-muweave-audio` | `pluginId` / `panelId` (`AudioMainPage`, `order: 44.8`) | `mixer`、`cues` | `packages/dsh-muweave-audio/src/client.tsx` |
| `muweave-assets` | `studio` | `@yeisme/dsh-muweave-assets` | `pluginId` / `panelId` (`AssetsMainPage`, `order: 44.9`) | `catalog`、`usage` | `packages/dsh-muweave-assets/src/client.tsx` |
| `muweave-kit` | `ops` | `@yeisme/dsh-muweave-kit` | `pluginId` / `panelId` (`KitMainPage`) | `templates`、`skills`、`cli-cards` | `packages/dsh-muweave-kit/src/client.tsx` |
| `muweave-schedule` | `ops` | `@yeisme/dsh-muweave-schedule` | `pluginId` / `panelId` (`ScheduleMainPage`) | `board` | `packages/dsh-muweave-schedule/src/client.tsx` |
| `muweave-modules` | 内置 | `@yeisme/dsh-muweave-core` | `THEATER_MODULES_VIEW_ID` (`ModuleManagerPage`) | （内置模块管理视图，非 stageTabs） | `packages/dsh-muweave-core/src/client/theater/ModuleManagerPage.tsx` |

当前代码共 **10 个独立 DSH 插件包**、**12 个房间**（11 个插件房间 + 1 个内置模块台 `muweave-modules`）与 **29 个插件 stage tab**（原 21 个 + v9 新增 8 个）。

## 维护规则

- 新增 room 或 stage tab 时，同一提交必须更新本表、对应插件源码证据和 owner OpenSpec 任务。
- 删除或重命名 room / tab 前，先检查 `data-room-id`、键盘入口、e2e 选择器和 session view 是否引用旧 ID。
- 这个映射只记录仓库内可验证的注册事实，不记录外部 DSH 设备或 provider 状态。
