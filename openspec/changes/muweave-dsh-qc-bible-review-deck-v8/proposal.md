# Proposal: MuWeave DSH Continuity Bible, Automated QC Gate & Offline Client Review Deck v8

## Why

MuWeave DSH v2–v7 delivered a complete tri-surface (UI + CLI + MCP) drama production workstation with custom engine bridges, multi-episode non-destructive cuts, and FCPXML/Jianying portable exports. However, five final production-delivery needs remained for vertical drama studios shipping episodes to clients and platforms:

1. **No structured Project Continuity Bible**: Character wardrobe/immutable traits, lens/lighting rules, negative guardrails, and 2026 AI compliance disclosure metadata were scattered across prompts instead of stored in a single optimistic-locked, injectable studio bible.
2. **No automated Episode QC Gate**: Directors lacked a zero-cost pre-delivery gate checking opening hook pacing (`<= 3.5s`), 6-track visual/audio/CAS readiness, lip-sync duration risk, 4-axis asset blocks, director approvals, and compliance disclosure before export.
3. **No offline Client Review Deck HTML & safe feedback re-import**: External stakeholders without DSH access could not review a 9:16 episode offline and return structured `review-feedback.json` safely without risking overwrites of director-`locked` shots.
4. **No SRT / WebVTT subtitle export**: Teams needed deterministic subtitle tracks compiled directly from the active non-destructive cut.
5. **No 9:16 Safe-Zone Overlay in AnimaticPlayer**: Directors could not verify top margin, right-edge short-video engagement rail, and bottom caption unsafe areas during animatic playback.

## What Changes

1. **Continuity Bible Store & Eikona UI (`@yeisme/dsh-muweave-core`, `@yeisme/dsh-muweave-eikona`)**:
   - Add `ContinuityBibleStore` (`pluginDataDir/continuity-bible.v1.json`, `0600` atomic write, `.corrupt-*` backup, `expectedRevision` optimistic lock → `muweave/bible_revision_conflict`, hex color validation, credential/host-path guard → `muweave/invalid_bible_input`) with RPCs `project.bible.get` & `project.bible.set`.
   - Mount 「片场连续性圣经」 (`.mw-bible-card`) inside Eikona's existing `masters` tab with save + 「`@` 注入助手」 staging.
2. **Automated Episode QC Gate (`@yeisme/dsh-muweave-core`, `@yeisme/dsh-muweave-drama`)**:
   - Add pure zero-cost `runEpisodeQc` (`drama-qc.ts`) and `drama.qc.report` checking 5 pillars (opening hook & duration range, media/CAS/lip-sync risk, blocked 4-axis assets, director approval gate, compliance disclosure) with `0–100` score and `readyForDelivery`.
   - Render collapsible `.dr-qc-strip` in Drama `storyboard` and `timeline` with clickable shot findings opening `ShotInspector`.
3. **Offline Client Review Deck HTML, Safe Feedback Import & SRT/WebVTT Subtitles**:
   - Extend `DramaExportFormat` with `srt_subtitles` (`.srt`), `webvtt_subtitles` (`.vtt`), and `review_deck_html` (zero external CDN/fonts, HTML/`</script>`-escaped sanitized state, 9:16 preview player, compliance badge, `review-feedback.json` download). Portable `--bundle-dir` for `review_deck_html` bundles `subtitles.srt`, `media/`, and `README.txt`.
   - Add `DramaReviewStore.importFeedback` & `drama.shot.review.import` skipping `locked` shots (`skipped_locked`, reason `'locked_by_director'`) unless `allowLocked === true`, plus Timeline 「导入甲方反馈 JSON」 upload UI.
4. **9:16 Safe-Zone Overlay (`@yeisme/dsh-muweave-core/client`)**:
   - Add opt-in `9:16 安全区` toggle (`data-animatic-safezone-toggle="true"`) and non-interactive `.dr-safe-zone-overlay` in `AnimaticPlayer`.
5. **CLI, MCP (18 Tools / 8 Resources) & Documentation**:
   - Add CLI `muweave bible show|set`, `muweave qc [--episode] [--strict]`, `muweave review import`, `muweave export srt_subtitles|webvtt_subtitles|review_deck_html`.
   - Add MCP `muweave_project_bible`, `muweave_drama_qc_report` (18 tools, zero `job.approve`) and resources `muweave://project/bible`, `muweave://drama/qc` (8 resources).
   - Refresh `README.md`, `docs/INTEGRATIONS.md`, `CHANGELOG.md`, `docs/design/qc-bible-review-deck-v8.md`, and `docs/design/README.md`.

## Non-goals

- Never expose `job.approve` or autonomous paid execution over CLI, MCP, or Kit agent tools.
- Never fetch external CDNs, fonts, or remote scripts inside `review_deck_html`.
- Never mutate canonical `.scaena/**`, `.eikona/**`, or `.auctra/**` internals or alter existing theater room / stage tab IDs.
