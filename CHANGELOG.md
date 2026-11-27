# Changelog

All notable milestones of the MuWeave DSH Creator Plugin Suite & `.muweave/` workspace bundle are documented here.

## v8 — Continuity Bible, Automated QC Gate, Offline Client Review Deck & 9:16 Safe-Zone (2026-11-27)

- **Project Continuity Bible (`project.bible.get/set`)**:
  - Added `ContinuityBibleStore` (`continuity-bible.v1.json`, `0600` atomic write, `.corrupt-*` backup, hex validation, `expectedRevision` optimistic locking → `muweave/bible_revision_conflict`, credential/host-path guard → `muweave/invalid_bible_input`).
  - Added 「片场连续性圣经」 (`.mw-bible-card`) inside Eikona's `masters` tab with save and 「`@` 注入助手」 staging, plus `eikona-bible-1440x900.png` E2E capture.
- **Automated Episode QC Gate (`drama.qc.report`)**:
  - Added zero-cost 5-pillar `runEpisodeQc` (opening hook/duration, visual/audio/CAS/lip-sync risk, blocked 4-axis assets, director review gate, compliance disclosure) returning `0–100` score and `readyForDelivery`.
  - Added collapsible `.dr-qc-strip` in Drama `storyboard` & `timeline` with clickable shot findings opening `ShotInspector`.
- **SRT/WebVTT Subtitles, Offline Client Review Deck HTML & Safe Feedback Import**:
  - Extended `drama.export.manifest` & `muweave export` with `srt_subtitles`, `webvtt_subtitles`, and zero-CDN `review_deck_html` (HTML/`</script>`-escaped 9:16 preview + `review-feedback.json` download; `--bundle-dir` also writes `subtitles.srt`).
  - Added `DramaReviewStore.importFeedback` & `drama.shot.review.import` (skipping `locked` shots as `skipped_locked` by default) plus Timeline 「导入甲方反馈 JSON」 upload UI.
- **9:16 Safe-Zone Overlay, CLI & MCP (18 Tools / 8 Resources)**:
  - Added opt-in `9:16 安全区` toggle & non-interactive `.dr-safe-zone-overlay` in `AnimaticPlayer`.
  - Added CLI `muweave bible`, `muweave qc`, `muweave review import`, MCP `muweave_project_bible` & `muweave_drama_qc_report` (18 tools, zero `job.approve`), and resources `muweave://project/bible` & `muweave://drama/qc` (8 resources).

## v7 — Custom Engine Bridge, Multi-Episode Non-Destructive Cut & NLE Portable Export (2026-11-27)

- **Zero-Secret Custom Engine Bridge**:
  - Added `CustomAdapterStore` (`custom-adapters.v1.json`, `0600` atomic write, `.corrupt-*` backup) storing env var names (`authEnvVar`) only, rejecting plaintext secrets (`sk-*` / `Bearer`), and enforcing strict SSRF/HTTPS validation (`ADAPTER_HTTPS_REQUIRED`, `ADAPTER_PRIVATE_NET_FORBIDDEN`).
  - Added `openai_http`, `comfyui_http`, and no-shell `cli_wrapper` builders, 3 presets (`openai-image`, `openai-tts`, `comfyui-local`), zero-cost `testCustomAdapter` probe, RPCs `adapter.custom.list|save|remove|test`, CLI `muweave adapters`, MCP `muweave_adapters_manage`, and Kit's `.kit-adapter-card` UI with client-side plaintext secret blocking.
- **Multi-Episode Non-Destructive Cut Layer**:
  - Added `DramaCutStore` (`drama-cuts.v1.json`, `0600` atomic write, `expectedRevision` optimistic locking → `muweave/cut_revision_conflict`) and `applyEpisodeCut` overlay with RPCs `drama.cut.get|set|reset`, CLI `muweave cut`, MCP `muweave_drama_cut_manage` (16 tools total, still zero `job.approve`), and multi-episode `.dr-episode-bar` switchers + inline cut controls in Drama and Script.
- **FCPXML 1.10, Jianying Draft & Portable Bundle Export**:
  - Extended `drama.export.manifest` and `muweave export` with `fcpxml_1_10` (`*.fcpxml`), `jianying_draft_v1` (`draft_content.json`), `--episode` filtering, and `--bundle-dir` portable CAS media export (`media/<sha12>.<ext>`, zero host paths or secrets), plus Timeline 「导出 FCPXML」 & 「导出剪映草稿」 buttons.

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
