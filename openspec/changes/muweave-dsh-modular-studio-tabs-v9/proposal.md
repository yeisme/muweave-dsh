# Proposal: MuWeave DSH Modular Header Architecture & 4 Studio Tabs v9

## Why

As MuWeave DSH matured from 7 core rooms into a full vertical-drama studio, creators requested four high-value specialized workspaces—**Spatial Canvas (`画布`)**, **3D Director Previs Stage (`3D导演台`)**, **Multi-Track Audio & Cue Desk (`音画台`)**, and **Central Asset Vault (`资产库`)**—without turning the theater header into an overcrowded fixed bar:

1. **Fixed header cannot scale cleanly to 11+ rooms**: Different creator roles (Director, Art/Canvas, Audio/Edit, Producer) need a customizable top bar with role presets, pin/unpin, drag/step reordering, and 3-group visual hierarchy (`pipeline | studio | ops`).
2. **No spatial moodboard / story-graph canvas**: Creators lacked an infinite pan/zoom node canvas that auto-lays out current episode masters, Continuity Bible palette, scenes, and shots with Mermaid export.
3. **No zero-dependency 3D director previs & 180° axis-crossing check**: Directors could not block camera focal lengths (`24–135mm`), actors, lights, and props in 3D, check 180° axis crossing, compile structured camera prompts, or bind a rendered 3D greybox PNG directly to a shot as `reference`.
4. **No dedicated Audio Mixer or Central Asset Vault**: Multi-track `voice / music / sfx` gain/mute/solo/fade mixing, `>8s` lip-sync drift cues, and cross-episode asset↔shot reference matrices needed focused studio rooms.

## What Changes

1. **Modular Header & Module Manager (`@yeisme/dsh-muweave-core/client`)**:
   - Add `group?: TheaterRoomGroup` (`'pipeline' | 'studio' | 'ops'`) to `TheaterRoom`, `THEATER_MODULES_VIEW_ID = 'muweave-modules'` (rendered as built-in `ModuleManagerPage` without mutating `getTheaterRooms()`), 5 role presets (`all`, `director`, `art_canvas`, `audio_edit`, `producer`), pin/reorder controls, `.mw-room-nav-sep` separators, and `Alt+1..9` mapped to the first 9 visible header rooms.
   - Persist layout via `WorkspaceTabsStore` (`workspace-tabs.v1.json`, `workspace.tabs.get|save|reset`).
2. **4 Standalone DSH Studio Plugins (`@yeisme/dsh-muweave-{canvas,stage3d,audio,assets}`)**:
   - **`muweave-canvas` (`画布`, `board` / `outline`)**: Pan/zoom spatial board, auto-layout from active episode, node/edge editing, `CanvasBoardStore` (`canvas.board.get|save|reset`), Mermaid export, `@` staging & generation triggers.
   - **`muweave-stage3d` (`3D导演台`, `director-stage` / `camera-sheet`)**: Pure zero-dependency 3D perspective projection (`24–135mm`), 5 camera presets (`ots`, `hero_low`, `two_shot`, `ecu`, `birds_eye`), 180° axis-crossing alert, structured camera prompt compiler, `Stage3dStore` (`stage3d.scene.get|save|reset`), and PNG-validated `stage3d.snapshot.save` writing CAS blobs and binding as `reference` media.
   - **`muweave-audio` (`音画台`, `mixer` / `cues`)**: Master + 3-track (`voice`/`music`/`sfx`) mute/solo/gain (`0–150%`)/fade (`0–10000ms`), `AudioMixStore` (`audio.mix.get|save|reset`), missing-voice TTS launch, dialogue cue table with `>8s` lip-sync risk badge, and SRT/VTT export.
   - **`muweave-assets` (`资产库`, `catalog` / `usage`)**: Cross-domain searchable asset catalog, 4-axis readiness dots, bind-to-shot, `@` staging, and bidirectional asset↔shot usage matrix.
3. **Build, Pack, CLI, MCP (22 Tools / 12 Resources) & Docs**:
   - Register all 10 DSH plugin packages in `tsconfig.json`, `scripts/build-all.mjs`, `scripts/pack-plugins.mjs`, `tests/styles-static.test.ts`, and `scripts/inner-e2e-runner.mjs`.
   - Extend CLI (`muweave tabs`, `muweave canvas`, `muweave stage3d`, `muweave audio`) and MCP (`muweave_workspace_tabs`, `muweave_canvas_board`, `muweave_stage3d_scene`, `muweave_audio_mix` → 22 tools / 12 resources, still ZERO `job.approve`).
   - Update `docs/design/tab-room-mapping.md` (12 rooms), `docs/design/modular-studio-tabs-v9.md`, `docs/design/README.md`, `README.md`, and `CHANGELOG.md`.

## Non-goals

- Never register `muweave-modules` into `getTheaterRooms()` (keeps existing theater plugin-room count invariants intact).
- Never add Three.js / ReactFlow / WebAudio external npm dependencies; keep all rendering zero-dependency native Canvas2D/SVG/HTML5 + externalized React 18.
- Never expose `job.approve`, mutate canonical `.scaena/**` / `.eikona/**` / `.auctra/**` internals, or allow ad-hoc inline styles or literal hex colors in `.tsx`.
