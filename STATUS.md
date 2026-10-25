# Status

**Project:** project-air · **Profile:** L · **Stage:** 1 of 10 (10 defined)

> Generated from `board.json`. Do not edit by hand.

## Stages

### Stage 1 — `foundation` Foundation

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `board-check`, `ci-green` (missing record), `design-check` (missing record), `language-check` (missing record), `changelog-entry` (missing record), `release-dry` (missing record)
- Exit criteria: Every packages[] folder exists with a README and an ARCHITECTURE.md; package map and versions are filled in.; Two worktrees run tests side by side without port or database collision; two e2e runs wait for each other.; CI rejects a pull request that leaves its scope, adds a raw colour, hard-codes UI text or lacks a change entry.; Release 0.0.1 and one preview ran end to end through CI from a tag.
- Tasks: P0-02, P0-03, P0-04, P0-06, P0-07, P0-08, P0-09, P0-10, P0-11, P0-12, P0-13, P0-14, P0-15, P0-16, P0-17, P0-18

### Stage 2 — `contract` Contract

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `contracts` (missing record), `codegen` (missing record)
- Exit criteria: contracts 0.1.0 tagged; every schema has a valid and an invalid fixture.; TS and C++ read the same fixtures identically.

### Stage 3 — `engine-spike` Engine spike

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `cpp-unit` (missing record), `wasm-build` (missing record), `perf-baseline` (missing record)
- Exit criteria: 60 fps with 50,000 rectangles on the reference hardware; WASM <= 300 KB gzip.; Measured report and ADR for the engine architecture.

### Stage 4 — `backend-core` Backend core

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `api-tests` (missing record), `rls-tests` (missing record)
- Exit criteria: API suite covers allow and deny for every route; RLS tests green.; A script creates account, workspace, board and note via the SDK; a second account sees nothing.

### Stage 5 — `engine-core` Engine core

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `cpp-unit` (missing record), `visual` (missing record), `perf` (missing record)
- Exit criteria: 10,000 objects at 60 fps in the playground.; All engine entries of the canvas work orders done; reference images green.

### Stage 6 — `realtime` Realtime

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `crdt-convergence` (missing record), `load` (missing record)
- Exit criteria: Load test 25 clients p95 <= 150 ms; restart loses no acknowledged change.; Two offline browsers converge after reconnect.

### Stage 7 — `web-app` Web app

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `e2e` (missing record), `design-check` (missing record), `language-check` (missing record)
- Exit criteria: Main e2e flows green on a preview environment.; Every canvas work order done with evidence; design-check and language-check green repo-wide.

### Stage 8 — `value` Import, export and AI

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `import-tests` (missing record), `e2e` (missing record)
- Exit criteria: Ten sample boards imported with a per-object checklist; JSON export round-trips.; Coach budget enforced.

### Stage 9 — `hardening` Hardening and beta

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `smoke` (missing record), `load` (missing record), `release-dry` (missing record)
- Exit criteria: All product targets measured; no open high-severity security findings.; Two weeks of beta without data loss.

### Stage 10 — `v1` Public v1

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `release` (missing record), `smoke` (missing record)
- Exit criteria: Release 1.0.0 built by CI from a tag; smoke checks green on every environment.

## Packages

