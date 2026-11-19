## ADDED Requirements

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
