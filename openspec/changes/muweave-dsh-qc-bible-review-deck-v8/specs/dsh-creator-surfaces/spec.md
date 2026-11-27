# Continuity Bible, Automated QC Gate & Offline Client Review Deck v8

## ADDED Requirements

### Requirement: Continuity Bible SHALL persist optimistic-locked studio rules and stage cleanly from Eikona
`@yeisme/dsh-muweave-core` SHALL expose `project.bible.get` and `project.bible.set` backed by `ContinuityBibleStore` (`continuity-bible.v1.json`, `0600` atomic write, `.corrupt-*` backup), enforcing hex color validation, credential/host-path rejection (`muweave/invalid_bible_input`), and `expectedRevision` locking (`muweave/bible_revision_conflict`). Eikona's `masters` tab SHALL edit, save, and `@`-stage the bible without changing stage tab IDs.

#### Scenario: Stale bible revision and secret-bearing inputs are rejected
- **WHEN** `project.bible.set` is called with a stale `expectedRevision` or a plaintext credential/host path
- **THEN** the host SHALL reject with `muweave/bible_revision_conflict` or `muweave/invalid_bible_input` without overwriting persisted data

### Requirement: Automated Episode QC Gate SHALL evaluate five delivery pillars at zero cost across UI, CLI, and MCP
`@yeisme/dsh-muweave-core` SHALL provide `runEpisodeQc` and `drama.qc.report` evaluating opening hook/duration, visual/audio/CAS/lip-sync readiness, blocked 4-axis assets, director approval, and compliance disclosure on the active cut with a `0–100` score and `readyForDelivery`. Drama `.dr-qc-strip`, CLI `muweave qc`, and MCP `muweave_drama_qc_report` SHALL expose this sanitized report.

#### Scenario: Episode QC blocks unapproved or missing-visual shots and opens inspector on click
- **WHEN** `drama.qc.report` runs on an episode with a `draft` or missing-visual shot and the director clicks that finding in `.dr-qc-strip`
- **THEN** `readyForDelivery` SHALL be `false` with corresponding blocker findings, and clicking the finding SHALL open `ShotInspector` on that `shotRef`

### Requirement: Exporter SHALL compile SRT/WebVTT subtitles and offline Client Review Deck HTML with locked-shot safe feedback import
`@yeisme/dsh-muweave-core` SHALL extend `drama.export.manifest` and `muweave export` with `srt_subtitles`, `webvtt_subtitles`, and zero-CDN `review_deck_html` (HTML/`</script>`-escaped, 9:16 preview, `review-feedback.json` export), and SHALL provide `drama.shot.review.import` skipping director-`locked` shots (`skipped_locked`) unless `allowLocked: true`, while keeping MCP at 18 tools and 8 resources with zero `job.approve`.

#### Scenario: Importing client feedback preserves director-locked shots by default
- **WHEN** `drama.shot.review.import` receives feedback targeting a `locked` shot and an `in_review` shot without `allowLocked: true`
- **THEN** the `locked` shot SHALL report `skipped_locked` (`locked_by_director`) unchanged while valid unlocked shots SHALL be imported atomically

### Requirement: AnimaticPlayer SHALL provide an opt-in 9:16 Safe-Zone Overlay using token-only styles
`AnimaticPlayer` SHALL include an opt-in `9:16 安全区` toggle (`data-animatic-safezone-toggle="true"`, default off) that mounts a non-interactive `.dr-safe-zone-overlay` (`data-safe-zone-overlay="true"`) depicting top margin, right engagement rail, bottom caption zone, and center safe action frame using `--mw-*` tokens only.

#### Scenario: Toggling safe-zone overlay mounts and unmounts non-interactive guides
- **WHEN** the user clicks `[data-animatic-safezone-toggle="true"]` in `AnimaticPlayer` twice
- **THEN** `[data-safe-zone-overlay="true"]` SHALL mount with `aria-hidden="true"` on the first click and unmount on the second click
