# Custom Engine Bridge, Non-Destructive Cut & NLE Export v7

## ADDED Requirements

### Requirement: Custom engine bridge SHALL enforce zero-secret env-var storage, SSRF/HTTPS validation, and standard capability gates
`@yeisme/dsh-muweave-core` SHALL persist custom adapters (`openai_http`, `comfyui_http`, `cli_wrapper`) in `pluginDataDir/custom-adapters.v1.json` (`0600` atomic write, `.corrupt-*` backup) via `adapter.custom.list|save|remove|test`. Only env var names (`authEnvVar`) SHALL be stored, plaintext secrets SHALL be rejected, SSRF/HTTPS rules SHALL block unsafe endpoints, and enabled adapters SHALL run through standard `paidEnabled`, `dailyCap`, and human approval gates.

#### Scenario: Plaintext credentials and unsafe SSRF endpoints are rejected
- **WHEN** `adapter.custom.save` receives a plaintext `sk-*` key in `authEnvVar`, a `169.254.*` metadata URL, an external `http://` URL, or a private LAN URL without `allowPrivateNetwork: true`
- **THEN** the host SHALL reject the save with a structured error (`ADAPTER_HTTPS_REQUIRED`, `ADAPTER_PRIVATE_NET_FORBIDDEN`, or credential error) without persisting any secret

#### Scenario: Valid custom adapter lists env readiness and executes zero-cost probe
- **WHEN** an adapter with `authEnvVar: "OPENAI_API_KEY"` is saved and probed via `adapter.custom.test`
- **THEN** `adapter.custom.list` SHALL expose `envReady` without returning the secret value, and `adapter.custom.test` SHALL verify readiness without invoking paid generation

### Requirement: Multi-episode non-destructive cut layer SHALL persist optimistic-locked shot overrides without mutating canonical bundles
`@yeisme/dsh-muweave-core` SHALL expose `drama.cut.get`, `drama.cut.set`, and `drama.cut.reset` backed by `DramaCutStore` (`pluginDataDir/drama-cuts.v1.json`, `0600` atomic write, `.corrupt-*` backup) supporting per-episode shot reordering, duration overrides (`200_000..300_000_000` micros), omit/restore, and transitions (`cut | crossfade | dip_to_black`) with `expectedRevision` optimistic locking.

#### Scenario: Stale cut revision is rejected and reset restores canonical order
- **WHEN** `drama.cut.set` is called with a stale `expectedRevision`, and later `drama.cut.reset` is invoked for the episode
- **THEN** the stale write SHALL fail with `muweave/cut_revision_conflict` including `currentRevision`, and `drama.cut.reset` SHALL clear overrides without touching `.scaena/**`

### Requirement: Drama exporter SHALL compile sanitized FCPXML 1.10, Jianying drafts, and portable media bundles
`@yeisme/dsh-muweave-core` SHALL extend `drama.export.manifest` and `muweave export` with `fcpxml_1_10` (`application/xml`) and `jianying_draft_v1` (`draft_content.json`), applying optional `episodeRef` filtering and `EpisodeCutOverrideV1` overlays, and SHALL support `--bundle-dir` portable export copying verified CAS media into `media/<sha12>.<ext>` with zero host paths or credentials.

#### Scenario: Exporting FCPXML, Jianying draft, and portable bundle strips host paths
- **WHEN** `drama.export.manifest` or `muweave export --episode episode:01 --bundle-dir <dir>` runs for `fcpxml_1_10` or `jianying_draft_v1`
- **THEN** the output SHALL reflect non-destructive cut overrides, reference only relative `media/<sha12>.<ext>` paths, copy verified CAS blobs, and contain zero host paths or secrets

### Requirement: Drama, Script, and Kit surfaces SHALL expose episode switching, cut controls, NLE exports, and zero-secret bridge management
`@yeisme/dsh-muweave-drama`, `@yeisme/dsh-muweave-script`, and `@yeisme/dsh-muweave-kit` SHALL preserve all existing room and stage tab IDs while adding multi-episode `.dr-episode-bar` switchers, Drama non-destructive cut controls (`ShotInspector` & storyboard) and FCPXML/Jianying export buttons, and Kit's `.kit-adapter-card` bridge manager with client-side plaintext secret blocking using `--mw-*` tokens only.

#### Scenario: Kit bridge card blocks plaintext secrets client-side and Drama applies non-destructive cuts
- **WHEN** a user enters `sk-*` in Kit's `authEnvVar` field or reorders/omits shots and resets in Drama
- **THEN** Kit SHALL show an inline warning without sending an RPC, Drama SHALL persist cut overrides via `drama.cut.set`/`reset`, and MCP SHALL expose 16 tools with zero `job.approve`
