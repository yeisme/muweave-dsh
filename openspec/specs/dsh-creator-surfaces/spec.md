# dsh-creator-surfaces Specification

## Purpose
TBD - created by archiving change muweave-dsh-creator-suite-v1. Update Purpose after archive.
## Requirements
### Requirement: Core host bus SHALL serve buffered RPC, short-TTL Range media, generation tracking, and reconcile-only unknown outcomes
`@yeisme/dsh-muweave-core` SHALL register `POST /api/muweave-dsh/rpc` and `GET /api/muweave-dsh/media` via `ctx.connection.fetch.register` inside `ctx.effect`, reject cross-site `sec-fetch-site` values and plaintext credentials, catch all handler exceptions into structured `{ ok: false, error }` JSON envelopes, verify CAS SHA-256 digests on media reads with HTTP `Range` support, stamp host generations against stale read overwrites, and lock timed-out or interrupted mutations into `reconcile_required` without automatic retries.

#### Scenario: Cross-site or credential-bearing RPC request is rejected
- **WHEN** a request to `/api/muweave-dsh/rpc` carries `sec-fetch-site: cross-site` or an `sk-*` / `Bearer` secret in its payload
- **THEN** the handler SHALL refuse execution and return a structured error envelope without invoking any subprocess

#### Scenario: Interrupted controlled write requires reconciliation
- **WHEN** a controlled owner write (`scene_card.save`, `eikona.accept`, `eikona.handoff`) returns an ambiguous transport timeout
- **THEN** the operation ledger SHALL record `unknown` / `reconcile_required` bound to the original `idempotencyKey` and block duplicate submission until reconciled

### Requirement: Dual-mode Tab/Pane shell, 3-state floating agent, and timing progress strip SHALL integrate cleanly with DSH 0.2.2-rc.1
The 5 DSH plugins (`workbench`, `eikona`, `script`, `drama`, `kit`) SHALL register bilingual (`zh`/`en`) dictionaries, official right-pane `dockkit` tabs (`sidebarRightTabs` + `sidebar.right.pane.tab`), and global 3-column split workspaces with multi-tab and 2-up/4-up compare views, mount a `shell.overlay` 3-state floating agent (`pill` / `bar` / `panel`) confined within the page rectangle across `1440`, `1024`, `768`, and `390` widths, enforce `openai/gpt-image-2.5-sunburst` pixel `WxH` rules on Eikona generation intents, scope creator skills to the `muweave-creator` PTC preset, and render `drama-process-timing` compliant progress states without calling `selectPanel` at startup.

#### Scenario: Hot reload and narrow viewport preserve host chrome and clean disposers
- **WHEN** all 5 plugins are loaded, hot-reloaded, and rendered at `390px` and `1440px` viewports in an isolated DSH `0.2.2-rc.1` host
- **THEN** no duplicate `<style>` or sidebar entries SHALL remain, `[data-ready="true"]` SHALL stay accessible in every floating agent state, and `[data-slot="settings.launcher"] button` SHALL remain unobstructed

### Requirement: Creator plugins SHALL share one Drama Theater sidebar entry
The MuWeave DSH creator plugins SHALL register their pages as rooms of a single global "Drama Theater" page (`muweave-theater`) instead of separate sidebar entries. Shared seats (`main`, `sidebar.panellist`, the right-sidebar companion tab, the floating-agent `shell.overlay`, the session header action and the `@` / `/` trigger sources) SHALL be registered by exactly one plugin at a time through a cross-bundle registry, and SHALL be handed to another live plugin when the holder is disposed.

#### Scenario: Five plugins produce one sidebar entry
- **WHEN** all five creator plugins are applied to one DSH client
- **THEN** exactly one `sidebar.panellist` entry and one `main` entry with id `muweave-theater` SHALL be registered, and the theater SHALL list five rooms in order: 总览, 视觉, 剧本, 分镜生产, 工具箱

#### Scenario: The seat holder unloads
- **WHEN** the plugin holding the shared seats is disposed while other creator plugins remain
- **THEN** every shared seat SHALL still be registered exactly once, and after the last plugin is disposed no seat SHALL remain

### Requirement: The theater SHALL switch rooms through a workspace switcher
The theater header SHALL show a workspace switcher button with the active room name that opens a `menu` of `menuitemradio` rooms with descriptions and `Alt+N` hints. Arrow keys SHALL move focus, Enter or click SHALL select, and Escape SHALL close the menu and return focus to the switcher. While the theater is active, `Alt+1…N` SHALL switch rooms directly. The last room SHALL be remembered in `localStorage` (`muweave.theater.room`) and SHALL fall back to the first room when its plugin is gone. A "回到对话" action SHALL leave the theater.

#### Scenario: Keyboard room switch keeps focus
- **WHEN** the user opens the switcher, presses ArrowDown and selects the second room
- **THEN** the menu SHALL close, the second room SHALL render, its id SHALL be stored, and focus SHALL rest on the switcher

### Requirement: Drama sessions SHALL offer a session-scoped 做剧 view
The drama plugin SHALL register a `conversation.view` (`muweave-drama`, label 「做剧」) that shows only the session's perspective: a production progress line, an "open in theater" action, and sections for this session's mentioned or handed-off elements, shots, script scenes and assets. Each section SHALL show a capped compact summary built from shared drama components and link to the theater for the rest. A session with no drama log entries SHALL show an empty state with an entry into the theater.

#### Scenario: Session log rows locate elements in the theater
- **WHEN** an element is inserted with `@` in a session and the user opens that session's 做剧 view
- **THEN** the element SHALL appear in the 本会话 section with its status, and 「在剧场定位」 SHALL open the theater at the room that owns that element

### Requirement: Same-generation RPC responses SHALL NOT be dropped
The client generation guard SHALL accept responses whose generation equals the applied generation regardless of arrival order, so parallel reads of one host state cannot discard details.

#### Scenario: Parallel reads resolve out of order
- **WHEN** two requests issued in order A, B return with the same generation in order B, A
- **THEN** both responses SHALL be accepted

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

