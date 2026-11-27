# Orchestration Control Plane & Open Engine Ecosystem v6

## ADDED Requirements

### Requirement: Orchestration control plane SHALL manage bot circuit breakers and task trees across UI, CLI, and MCP
`@yeisme/dsh-muweave-core` SHALL expose bot pause/resume (`expectedRevision` guarded), task listing (`orphanedCount`), trace inspection, and cascading task cancellation across `GenerationDrawer`'s `OrchestrationPanel`, `muweave bots|tasks` CLI commands, and MCP (`muweave_orchestration_status`, `muweave_task_trace_or_cancel`, `muweave://orchestration/tasks`) without exposing `job.approve`.

#### Scenario: Operator toggles bot circuit breaker and cancels a task tree from OrchestrationPanel
- **WHEN** the user switches `GenerationDrawer` to the `orchestration` tab, toggles `bot.pause`, expands `task.trace`, and triggers `task.cancel`
- **THEN** the UI SHALL send `expectedRevision` and `idempotencyKey` on `bot.pause`, render redacted trace counts, and display the `cancelledTaskIds` and `cancelledJobIds` receipt

#### Scenario: CLI and MCP inspect orchestration state and cascade cancel without paid approval
- **WHEN** a caller runs `muweave bots list`, `muweave tasks cancel <taskId>`, or invokes `muweave_orchestration_status` / `muweave_task_trace_or_cancel`
- **THEN** responses SHALL be sanitized of host paths and credentials, return cascade cancellation IDs, and never expose `job.approve`

### Requirement: Capability doctor SHALL diagnose blocked engines with zero-cost remediation guidance
`@yeisme/dsh-muweave-core` SHALL provide `runCapabilityDoctor` and `muweave doctor --capabilities [--json|--agent]` returning available/blocked capability counts, host paid status, and actionable remediation tips per blocked reason (`NO_COST_CAP`, `NO_SUBMIT_COMMAND`, `ADAPTER_PENDING`, `OWNER_NOT_INSTALLED`, `MARKER_MISSING`, `PAID_DISABLED_BY_HOST`) with zero paid calls or host-path leaks.

#### Scenario: Running capability doctor reports blocked reasons and remediations safely
- **WHEN** `muweave doctor --capabilities --json` is executed in a workspace with blocked capabilities
- **THEN** the command SHALL exit 0 with per-capability remediation strings, zero provider calls, and zero host filesystem paths

### Requirement: Opt-in local preview adapter SHALL support zero-cost end-to-end generation testing only when explicitly enabled
`CapabilityRegistry` SHALL register `LOCAL_PREVIEW_ADAPTER` (`demo.image.preview`, `costUnit: 'none'`) ONLY when `MUWEAVE_LOCAL_PREVIEW_ADAPTER=1` is set. When disabled (default), the adapter SHALL NOT appear in the catalog; when enabled, it SHALL write deterministic minimal PNGs into CAS and complete `estimate → request → approve → review → linkToShot` with zero external calls.

#### Scenario: Local preview adapter is absent by default and completes free CAS loop when opted in
- **WHEN** `MUWEAVE_LOCAL_PREVIEW_ADAPTER` is unset versus set to `'1'`
- **THEN** `demo.image.preview` SHALL be omitted from `capability.catalog` when unset, and when set to `'1'` SHALL produce valid CAS PNG blobs linkable to a storyboard shot at zero cost

### Requirement: Workbench tool catalog SHALL localize blocked reasons and prevent compare-shortcut clipping
`@yeisme/dsh-muweave-workbench` SHALL render `unavailableReasonLabel(code, lang)` in the rightbar tool catalog while preserving the raw enum in `data-reason` and `title`, and SHALL place `<kbd>C</kbd>` inside the `对比基线` button with wrapping action rows so no control clips at `1440px` or `1024px`.

#### Scenario: Workbench rightbar displays localized blocked labels and unclipped compare button
- **WHEN** Workbench renders blocked tools and a primary stage card at `1440px` and `1024px`
- **THEN** visible text SHALL show localized labels instead of raw `NO_COST_CAP` / `OWNER_NOT_INSTALLED` codes, `data-reason` SHALL retain the raw code, and the `对比基线` button with `<kbd>C</kbd>` SHALL wrap without clipping
