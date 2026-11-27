# Tasks: muweave-dsh-tri-surface-v5

## Wave 0: OpenSpec & Design Documentation

- [x] 0.1 Author OpenSpec change artifacts (`openspec/changes/muweave-dsh-tri-surface-v5/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/dsh-creator-surfaces/spec.md}`) and validate with `openspec validate muweave-dsh-tri-surface-v5 --strict --no-interactive`.
- [x] 0.2 Author `docs/design/tri-surface-cli-mcp-v5.md`, register it in `docs/design/README.md`, and add concise CLI & MCP guides to `README.md`.

## Wave 1: Creator CLI, Demo Showcase & Local+Remote MCP Server (`packages/dsh-muweave-core`)

- [ ] 1.1 Implement `packages/dsh-muweave-core/src/demo-seed.ts` (`seedDemoWorkspace`) creating `"雨夜怀表 · 第 1 集"` with valid `.muweave/` bundle, CAS PNG blobs, and non-overwrite guard unless `force: true`.
- [ ] 1.2 Implement `packages/dsh-muweave-core/src/mcp/server.ts` (MCP JSON-RPC 2.0 `2024-11-05`/`2025-03-26`, 12 sanitized tools with zero `job.approve`, 5 `muweave://*` resources, 3 prompts, local direct + proxy bridge, stdio transport).
- [ ] 1.3 Implement `packages/dsh-muweave-core/src/mcp/http.ts` (`startMuweaveMcpHttpServer`: `/healthz`, `/mcp` POST/GET SSE/DELETE/OPTIONS, fail-fast `REMOTE_AUTH_TOKEN_REQUIRED` on non-loopback binds, `crypto.timingSafeEqual` Bearer auth).
- [ ] 1.4 Implement `packages/dsh-muweave-core/src/cli.ts` (`muweave` bin with human/`--json`/`--agent` outputs), wire `index.ts`, `package.json`, and `scripts/build-all.mjs`, and add `tests/muweave-cli.test.ts` & `tests/muweave-mcp-server.test.ts`.

## Wave 2: Global UX Polish & Drama Surfaces (`packages/dsh-muweave-core/src/client` & `packages/dsh-muweave-drama`)

- [ ] 2.1 Implement `shortcuts-modal.tsx`, `publishTheaterRoomBadges` / `useTheaterRoomBadges` in `theater/registry.ts` & `TheaterPage.tsx`, per-chip `×` removal & room-aware quick prompt chips in `floating-agent.tsx`, and token-based CSS in `styles.ts`.
- [ ] 2.2 Upgrade `packages/dsh-muweave-drama/src/{shot-inspector.tsx,timeline-view.tsx,client.tsx}` with bottom `.dr-filmstrip`, storyboard keyword search, `needs_revision` room badge reporting, and Timeline Markdown review summary copy.

## Wave 3: DSH Kit Agent Tools Sync, CLI/MCP Card & v5 UX Tests (`packages/dsh-muweave-kit` & `tests`)

- [ ] 3.1 Register 4 narrow agent tools (`muweave_drama_shots_list`, `muweave_drama_review_set`, `muweave_drama_export`, `muweave_project_diagnose`) and `muweave-cli-mcp-assist` skill in `packages/dsh-muweave-kit/src/index.ts`.
- [ ] 3.2 Add sanitized `.kit-mcp-card` (CLI cookbook + 3-mode MCP config switcher) inside existing `cli-cards` tab in `packages/dsh-muweave-kit/src/client.tsx`, and add `tests/ux-v5-polish.test.tsx`.

## Wave 4: Full Verification Gate

- [ ] 4.1 Run `openspec validate muweave-dsh-tri-surface-v5 --strict --no-interactive`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm pack:plugins`, and `pnpm test:integration` with 0 redaction leaks.
