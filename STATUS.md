# Status

**Project:** project-air · **Profile:** L · **Stage:** 5 of 11 (11 defined)

> Generated from `board.json`. Do not edit by hand.

## Stages

### Stage 1 — `foundation` Foundation

- State: complete
- Owner decision: `continue`
- Exit gates: `board-check`, `install`, `boundaries`, `dev-setup`, `compose-config`, `tokens-codegen`, `design-check`, `language-check`, `changelog-entry`, `ci-local`, `polier-version`
- Exit criteria: Every packages[] folder exists with a README and an ARCHITECTURE.md; package map and versions are filled in.; A fresh clone installs reproducibly with the committed lockfile; root lint, typecheck, test and build pass.; Two worktrees run install, lint, typecheck and tests side by side without port or database collision; tools/dev/setup and teardown create and remove the slot database and bucket and refuse slot 0.; design-check, language-check, changelog-entry and boundaries reject a violating change locally; every code change carries a .changes entry.; The CI workflow is authored and proven locally (actionlint + act) and local sessions use Polier at the board's generator_version; the real GitHub run, branch protection, hosting and releases are deferred to the remote stage after hardening (ADR-0003).; A runnable design preview page exists with desktop and mobile screenshots and a live two-note connection demo (P0-19, P0-20).
- Tasks: P0-03, P0-04, P0-06, P0-07, P0-08, P0-09, P0-10, P0-11, P0-12, P0-13, P0-14, P0-18, P0-19, P0-20, P0-21, P0-22, P0-23, P0-24, P0-25, P0-26, P0-27, P0-28, P0-29, P0-30, P0-31, P0-32

### Stage 2 — `contract` Contract

- State: complete
- Owner decision: `continue`
- Exit gates: `contracts`, `codegen`
- Exit criteria: contracts 0.1.0 tagged; every schema has a valid and an invalid fixture.; TS and C++ read the same fixtures identically.
- Tasks: P1-01, P1-02, P1-03, P1-04, P1-05, P1-06, P1-07

### Stage 3 — `engine-spike` Engine spike

- State: complete
- Owner decision: `continue`
- Exit gates: `cpp-unit`, `wasm-build`, `perf-baseline`
- Exit criteria: 60 fps with 50,000 rectangles on the reference hardware; WASM <= 300 KB gzip.; Measured report and ADR for the engine architecture.
- Tasks: P2-01, P2-02, P2-03, P2-04, P2-05

### Stage 4 — `backend-core` Backend core

- State: complete
- Owner decision: `continue`
- Exit gates: `api-tests`, `rls-tests`
- Exit criteria: API suite covers allow and deny for every route; RLS tests green.; A script creates account, workspace, board and note via the SDK; a second account sees nothing.
- Tasks: P3-01, P3-02, P3-03, P3-04, P3-05, P3-06

### Stage 5 — `engine-core` Engine core

- State: exit gates missing: visual-final, perf-final
- Owner decision: `continue`
- Exit gates: `cpp-unit`, `visual-final` (missing record), `perf-final` (missing record)
- Exit criteria: 10,000 objects at 60 fps in the playground.; All engine entries of the canvas work orders done; reference images green.
- Tasks: P4-01, P4-02, P4-03, P4-04, P4-05, P4-06, P4-07, P4-08, P4-09, P4-10, P4-11, P4-12, P4-13, P4-14, P4-15, P4-16, P4-17, P4-18, P4-19, P4-20, P4-21, P4-22, P4-23, P4-24, P4-25, P4-26, P4-27, P4-28

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

