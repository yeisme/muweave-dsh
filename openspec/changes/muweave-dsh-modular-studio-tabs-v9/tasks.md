# Tasks: muweave-dsh-modular-studio-tabs-v9

## Wave 0: OpenSpec, Room Mapping & Release Docs

- [x] 0.1 Author OpenSpec change artifacts (`openspec/changes/muweave-dsh-modular-studio-tabs-v9/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/dsh-creator-surfaces/spec.md}`) and validate with `openspec validate muweave-dsh-modular-studio-tabs-v9 --strict --no-interactive`.
- [x] 0.2 Update `docs/design/tab-room-mapping.md` (12 rooms), author `docs/design/modular-studio-tabs-v9.md`, register in `docs/design/README.md`, and update `README.md` & `CHANGELOG.md`.

## Wave 1: Protocol, 4 Persistent Stores, PNG CAS Snapshot, CLI, MCP (22 Tools / 12 Resources) & Build/Pack (`packages/dsh-muweave-core`)

- [ ] 1.1 Extend `protocol.ts` with 13 v9 RPC actions & DTOs and add 4 plugin path aliases to `tsconfig.json`.
- [ ] 1.2 Implement `workspace-tabs-store.ts`, `canvas-board-store.ts` (+ `exportCanvasMermaid`), `stage3d-store.ts` (+ `compileStage3dPrompt`, `detectAxisCrossing`), and `audio-mix-store.ts`.
- [ ] 1.3 Wire all 13 RPCs in `host.ts` (including PNG magic/size-validated `stage3d.snapshot.save`), extend `cli.ts`, `mcp/server.ts` (22 tools / 12 resources), `index.ts`, `scripts/build-all.mjs`, and `scripts/pack-plugins.mjs` (10 plugins); add `tests/v9-modular-stores.test.ts`.

## Wave 2: Modular Header, Module Manager & Token Styles (`packages/dsh-muweave-core/src/client`)

- [ ] 2.1 Implement `theater/module-manager.ts`, `theater/ModuleManagerPage.tsx`, 3-group `RoomNav` & `muweave-modules` routing in `TheaterPage.tsx`, `THEATER_QUICK_ROOMS` in `command-palette.tsx`, and re-exports in `index.tsx`.
- [ ] 2.2 Add `.mw-room-nav-sep`, `.mw-mod-*`, `.mw-canvas-*`, `.mw-s3d-*`, `.mw-aud-*`, `.mw-ast-*` styles and dynamic CSS var defaults in `styles.ts`.

## Wave 3: 4 Standalone Studio Plugins, Static Guard & E2E (`canvas`, `stage3d`, `audio`, `assets`, `scripts`, `tests`)

- [ ] 3.1 Implement `@yeisme/dsh-muweave-canvas` (`board`, `outline`) and `@yeisme/dsh-muweave-stage3d` (`projection3d.ts`, `director-stage`, `camera-sheet`).
- [ ] 3.2 Implement `@yeisme/dsh-muweave-audio` (`mixer`, `cues`) and `@yeisme/dsh-muweave-assets` (`catalog`, `usage`), expand `tests/styles-static.test.ts` to all 10 plugins, update `scripts/inner-e2e-runner.mjs` for 10 plugins + 5 new screenshots, and add `tests/v9-modular-studio-ui.test.tsx`.

## Wave 4: Full Verification Gate

- [ ] 4.1 Run `openspec validate muweave-dsh-modular-studio-tabs-v9 --strict --no-interactive`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm pack:plugins`, and `pnpm test:integration` with 0 redaction leaks.
