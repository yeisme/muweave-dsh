## ADDED Requirements

### Requirement: Generation SHALL go through owner CLIs behind a zero-call estimate and a human approval
The host SHALL expose generation only through capability adapters that invoke owner CLIs with fixed binary names and official `--json` contracts. Every paid or unknown-cost capability SHALL produce a zero-call estimate before a job can exist, and a job SHALL be submitted only after `job.approve` from the UI with a ceiling at or above the estimate, which the host SHALL pass to the owner as its cost cap. Paid generation SHALL be disabled by default. Agent tools SHALL be able to estimate and request jobs but SHALL NOT approve them. A capability whose owner lacks a required cost cap, idempotency key or confirm flag SHALL be reported unavailable with a stable reason.

#### Scenario: Paid switch off
- **WHEN** `paidEnabled` is false and the UI approves a priced estimate
- **THEN** the host SHALL return `PAID_DISABLED` and SHALL NOT invoke the owner submit command

#### Scenario: Ceiling below estimate
- **WHEN** the approval ceiling is lower than the estimate
- **THEN** the host SHALL return `CEILING_BELOW_ESTIMATE` without invoking the owner

#### Scenario: Unknown cost needs an explicit acceptance
- **WHEN** a capability with `costClass: unknown` is approved without `acceptUnknownCost: true`
- **THEN** the host SHALL return `UNKNOWN_COST_NOT_ACCEPTED`

### Requirement: Generation jobs SHALL be durable, slot-based and never resubmitted
Jobs SHALL pre-allocate output slots with per-slot status, persist to a mode-0600 plugin data file without raw prompts, and carry a fixed idempotency key. A submit timeout, a killed child process, or a host restart while a job is running SHALL move the job to `reconcile_required`; reconciliation SHALL only query the owner job reference and SHALL NOT resubmit. Owner-reported spend SHALL be shown as actual cost, and absent spend SHALL be shown as not reported rather than zero.

#### Scenario: Host restart during a running job
- **WHEN** the host restarts while a job is `running`
- **THEN** the job SHALL load as `reconcile_required` and the next reconcile SHALL call only the owner status command

#### Scenario: Stored records carry no prompt
- **WHEN** a job is persisted
- **THEN** the record SHALL contain `promptDigest` and a derived title, and SHALL NOT contain the prompt text

### Requirement: Shots SHALL show linked media from the bundle
Accepted slot media and candidate artifacts SHALL be linkable to a `shotRef` through `.muweave` bindings `shotMedia`, storing only refs and digests. The storyboard grid and the 成稿 room SHALL show a shot's keyframe when one is linked and the typographic shot poster otherwise.

#### Scenario: Accepting a slot generated for a shot
- **WHEN** a slot from a job anchored to a shot is accepted with `linkToShot`
- **THEN** the shot SHALL show that slot's image in the storyboard grid after the next bundle read
