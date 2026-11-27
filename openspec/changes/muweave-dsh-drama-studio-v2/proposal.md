# Proposal: MuWeave DSH Drama Studio v2

## Why

MuWeave DSH has delivered the v8 workbench, project management (F1/F2/F3), Schedule v2, capability gateway (`CapabilityService`), and multi-agent orchestration P0–P2 (`BotTaskService`). However, the creator's highest-frequency production room (`@yeisme/dsh-muweave-drama`) remains a read-only viewer, and multi-agent orchestration P3 reliability closure is incomplete:

1. `storyboard` displays static shot rows and a single `keyframe`, without per-shot 6-role media management (`keyframe | reference | video | voice | music | sfx`) or director review workflow/notes.
2. There is no in-browser Animatic preview player to validate 9:16 vertical drama pacing and audio-visual sync against `plannedDurationMicros`.
3. `timeline` renders a single static track without multi-track synchronization or standard NLE rough-cut handoff exports (`cut_manifest_v1`, `cmx3600_edl`, `shotlist_csv`).
4. `side-by-side` and `assets` lack cross-pane linkage, scene-to-shot coverage metrics, and reverse impact lookup from blocked assets to affected shots.
5. Multi-agent orchestration P3 gaps (`task.cancel` cascading cancellation to active `CapabilityService` jobs, `orphanedCount` reporting, and explicit `paused` circuit-breaker visibility in creator surfaces) remain open.

## What Changes

1. **Host RPC, Review Store & Rough-Cut Exporter (`@yeisme/dsh-muweave-core`)**:
   - Extend `RPC_ACTIONS` and `protocol.ts` with `drama.shot.review.list`, `drama.shot.review.set`, and `drama.export.manifest`, plus browser-safe v1 DTOs.
   - Add `DramaReviewStore` persisting optimistic-locked director reviews to `pluginDataDir/drama-reviews.v1.json` (`0600` atomic write, `.corrupt-*` quarantine, credential and host-path guardrails).
   - Add pure `buildDramaExportPackage` compiler (`drama-export.ts`) producing sanitized `cut_manifest_v1`, `cmx3600_edl`, and `shotlist_csv` packages with deterministic SMPTE timecodes.
2. **Multi-Agent Orchestration P3 Closure (`@yeisme/dsh-muweave-core`)**:
   - Report `orphanedCount` in `TaskLedger.list()` and wire `BotTaskService` `onTasksCancelled` hook to `CapabilityService.cancelJobsForTasks`, returning `cancelledJobIds`.
   - Surface `paused` bot circuit-breaker counts and `orphanedCount` warnings explicitly in `GenerationJobs`.
3. **Shared Client Primitives & Visual Tokens (`@yeisme/dsh-muweave-core/client`)**:
   - Expand `shot-media.tsx` with 6-role helpers (`SHOT_MEDIA_ROLE_LIST`, `mediaForRole`, `shotReadinessSummary`) and parameterized `ShotGenerateButton`.
   - Add zero-dependency native HTML5 `AnimaticPlayer` supporting `9:16` / `16:9` aspect toggle, `/api/muweave-dsh/media` short-TTL grants, audio/video sync, and `prefers-reduced-motion`.
   - Centralize `.dr-*` styles in `styles.ts` strictly using `--mw-*` tokens, `rem` units, zero orange hues, and responsive breakpoints (`1440 / 1024 / 768 / 390`).
4. **Drama Production Room Upgrade (`@yeisme/dsh-muweave-drama`)**:
   - Keep all 4 existing stage tab IDs (`storyboard`, `assets`, `timeline`, `side-by-side`) intact.
   - Add `ShotInspector`, `TimelineView`, `SideBySideView`, and `AssetsView`, plus storyboard filter bar, review badges, 6-role readiness dots, and expandable `AnimaticPlayer`.
5. **Design Documentation**:
   - Add `docs/design/drama-studio-v2.md` and register it in `docs/design/README.md`.

## Non-goals

- Do not read or mutate canonical `.scaena/**`, `.eikona/**`, or `.auctra/**` internal SQLite databases or private metadata files.
- Do not add third-party video/timeline NPM packages or bundle a second copy of React into DSH browser bundles.
- Do not change existing theater room IDs or the 4 `muweave-drama` stage tab IDs (`storyboard`, `assets`, `timeline`, `side-by-side`).
- Do not perform server-side FFmpeg rendering or cloud NLE rendering; rough-cut export is limited to sanitized metadata/EDL/CSV handoff packages.
- Do not implement registry migration reporting (tracked separately in `muweave-dsh-docs-alignment-v1`).

## Risks & Mitigations

- **Concurrent review overwrites**: Mitigated by `expectedRevision` optimistic locking (`muweave/review_revision_conflict` with `currentRevision`).
- **Sensitive data leakage in exports/notes**: Mitigated by mandatory `findPlaintextCredential` and `containsHostPath` gates on both review writes and export compilation.
- **Style regression / bundle bloat**: Mitigated by keeping all styles in `styles.ts` (guarded by `tests/styles-static.test.ts`) and using native HTML5 `<video>` / `<audio>` without extra runtime dependencies.
