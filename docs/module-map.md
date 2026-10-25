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

- Build, lint, typecheck and test run through the root workspace (P0-04, `## Commands`). A package
  adds the matching `package.json` scripts in the task that creates it; until then a package has
  no commands.
- Kinds: `package` shared library, `service` deployable backend, `app` deployable UI, `tool`
  build/check helper, `infra` configuration.
- Packages import only what `may_import` allows; gate `boundaries`
  (`python3 $POLIER/tools/boundaries.py .`).
- No cycles; services never import each other (HTTP or messages only); apps never import services.
- Cross-package interfaces are contracts in `packages/contracts` (from stage contract), versioned;
  every dependant changes in the same task.
- Each package gets `ARCHITECTURE.md` (≤ 400 words) and optionally `AGENTS.md` (≤ 200 words) in the
  stage that creates it.

## Commands

The workspace is pnpm workspaces + Turborepo (owner answer Q2, P0-04). Run root commands from the
repository root; Node comes from `.nvmrc` (`24.22.1`), the package manager is pinned in
`packageManager` (`pnpm@12.14.0`). Turbo runs a task only in packages that define a script with
that name and reuses cached results, so only changed packages execute; a task that no package
defines exits 0 with a warning.

| Command | Turbo task | What it runs |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | – | clean install from the committed `pnpm-lock.yaml`; CI uses the same command |
| `pnpm build` | `build` | `turbo run build` |
| `pnpm lint` | `lint` | `turbo run lint` |
| `pnpm typecheck` | `typecheck` | `turbo run typecheck && tsc -b tsconfig.json` (packages, then the root solution build) |
| `pnpm test` | `test` | `turbo run test` |
| `pnpm clean` | – | removes root `node_modules/`, `.turbo/` and `coverage/` |

- One package: `pnpm --filter <package-name-or-path> <script>`, e.g.
  `pnpm --filter ./packages/contracts test`.
- Change set only: `pnpm build --affected` passes Turbo's `--affected` flag; plain `pnpm build`
  relies on Turbo's cache and dependency graph.
- Shared lint config: root `eslint.config.mjs` (flat config, typescript-eslint, type-aware rules).
  Every linted file must belong to the package's `tsconfig.json`.
- Root `tsconfig.json` is the solution file (`files: []`, `references: []`, extending
  `tsconfig.base.json` so `tsc -b` exits 0 while the workspace is empty); package tasks add their
  references in the task that creates the package.
- `reference/` is not part of the workspace and is excluded from lint and typecheck.

### Script shape per package

A package has these scripts only after the task that creates it adds a `package.json`; until then
Turbo skips it.

| Kind | `lint` | `typecheck` | `test` | `build` |
| --- | --- | --- | --- | --- |
| `package`, `service`, `tool` | `eslint --max-warnings=0 .` | `tsc --noEmit` with a `tsconfig.json` that extends `tsconfig.base.json` | the runner the package adds with its first test | `tsc -b` or the package build tool |
| `app` | same | same | same | the app bundler chosen in its stage |

`infra/` is outside the workspace globs; its commands are `docker compose -f infra/compose/compose.yaml …`
(P0-07). A package without a script for a task is skipped by Turbo.

## Layers inside a TypeScript package

| Layer | Folder | Purpose | May import | May not import |
|---|---|---|---|---|
| UI | `src/ui/` | components, views | logic | data directly |
| Logic | `src/logic/` | rules, use cases, domain types | data, contracts | UI |
| Data | `src/data/` | adapters, clients, persistence | contracts | UI, logic |
| Tests | `tests/` | verification | everything (read-only) | production changes |

Services have no UI layer; the engine follows its own module list in `docs/engine.md` (stage
engine-spike).