- `packages/contracts` — kind: `package` — may import: —
- `packages/ui-kit` — kind: `package` — may import: —
- `packages/engine` — kind: `package` — may import: packages/contracts, packages/ui-kit
- `packages/crdt` — kind: `package` — may import: packages/contracts
- `packages/editor` — kind: `package` — may import: packages/contracts, packages/ui-kit
- `packages/sdk` — kind: `package` — may import: packages/contracts
- `packages/test-kit` — kind: `package` — may import: packages/contracts
- `services/platform` — kind: `service` — may import: packages/contracts
- `services/auth` — kind: `service` — may import: packages/contracts
- `services/sync` — kind: `service` — may import: packages/contracts, packages/crdt
- `services/media` — kind: `service` — may import: packages/contracts
- `services/ai` — kind: `service` — may import: packages/contracts
- `services/worker` — kind: `service` — may import: packages/contracts
- `apps/web` — kind: `app` — may import: packages/contracts, packages/ui-kit, packages/editor, packages/engine, packages/sdk
- `apps/engine-playground` — kind: `app` — may import: packages/contracts, packages/ui-kit, packages/engine, packages/test-kit
- `tools/import-export` — kind: `tool` — may import: packages/contracts
- `tools/design-check` — kind: `tool` — may import: —
- `tools/language-check` — kind: `tool` — may import: —
- `tools/release` — kind: `tool` — may import: —
- `tools/dev` — kind: `tool` — may import: —
- `infra` — kind: `infra` — may import: —

## Runtime

- Slots: 10 (0 = main checkout) · ports: 4000 + 100·N
- Services: web +0, web-e2e +1, platform +10, auth +20, sync +30, media +40, ai +50, playground +60
- Ports, database and bucket names: read `.polier-slot` (`tools/slot.py show`)

## Ready now

- `P0-06` Per-slot dev setup and teardown
  - P0-04: Closed P0-04: pnpm workspaces + Turborepo, exact tool versions, lockfile committed, Node 24.22.1 LTS pinned.
  - P0-04: install = pnpm install --frozen-lockfile; unit = pnpm test; root lint/typecheck/test/build exit 0 on the empty workspace.
  - P0-04: Board-check runs before pnpm install (check.py scans node_modules); P0-06, P0-12 and P0-18 can start.
  - P0-07: Closed P0-07: infra/compose with PostgreSQL 17.11, SeaweedFS 4.50 (S3) and Mailpit 1.32.0, pinned, healthy, loopback ports 5433/8333/1025/8025.
  - P0-07: Gate compose-config passes; images recorded in docs/versions.md, gate command in docs/quality.md.
  - P0-07: P0-06 reads .polier-slot and creates per-slot DB/bucket against this stack; never resets slot 0 data.
- `P0-08` CI skeleton
  - P0-04: Closed P0-04: pnpm workspaces + Turborepo, exact tool versions, lockfile committed, Node 24.22.1 LTS pinned.
  - P0-04: install = pnpm install --frozen-lockfile; unit = pnpm test; root lint/typecheck/test/build exit 0 on the empty workspace.
  - P0-04: Board-check runs before pnpm install (check.py scans node_modules); P0-06, P0-12 and P0-18 can start.
- `P0-12` Design tokens and icons in ui-kit
  - P0-04: Closed P0-04: pnpm workspaces + Turborepo, exact tool versions, lockfile committed, Node 24.22.1 LTS pinned.
  - P0-04: install = pnpm install --frozen-lockfile; unit = pnpm test; root lint/typecheck/test/build exit 0 on the empty workspace.
  - P0-04: Board-check runs before pnpm install (check.py scans node_modules); P0-06, P0-12 and P0-18 can start.
  - P0-10: Closed P0-10: docs/design-rules.md derived from the reference, adapted to tokens.json, icons, engine, Polier and i18n.
  - P0-10: Gate board-check passes; no prototype/vendor names, no broken links.
  - P0-10: P0-11 can build the canvas acceptance catalogue on it; P0-12/P0-13 cite it.
- `P0-18` i18n scaffold and language-check gate
  - P0-04: Closed P0-04: pnpm workspaces + Turborepo, exact tool versions, lockfile committed, Node 24.22.1 LTS pinned.
  - P0-04: install = pnpm install --frozen-lockfile; unit = pnpm test; root lint/typecheck/test/build exit 0 on the empty workspace.
  - P0-04: Board-check runs before pnpm install (check.py scans node_modules); P0-06, P0-12 and P0-18 can start.

## Done

