# Proposal: MuWeave DSH Orchestration Control Plane & Open Engine Ecosystem v6

## Why

With v2–v5 delivered (Drama Studio, P2/P3 closure, 7-room polish, Creator CLI, and Local+Remote MCP), four operational gaps remain for day-to-day production reliability and open-engine onboarding:

1. **No interactive Orchestration & Circuit-Breaker Control Plane**: Operators cannot pause/resume bots, inspect delegated task traces, or trigger cascading task cancellation across UI, CLI, and MCP surfaces.
2. **No actionable capability preflight doctor**: Users seeing blocked capabilities (`NO_COST_CAP`, `OWNER_NOT_INSTALLED`, `PAID_DISABLED_BY_HOST`, etc.) lack a zero-cost diagnostic command explaining why each capability is unavailable and how to remediate it.
3. **No opt-in zero-cost local generation loop**: Evaluators without external owner CLIs cannot exercise the full generation lifecycle (`estimate → request → approve → slot review → linkToShot`) end-to-end without spending money.
4. **Remaining Workbench visual polish & E2E coverage**: Workbench's rightbar tool catalog still exposes raw blocked reason enums as visible text, the `对比基线` `<kbd>C</kbd>` badge can clip on tighter widths, and v5/v6 surfaces need automated Playwright screenshot coverage.

## What Changes

1. **Capability Doctor & Opt-In Local Preview Adapter (`@yeisme/dsh-muweave-core`)**:
   - Add `capabilities/doctor.ts` (`runCapabilityDoctor`) and `muweave doctor --capabilities [--json|--agent]` returning zero-cost availability and actionable remediation tips per blocked reason.
   - Add `capabilities/preview-adapter.ts` (`LOCAL_PREVIEW_ADAPTER`, `demo.image.preview`, `costUnit: 'none'`) dynamically registered in `CapabilityRegistry` **only** when `MUWEAVE_LOCAL_PREVIEW_ADAPTER=1` (OFF by default), writing deterministic minimal PNGs into CAS via `putCasBlob`.
2. **Tri-Surface Orchestration Control Plane (`@yeisme/dsh-muweave-core`)**:
   - **UI**: Add `OrchestrationPanel` inside `GenerationDrawer` (`生成任务 | 编排与断路器`) supporting `bot.pause` toggle (with `expectedRevision` + `idempotencyKey`), `task.trace` inspection, `orphanedCount` warnings, and `task.cancel` cascade receipts.
   - **CLI**: Add `muweave bots list|pause|resume` and `muweave tasks list|trace|cancel` with sanitized human/`--json`/`--agent` outputs.
   - **MCP**: Add `muweave_orchestration_status` and `muweave_task_trace_or_cancel` (14 tools total, still NEVER exposing `job.approve`) plus live resource `muweave://orchestration/tasks` (6 resources total).
3. **Workbench Visual Closure & E2E Screenshot Coverage (`@yeisme/dsh-muweave-workbench`, `scripts/`)**:
   - Localize blocked reasons in Workbench's rightbar tool catalog via `unavailableReasonLabel(code, lang)` while preserving raw codes in `data-reason` and `title`.
   - Move `<kbd>C</kbd>` cleanly inside the `对比基线` button and fix `.mw-stage-primary-body` / `.mw-stage-primary-actions` wrapping so nothing clips at `1440px` or `1024px`.
   - Extend `scripts/inner-e2e-runner.mjs` with 4 new `1440×900` captures (`kit-cli-mcp`, `shortcuts-modal`, `drama-inspector-open`, `orchestration-drawer`).
4. **Documentation & Release History**:
   - Add `docs/design/orchestration-ecosystem-v6.md`, register it in `docs/design/README.md`, and create `CHANGELOG.md` summarizing v0.1.0 through v6.

## Non-goals

- Never enable `LOCAL_PREVIEW_ADAPTER` by default or weaken paid capability approval gates.
- Never expose `job.approve` or autonomous paid execution over CLI, MCP, or Kit agent tools.
- Never alter existing theater room IDs, stage tab IDs, or canonical `.scaena/**` / `.eikona/**` / `.auctra/**` internals.
