# Tri-Surface CLI, MCP & UX v5

## ADDED Requirements

### Requirement: Creator CLI SHALL support workspace operations, demo seeding, and sanitized machine outputs
`@yeisme/dsh-muweave-core` SHALL provide a `muweave` CLI binary supporting human, `--json`, and `--agent` (`spec_version=1.0`) outputs for `status`, `shots list`, `review set|batch`, `export`, `schedule`, `diagnose`, `migrate report`, `demo [seed]`, and `mcp`. All structured outputs SHALL strip host paths and credentials, and `muweave demo seed` SHALL create a valid `.muweave/` showcase without overwriting non-empty bundles unless `--force` is passed.

#### Scenario: Seeding a demo workspace produces a valid bundle and guards existing data
- **WHEN** `muweave demo seed` runs in an empty directory and is later invoked again without `--force`
- **THEN** the first run SHALL create a self-contained `.muweave/` bundle passing `validateBundleOnDisk()`, and the second run SHALL refuse to overwrite existing data

#### Scenario: Agent and JSON CLI outputs strip host paths and secrets
- **WHEN** `muweave status --agent` or `muweave export cmx3600_edl --json` is executed
- **THEN** the output SHALL conform to the requested contract with zero host filesystem paths and zero plaintext credentials

### Requirement: MCP Server SHALL expose sanitized tools over local stdio and authenticated remote HTTP without paid approval
`@yeisme/dsh-muweave-core` SHALL expose an MCP JSON-RPC 2.0 server (`2024-11-05` and `2025-03-26`) over local `stdio` and Streamable HTTP (`/mcp`, `/healthz`) with 12 sanitized tools, 5 `muweave://*` resources, and 3 prompts. The server SHALL NEVER expose `job.approve`, SHALL reject non-loopback HTTP binds lacking an auth token with `REMOTE_AUTH_TOKEN_REQUIRED`, and SHALL enforce constant-time Bearer token validation on `/mcp`.

#### Scenario: Non-loopback HTTP MCP server fails fast without auth token and enforces Bearer auth
- **WHEN** `startMuweaveMcpHttpServer` is started on `0.0.0.0` without an auth token, or a client calls `POST /mcp` with an invalid Bearer token when auth is enabled
- **THEN** startup without a token SHALL throw `REMOTE_AUTH_TOKEN_REQUIRED`, and unauthenticated `/mcp` requests SHALL receive HTTP `401`

#### Scenario: MCP tool catalog excludes paid approval and sanitizes outputs
- **WHEN** an MCP client calls `tools/list` or invokes `muweave_job_request_or_status`
- **THEN** no `job.approve` or paid-approval tool SHALL be listed, job requests SHALL stop at `waiting_approval`, and all responses SHALL strip host paths and credentials

### Requirement: DSH Kit SHALL sync narrow creator agent tools and render a sanitized CLI and MCP onboarding card
`@yeisme/dsh-muweave-kit` SHALL register narrow `role: 'agent'` tools (`muweave_drama_shots_list`, `muweave_drama_review_set`, `muweave_drama_export`, `muweave_project_diagnose`) without exposing `job.approve`, register the `muweave-cli-mcp-assist` runtime skill, and render a sanitized CLI & MCP config card inside the existing `cli-cards` tab using `${workspaceFolder}` and `<your-mcp-token>` placeholders only.

#### Scenario: Kit CLI and MCP config card switches modes without leaking host paths
- **WHEN** a user opens the `cli-cards` tab and switches between local stdio, remote HTTP, and loopback proxy MCP config tabs
- **THEN** the rendered config snippets SHALL contain zero host filesystem paths or real tokens, and copying SHALL succeed without altering existing stage tab IDs

### Requirement: Creator theater and drama surfaces SHALL provide shortcuts help, room badges, context-aware agent chips, filmstrip navigation, and Markdown review copy
`@yeisme/dsh-muweave-core/client` and `@yeisme/dsh-muweave-drama` SHALL provide a `?` `ShortcutsHelpModal`, theater room attention badges, per-chip `×` removal and room-specific quick prompt chips in `FloatingAgentOverlay`, a `ShotInspector` bottom filmstrip, storyboard keyword search, and Timeline Markdown review summary copy styled exclusively with `--mw-*` tokens.

#### Scenario: Shortcuts modal opens on question mark and closes cleanly on Escape
- **WHEN** the user presses `?` outside editable inputs and then presses `Escape`
- **THEN** `ShortcutsHelpModal` SHALL open with `role="dialog"` and four shortcut groups, and `Escape` SHALL close it and restore focus

#### Scenario: Director filters storyboard, jumps via filmstrip, and copies Markdown review summary
- **WHEN** the user searches shots by keyword, selects a shot via the `ShotInspector` bottom filmstrip, or clicks the Markdown review copy button in `timeline`
- **THEN** matching shots SHALL filter in place, the filmstrip SHALL switch the active shot, and the copied Markdown summary SHALL exclude host paths and credentials
