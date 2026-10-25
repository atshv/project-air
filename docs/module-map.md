# Module Structure: Project air

> Detail document for `ARCHITECTURE.md` (profile L). Package map and import rules; no
> architecture decisions. Layout rules: `docs/monorepo-layout.md`.

## Package map

| Package path | Kind | Purpose | May import | Created in stage |
|---|---|---|---|---|
| `packages/contracts/` | `package` | data model, operations, sync protocol, API errors as JSON Schema + codegen | – | contract |
| `packages/ui-kit/` | `package` | design tokens (CSS + C++), icons, base components | – | foundation |
| `packages/engine/` | `package` | C++ → WebAssembly canvas engine + TS bridge | `packages/contracts`, `packages/ui-kit` | engine-spike |
| `packages/crdt/` | `package` | board document as CRDT behind an own interface | `packages/contracts` | later |
| `packages/editor/` | `package` | note editor (rich text, links) | `packages/contracts`, `packages/ui-kit` | later |
| `packages/sdk/` | `package` | typed client for platform and sync | `packages/contracts` | later |
| `packages/test-kit/` | `package` | fixtures, fake servers, slot helpers | `packages/contracts` | engine-spike |
| `services/platform/` | `service` | HTTP API: workspaces, boards, notes, permissions | `packages/contracts` | later |
| `services/auth/` | `service` | accounts, sessions, invitations | `packages/contracts` | later |
| `services/sync/` | `service` | WebSocket realtime, CRDT exchange, presence | `packages/contracts`, `packages/crdt` | later |
| `services/media/` | `service` | uploads, thumbnails, PDF pages | `packages/contracts` | later |
| `services/ai/` | `service` | coach, search, summaries | `packages/contracts` | later |
| `services/worker/` | `service` | background jobs | `packages/contracts` | later |
| `apps/web/` | `app` | the product UI | `packages/contracts`, `packages/ui-kit`, `packages/editor`, `packages/engine`, `packages/sdk` | later |
| `apps/engine-playground/` | `app` | engine demo without backend | `packages/contracts`, `packages/ui-kit`, `packages/engine`, `packages/test-kit` | engine-spike |
| `tools/import-export/` | `tool` | import/export converters | `packages/contracts` | later |
| `tools/design-check/` | `tool` | design rules gate | – | foundation |
| `tools/language-check/` | `tool` | language and translation gate | – | foundation |
| `tools/release/` | `tool` | change entries and release commands | – | foundation |
| `tools/dev/` | `tool` | per-slot setup and teardown | – | foundation |
| `infra/` | `infra` | containers, local compose, migrations, environments | – | foundation |

- Build, lint, typecheck and test commands per package are added by P0-04 (workspace) and by the
  task that creates each package; until then a package has no commands.
- Kinds: `package` shared library, `service` deployable backend, `app` deployable UI, `tool`
  build/check helper, `infra` configuration.
- Packages import only what `may_import` allows; gate `boundaries`
  (`python3 $POLIER/tools/boundaries.py .`).
- No cycles; services never import each other (HTTP or messages only); apps never import services.
- Cross-package interfaces are contracts in `packages/contracts` (from stage contract), versioned;
  every dependant changes in the same task.
- Each package gets `ARCHITECTURE.md` (≤ 400 words) and optionally `AGENTS.md` (≤ 200 words) in the
  stage that creates it.

## Layers inside a TypeScript package

| Layer | Folder | Purpose | May import | May not import |
|---|---|---|---|---|
| UI | `src/ui/` | components, views | logic | data directly |
| Logic | `src/logic/` | rules, use cases, domain types | data, contracts | UI |
| Data | `src/data/` | adapters, clients, persistence | contracts | UI, logic |
| Tests | `tests/` | verification | everything (read-only) | production changes |

Services have no UI layer; the engine follows its own module list in `docs/engine.md` (stage
engine-spike).