- `P4-08` Text atlas and glyph texture pipeline (L02)
  - P4-02: Closed P4-02: deterministic test-kit scenes (500 cards/50 zones/144 blocks, 10k stress), interactive playground with pan/zoom, HUD, ready hook; benchmark mode preserved.
  - P4-02: Screenshots 1440x900/390x844 + serve/capture log (HTTP 200, SwiftShader capture); test-kit suite 12/12; four gates green after the owner-approved design-check test fix 32c8f28.
  - P4-02: Two review rounds; minors fixed (serve-log consistency, per-zone block assertions). Deviation: Node v26.12.1 vs the .nvmrc pin.
  - P4-04: Closed P4-04: dependency-free visual gate, 8 committed baselines (4 scenes x 2 viewports, WebGL2), 0 differing pixels on ANGLE Metal M2; fail-closed renderer and exact viewports.
  - P4-04: Baselines regenerated once after the OS move Darwin 25.5.0 -> 27.2.0 (text AA only, geometry unchanged), documented under 'Baseline history'; --update is a review action, never a pass.
  - P4-04: Deterministic ?view= camera hook; gate log prints URL + camera; board-check + visual green. Stage-exit final gates are perf-final/visual-final, run by P4-28.

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
- [x] `P1-01` Board content data model as JSON Schema — status: `done` — owner: —
- [x] `P1-02` Operations, inverse operations and group — status: `done` — owner: —
- [x] `P1-03` Codegen TS + C++ with identical fixtures — status: `done` — owner: —
- [x] `P1-04` Sync protocol messages — status: `done` — owner: —
- [x] `P1-05` API resources and error codes — status: `done` — owner: —
- [x] `P1-06` Contract documentation, ADR and 0.1.0 metadata — status: `done` — owner: —
- [x] `P1-07` Contract overview in the preview — status: `done` — owner: —
- [x] `P2-01` Engine toolchain and native + WASM build scaffold — status: `done` — owner: —
- [x] `P2-02` Engine core model and render command buffer — status: `done` — owner: —
- [x] `P2-03` WebGL2 renderer, TS bridge and engine playground — status: `done` — owner: —
- [x] `P2-04` Performance baseline and measured report — status: `done` — owner: —
- [x] `P2-05` Engine architecture ADR, module docs and stage showcase — status: `done` — owner: —
- [x] `P3-01` Backend scaffold, PostgreSQL and local Compose — status: `done` — owner: —
- [x] `P3-02` PostgreSQL schema, migrations and RLS policies — status: `done` — owner: —
- [x] `P3-03` Auth service with self-hosted Ory Kratos — status: `done` — owner: —
- [x] `P3-04` Platform API routes and api-tests — status: `done` — owner: —
- [x] `P3-05` SDK, RLS tests and backend acceptance — status: `done` — owner: —
- [x] `P3-06` Contract-valid account IDs (Kratos identity mapping) — status: `done` — owner: —
- [x] `P4-01` Engine document: stable ids, incremental mutations, hit testing and spatial queries — status: `done` — owner: —
- [x] `P4-02` Engine playground: interactive sample board and stage shell — status: `done` — owner: —
- [x] `P4-03` Engine-core perf gate and L01 basis — status: `done` — owner: —
- [x] `P4-04` Visual gate with reference images — status: `done` — owner: —
- [x] `P4-05` Gesture-to-operation seam and undo history core — status: `done` — owner: —
- [x] `P0-26` Toolbar and zone with notepad and image window in the preview — status: `done` — owner: —
- [x] `P0-27` Bilingual preview with DE/EN switch and cache-busted assets — status: `done` — owner: —
- [x] `P0-28` Zone detach interaction: drag notepad and photo out and back — status: `done` — owner: —
- [x] `P0-29` Zone collapse, re-grouping and smaller zoom controls — status: `done` — owner: —
- [x] `P0-30` Flexible zone layout, less magnetic drag and smaller controls — status: `done` — owner: —
- [x] `P0-31` Refined live demo: smooth merge/split and calm motion — status: `done` — owner: —
- [x] `P0-32` Zone titles: named, editable zone headers in the live demo — status: `done` — owner: —

## In progress

- [ ] `P4-07` Canvas feel: fit, dot grid and idle drawing (L19) — status: `in_progress` — owner: lead
- [ ] `P4-25` Contract 0.2.0: zone parent reference and reorder (z) operation (L08/L13) — status: `in_progress` — owner: lead

## Blocked / failed

- none

## Open