- [x] `P0-03` Workspace folders, package READMEs and architectures — status: `done` — owner: —
- [x] `P0-04` Workspaces, build orchestration and pinned versions — status: `done` — owner: —
- [x] `P0-07` Local services compose — status: `done` — owner: —
- [x] `P0-10` Adapt design rules to this project — status: `done` — owner: —
- [x] `P0-11` Canvas acceptance catalogue — status: `done` — owner: —

## In progress

- none

## Blocked / failed

- [!] `P0-02` Protect main and document repository settings — status: `blocked` — owner: —

## Open

- [ ] `P0-06` Per-slot dev setup and teardown — status: `pending` — owner: —
- [ ] `P0-08` CI skeleton — status: `pending` — owner: —
- [ ] `P0-09` Pinned Polier for agents and CI — status: `pending` — owner: —
- [ ] `P0-12` Design tokens and icons in ui-kit — status: `pending` — owner: —
- [ ] `P0-13` design-check gate — status: `pending` — owner: —
- [ ] `P0-14` Change entries and changelog gate — status: `pending` — owner: —
- [ ] `P0-15` Release command and tag-based CI release — status: `pending` — owner: —
- [ ] `P0-16` Dependency updates and Polier update check — status: `pending` — owner: —
- [ ] `P0-17` RELEASING.md and release 0.0.1 — status: `pending` — owner: —
- [ ] `P0-18` i18n scaffold and language-check gate — status: `pending` — owner: —

## Decisions

- 2026-10-25 `ADR-0001` Monorepo with packages, services, apps, tools and infra (`docs/adr/ADR-0001-monorepo.md`)
- 2026-10-25 `ADR-0002` Local-first build until the GitHub switch (`docs/adr/ADR-0002-local-first.md`)

## Open questions

- `Q1` Product name (working title: Project air) (needed before stage: v1). — blocks: — — status: `open`
- `Q3` Hosting provider and country (CH/EU). — blocks: P0-15 — status: `open`
- `Q4` CRDT: open-source library behind an own interface (proposal) or own algorithm (needed before stage: realtime). — blocks: — — status: `open`
- `Q5` Auth: build it ourselves (proposal) or a self-hosted open-source server (needed before stage: backend-core). — blocks: — — status: `open`
- `Q6` Reference hardware for the 60 fps target (needed before stage: engine-spike). — blocks: — — status: `open`
- `Q7` Who builds the engine: a person with C++/graphics experience or agents under close guidance (needed before stage: engine-spike). — blocks: — — status: `open`
- `Q8` Which import formats, after a legal check of their terms (needed before stage: value). — blocks: — — status: `open`
- `Q9` Pricing model for v1 (needed before stage: v1). — blocks: — — status: `open`
- `Q10` Version scheme: 0.0.1 plus letter entries (proposal) or four-part. — blocks: P0-14 — status: `open`
- `Q11` AI-written release notes workflow: yes or no. — blocks: P0-16 — status: `open`
- `Q12` i18n library or own thin layer on Intl. — blocks: P0-18 — status: `open`
- `Q14` English visible at launch or prepared only; who translates further languages (needed before stage: v1). — blocks: — — status: `open`
- `Q15` Canvas collisions: clear layers only (proposal) or gentle nudge (needed before stage: engine-core). — blocks: — — status: `open`
- `Q16` Trackpad default: two fingers pan, pinch zooms (proposal) or scroll zooms (needed before stage: engine-core). — blocks: — — status: `open`
- `Q17` Zones as containers: zones keep their content and move it as one operation (proposal, needs a decision record and migration) or zones are only visual frames? — blocks: — — status: `open`
- `Q18` Performance target split: the engine-spike exit says 60 fps with 50,000 rectangles, the canvas catalogue L01 names 10,000 objects at 60 fps and no long task > 16 ms. Which target applies to which stage gate? — blocks: — — status: `open`
