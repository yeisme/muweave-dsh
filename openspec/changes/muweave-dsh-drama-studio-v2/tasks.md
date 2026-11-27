# Tasks: muweave-dsh-drama-studio-v2

## Wave 0: OpenSpec & Design Documentation

- [x] 0.1 Author OpenSpec change artifacts (`openspec/changes/muweave-dsh-drama-studio-v2/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/dsh-creator-surfaces/spec.md}`) and validate with `openspec validate muweave-dsh-drama-studio-v2 --strict --no-interactive`.
- [x] 0.2 Author `docs/design/drama-studio-v2.md` and register it in `docs/design/README.md`.

## Wave 1: Host Protocol, Review Store, Rough-Cut Exporter & P3 Cascade Cancel (`packages/dsh-muweave-core`)

- [x] 1.1 Extend `packages/dsh-muweave-core/src/protocol.ts` with `drama.shot.review.list`, `drama.shot.review.set`, `drama.export.manifest` in `RPC_ACTIONS` and browser-safe v1 DTO types (`ShotReviewStatus`, `ShotReviewRecordV1`, `ShotReviewSetInputV1`, `DramaExportFormat`, `DramaExportResultV1`).
- [x] 1.2 Implement `packages/dsh-muweave-core/src/drama-review-store.ts` with `drama-reviews.v1.json` atomic `0600` persistence, `.corrupt-*` quarantine, `expectedRevision` optimistic locking (`muweave/review_revision_conflict`), and credential/host-path guardrails.
- [x] 1.3 Implement `packages/dsh-muweave-core/src/drama-export.ts` (`msToSmpte`, `buildDramaExportPackage`) supporting `cut_manifest_v1`, `cmx3600_edl`, and `shotlist_csv` with mandatory credential and host-path sanitization exit gates.
- [x] 1.4 Implement multi-agent P3 cascade cancellation and orphan counting in `bot-task/tasks.ts`, `bot-task/service.ts`, `capabilities/service.ts` (`cancelJobsForTasks`), and wire all new RPC routes + `onTasksCancelled` hook in `host.ts`.

## Wave 2: Shared Client Primitives, AnimaticPlayer & Styles (`packages/dsh-muweave-core/src/client`)

- [x] 2.1 Extend `packages/dsh-muweave-core/src/client/shot-media.tsx` with 6-role helpers (`SHOT_MEDIA_ROLE_LIST`, `mediaForRole`, `shotReadinessSummary`) and parameterized `ShotGenerateButton`.
- [x] 2.2 Implement `packages/dsh-muweave-core/src/client/animatic-player.tsx` (native HTML5 `<video>`/`<audio>`, `9:16`/`16:9` aspect toggle via `data-aspect`, `/api/muweave-dsh/media` short-TTL grants, step/scrub/mute controls, reduced-motion compliance).
- [x] 2.3 Update `packages/dsh-muweave-core/src/client/generation-jobs.tsx` to surface `paused` bot counts (`data-bot-paused-count`) and `orphanedCount` (`data-orphaned-task-count`), and export new primitives in `client/index.tsx`.
- [x] 2.4 Add centralized `.dr-*` token-based styles in `packages/dsh-muweave-core/src/client/styles.ts` complying with `tests/styles-static.test.ts` and `1440 / 1024 / 768 / 390` viewports.

## Wave 3: Drama Room Production Surfaces (`packages/dsh-muweave-drama`)

- [x] 3.1 Implement `packages/dsh-muweave-drama/src/shot-inspector.tsx` (director 5-state review + tags + note with optimistic-lock conflict recovery, 6-role media preview/playback/link/unlink, Eikona element binding, and `GenerationDrawer` prefill).
- [x] 3.2 Implement `packages/dsh-muweave-drama/src/timeline-view.tsx` (EDL / JSON / CSV export toolbar, 3-track synchronized ruler, click-to-inspect clips, clip detail table).
- [x] 3.3 Implement `packages/dsh-muweave-drama/src/side-by-side-view.tsx` (scene coverage metrics, `data-scene-uncovered="true"` badge, click-to-filter shot list) and `assets-view.tsx` (`All / Blocked / Ready` filter, Eikona master thumbnails, reverse shot impact chips).
- [x] 3.4 Integrate all views, storyboard filter bar, expandable `AnimaticPlayer`, `ShotInspector`, `RoomHero` stats, and bilingual (`zh`/`en`) labels in `packages/dsh-muweave-drama/src/client.tsx` while keeping the 4 stage tab IDs unchanged.

## Wave 4: Automated Verification & Integration Evidence

- [x] 4.1 Add unit and component test suites: `tests/drama-review-store.test.ts`, `tests/drama-export.test.ts`, `tests/drama-production-ui.test.tsx`, `tests/bot-cascade-cancel.test.ts`.
- [x] 4.2 Run full repository verification (`openspec validate muweave-dsh-drama-studio-v2 --strict --no-interactive`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm pack:plugins`).

## Wave 5: v3 Productization, Full Closure & Cross-Platform E2E

- [ ] 5.1 Backend v3 closure (`packages/dsh-muweave-core`): add `project.migration.report` (`ProjectStore.migrationReport()`), `drama.shot.review.batch` (`DramaReviewStore.setBatch()`), cross-day budget `windowSummaries` (`last7Days`, `allTime`), and per-delegation `budgetCeiling` on `task.delegate`, with unit tests (`tests/project-migration-report.test.ts`, `tests/drama-batch-review.test.ts`).
- [ ] 5.2 Core client & styles v3 (`packages/dsh-muweave-core/src/client`): surface `windowSummaries` in `generation-jobs.tsx`, add keyboard shortcuts (`Space`, `ArrowLeft`/`ArrowRight`) + `<kbd>` hints to `animatic-player.tsx`, and add `.dr-readiness-strip`, `.dr-batch-bar`, `.dr-kbd-hints`, `.mw-onboarding-card`, `.mw-migration-report` + 1440px/390px visual polish in `styles.ts`.
- [ ] 5.3 Drama & Workbench v3 UI: add Episode Production Readiness Strip, multi-select batch review (`drama.shot.review.batch`) + `@` batch staging, and `ShotInspector` director keyboard accelerators (`ArrowLeft`/`k`, `ArrowRight`/`j`, `a`, `r`, `Escape`) in `packages/dsh-muweave-drama`; add read-only Migration Report block (`diagnosis-panel.tsx`) and 3-step Onboarding Card in `packages/dsh-muweave-workbench`.
- [ ] 5.4 Cross-platform macOS + Linux E2E (`scripts/run-integration-e2e.mjs`, `scripts/inner-e2e-runner.mjs`): preserve Linux `unshare -rn`, support macOS loopback isolation + Chrome auto-detection, capture 1440×900 and 390×844 Drama Studio v2/v3 screenshots, and output 6-file redacted evidence bundle via `pnpm test:integration`.
- [x] 5.5 Update `docs/design/desk-v8-spec.md`, `docs/design/drama-studio-v2.md`, and `openspec/changes/muweave-dsh-drama-studio-v2/tasks.md` with v3 productization and P2 registry migration report closure, and validate with `openspec validate muweave-dsh-drama-studio-v2 --strict --no-interactive`.
