# 提案：MuWeave DSH 文档事实对齐 v1

## Why

审计发现 room / stage tab 的任务口径与源码注册事实没有一张固定映射，v8 文档还保留 F3 已交付前和 schedule v2 已交付前的旧状态。后续派发需要一个不依赖旧报告叙述的文档基线。

## What Changes

1. 新增 room / stage tab 映射，记录 7 个实际 room、21 个 stage tab 与源码行号，并明确 room-1..9 只是快捷键预留。
2. 更新 v8 spec、v8 proposal、F3 设计与交付文档，把 F3 标为已交付（54d1374），把 schedule v2 标为已交付（fadbe67），保留 registry migration report 未交付。
3. 更新 docs/design 索引，加入映射文档和当前状态说明。

## Non-goals

- 不修改 TypeScript、测试、RPC、bundle schema、owner CLI 或 provider 配置。
- 不实现 registry migration report，不新增外部数据或设备/provider 证据。
