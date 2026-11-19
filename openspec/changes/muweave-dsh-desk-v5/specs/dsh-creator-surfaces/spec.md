## ADDED Requirements

### Requirement: Motion SHALL be CSS-variable driven and fully gated by reduced-motion
The core client SHALL expose `usePrefersReducedMotion`, `useTilt` and `useParallax`. The hooks SHALL only write the `--mw-tilt-x`, `--mw-tilt-y`, `--mw-parallax-x` and `--mw-parallax-y` custom properties and SHALL leave every transform to CSS, so a single stylesheet block can disable it. `useTilt` SHALL accept a `disabled` option, SHALL skip elements whose measured size is zero, and SHALL clamp its normalised pointer position to `-1…1`. `useParallax` SHALL clamp its output and SHALL fall back to the default strength when handed a non-finite value. `MediaCard` and `NoteCard` SHALL accept an optional `tilt` flag that defaults to off. Under `prefers-reduced-motion: reduce` the tilt and parallax variables SHALL stay `0` and no transform, transition or animation introduced by these primitives SHALL run.

#### Scenario: Reduced motion keeps the tilt variables at zero
- **WHEN** the host reports `prefers-reduced-motion: reduce` and the pointer moves across a card built with `tilt`
- **THEN** the card SHALL receive no tilt listeners and `--mw-tilt-x`/`--mw-tilt-y` SHALL remain `0`, so the rendered rotation stays at identity

#### Scenario: The tilt budget is three degrees per axis
- **WHEN** the pointer sits exactly on a corner of a tilting card
- **THEN** the normalised variables SHALL be clamped to `±1` and the rendered rotation SHALL stay within 3 degrees per axis

### Requirement: The schedule calendar SHALL be operable from the keyboard, with undo
The schedule room's month grid SHALL use a roving tabindex (only the focused day is `tabIndex=0`) and SHALL keep `aria-selected` in sync. Arrow keys SHALL move the focus by one day or one week, Home/End SHALL jump to the Monday/Sunday of the focused week, PageUp/PageDown SHALL move by one month with end-of-month clamping, Enter SHALL plan the selected backlog row (or clear the focused day when nothing is selected), Delete/Backspace SHALL clear the focused day, `t` SHALL return to today, `[` and `]` SHALL shift the month, and Ctrl/Cmd+Z SHALL undo the last plan or clear through the same RPC the UI uses. The undo stack SHALL hold at most 20 entries and SHALL NOT introduce client-side shadow state.

#### Scenario: PageDown from the 31st clamps to the new month's last day
- **WHEN** the focused day is `2026-01-31` and the user presses PageDown
- **THEN** the focused day SHALL become `2026-02-28` and the board SHALL show February

#### Scenario: Undo reverses a clear
- **WHEN** the user clears a chip and then presses Ctrl/Cmd+Z
- **THEN** `schedule.plan` SHALL be called with the cleared `ref` and its previous date, and the chip SHALL reappear in that cell

### Requirement: Drag state SHALL be visible on the source and the drop target
Backlog rows SHALL be draggable and SHALL carry `data-dragging="true"` while a drag is in flight; every cell SHALL carry `data-drop-ready="true"` while a selection can land there, and the cell under the drag SHALL carry `data-drop-active="true"`. Both attributes SHALL be cleared on `dragleave` and `dragend`. Empty states SHALL state the next action instead of rendering an empty panel.

#### Scenario: Dragging a backlog row marks source and target
- **WHEN** a backlog row is dragged over a day cell
- **THEN** that row SHALL expose `data-dragging="true"` and the hovered cell SHALL expose `data-drop-active="true"`

#### Scenario: An empty backlog offers the sync action
- **WHEN** every `.muweave/` element is already planned
- **THEN** the backlog area SHALL render the empty copy together with a control that reloads the element list

### Requirement: The command palette SHALL remember recent commands and filter actions with `>`
The palette SHALL persist the last five executed command ids in `localStorage` under `muweave.cmdk.recent.v1`, SHALL render the still-matching recents as a top "recent" section without duplicating them further down, and SHALL treat a leading `>` as an action-group-only filter that also swaps the placeholder copy. Arrow keys SHALL wrap around the filtered list, Tab SHALL complete the active row's label into the input, Enter SHALL run it and Escape SHALL close the palette and return focus. Unreadable or unwritable storage SHALL degrade silently to an empty recent list.

#### Scenario: A leading `>` narrows the list to actions
- **WHEN** the user types `>` in the palette input
- **THEN** only rows whose group is the localized action group SHALL remain and Enter SHALL run the active one

#### Scenario: Running a command promotes it to the recent section
- **WHEN** the user runs a room command and reopens the palette
- **THEN** that command SHALL appear under the "recent" group above its original group

## MODIFIED Requirements

### Requirement: Creator plugin surfaces SHALL share a token-based visual system
The MuWeave DSH plugins SHALL style every surface through `--mw-*` tokens declared by `@yeisme/dsh-muweave-core` and its shared classes, and every `--mw-*` token a surface reads SHALL be declared before use. Inline `style` attributes SHALL be limited to dynamic custom properties, the workspace grid columns, and floating-agent coordinates. Colours SHALL come from DSH host aliases with token fallbacks only; lengths SHALL be rem except 1px/2px hairlines; `backdrop-filter` SHALL appear only inside `@supports (backdrop-filter: …)` so every glass surface keeps an opaque fallback; the dusk-violet accent (oklch hue 308) SHALL be reserved for primary actions and the focus ring; selection SHALL be a neutral fill with a stronger line; orange hues SHALL NOT be used. Every interactive control SHALL show a `:focus-visible` ring, and all motion — including the tilt, parallax and spring-in primitives added for the desk v5 surfaces — SHALL stop under `prefers-reduced-motion: reduce`.

#### Scenario: Static guard rejects an ad-hoc inline style or an orange accent
- **WHEN** a plugin adds `style={{ padding: 8 }}` or the accent token is changed to an orange hue
- **THEN** `tests/styles-static.test.ts` SHALL fail

#### Scenario: A new transform is silenced when motion is reduced
- **WHEN** a surface introduces a new animated transform and does not add it to the reduced-motion block
- **THEN** the motion rules of the static guard SHALL be reviewed so the surface ends up with `transform: none` under `prefers-reduced-motion: reduce`

#### Scenario: Raw owner enums are shown as readable status tags
- **WHEN** an element status such as `waiting_review` or `reconcile_required` is rendered
- **THEN** the surface SHALL show a localized label with a tone dot and keep the raw value in `data-status` and the tooltip
