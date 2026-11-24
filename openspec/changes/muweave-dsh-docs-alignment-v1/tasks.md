# 任务清单：muweave-dsh-docs-alignment-v1

- [x] 1.1 固化 room / stage tab 映射：新增 docs/design/tab-room-mapping.md，记录 7 个 room、21 个 stage tab、共享注册 helper 和 room-1..9 预留边界。证据：docs/design/tab-room-mapping.md:1-35；packages/dsh-muweave-core/src/client/index.tsx:180-186,262-295。
- [x] 1.2 修正 v8/F3 状态：desk-v8-spec.md、desk-v8-proposal.md、project-features-next.md、f3-delivery.md 统一引用 54d1374 的 project.diagnose 实现和测试。证据：docs/design/desk-v8-spec.md:3,88,101-118；docs/design/f3-delivery.md:1-8,80-88。
- [x] 1.3 修正长期兼容状态：schedule v2 标为 fadbe67 已交付，registry migration report 保留未交付并与 schedule v2 分列。证据：docs/design/schedule-v2-delivery.md:1-6,22-30；packages/dsh-muweave-core/src/protocol.ts:358-385；tests/schedule-v2.test.ts:13-127。
- [x] 1.4 更新文档索引与本 change 记录，保证后续实现派发有唯一入口。证据：docs/design/README.md:5-18；本文件任务 1.1-1.3；openspec/changes/muweave-dsh-docs-alignment-v1/specs/dsh-docs/spec.md:1-20。
