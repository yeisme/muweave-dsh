## ADDED Requirements

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
