## MODIFIED Requirements

### Requirement: Creator plugin surfaces SHALL share a token-based visual system
The five MuWeave DSH plugins SHALL style every surface through `--mw-*` tokens declared by `@yeisme/dsh-muweave-core` and its shared classes. Inline `style` attributes SHALL be limited to dynamic `--mw-*` custom properties. Colours SHALL come from DSH host aliases with token fallbacks only; lengths SHALL be rem except 1px/2px hairlines. The primary action colour SHALL be the host primary fill (`--dsw-alias-button-primary-fill`, monochrome ink) with no brand accent hue: oklch colours with hue 290–320 and chroma above 0.08 SHALL NOT be used, and orange hues SHALL NOT be used. Selection SHALL be a neutral fill with a stronger line. The ambient backdrop SHALL use exactly three blobs with chroma at most 0.06, and `backdrop-filter` SHALL only appear inside `@supports (backdrop-filter …)` blocks over an opaque fallback. Every interactive control SHALL show a `:focus-visible` ring, and motion SHALL stop under `prefers-reduced-motion: reduce`.

#### Scenario: Static guard rejects an ad-hoc inline style, an orange hue, or the old violet accent
- **WHEN** a plugin adds `style={{ padding: 8 }}`, an orange hue, or `--mw-accent` is set back to an oklch hue-308 violet
- **THEN** `tests/styles-static.test.ts` SHALL fail

#### Scenario: Raw owner enums are shown as readable status tags
- **WHEN** an element status such as `waiting_review` or `reconcile_required` is rendered
- **THEN** the surface SHALL show a localized label with a tone dot and keep the raw value in `data-status` and the tooltip

## ADDED Requirements

### Requirement: Theater rooms SHALL lead with the work through an editorial hero and card layout
Every theater room SHALL render a `RoomHero` (`data-muweave-hero="true"`) above its tabs with a serif title, icon-and-number stats and pill actions, and SHALL render its default tab body as cards rather than tables. The hero cover SHALL show up to three real project candidate images resolved through the short-TTL media route, and SHALL fall back to a typographic poster (no placeholder art) when the project has no pixels. Tables and raw identifiers SHALL remain reachable through an explicit cards/table switch where they existed. Under the theater chrome the hero SHALL carry the room subtitle so the top bar stays on one row.

#### Scenario: Visual room shows real covers
- **WHEN** the Eikona room opens on a project with candidate images
- **THEN** `[data-muweave-hero="true"] [data-muweave-cover="images"] img` SHALL decode with `naturalWidth > 0`

#### Scenario: Production room defaults to the shot board
- **WHEN** the drama room opens
- **THEN** `[data-drama-shot-board="true"]` SHALL be visible with at least one media card, and the original table SHALL be one switch away

### Requirement: Wide theaters SHALL switch rooms through a pill navigation
At widths of 860px and above the theater SHALL show one pill button per room in a glass navigation bar; only the current room SHALL carry `aria-current="page"`, each button SHALL keep `data-room-id`, and Alt+N SHALL keep working. Below 860px the room menu SHALL remain the switcher.

#### Scenario: Pill nav marks the current room
- **WHEN** the user clicks the second room's pill
- **THEN** that room SHALL open and become the only element with `aria-current="page"` in `[data-muweave-room-nav="true"]`