- [ ] `P0-02` Protect main and document repository settings — status: `pending` — owner: —
- [ ] `P0-15` Release command and tag-based CI release — status: `pending` — owner: —
- [ ] `P0-16` Dependency updates and Polier update check — status: `pending` — owner: —
- [ ] `P0-17` RELEASING.md and release 0.0.1 — status: `pending` — owner: —
- [ ] `P4-06` Layers and draw order (L13) — status: `pending` — owner: —
- [ ] `P4-08` Text atlas and glyph texture pipeline (L02) — status: `pending` — owner: —
- [ ] `P4-09` Glyph layout, text instances and ellipsis (L02) — status: `pending` — owner: —
- [ ] `P4-10` Titles, previews and visible quality (L02) — status: `pending` — owner: —
- [ ] `P4-11` WebGPU render pipeline behind the command buffer — status: `pending` — owner: —
- [ ] `P4-12` WebGPU backend selection, capability and fallback — status: `pending` — owner: —
- [ ] `P4-13` WebGPU switch and two-backend image comparison — status: `pending` — owner: —
- [ ] `P4-14` Dragging versus editing (L03) — status: `pending` — owner: —
- [ ] `P4-15` Snapping (L07) — status: `pending` — owner: —
- [ ] `P4-16` Multi-selection (L10) — status: `pending` — owner: —
- [ ] `P4-17` Resize (L14) — status: `pending` — owner: —
- [ ] `P4-18` Auto-pan (L16) — status: `pending` — owner: —
- [ ] `P4-19` Placement of new objects (L20) — status: `pending` — owner: —
- [ ] `P4-20` Keyboard and context menu (L12) — status: `pending` — owner: —
- [ ] `P4-21` Undo/redo (L11) — status: `pending` — owner: —
- [ ] `P4-22` Remember view (L17) — status: `pending` — owner: —
- [ ] `P4-23` DOM overlay for field editing and inline comfort (L18) — status: `pending` — owner: —
- [ ] `P4-24` Trackpad and wheel defaults (L15, desktop part) — status: `pending` — owner: —
- [ ] `P4-26` Zones as containers II: platform migration and containment (L08) — status: `pending` — owner: —
- [ ] `P4-27` Zones as containers II: engine membership and zone move (L08) — status: `pending` — owner: —
- [ ] `P4-28` L01 final proof, two-backend reference images and stage showcase — status: `pending` — owner: —

## Decisions

- 2026-10-25 `ADR-0001` Monorepo with packages, services, apps, tools and infra (`docs/adr/ADR-0001-monorepo.md`)
- 2026-10-25 `ADR-0002` Local-first build until the GitHub switch (`docs/adr/ADR-0002-local-first.md`)
- 2026-10-25 `ADR-0003` Remote phase as the last stage before v1 (`docs/adr/ADR-0003-remote-phase.md`)
- 2026-10-25 `ADR-0004` Contract v1 text limits and board visibility (`docs/adr/ADR-0004-contract-limits-visibility.md`)
- 2026-10-25 `ADR-0005` Contract and versions (`docs/adr/ADR-0005-contract.md`)
- 2026-10-25 `ADR-0006` Engine architecture (`docs/adr/ADR-0006-engine-architecture.md`)
- 2026-10-25 `ADR-0007` Self-hosted Ory Kratos for authentication (`docs/adr/ADR-0007-auth.md`)
- 2026-10-25 `ADR-0008` API and session model
- 2026-10-25 `ADR-0009` Canvas text and overlay strategy (`docs/adr/ADR-0009-canvas-text-and-overlay.md`)
- 2026-10-27 `ADR-0010` Zones as containers (`docs/adr/ADR-0010-zone-containers.md`)

## Open questions

- `Q1` Product name (working title: Project air) (needed before stage: v1). — blocks: — — status: `open`
- `Q3` Hosting provider and country (CH/EU). — blocks: P0-15 — status: `open`
- `Q4` CRDT: open-source library behind an own interface (proposal) or own algorithm (needed before stage: realtime). — blocks: — — status: `open`
- `Q8` Which import formats, after a legal check of their terms (needed before stage: value). — blocks: — — status: `open`
- `Q9` Pricing model for v1 (needed before stage: v1). — blocks: — — status: `open`
- `Q14` English visible at launch or prepared only; who translates further languages (needed before stage: v1). — blocks: — — status: `open`
