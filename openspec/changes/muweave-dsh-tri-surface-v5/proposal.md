# Proposal: MuWeave DSH Tri-Surface CLI, MCP & UX v5

## Why

MuWeave DSH v2–v4 delivered a complete 7-room visual workstation for vertical drama production, but creators and external AI agents still cannot operate on `.muweave/` workspaces outside the DSH browser UI:

1. **No standalone Creator CLI or zero-friction demo**: Users cannot inspect status, filter missing-media shots, batch-review, export rough-cut packages, or seed a realistic 9:16 demo episode (`muweave demo seed`) from the terminal.
2. **No MCP Server surface (Local stdio + Remote Streamable HTTP)**: External MCP clients (Claude Desktop, Cursor, remote agent runners) cannot query `.muweave/` or invoke review/export/schedule/diagnose tools over standard MCP JSON-RPC 2.0 with strict security boundaries.
3. **Kit internal agent tools lag behind v2–v4 RPCs**: The `muweave-creator` preset lacks narrow tools for storyboard listing, shot review, rough-cut export, and project diagnosis, and the Kit UI has no CLI/MCP onboarding cookbook.
4. **High-frequency director UX friction**: Creators lack a `?` keyboard shortcuts cheat sheet, room-level attention badges, per-chip `@` removal and room-aware quick prompts in the floating agent, a bottom filmstrip inside `ShotInspector`, storyboard keyword search, and one-click Markdown review summary export.

## What Changes

1. **Creator CLI & Demo Showcase (`@yeisme/dsh-muweave-core`)**:
   - Add `demo-seed.ts` (`seedDemoWorkspace`) generating a self-contained `"雨夜怀表 · 第 1 集"` workspace passing `validateBundleOnDisk()` without overwriting non-empty `.muweave/` unless `--force` is passed.
   - Add `cli.ts` (`muweave` binary) supporting human, `--json`, and `--agent` (`spec_version=1.0`) outputs for `status`, `shots list`, `review set|batch`, `export`, `schedule list|plan|clear`, `diagnose`, `migrate report`, `demo [seed]`, and `mcp`.
2. **Local stdio & Remote Streamable HTTP MCP Server (`@yeisme/dsh-muweave-core`)**:
   - Add `mcp/server.ts` (zero new npm deps) implementing MCP JSON-RPC 2.0 (`2024-11-05` & `2025-03-26`) with 12 sanitized tools (explicitly excluding `job.approve`), 5 `muweave://*` resources, 3 creator prompts, local direct mode and loopback/authorized proxy mode.
   - Add `mcp/http.ts` implementing Streamable HTTP (`/healthz`, `GET/POST/DELETE/OPTIONS /mcp`, 1 MiB cap, `Mcp-Session-Id`) with fail-fast `REMOTE_AUTH_TOKEN_REQUIRED` on non-loopback binds without an auth token and `crypto.timingSafeEqual` Bearer verification.
3. **DSH Kit Sync & CLI/MCP Onboarding (`@yeisme/dsh-muweave-kit`)**:
   - Register 4 narrow agent tools (`muweave_drama_shots_list`, `muweave_drama_review_set`, `muweave_drama_export`, `muweave_project_diagnose`) and the `muweave-cli-mcp-assist` runtime skill.
   - Add the sanitized 「CLI & MCP 接入向导」 card inside the existing `cli-cards` tab (preserving all stage tab IDs).
4. **v5 Creator UX Upgrades (`@yeisme/dsh-muweave-core/client` & `@yeisme/dsh-muweave-drama`)**:
   - Add `?` `ShortcutsHelpModal`, theater room badges (`publishTheaterRoomBadges`), per-chip `×` removal & room-aware quick prompts in `FloatingAgentOverlay`, `ShotInspector` bottom filmstrip, storyboard keyword search, and Timeline Markdown review summary copy.
5. **Documentation**:
   - Add `docs/design/tri-surface-cli-mcp-v5.md`, register it in `docs/design/README.md`, and add concise CLI & MCP guides to `README.md`.

## Non-goals

- Never expose `job.approve` or any autonomous paid execution approval over CLI, MCP, or Kit agent tools.
- Never add third-party MCP SDK or HTTP server npm dependencies; use Node.js built-ins + existing `zod`.
- Never mutate canonical `.scaena/**`, `.eikona/**`, or `.auctra/**` internal stores or emit host filesystem paths / plaintext credentials.
- Never add or rename theater room IDs or stage tab IDs.
