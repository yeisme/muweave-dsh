## MODIFIED Requirements

### Requirement: Creator surfaces SHALL expose one layer of navigation and controls
Every creator page SHALL render its content full width with no permanently docked left column. Room-scoped filters/trees SHALL be reachable from a trigger button that opens a popover carrying `data-muweave-pane="left"`, and that popover SHALL close on outside pointerdown and on Escape even when focus remains on the trigger. Layout presets, split mode and the inspector toggle SHALL live behind a single 「视图」 (`View`) popover at every width, and the stage tab strip SHALL be a plain underlined text strip rather than a filled pill group. The stage SHALL NOT paint a card background, radius or shadow; elevation is reserved for cards.

#### Scenario: The stage is full width before any popover opens
- **WHEN** a creator room mounts
- **THEN** no `[data-muweave-pane="left"]` element SHALL exist, and the stage SHALL occupy the full canvas width

#### Scenario: Escape closes an open popover
- **WHEN** the filter popover is open and focus is still on its trigger
- **THEN** pressing Escape SHALL hide `[data-muweave-pane="left"]`

### Requirement: The inspector SHALL follow the current selection
When the room supplies a right inspector, the shell SHALL show it as soon as an inspector payload exists and hide it when the payload disappears, so selecting a card always reveals its detail pane.

#### Scenario: Selecting an element reveals the inspector
- **WHEN** the user selects an element card in the workbench room
- **THEN** the inspector column SHALL be visible without toggling it manually

## ADDED Requirements

### Requirement: A command palette SHALL list rooms, stage views and shell actions
The shell SHALL provide a command palette opened by the toolbar button or ⌘K/Ctrl+K. It SHALL render `role="dialog"` with a `listbox`, list rooms (from the theater registry), the room's stage views and shell actions (generate desk, assistant, sync, filter, layout), support ↑/↓/Enter/Escape, match by case-insensitive substring or subsequence, return focus to the element that opened it, and portal its overlay to `document.body` so host containment cannot reposition it.

#### Scenario: Palette lists and filters commands
- **WHEN** the palette opens on the workbench room
- **THEN** it SHALL list at least three rows across at least two groups, and typing the first characters of a row label SHALL keep at least one row visible

#### Scenario: Palette closes on Escape
- **WHEN** the palette is open and Escape is pressed
- **THEN** `[data-muweave-command-palette="true"]` SHALL be hidden

### Requirement: Plugins SHALL install on dsh 0.2.2-rc.2 and later
The packages SHALL declare `engines.dsh` as a range admitting rc.2 and rc.3 rather than pinning a single release candidate, the `muweave-creator` preset SHALL include the `tool-office` row present in those hosts' `ptc.patch.yml`, and the preset parity test SHALL resolve the host manifest from the `dsh` on `PATH` instead of a hard-coded path.

#### Scenario: Kit parity follows the installed host
- **WHEN** `tests/kit.test.ts` runs with any dsh on `PATH`
- **THEN** it SHALL compare the preset rows against that host's `ptc.patch.yml`, and skip only when no host install is reachable
