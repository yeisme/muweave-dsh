# MuWeave DSH Creator Plugin Suite & .muweave/ Bundle

`cli/muweave-dsh` owns the DeepSeek Harness (`engines.dsh`: `>=0.2.2-rc.2 <0.3.0`) multi-plugin suite for MuWeave creative workflows and the CLI-authored `.muweave/` materialized workspace bundle (`@yeisme/muweave-bundle`).

## Tech stack and layout

- Node.js `>=22.19.0`, TypeScript 5.9, React 18 (externalized in DSH browser bundles), `pnpm` workspace monorepo.
- `packages/muweave-bundle`: `@yeisme/muweave-bundle` — `.muweave/` materialized workspace bundle specification, `muweave-bundle` CLI (`init`, `bind`, `sync`, `inspect`, `validate`, `doctor`), official CLI/API collector, and pure browser-safe read-only consumer SDK (`@yeisme/muweave-bundle/consumer`) reusable by both DSH plugins and `client/muweave-frame-studio`.
- `packages/dsh-muweave-core`: `@yeisme/dsh-muweave-core` — shared host RPC bus (`/api/muweave-dsh/rpc`), short-TTL Range media server (`/api/muweave-dsh/media`), reconcile ledger, dual-mode Tab/Pane abstraction (DSH rightbar `dockkit` + global controlled 3-column split/tabstrip/compare), `shell.overlay` native 3-state floating agent (pill/bar/panel), `@` element chips, `/` triggers, and `drama-process-timing` compliant progress strip.
- `packages/dsh-muweave-workbench`: `@yeisme/dsh-muweave-workbench` — `.muweave/` overview hub, project ref binding & sync wizard, Pi artifacts (`.pi/goals`, `.pi/subagent-runs`, Plan markdown) & DSH tool artifacts viewer and side-by-side diff.
- `packages/dsh-muweave-eikona`: `@yeisme/dsh-muweave-eikona` — Eikona visual information elements gallery, 2-up/4-up zoom compare, assessment scorecards, character/scene master bindings, controlled `feedback accept/reject` & `assets bind/handoff` with `openai/gpt-image-2.5-sunburst` pixel `WxH` validation.
- `packages/dsh-muweave-script`: `@yeisme/dsh-muweave-script` — Auctra screenplay scene visualization (narrative vs story-time dual timeline, Scene Card save/submit with `expectedRevision`, progressive Context Graph, stale candidate diff).
- `packages/dsh-muweave-drama`: `@yeisme/dsh-muweave-drama` — Scaena drama storyboard summary table, shot strips, 4-axis asset readiness badges, edit timeline summary, and script-to-shot side-by-side view.
- `packages/dsh-muweave-kit`: `@yeisme/dsh-muweave-kit` — `muweave-creator` PTC agent preset (parity-checked against the installed dsh `ptc.patch.yml`, aligned to rc.2/rc.3), on-demand drama/script runtime skills & Chinese `/` search, `template-registry.catalog.v1` preset prompt `{{slot}}` form filler, and allowlisted CLI cards.
- `packages/dsh-muweave-schedule`: `@yeisme/dsh-muweave-schedule` — publishing schedule room (month calendar + backlog, drag/tap planning) over `.muweave/` references, backed by the shared `schedule.list/plan/clear` RPC and local `schedule.v1.json` board.

## Architecture boundaries & prohibited actions

- `.muweave/` is a **rebuildable, CLI-authored materialized bundle**, never a second canonical database. Canonical domain truth stays in `cli/eikona`, `cli/auctra`, `agent/scaena`, `cli/sonora`, and `backend-server/template-registry`.
- Never directly read or mutate `.eikona/**`, `.auctra/**`, `.scaena/**` internal SQLite databases or private metadata files; collect exclusively via official `--json` / `handoff` contracts after checking workspace initialization markers (`.scaena/project.json`, `.auctra/`) so read probes never implicitly initialize directories.
- Never use `ctx.connection.rpc.handle`; always register exact buffered fetch routes under `/api/muweave-dsh/*` wrapped in `try/catch` returning structured `{ ok, data, error }` JSON envelopes.
- Never bundle a second copy of `react`, `react-dom`, or non-seed Node modules into DSH lazy-CJS browser bundles; never call `selectPanel` at startup; never mutate the user's `~/.dsh/profiles/web`.
- Never store plaintext credentials (`sk-*`, `Bearer`, cookies, private keys), raw prompts, provider payloads, host filesystem paths, or full chain-of-thought in `.muweave/`, UI storage, logs, or test evidence.
- Never run race detection (`-race`) unless the human user explicitly demands it for a specific scope.
- Integration and E2E test runs must write the standard 6-file redacted evidence bundle under `temp/integration-test-runs/<run-id>/`.

## Active runtime skills

<!-- runtime-skills:start -->
- `ai-drama-router`
- `ai-native-cli-output-contract`
- `dsh-plugin-development`
- `project-integration-test-evidence`
- `yeisme-coding-execution-driver`
- `yeisme-frontend-quality-workflow`
<!-- runtime-skills:end -->

## Verification commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack:plugins
pnpm test:integration
openspec validate muweave-dsh-creator-suite-v1 --strict --no-interactive
```
