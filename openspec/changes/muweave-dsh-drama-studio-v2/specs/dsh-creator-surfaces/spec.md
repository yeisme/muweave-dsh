# Drama Studio v2

## ADDED Requirements

### Requirement: Drama production host SHALL persist optimistic-locked shot reviews and compile sanitized rough-cut exports
`@yeisme/dsh-muweave-core` SHALL expose `drama.shot.review.list`, `drama.shot.review.set`, and `drama.export.manifest` on `/api/muweave-dsh/rpc`. Shot reviews SHALL persist in `pluginDataDir/drama-reviews.v1.json` (atomic `0600` writes, `.corrupt-*` quarantine, never touching canonical `.scaena/**`, `.eikona/**`, or `.auctra/**`) with `expectedRevision` optimistic locking, credential/path rejection, and sanitized `cut_manifest_v1`, `cmx3600_edl`, and `shotlist_csv` exports.

#### Scenario: Saving a shot review with stale revision is rejected
- **WHEN** `drama.shot.review.set` is called with an `expectedRevision` that does not match the persisted record
- **THEN** the host SHALL reject the write with `muweave/review_revision_conflict`, preserve existing data, and include `currentRevision` in error details

#### Scenario: Exported rough-cut packages strip host paths and credentials
- **WHEN** `drama.export.manifest` is requested for `cut_manifest_v1`, `cmx3600_edl`, or `shotlist_csv`
- **THEN** the response SHALL contain deterministic timecodes derived from `plannedDurationMicros` / edit clips, zero host filesystem paths, and zero plaintext credentials

### Requirement: Drama room SHALL provide 6-role shot media inspection, director review, animatic playback, and cross-tab linkage
`@yeisme/dsh-muweave-drama` and `@yeisme/dsh-muweave-core` SHALL keep the four `muweave-drama` stage tab IDs (`storyboard`, `assets`, `timeline`, `side-by-side`) unchanged while providing a 6-role `ShotInspector` (`keyframe | reference | video | voice | music | sfx`) with director review, a zero-dependency `AnimaticPlayer` (`9:16` / `16:9`), a 3-track `timeline` with rough-cut exports, and synchronized `side-by-side` and `assets` linkage using `--mw-*` tokens only.

#### Scenario: Shot inspector manages 6 media roles and persists director review
- **WHEN** a user opens a shot in `ShotInspector`, binds or unlinks media across `keyframe|reference|video|voice|music|sfx`, and saves a review status and note
- **THEN** the UI SHALL invoke `shot.media.link`/`unlink` and `drama.shot.review.set`, reflect updated 6-role readiness indicators on the storyboard card, and survive reload

#### Scenario: Animatic player sequences shots by planned duration with aspect toggle
- **WHEN** the user opens the Animatic player and switches between `9:16` and `16:9` or steps between shots
- **THEN** the player SHALL resolve media via `/api/muweave-dsh/media` short-TTL grants, display the active shot timecode and review badge, and respect `prefers-reduced-motion`

#### Scenario: Script-to-shots coverage and asset-to-shots impact stay synchronized
- **WHEN** the user selects a scene in `side-by-side` or filters blocked assets in `assets`
- **THEN** scenes with zero shots SHALL display an explicit coverage-gap badge, selecting a scene SHALL filter matching shots, and blocked assets SHALL list impacted `shotRef`s

### Requirement: Multi-agent orchestration P3 SHALL cascade task cancellation to active jobs and surface circuit-breaker/orphan states
`BotTaskService` and `CapabilityService` SHALL cascade `task.cancel` subtree cancellations to active linked capability jobs, report `orphanedCount` in `task.list`, and surface paused bot circuit-breaker states and orphaned task counts explicitly in creator generation/progress UIs.

#### Scenario: Cancelling a task tree cascades to linked capability jobs
- **WHEN** `task.cancel` cancels a root or delegated task linked to active `CapabilityService` jobs
- **THEN** those active jobs SHALL transition to `cancelled` (or remain `reconcile_required` if owner cancel is ambiguous) and `cancelledJobIds` SHALL be returned

#### Scenario: Paused bots and orphaned tasks are visible in creator surfaces
- **WHEN** a bot is in `paused` state or `task.list` reports `orphanedCount > 0`
- **THEN** the generation/progress surface SHALL render explicit text + tone indicators without fabricating a healthy state
