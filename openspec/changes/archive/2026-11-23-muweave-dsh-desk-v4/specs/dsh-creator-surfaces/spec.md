## ADDED Requirements

### Requirement: The suite SHALL offer a publishing schedule board over `.muweave/` references
The suite SHALL provide a schedule room backed by `schedule.list`, `schedule.plan` and `schedule.clear` on the shared `/api/muweave-dsh/rpc` bus, stored in `schedule.v1.json` under the plugin data directory with `0600` permissions and atomic writes. The board SHALL keep one row per `ref`, SHALL treat re-planning as a move that preserves fields the caller did not restate, SHALL cap itself at 500 rows, and SHALL rename an unreadable file aside instead of discarding it.

#### Scenario: Re-planning moves a row instead of adding one
- **WHEN** `schedule.plan` is called twice for the same `ref` with different dates
- **THEN** the board SHALL contain exactly one row for that `ref`, holding the newer date and the older label/kind/note

#### Scenario: Impossible calendar days are rejected
- **WHEN** `schedule.plan` receives `2026-02-31` or `2026-13-01`
- **THEN** the envelope SHALL fail with `muweave/invalid_date` and the board SHALL stay unchanged

#### Scenario: The board survives a host restart
- **WHEN** a second host service opens the same plugin data directory
- **THEN** `schedule.list` SHALL return the rows written by the first service

### Requirement: The schedule room SHALL plan by drag, tap, and clear by chip
The room SHALL render a backlog of `.muweave/` elements that are not yet planned and a Monday-first month grid with today marked. Selecting a backlog row and tapping a day, or dropping a backlog row onto a day, SHALL create the slot; tapping a planned chip SHALL remove it. Narrow containers SHALL stack backlog above calendar.

#### Scenario: Tap-to-plan then chip-to-clear
- **WHEN** the user selects a backlog row, taps a day in the current month, then taps the resulting chip
- **THEN** a `.mw-sched-chip` SHALL appear in that cell and SHALL be gone after the second tap

### Requirement: Agent tools SHALL plan the board without UI approval, and only the board
The kit SHALL expose `muweave_schedule_list`, `muweave_schedule_plan` and `muweave_schedule_clear` bound to those RPC actions, plus a `muweave-schedule-plan` runtime skill. Descriptions SHALL state that scheduling is local and reversible and therefore needs no approval, while paid generation still requires the user to approve in 生成台. No schedule tool SHALL carry approval authority.

#### Scenario: No approval tool hides in the schedule set
- **WHEN** the registered tool names are inspected
- **THEN** exactly the three schedule tools SHALL exist and none SHALL match `/approve/i`

## MODIFIED Requirements

### Requirement: Creator triggers SHALL rank by relevance and remember recent picks
The `@` and `/` sources SHALL score candidates (exact label, label prefix, label substring, other fields, subsequence) and drop zero-score rows, SHALL surface the last six picks per trigger in a top section, SHALL localize element status through `statusLabel`, and SHALL accept `domain:`, `kind:`, `owner:`, `scene:` and `episode:` prefixes in the `@` query. `/` SHALL list skills before templates at equal relevance and group templates by category. Insert text and the per-send serialization budget SHALL stay unchanged.

#### Scenario: A skill wins over a template at equal relevance
- **WHEN** `/` is queried with a term that matches one skill label and one template title
- **THEN** the first candidate SHALL be the skill and picking it SHALL return `/<skillName>`

#### Scenario: Domain prefix narrows the pool
- **WHEN** `@eikona` is typed
- **THEN** every returned candidate SHALL come from the `eikona` domain

### Requirement: Floating layers SHALL use layered depth, with motion gated by reduced-motion
Overlay surfaces SHALL use `--mw-elev-4` plus a hairline bevel; the floating agent SHALL step down through `elev-3` (panel) and `elev-2` (bar/pill). Overlays SHALL enter with a short perspective/rotate transform and interactive cards SHALL lift on hover. All of it SHALL be disabled under `prefers-reduced-motion: reduce`, and colours SHALL stay on `--mw-*` tokens.

#### Scenario: Reduced motion removes the entrance transform
- **WHEN** the host requests reduced motion
- **THEN** overlay and card transitions SHALL be disabled and no transform SHALL remain on hover
