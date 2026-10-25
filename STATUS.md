# Status

**Project:** project-air · **Profile:** L · **Stage:** 1 of 11 (11 defined)

> Generated from `board.json`. Do not edit by hand.

## Stages

### Stage 1 — `foundation` Foundation

- State: complete
- Owner decision: `continue`
- Exit gates: `board-check`, `install`, `boundaries`, `dev-setup`, `compose-config`, `tokens-codegen`, `design-check`, `language-check`, `changelog-entry`, `ci-local`, `polier-version`
- Exit criteria: Every packages[] folder exists with a README and an ARCHITECTURE.md; package map and versions are filled in.; A fresh clone installs reproducibly with the committed lockfile; root lint, typecheck, test and build pass.; Two worktrees run install, lint, typecheck and tests side by side without port or database collision; tools/dev/setup and teardown create and remove the slot database and bucket and refuse slot 0.; design-check, language-check, changelog-entry and boundaries reject a violating change locally; every code change carries a .changes entry.; The CI workflow is authored and proven locally (actionlint + act) and local sessions use Polier at the board's generator_version; the real GitHub run, branch protection, hosting and releases are deferred to the remote stage after hardening (ADR-0003).; A runnable design preview page exists with desktop and mobile screenshots and a live two-note connection demo (P0-19, P0-20).
- Tasks: P0-03, P0-04, P0-06, P0-07, P0-08, P0-09, P0-10, P0-11, P0-12, P0-13, P0-14, P0-18, P0-19, P0-20, P0-21, P0-22, P0-23, P0-24, P0-25

### Stage 2 — `contract` Contract

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `contracts` (missing record), `codegen` (missing record)
- Exit criteria: contracts 0.1.0 tagged; every schema has a valid and an invalid fixture.; TS and C++ read the same fixtures identically.
- Tasks: P1-01

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
- Exit gates: `e2e` (missing record), `design-check`, `language-check`
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

### Stage 10 — `remote` Remote

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `branch-protection` (missing record), `ci-green` (missing record), `polier-version`, `release-dry` (missing record), `smoke` (missing record)
- Exit criteria: main is protected; CI rejects a pull request outside its scope, with raw colours, hard-coded UI text or without a change entry.; Polier v1.0.0 is pinned in CI; release 0.0.1 and one preview ran end to end from a tag.; Hosting is chosen (Q3), environments and smoke checks are complete.
- Tasks: P0-02, P0-15, P0-16, P0-17

### Stage 11 — `v1` Public v1

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

- `P1-01` Board content data model as JSON Schema

## Done

- [x] `P0-03` Workspace folders, package READMEs and architectures — status: `done` — owner: —
- [x] `P0-04` Workspaces, build orchestration and pinned versions — status: `done` — owner: —
- [x] `P0-06` Per-slot dev setup and teardown — status: `done` — owner: —
- [x] `P0-07` Local services compose — status: `done` — owner: —
- [x] `P0-08` CI skeleton — status: `done` — owner: —
- [x] `P0-09` Pinned Polier for agents and CI — status: `done` — owner: —
- [x] `P0-10` Adapt design rules to this project — status: `done` — owner: —
- [x] `P0-11` Canvas acceptance catalogue — status: `done` — owner: —
- [x] `P0-12` Design tokens and icons in ui-kit — status: `done` — owner: —
- [x] `P0-13` design-check gate — status: `done` — owner: —
- [x] `P0-14` Change entries and changelog gate — status: `done` — owner: —
- [x] `P0-18` i18n scaffold and language-check gate — status: `done` — owner: —
- [x] `P0-19` Design preview page — status: `done` — owner: —
- [x] `P0-20` Live connection demo in the preview — status: `done` — owner: —
- [x] `P0-21` Match the demo connection to the design system — status: `done` — owner: —
- [x] `P0-22` Version and last change in the preview masthead — status: `done` — owner: —
- [x] `P0-23` Visible connection anchors in the demo — status: `done` — owner: —
- [x] `P0-24` Curved edge, visible anchors and zoom controls in the demo — status: `done` — owner: —
- [x] `P0-25` Grouped zoom control and invisible anchors — status: `done` — owner: —

## In progress

- none

## Blocked / failed

- none

## Open

- [ ] `P0-02` Protect main and document repository settings — status: `pending` — owner: —
- [ ] `P0-15` Release command and tag-based CI release — status: `pending` — owner: —
- [ ] `P0-16` Dependency updates and Polier update check — status: `pending` — owner: —
- [ ] `P0-17` RELEASING.md and release 0.0.1 — status: `pending` — owner: —
- [ ] `P1-01` Board content data model as JSON Schema — status: `pending` — owner: —

## Decisions

- 2026-10-25 `ADR-0001` Monorepo with packages, services, apps, tools and infra (`docs/adr/ADR-0001-monorepo.md`)
- 2026-10-25 `ADR-0002` Local-first build until the GitHub switch (`docs/adr/ADR-0002-local-first.md`)
- 2026-10-25 `ADR-0003` Remote phase as the last stage before v1 (`docs/adr/ADR-0003-remote-phase.md`)

## Open questions

- `Q1` Product name (working title: Project air) (needed before stage: v1). — blocks: — — status: `open`
- `Q3` Hosting provider and country (CH/EU). — blocks: P0-15 — status: `open`
- `Q4` CRDT: open-source library behind an own interface (proposal) or own algorithm (needed before stage: realtime). — blocks: — — status: `open`
- `Q5` Auth: build it ourselves (proposal) or a self-hosted open-source server (needed before stage: backend-core). — blocks: — — status: `open`
- `Q6` Reference hardware for the 60 fps target (needed before stage: engine-spike). — blocks: — — status: `open`
- `Q7` Who builds the engine: a person with C++/graphics experience or agents under close guidance (needed before stage: engine-spike). — blocks: — — status: `open`
- `Q8` Which import formats, after a legal check of their terms (needed before stage: value). — blocks: — — status: `open`
- `Q9` Pricing model for v1 (needed before stage: v1). — blocks: — — status: `open`
- `Q14` English visible at launch or prepared only; who translates further languages (needed before stage: v1). — blocks: — — status: `open`
- `Q15` Canvas collisions: clear layers only (proposal) or gentle nudge (needed before stage: engine-core). — blocks: — — status: `open`
- `Q16` Trackpad default: two fingers pan, pinch zooms (proposal) or scroll zooms (needed before stage: engine-core). — blocks: — — status: `open`
- `Q17` Zones as containers: zones keep their content and move it as one operation (proposal, needs a decision record and migration) or zones are only visual frames? — blocks: — — status: `open`
- `Q18` Performance target split: the engine-spike exit says 60 fps with 50,000 rectangles, the canvas catalogue L01 names 10,000 objects at 60 fps and no long task > 16 ms. Which target applies to which stage gate? — blocks: — — status: `open`
