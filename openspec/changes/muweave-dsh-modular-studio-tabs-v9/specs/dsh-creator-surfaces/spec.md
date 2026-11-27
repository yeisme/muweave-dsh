# Modular Header Architecture & 4 Studio Tabs v9

## ADDED Requirements

### Requirement: Modular theater header SHALL support 3-group layout, role presets, pin/reorder customization, and built-in Module Manager
`@yeisme/dsh-muweave-core` SHALL support `group` (`pipeline | studio | ops`) on theater rooms, expose a built-in `muweave-modules` `ModuleManagerPage` without adding it to `getTheaterRooms()`, persist tab presets (`all | director | art_canvas | audio_edit | producer`), pins, and ordering via `WorkspaceTabsStore` (`workspace.tabs.get|save|reset`), and map `Alt+1..9` to the first nine visible header rooms.

#### Scenario: Switching role preset and reordering header tabs persists cleanly
- **WHEN** a user opens `muweave-modules`, selects a role preset or pins/reorders rooms, and saves
- **THEN** `workspace.tabs.save` SHALL persist the configuration with optimistic locking, `RoomNav` SHALL render visible rooms in three grouped sections, and `getTheaterRooms()` SHALL retain only plugin rooms

### Requirement: Spatial Canvas and 3D Director Stage plugins SHALL persist boards and scenes and bind validated PNG snapshots to shots
`@yeisme/dsh-muweave-canvas` (`board`, `outline`) and `@yeisme/dsh-muweave-stage3d` (`director-stage`, `camera-sheet`) SHALL persist optimistic-locked data via `CanvasBoardStore` (`canvas.board.*`, Mermaid export) and `Stage3dStore` (`stage3d.scene.*`, prompt compiler, 180° axis-crossing detection). `stage3d.snapshot.save` SHALL validate PNG magic bytes and `<= 2 MiB` size, store to CAS, and bind as `reference` media.

#### Scenario: Stage3D detects axis crossing and binds a validated PNG snapshot to a shot
- **WHEN** `stage3d.snapshot.save` receives a valid base64 PNG for an opaque `shotRef` and `detectAxisCrossing` compares camera sides across an actor axis
- **THEN** the host SHALL reject non-PNG or oversized payloads, persist valid PNGs to CAS and link them as `reference`, and surface axis-crossing alerts when the camera crosses the 180° line

### Requirement: Multi-Track Audio Desk and Central Asset Vault plugins SHALL manage audio mixes and cross-episode asset usage
`@yeisme/dsh-muweave-audio` (`mixer`, `cues`) SHALL persist clamped `voice`/`music`/`sfx` gain (`0–150%`), mute/solo, and fade (`0–10000ms`) via `AudioMixStore` (`audio.mix.*`), flag `>8s` lip-sync cues, and offer SRT/VTT export. `@yeisme/dsh-muweave-assets` (`catalog`, `usage`) SHALL provide cross-domain asset filtering, 4-axis readiness badges, bind-to-shot, `@` staging, and a bidirectional asset-to-shot usage matrix.

#### Scenario: Audio mixer clamps invalid gain/fade values and Asset Vault shows bidirectional usage
- **WHEN** `audio.mix.save` receives out-of-range gain/fade values and the user opens `muweave-assets` `usage` tab
- **THEN** `AudioMixStore` SHALL clamp gain to `0..150` and fade to `0..10000` with optimistic locking, and `muweave-assets` SHALL display linked and unreferenced assets across shots

### Requirement: Ten-plugin suite SHALL enforce static token styling and expose v9 CLI and 22-tool MCP surfaces without paid approval
All 10 DSH plugin packages SHALL pass `tests/styles-static.test.ts` using `--mw-*` tokens and CSS custom properties only, pack via `scripts/pack-plugins.mjs`, and expose `muweave tabs|canvas|stage3d|audio` CLI commands plus 22 MCP tools and 12 `muweave://*` resources with zero `job.approve` exposure.

#### Scenario: Static style guard and MCP tool catalog verify all 10 plugins and 22 tools
- **WHEN** `tests/styles-static.test.ts` scans all 10 plugins and an MCP client calls `tools/list` and `resources/list`
- **THEN** zero ad-hoc inline styles or literal colors SHALL be found, MCP SHALL list 22 tools and 12 resources with zero `job.approve`, and all outputs SHALL strip host paths
