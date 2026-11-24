# MuWeave DSH room / stage tab 映射

> 状态：现行事实映射。本文把剧场房间、插件 owner 和页内 stage tab 的 ID 固定在同一张表中。它不把 room-1..9 快捷键预留扩写成实际房间，也不引入新的 tab。
> 证据基线：packages/dsh-muweave-core/src/client/index.tsx:180-186,262-295 的共享注册 helper，以及各插件 src/client.tsx 的 registerMuweaveCreatorPlugin 调用和 stageTabs 定义。

## 共享壳层

所有插件通过 registerMuweaveCreatorPlugin 登记到一个全局剧场。共享座位包括 main、sidebar.panellist、一个右栏 companion tab、shell.overlay、会话 header action 和 @ / slash trigger source。源码证据见 packages/dsh-muweave-core/src/client/index.tsx:180-186。

packages/dsh-muweave-core/src/client/keymap.ts:18-26 的 room-1 到 room-9 只是快捷键预留，不能作为九个实际 room 的注册证据。

## 实际 room 与 stage tab

| room | plugin owner | room 注册证据 | stage tab ID | 证据位置 |
|---|---|---|---|---|
| muweave-workbench | @yeisme/dsh-muweave-workbench | pluginId / panelId | overview、pi-artifacts、dsh-artifacts、bind-wizard | packages/dsh-muweave-workbench/src/client.tsx:1017-1036,748-769 |
| muweave-draft | @yeisme/dsh-muweave-workbench | extraRooms[0].panelId | draft | packages/dsh-muweave-workbench/src/client.tsx:1037-1047,989-1000 |
| muweave-eikona | @yeisme/dsh-muweave-eikona | pluginId / panelId | gallery、masters、scores、spec-guard | packages/dsh-muweave-eikona/src/client.tsx:595-612,340-523 |
| muweave-script | @yeisme/dsh-muweave-script | pluginId / panelId | dual-timeline、scene-cards、context-graph、candidate-diff | packages/dsh-muweave-script/src/client.tsx:548-565,220-489 |
| muweave-drama | @yeisme/dsh-muweave-drama | pluginId / panelId | storyboard、assets、timeline、side-by-side | packages/dsh-muweave-drama/src/client.tsx:603-624,248-555 |
| muweave-kit | @yeisme/dsh-muweave-kit | pluginId / panelId | templates、skills、cli-cards | packages/dsh-muweave-kit/src/client.tsx:393-410,163-309 |
| muweave-schedule | @yeisme/dsh-muweave-schedule | pluginId / panelId | board | packages/dsh-muweave-schedule/src/client.tsx:870-891,670-674 |

当前代码因此可数出 7 个 room（其中 1 个是 Workbench 的额外 Draft room）和 21 个 stage tab。任务或旧报告若写“9 个 f*/sched tab”，必须先提供对应 ID 或文档映射，不能用快捷键预留项代替。

## 维护规则

- 新增 room 或 stage tab 时，同一提交必须更新本表、对应插件源码证据和 owner OpenSpec 任务。
- 删除或重命名 room / tab 前，先检查 data-room-id、键盘入口、e2e 选择器和 session view 是否引用旧 ID。
- 这个映射只记录仓库内可验证的注册事实，不记录外部 DSH 设备或 provider 状态。
