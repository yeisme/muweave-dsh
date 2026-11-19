## ADDED Requirements

### Requirement: Materialized .muweave/ bundle SHALL be CLI-authored, path-free, secret-free, and rebuildable
`@yeisme/muweave-bundle` SHALL compile upstream official JSON/handoff payloads from Eikona, Auctra, Scaena, local `.pi/` artifacts, and DSH tool outputs into `.muweave/bundle.v1.json`, `.muweave/index.v1.json`, `.muweave/elements/<domain>/*.json`, `.muweave/cas/sha256/**`, and append-only `.muweave/events/sync.jsonl` using atomic temporary-file-plus-rename writes. It MUST strip host absolute paths and reject plaintext credentials, and deleting `.muweave/` followed by `muweave-bundle sync` SHALL deterministically reconstruct all bound elements without mutating upstream owner directories.

#### Scenario: Syncing Eikona, Auctra, Scaena, and Pi elements into .muweave/
- **WHEN** `muweave-bundle sync --workspace <dir> --json` runs against bound upstream fixtures or initialized owner workspaces
- **THEN** `.muweave/index.v1.json` and normalized `MuweaveElementV1` files SHALL be written atomically with SHA-256 digests and zero host absolute paths or credentials

#### Scenario: Uninitialized owner workspace preflight skips CLI invocation
- **WHEN** a workspace lacks `.scaena/project.json` or `.auctra/` initialization markers
- **THEN** the collector SHALL report `uninitialized_owner` without spawning `scaena` or `auctra` processes that would create side-effect SQLite files

### Requirement: Browser-safe consumer SDK SHALL validate and project .muweave/ elements for both DSH and MuWeave Web
`@yeisme/muweave-bundle/consumer` SHALL be a pure TypeScript module with zero Node.js imports that validates `bundle.v1`, `index.v1`, and `MuweaveElementV1` payloads fail-closed and projects `ProjectionEnvelopeV1` views filterable by episode, scene, character, role, and source tool.

#### Scenario: Malformed or future-major element is fail-closed
- **WHEN** `@yeisme/muweave-bundle/consumer` receives an element with an unsupported major schema version or missing digest
- **THEN** it SHALL mark that projection `contract_mismatch` with write actions disabled instead of throwing an uncaught render error
