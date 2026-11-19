## ADDED Requirements

### Requirement: Creator plugin surfaces SHALL share a token-based visual system
The five MuWeave DSH plugins SHALL style every surface through `--mw-*` tokens declared by `@yeisme/dsh-muweave-core` and its shared classes. Inline `style` attributes SHALL be limited to dynamic custom properties, the workspace grid columns, and floating-agent coordinates. Colours SHALL come from DSH host aliases with token fallbacks only; lengths SHALL be rem except 1px/2px hairlines; the dusk-violet accent (oklch hue 308) SHALL be reserved for primary actions and the focus ring; selection SHALL be a neutral fill with a stronger line; orange hues SHALL NOT be used. Every interactive control SHALL show a `:focus-visible` ring, and motion SHALL stop under `prefers-reduced-motion: reduce`.

#### Scenario: Static guard rejects an ad-hoc inline style or an orange accent
- **WHEN** a plugin adds `style={{ padding: 8 }}` or the accent token is changed to an orange hue
- **THEN** `tests/styles-static.test.ts` SHALL fail

#### Scenario: Raw owner enums are shown as readable status tags
- **WHEN** an element status such as `waiting_review` or `reconcile_required` is rendered
- **THEN** the surface SHALL show a localized label with a tone dot and keep the raw value in `data-status` and the tooltip

### Requirement: Workspace shell SHALL keep a single-row header and spend no space on empty panes
The global workspace SHALL keep its header to one row (title, subtitle, plugin actions, sync), place layout, pane toggles and split controls at the end of the stage tab row, and fold them into a single "View" menu below 860px. An empty compare pane SHALL render as a slim drop hint instead of a full column, and the inspector column SHALL appear only when a plugin supplies content. Accessible names used by the end-to-end suite SHALL remain stable.

#### Scenario: Narrow viewport keeps tabs horizontal and the composer usable
- **WHEN** a plugin panel renders at 390px width
- **THEN** stage tabs SHALL stay on one horizontally scrollable row, view controls SHALL be reachable through the View menu, and the floating agent input SHALL keep at least 6rem of width without covering `[data-slot="settings.launcher"] button`
