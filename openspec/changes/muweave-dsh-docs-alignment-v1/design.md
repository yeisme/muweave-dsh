# 设计：MuWeave DSH 文档事实对齐 v1

## 事实来源

- 共享 room 注册由 packages/dsh-muweave-core/src/client/index.tsx:180-186,262-295 提供。
- Workbench、Eikona、Script、Drama、Kit、Schedule 的 plugin / panel ID 与 stage tab 由 docs/design/tab-room-mapping.md 逐项指向源码行号。
- F3 已交付证据是提交 54d1374、packages/dsh-muweave-workbench/src/diagnosis-panel.tsx、tests/diagnosis-panel.test.tsx、tests/project-diagnose.test.ts。
- schedule v2 已交付证据是提交 fadbe67、packages/dsh-muweave-core/src/protocol.ts:358-385、packages/dsh-muweave-core/src/host.ts:1165-1185、packages/dsh-muweave-schedule/src/client.tsx:462-471、tests/schedule-v2.test.ts。

## 状态规则

- 文档状态必须区分“已交付实现”“设计预留”“外部环境门”。
- F3 的状态使用 54d1374 和交付报告中的只读 project.diagnose 证据，不再写成待做。
- schedule v2 的状态使用 fadbe67 和 v1 兼容 projectId 扩展证据，不再写成设计预留。
- registry migration report 没有实现文件或提交，继续标为未交付，并从 F3 的已交付范围中分离。
- room-1..9 快捷键不增加 room 数量，room 数量只来自 registerTheaterRoom 的 plugin / extra room 注册。

## 验证

- npm run typecheck
- openspec validate muweave-dsh-docs-alignment-v1 --strict --no-interactive
- git diff --check
