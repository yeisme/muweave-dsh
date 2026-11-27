# Proposal: MuWeave DSH Custom Engine Bridge, Non-Destructive Cut & NLE Export v7

## Why

MuWeave DSH v2–v6 delivered a complete tri-surface (UI + CLI + MCP) drama production workstation, but three practical creator workflows remained blocked for external users without private owner CLIs or advanced NLE pipelines:

1. **No zero-secret Custom Engine Bridge**: Creators could not plug in OpenAI-compatible HTTP APIs, local ComfyUI servers, or custom CLI wrappers through MuWeave's standard `estimate → approve → submit → slot review → shot.media.link` safety gates.
2. **No Multi-Episode Non-Destructive Cut Layer**: Directors working on multi-episode vertical dramas lacked episode switching and non-destructive cut controls (shot reordering, duration trimming, omit/restore, transitions) that preserve canonical `.scaena/**` data.
3. **No FCPXML 1.10 / Jianying Draft or Portable Media Bundle Export**: Rough-cut handoff was limited to `cut_manifest_v1`, `cmx3600_edl`, and `shotlist_csv` without native Final Cut Pro / DaVinci FCPXML 1.10, Jianying (`draft_content.json`), or self-contained `--bundle-dir` portable media packages.

## What Changes

1. **Custom Engine Bridge (`@yeisme/dsh-muweave-core`)**:
   - Add `CustomAdapterStore` (`pluginDataDir/custom-adapters.v1.json`, `0600` atomic write, `.corrupt-*` backup) storing environment variable names only (`authEnvVar` matching `/^[A-Z_][A-Z0-9_]{1,63}$/`), rejecting plaintext secrets (`findPlaintextCredential`) and enforcing strict SSRF/HTTPS rules (`validateAdapterEndpointUrl`: blocking `file:`, `gopher:`, `user:pass@`, `0.0.0.0`, `169.254.*`; blocking private LAN unless `allowPrivateNetwork === true`; requiring `https:` for external non-loopback endpoints).
   - Add `openai_http`, `comfyui_http`, and `cli_wrapper` (no-shell `execFile`) runtime builders, 3 presets (`openai-image`, `openai-tts`, `comfyui-local`), zero-cost `testCustomAdapter` probe, and RPC actions `adapter.custom.list|save|remove|test` integrated into `CapabilityRegistry` & `CapabilityService`.
2. **Multi-Episode Non-Destructive Cut Layer (`@yeisme/dsh-muweave-core`)**:
   - Add `DramaCutStore` (`pluginDataDir/drama-cuts.v1.json`, `0600` atomic write, `.corrupt-*` backup, `expectedRevision` optimistic lock → `muweave/cut_revision_conflict`, duration clamp `200_000..300_000_000` micros) and pure `applyEpisodeCut(rows, override)` with RPC actions `drama.cut.get|set|reset`.
   - Extend `seedDemoWorkspace` with optional `episodes` count (supporting multi-episode `episode:01` & `episode:02` demos).
3. **FCPXML 1.10, Jianying Draft & Portable Bundle Export (`@yeisme/dsh-muweave-core`)**:
   - Extend `DramaExportFormat` with `fcpxml_1_10` (`application/xml`) and `jianying_draft_v1` (`draft_content.json`, `application/json`), overlay episode filtering and `EpisodeCutOverrideV1`, emit safe relative `media/<sha12>.<ext>` paths only, and add `exportDramaPortableBundle` (`--bundle-dir`).
   - Extend CLI (`muweave adapters`, `muweave cut`, `muweave export --episode --bundle-dir`, `muweave demo seed --episodes`) and MCP (`muweave_adapters_manage`, `muweave_drama_cut_manage` → 16 tools total, still NEVER exposing `job.approve`).
4. **v7 Drama, Script & Kit UI Upgrades**:
   - Drama: `.dr-episode-bar` multi-episode switcher, `.dr-cut-banner` + reset, inline reorder/omit controls, `ShotInspector` 「粗剪微调」 (duration, transition, omit/restore), and Timeline 「导出 FCPXML」 & 「导出剪映草稿」 buttons.
   - Script: `.dr-episode-bar` multi-episode switcher when `episodes.length > 1`.
   - Kit: 「外部引擎 Bridge 配置」 (`.kit-adapter-card`) inside existing `cli-cards` tab with 3 presets, `envReady` badges, client-side plaintext secret guard, test/save/remove controls.
5. **Documentation & Release Log**:
   - Add `docs/design/bridge-cut-export-v7.md`, update `docs/design/README.md`, `README.md`, and `CHANGELOG.md`.

## Non-goals

- Never store plaintext API keys, Bearer tokens, or host filesystem paths in `custom-adapters.v1.json`, `drama-cuts.v1.json`, exports, or UI storage.
- Never bypass `paidEnabled`, `dailyCap`, or human UI approval (`job.approve` stays excluded from CLI, MCP, and Kit agent tools).
- Never mutate canonical `.scaena/**`, `.eikona/**`, or `.auctra/**` internal stores or alter existing theater room / stage tab IDs.
