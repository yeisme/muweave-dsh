# Tasks: muweave-dsh-bridge-cut-export-v7

## Wave 0: OpenSpec, Design Doc, README & CHANGELOG

- [x] 0.1 Author OpenSpec change artifacts (`openspec/changes/muweave-dsh-bridge-cut-export-v7/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/dsh-creator-surfaces/spec.md}`) and validate with `openspec validate muweave-dsh-bridge-cut-export-v7 --strict --no-interactive`.
- [x] 0.2 Author `docs/design/bridge-cut-export-v7.md`, register it in `docs/design/README.md`, and update `README.md` and `CHANGELOG.md`.

## Wave 1: Custom Engine Bridge, DramaCutStore, FCPXML/Jianying Export, CLI & MCP (`packages/dsh-muweave-core`)

- [ ] 1.1 Extend `packages/dsh-muweave-core/src/protocol.ts` with `adapter.custom.*` & `drama.cut.*` RPC actions, `fcpxml_1_10` / `jianying_draft_v1` export formats, and v7 DTO types.
- [ ] 1.2 Implement `packages/dsh-muweave-core/src/capabilities/custom-adapters.ts` (`CustomAdapterStore`, `validateAdapterEndpointUrl`, `CUSTOM_ADAPTER_PRESETS`, `buildCustomCapabilityAdapter`, `testCustomAdapter`) and wire into `registry.ts` & `service.ts`.
- [ ] 1.3 Implement `packages/dsh-muweave-core/src/drama-cut-store.ts` (`DramaCutStore`, `applyEpisodeCut`) and extend `drama-export.ts` (`fcpxml_1_10`, `jianying_draft_v1`, `exportDramaPortableBundle`) & `demo-seed.ts` (multi-episode support).
- [ ] 1.4 Wire RPCs in `host.ts`, add CLI `adapters` / `cut` / `export --episode --bundle-dir` / `demo seed --episodes` in `cli.ts`, add `muweave_adapters_manage` & `muweave_drama_cut_manage` (16 MCP tools) in `mcp/server.ts`, export from `index.ts`, and add `tests/custom-adapters.test.ts` & `tests/drama-cut-export-v7.test.ts`.

## Wave 2: v7 Styles, Drama/Script Multi-Episode Cut UI & Kit Bridge UI

- [ ] 2.1 Add token-based `.dr-episode-bar`, `.dr-cut-banner`, `.dr-cut-controls`, `.dr-shot-omitted`, `.kit-adapter-*` styles in `packages/dsh-muweave-core/src/client/styles.ts`.
- [ ] 2.2 Upgrade `packages/dsh-muweave-drama/src/{client.tsx,shot-inspector.tsx,timeline-view.tsx}` and `packages/dsh-muweave-script/src/client.tsx` with multi-episode switchers, non-destructive cut controls, and FCPXML / Jianying export buttons.
- [ ] 2.3 Add 「外部引擎 Bridge 配置」 (`.kit-adapter-card`) with client-side secret guard and 3 presets inside existing `cli-cards` tab in `packages/dsh-muweave-kit/src/client.tsx`, and add `tests/v7-product-ui.test.tsx`.

## Wave 3: Full Verification Gate

- [ ] 3.1 Run `openspec validate muweave-dsh-bridge-cut-export-v7 --strict --no-interactive`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm pack:plugins`, and `pnpm test:integration` with 0 redaction leaks.
