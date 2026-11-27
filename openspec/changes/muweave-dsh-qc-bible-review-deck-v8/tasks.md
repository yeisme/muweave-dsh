# Tasks: muweave-dsh-qc-bible-review-deck-v8

## Wave 0: OpenSpec, Design Doc, README, INTEGRATIONS & CHANGELOG

- [x] 0.1 Author OpenSpec change artifacts (`openspec/changes/muweave-dsh-qc-bible-review-deck-v8/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/dsh-creator-surfaces/spec.md}`) and validate with `openspec validate muweave-dsh-qc-bible-review-deck-v8 --strict --no-interactive`.
- [x] 0.2 Author `docs/design/qc-bible-review-deck-v8.md`, register it in `docs/design/README.md`, refresh `README.md`, update `docs/INTEGRATIONS.md`, and add v8 section to `CHANGELOG.md`.

## Wave 1: Continuity Bible, Episode QC Gate, Subtitles, Review Deck HTML, Safe Feedback Import, CLI & MCP (`packages/dsh-muweave-core`)

- [ ] 1.1 Extend `protocol.ts` with `project.bible.get/set`, `drama.qc.report`, `drama.shot.review.import`, `srt_subtitles` / `webvtt_subtitles` / `review_deck_html`, and v8 DTOs.
- [ ] 1.2 Implement `continuity-bible-store.ts`, `drama-qc.ts` (`runEpisodeQc`), `DramaReviewStore.importFeedback`, and `drama-export.ts` (`srt_subtitles`, `webvtt_subtitles`, `review_deck_html`, portable bundle `subtitles.srt`).
- [ ] 1.3 Normalize `demo-seed.ts` episode 1 ref to `'episode:01'` with dialogue cells + default `ContinuityBibleV1`; wire RPCs in `host.ts`, CLI `bible`/`qc`/`review import`/`export` in `cli.ts`, and MCP 18 tools / 8 resources in `mcp/server.ts`; add `tests/continuity-bible.test.ts` & `tests/drama-qc-review-deck.test.ts`.

## Wave 2: 9:16 Safe-Zone Overlay, Drama QC/Import UI, Eikona Bible UI & E2E (`core/client`, `drama`, `eikona`, `scripts`)

- [ ] 2.1 Add `9:16 安全区` toggle & `.dr-safe-zone-overlay` in `animatic-player.tsx` and `.dr-safe-zone-*` / `.dr-qc-*` / `.dr-import-*` / `.mw-bible-*` token styles in `styles.ts`.
- [ ] 2.2 Add collapsible `.dr-qc-strip`, SRT/VTT/Review Deck HTML export buttons, and 「导入甲方反馈 JSON」 in `packages/dsh-muweave-drama/src/{client.tsx,timeline-view.tsx}`.
- [ ] 2.3 Add 「片场连续性圣经」 card (`.mw-bible-card`) inside Eikona's `masters` tab, add `eikona-bible-1440x900.png` capture in `scripts/inner-e2e-runner.mjs`, and add `tests/v8-qc-safezone-ui.test.tsx`.

## Wave 3: Full Verification Gate

- [ ] 3.1 Run `openspec validate muweave-dsh-qc-bible-review-deck-v8 --strict --no-interactive`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm pack:plugins`, and `pnpm test:integration` with 0 redaction leaks.
