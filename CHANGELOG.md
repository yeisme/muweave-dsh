# Changelog

All notable milestones of the MuWeave DSH Creator Plugin Suite & `.muweave/` workspace bundle are documented here.

## v6 — Orchestration Control Plane & Open Engine Ecosystem (2026-11-27)

- **Tri-Surface Orchestration Control Plane**:
  - Added `OrchestrationPanel` inside `GenerationDrawer` (`生成任务 | 编排与断路器`) with `bot.pause` circuit-breaker toggle (`expectedRevision` + `idempotencyKey`), `orphanedCount` alert, expandable `task.trace`, and `task.cancel` cascade receipts.
  - Added `muweave bots list|pause|resume` and `muweave tasks list|trace|cancel` CLI commands.
  - Expanded MCP server to 14 tools and 6 resources (`muweave_orchestration_status`, `muweave_task_trace_or_cancel`, `muweave://orchestration/tasks`), continuing to never expose `job.approve`.
- **Capability Doctor & Opt-In Local Preview Adapter**:
  - Added `runCapabilityDoctor` and `muweave doctor --capabilities [--json|--agent]` with zero-cost remediation guidance per blocked reason.
  - Added opt-in zero-cost `LOCAL_PREVIEW_ADAPTER` (`demo.image.preview`, `costUnit: 'none'`) gated strictly behind `MUWEAVE_LOCAL_PREVIEW_ADAPTER=1` (OFF by default).
- **Workbench Visual Closure & E2E Coverage**:
  - Localized blocked tool reasons in Workbench's rightbar via `unavailableReasonLabel` (keeping raw codes in `data-reason` & `title`), placed `<kbd>C</kbd>` inside `对比基线` to eliminate right-edge clipping, and added 4 new `1440×900` E2E captures (`kit-cli-mcp`, `shortcuts-modal`, `drama-inspector-open`, `orchestration-drawer`).

## v5 — Tri-Surface Creator CLI, Local/Remote MCP & Global UX (2026-11-27)

- **Creator CLI & Demo Showcase**: Added `muweave` CLI (`status`, `shots list`, `review set|batch`, `export`, `schedule`, `diagnose`, `migrate report`, `demo seed`, `mcp`) with human, `--json`, and `--agent` (`spec_version=1.0`) sanitized outputs, plus `seedDemoWorkspace` (`雨夜怀表 · 第 1 集`).
- **Local stdio & Remote Streamable HTTP MCP Server**: Added zero-dependency MCP JSON-RPC 2.0 server (`2024-11-05` & `2025-03-26`) with 12 sanitized tools, 5 `muweave://*` resources, 3 prompts, fail-fast `REMOTE_AUTH_TOKEN_REQUIRED` on non-loopback HTTP binds, and `crypto.timingSafeEqual` Bearer auth.
- **DSH Kit Sync & Global UX**: Registered 4 narrow agent tools (`muweave_drama_shots_list`, `muweave_drama_review_set`, `muweave_drama_export`, `muweave_project_diagnose`) and `muweave-cli-mcp-assist` skill; added CLI & MCP config card in `cli-cards`, `?` `ShortcutsHelpModal`, theater room badges, per-chip `@` removal + room-aware quick prompt chips, `ShotInspector` bottom filmstrip, storyboard keyword search, and Timeline Markdown review summary copy.

## v4 — Full-Product 7-Room Polish & Cross-Room Linkage (2026-11-27)

- Added `unavailableReasonLabel` zh/en mapping, `navigateToTheaterRoom`, and 7-room quick jump commands in `⌘K` Command Palette.
- Expanded `BUILTIN_CREATOR_TEMPLATES` to 5 practical short-drama recipes; added Kit category filters, 「复制提示词」, and 「直接去生成」.
- Upgraded Eikona with one-click 「绑定到分镜」 (`shot.media.link`) + 「去分镜台查看」 and gallery filters; upgraded Script with enhanced dual-timeline cards, vertical-drama duration estimates, and linear screenplay reader mode.
- Added Schedule month navigation header + backlog search/domain filters, and synced Drama review badges + 6-track readiness dots into the Draft room.

## v3 — Productization, P2/P3 Closure & Cross-Platform E2E (2026-11-27)

- Closed P2 Project Management with `project.migration.report` (`ProjectStore.migrationReport()` + Workbench read-only Migration Report block) and 3-step empty-workspace Onboarding Card.
- Closed P3 Multi-Agent Orchestration with cross-day budget `windowSummaries` (`last7Days`, `allTime`) and per-delegation `budgetCeiling`.
- Added Episode Production Readiness Strip, multi-select `drama.shot.review.batch` + `@` batch staging, and Director keyboard accelerators in `ShotInspector` and `AnimaticPlayer`.
- Added macOS + Linux dual-platform Playwright E2E runner with 6-file redacted evidence bundles and `1440×900` / `390×844` visual verification.

## v2 — Drama Studio Production Workstation (2026-11-27)

- Delivered `DramaReviewStore` (`drama-reviews.v1.json`, `0600` atomic write, `expectedRevision` optimistic locking, `.corrupt-*` quarantine) and sanitized rough-cut exporter (`cut_manifest_v1`, `cmx3600_edl`, `shotlist_csv`).
- Delivered 6-role `ShotInspector`, zero-dependency HTML5 `AnimaticPlayer` (`9:16` / `16:9`), 3-track interactive `TimelineView`, `SideBySideView` scene coverage linkage, `AssetsView` blocked-shot reverse impact lookup, and P3 `task.cancel` cascade cancellation + paused/orphaned health alerts.

## v0.1.0 — Foundation Suite & Workbench v8 (2026-11-24)

- Initial release of `@yeisme/muweave-bundle`, `@yeisme/dsh-muweave-core`, and the 6 DSH creator plugins (`workbench`, `eikona`, `script`, `drama`, `kit`, `schedule`) with single-entry Drama Theater shell, token-based visual system, v8 stage axis & compare views, F1–F3 project management, Schedule v2, capability gateway, and multi-agent P0–P2 foundation.
