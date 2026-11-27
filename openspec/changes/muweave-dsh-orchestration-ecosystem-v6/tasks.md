# Tasks: muweave-dsh-orchestration-ecosystem-v6

## Wave 0: OpenSpec, Design Doc & Release History

- [x] 0.1 Author OpenSpec change artifacts (`openspec/changes/muweave-dsh-orchestration-ecosystem-v6/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/dsh-creator-surfaces/spec.md}`) and validate with `openspec validate muweave-dsh-orchestration-ecosystem-v6 --strict --no-interactive`.
- [x] 0.2 Author `docs/design/orchestration-ecosystem-v6.md`, register it in `docs/design/README.md`, and create `CHANGELOG.md` covering v0.1.0 through v6.

## Wave 1: Capability Doctor, Opt-In Preview Adapter & CLI/MCP Orchestration (`packages/dsh-muweave-core`)

- [ ] 1.1 Implement `packages/dsh-muweave-core/src/capabilities/doctor.ts` (`runCapabilityDoctor`) with actionable remediation tips and zero host-path/credential leaks.
- [ ] 1.2 Implement `packages/dsh-muweave-core/src/capabilities/preview-adapter.ts` (`LOCAL_PREVIEW_ADAPTER`, `demo.image.preview`) gated strictly by `MUWEAVE_LOCAL_PREVIEW_ADAPTER=1` in `capabilities/registry.ts`.
- [ ] 1.3 Extend `packages/dsh-muweave-core/src/cli.ts` with `muweave doctor --capabilities`, `muweave bots list|pause|resume`, and `muweave tasks list|trace|cancel`.
- [ ] 1.4 Extend `packages/dsh-muweave-core/src/mcp/server.ts` with `muweave_orchestration_status`, `muweave_task_trace_or_cancel`, and `muweave://orchestration/tasks` (14 tools / 6 resources, zero `job.approve`), export new APIs from `index.ts`, and add `tests/capability-doctor-preview.test.ts`.

## Wave 2: Orchestration Control Panel & CSS Polish (`packages/dsh-muweave-core/src/client`)

- [ ] 2.1 Implement `packages/dsh-muweave-core/src/client/orchestration-panel.tsx` (`OrchestrationPanel`) and mount the `生成任务 | 编排与断路器` tab switcher in `generation.tsx`.
- [ ] 2.2 Add `.mw-orch-*` styles and fix `.mw-stage-primary-body` / `.mw-stage-primary-actions` wrapping in `styles.ts`, export `OrchestrationPanel` from `index.tsx`, and add `tests/orchestration-panel.test.tsx`.

## Wave 3: Workbench Visual Closure & v5/v6 E2E Screenshots (`packages/dsh-muweave-workbench`, `scripts/`)

- [ ] 3.1 Localize blocked tool reasons in `packages/dsh-muweave-workbench/src/client.tsx` via `unavailableReasonLabel` (retaining raw code in `data-reason` & `title`) and move `<kbd>C</kbd>` inside `对比基线` in `stage-workbench.tsx`.
- [ ] 3.2 Extend `scripts/inner-e2e-runner.mjs` with `1440×900` screenshots for `kit-cli-mcp`, `shortcuts-modal`, `drama-inspector-open`, and `orchestration-drawer`.

## Wave 4: Full Verification Gate

- [ ] 4.1 Run `openspec validate muweave-dsh-orchestration-ecosystem-v6 --strict --no-interactive`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm pack:plugins`, and `pnpm test:integration` with 0 redaction leaks.
