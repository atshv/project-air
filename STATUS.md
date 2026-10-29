# Status

**Project:** project-air · **Profile:** L · **Stage:** 6 of 11 (11 defined)

> Generated from `board.json`. Do not edit by hand.

## Stages

### Stage 1 — `foundation` Foundation

- State: tasks open
- Owner decision: `continue`
- Exit gates: `board-check`, `install`, `boundaries`, `dev-setup`, `compose-config`, `tokens-codegen`, `design-check`, `language-check`, `changelog-entry`, `ci-local`, `polier-version`
- Exit criteria: Every packages[] folder exists with a README and an ARCHITECTURE.md; package map and versions are filled in.; A fresh clone installs reproducibly with the committed lockfile; root lint, typecheck, test and build pass.; Two worktrees run install, lint, typecheck and tests side by side without port or database collision; tools/dev/setup and teardown create and remove the slot database and bucket and refuse slot 0.; design-check, language-check, changelog-entry and boundaries reject a violating change locally; every code change carries a .changes entry.; The CI workflow is authored and proven locally (actionlint + act) and local sessions use Polier at the board's generator_version; the real GitHub run, branch protection, hosting and releases are deferred to the remote stage after hardening (ADR-0003).; A runnable design preview page exists with desktop and mobile screenshots and a live two-note connection demo (P0-19, P0-20).
- Tasks: P0-03, P0-04, P0-06, P0-07, P0-08, P0-09, P0-10, P0-11, P0-12, P0-13, P0-14, P0-18, P0-19, P0-20, P0-21, P0-22, P0-23, P0-24, P0-25, P0-26, P0-27, P0-28, P0-29, P0-30, P0-31, P0-32, P0-33, P0-34, P0-35, P0-36, P0-37, P0-38, P0-39, P0-40, P0-41, P0-42, P0-43, P0-44, P0-48
- Tasks open: P0-48

### Stage 2 — `contract` Contract

- State: blocked by stage foundation
- Owner decision: `continue`
- Exit gates: `contracts`, `codegen`
- Exit criteria: contracts 0.1.0 tagged; every schema has a valid and an invalid fixture.; TS and C++ read the same fixtures identically.
- Tasks: P1-01, P1-02, P1-03, P1-04, P1-05, P1-06, P1-07

### Stage 3 — `engine-spike` Engine spike

- State: blocked by stage contract
- Owner decision: `continue`
- Exit gates: `cpp-unit`, `wasm-build`, `perf-baseline`
- Exit criteria: 60 fps with 50,000 rectangles on the reference hardware; WASM <= 300 KB gzip.; Measured report and ADR for the engine architecture.
- Tasks: P2-01, P2-02, P2-03, P2-04, P2-05

### Stage 4 — `backend-core` Backend core

- State: blocked by stage contract
- Owner decision: `continue`
- Exit gates: `api-tests`, `rls-tests`
- Exit criteria: API suite covers allow and deny for every route; RLS tests green.; A script creates account, workspace, board and note via the SDK; a second account sees nothing.
- Tasks: P3-01, P3-02, P3-03, P3-04, P3-05, P3-06

### Stage 5 — `engine-core` Engine core

- State: blocked by stage engine-spike
- Owner decision: `continue`
- Exit gates: `cpp-unit`, `visual-final`, `perf-final`
- Exit criteria: 10,000 objects at 60 fps in the playground.; All engine entries of the canvas work orders done; reference images green.
- Tasks: P4-01, P4-02, P4-03, P4-04, P4-05, P4-06, P4-07, P4-08, P4-09, P4-10, P4-11, P4-12, P4-13, P4-14, P4-15, P4-16, P4-17, P4-18, P4-19, P4-20, P4-21, P4-22, P4-23, P4-24, P4-25, P4-26, P4-27, P4-28, P4-29, P4-30, P4-31, P4-32

### Stage 6 — `realtime` Realtime

- State: blocked by stage backend-core, engine-core
- Owner decision: `continue`
- Exit gates: `crdt-convergence`, `load`
- Exit criteria: Load test 25 clients p95 <= 150 ms; restart loses no acknowledged change.; Two offline browsers converge after reconnect.
- Tasks: P5-01, P5-02, P5-03, P5-04, P5-05, P5-06, P5-07, P5-08

### Stage 7 — `web-app` Web app

- State: exit gates missing: e2e
- Owner decision: `continue`
- Exit gates: `e2e` (missing record), `design-check`, `language-check`
- Exit criteria: Main e2e flows green on a preview environment.; Every canvas work order done with evidence; design-check and language-check green repo-wide.
- Tasks: P6-01, P6-02, P6-03, P6-04, P6-05, P6-06, P6-07, P6-09, P6-10, P6-11, P0-45, P0-46, P6-08, P0-47
- Tasks open: P6-09, P6-10, P6-11, P6-08, P0-47

### Stage 8 — `value` Import, export and AI

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `import-tests` (missing record), `e2e` (missing record)
- Exit criteria: Ten sample boards imported with a per-object checklist; JSON export round-trips.; Coach budget enforced.

### Stage 9 — `hardening` Hardening and beta

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `smoke` (missing record), `load`, `release-dry` (missing record)
- Exit criteria: All product targets measured; no open high-severity security findings.; Two weeks of beta without data loss.

### Stage 10 — `remote` Remote

- State: waiting for the owner decision
- Owner decision: `pending`
- Exit gates: `branch-protection` (missing record), `ci-green` (missing record), `polier-version`, `release-dry` (missing record), `smoke` (missing record)
- Exit criteria: main is protected; CI rejects a pull request outside its scope, with raw colours, hard-coded UI text or without a change entry.; Polier at the board's generator_version is pinned in CI; release 0.0.1 and one preview ran end to end from a tag.; Hosting is chosen (Q3), environments and smoke checks are complete.
- Tasks: P0-02, P0-15, P0-16, P0-17
- Tasks open: P0-02, P0-15, P0-16, P0-17

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
- `packages/sdk` — kind: `package` — may import: packages/contracts, packages/crdt
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

- `P0-48` Live demo: visible selection frame, delete that works
  - P0-41: Closed P0-41: selection/multi-select/teammate frames follow the object radius via --frame-radius; hovered corner is a 2 px arc bracket. Blocks/zones use --radius-lg, notes --radius-md.
  - P0-41: Done checklist entries render --muted at opacity 0.6 with a full --accent tick and no strikethrough; design law section 6 row and L14 wording follow the demo.
  - P0-41: The three intro blocks became one line plus a numbered, two-column <details> contents list (ten points, EN/DE, keyboard); screenshots and the headless-Chrome log are committed.

## Orchestration

- Limits: 3 attempts/task, 3 in progress
- Next wave: none — nothing is ready
- Running: `P6-08` attempt 0/3<!-- polier:claims --> — claimed by dsh<!-- /polier:claims -->; `P0-47` attempt 0/3<!-- polier:claims --> — claimed by dsh<!-- /polier:claims -->; `P0-48` attempt 0/3<!-- polier:claims --> — claimed by dsh<!-- /polier:claims -->
- Blocked: P0-02, P0-15, P0-16, P0-17, P6-09, P6-10, P6-11 (stage waits)
- Approvals pending: none

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
- [x] `P4-06` Layers and draw order (L13) — status: `done` — owner: —
- [x] `P4-07` Canvas feel: fit, dot grid and idle drawing (L19) — status: `done` — owner: —
- [x] `P4-08` Text atlas and glyph texture pipeline (L02) — status: `done` — owner: —
- [x] `P4-09` Glyph layout, text instances and ellipsis (L02) — status: `done` — owner: —
- [x] `P4-10` Titles, previews and visible quality (L02) — status: `done` — owner: —
- [x] `P4-11` WebGPU render pipeline behind the command buffer — status: `done` — owner: —
- [x] `P4-12` WebGPU backend selection, capability and fallback — status: `done` — owner: —
- [x] `P4-13` WebGPU switch and two-backend image comparison — status: `done` — owner: —
- [x] `P4-14` Dragging versus editing (L03) — status: `done` — owner: —
- [x] `P4-15` Snapping (L07) — status: `done` — owner: —
- [x] `P4-16` Multi-selection (L10) — status: `done` — owner: —
- [x] `P4-17` Resize (L14) — status: `done` — owner: —
- [x] `P4-18` Auto-pan (L16) — status: `done` — owner: —
- [x] `P4-19` Placement of new objects (L20) — status: `done` — owner: —
- [x] `P4-20` Keyboard and context menu (L12) — status: `done` — owner: —
- [x] `P4-21` Undo/redo (L11) — status: `done` — owner: —
- [x] `P4-22` Remember view (L17) — status: `done` — owner: —
- [x] `P4-23` DOM overlay for field editing and inline comfort (L18) — status: `done` — owner: —
- [x] `P4-24` Trackpad and wheel defaults (L15, desktop part) — status: `done` — owner: —
- [x] `P4-25` Contract 0.2.0: zone parent reference and reorder (z) operation (L08/L13) — status: `done` — owner: —
- [x] `P4-26` Zones as containers II: platform migration and containment (L08) — status: `done` — owner: —
- [x] `P4-27` Zones as containers II: engine membership and zone move (L08) — status: `done` — owner: —
- [x] `P4-28` L01 final proof, two-backend reference images and stage showcase — status: `done` — owner: —
- [x] `P0-26` Toolbar and zone with notepad and image window in the preview — status: `done` — owner: —
- [x] `P0-27` Bilingual preview with DE/EN switch and cache-busted assets — status: `done` — owner: —
- [x] `P0-28` Zone detach interaction: drag notepad and photo out and back — status: `done` — owner: —
- [x] `P0-29` Zone collapse, re-grouping and smaller zoom controls — status: `done` — owner: —
- [x] `P0-30` Flexible zone layout, less magnetic drag and smaller controls — status: `done` — owner: —
- [x] `P0-31` Refined live demo: smooth merge/split and calm motion — status: `done` — owner: —
- [x] `P0-32` Zone titles: named, editable zone headers in the live demo — status: `done` — owner: —
- [x] `P4-29` Zone parity with the live demo I: arrangement and release preview (L08) — status: `done` — owner: —
- [x] `P4-30` Zone parity with the live demo II: lifecycle and names (L08) — status: `done` — owner: —
- [x] `P0-33` Live demo: checklist block and spreadsheet table card — status: `done` — owner: —
- [x] `P4-31` English sample text in the engine playground (language-check) — status: `done` — owner: —
- [x] `P5-01` Sync contract 0.3.0: settle the pre-realtime open points — status: `done` — owner: —
- [x] `P5-02` CRDT document core behind an own interface (Yjs) — status: `done` — owner: —
- [x] `P5-03` Sync service: WebSocket protocol, auth and durable update log — status: `done` — owner: —
- [x] `P5-04` SDK board-sync client and the one autosave path (L05 realtime half) — status: `done` — owner: —
- [x] `P5-05` Presence: cursors, selection, name and colour — status: `done` — owner: —
- [x] `P5-06` Durability and reconnect: restart, catch-up and snapshot compaction — status: `done` — owner: —
- [x] `P5-07` crdt-convergence proof: 10,000 rounds, offline clients and own-only undo — status: `done` — owner: —
- [x] `P5-08` load proof: 25 clients per board at p95 <= 150 ms and the stage report — status: `done` — owner: —
- [x] `P0-34` Live demo: move a zone with its members — status: `done` — owner: —
- [x] `P0-35` Design system page: contract 0.3.0, missing tokens and engine chrome — status: `done` — owner: —
- [x] `P0-36` Live demo: select and resize objects, photo without bar, edges behind — status: `done` — owner: —
- [x] `P0-37` Live demo: engine canvas chrome — status: `done` — owner: —
- [x] `P0-38` Layer order: edges below zones — status: `done` — owner: —
- [x] `P4-32` Engine follows contract 0.3.0 — status: `done` — owner: —
- [x] `P0-39` Live demo: quiet resize frame, done items dimmed, design rules page — status: `done` — owner: —
- [x] `P0-40` Live demo: two teammates on the board — status: `done` — owner: —
- [x] `P0-41` Live demo: rounded frames, darker done items, contents instead of text — status: `done` — owner: —
- [x] `P0-42` Live demo: light theme with sun/moon icons under DE/EN — status: `done` — owner: —
- [x] `P0-43` Live demo: pen tool and ink colours over the whole board — status: `done` — owner: —
- [x] `P0-44` Live demo: document the pen and ink colours in the preview — status: `done` — owner: —
- [x] `P6-01` Web app scaffold: React + Vite SPA, layout, i18n and base components — status: `done` — owner: —
- [x] `P6-02` Auth UI and session: Kratos login, registration and recovery — status: `done` — owner: —
- [x] `P6-03` Boards start page: workspaces, board list and creation over the SDK — status: `done` — owner: —
- [x] `P6-04` Board page host: engine, toolbar, zoom and view persistence (L00, L17) — status: `done` — owner: —
- [x] `P6-05` Board interactions: context menu, keyboard and undo/redo UI (L12, L11 hint) — status: `done` — owner: —
- [x] `P6-06` Contract 0.4.0: note body document and content operations — status: `done` — owner: —
- [x] `P6-07` Panel and editor: overlay, own editor, note placeholder and title (L04, L06, L09) — status: `done` — owner: —
- [x] `P0-45` Preview page: project areas, their tasks and purpose — status: `done` — owner: —
- [x] `P0-46` Preview page: back-to-top arrow — status: `done` — owner: —

## In progress

- [ ] `P6-08` Contract 0.4.0 operation support in crdt and sync — status: `in_progress` — owner: lead
- [ ] `P0-47` Preview page: connections diagram instead of roles — status: `in_progress` — owner: —

## Blocked / failed

- none

## Open

- [ ] `P0-02` Protect main and document repository settings — status: `pending` — owner: —
- [ ] `P0-15` Release command and tag-based CI release — status: `pending` — owner: —
- [ ] `P0-16` Dependency updates and Polier update check — status: `pending` — owner: —
- [ ] `P0-17` RELEASING.md and release 0.0.1 — status: `pending` — owner: —
- [ ] `P6-09` Realtime UI: live changes, presence and save status (L05) — status: `pending` — owner: —
- [ ] `P6-10` e2e suite: main flows and the e2e gate on the slot ports — status: `pending` — owner: —
- [ ] `P6-11` Canvas evidence, repo-wide checks and the web-app stage report — status: `pending` — owner: —
- [ ] `P0-48` Live demo: visible selection frame, delete that works — status: `pending` — owner: —

<!-- polier:claims -->
## Claims

- `P0-47` in progress by dsh since 2026-10-29T00:07:27+00:00 — worktree: /Users/rasulatashev/Desktop/KI Projekte/Project air-P0-47 · slot 4
- `P0-48` in progress by dsh since 2026-10-29T00:09:33+00:00 — worktree: /Users/rasulatashev/Desktop/KI Projekte/Project air-P0-48 · slot 5
- `P6-08` in progress by dsh since 2026-10-29T00:06:24+00:00 — worktree: /private/tmp/air-P6-08 · slot 3

<!-- /polier:claims -->

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
- 2026-10-28 `ADR-0011` CRDT: Yjs behind an own interface (`docs/adr/ADR-0011-crdt.md`)
- 2026-10-28 `ADR-0012` The SDK owns the client-side board document (`docs/adr/ADR-0012-sdk-client-document.md`)
- 2026-10-29 `ADR-0013` Web app stack: React + Vite SPA with an own editor (`docs/adr/ADR-0013-web-app-stack.md`)
- 2026-10-28 `ADR-0014` Edges below zones (`docs/adr/ADR-0014-edges-below-zones.md`)

## Open questions

- `Q1` Product name (working title: Project air) (needed before stage: v1). — blocks: — — status: `open`
- `Q3` Hosting provider and country (CH/EU). — blocks: P0-15 — status: `open`
- `Q8` Which import formats, after a legal check of their terms (needed before stage: value). — blocks: — — status: `open`
- `Q9` Pricing model for v1 (needed before stage: v1). — blocks: — — status: `open`
- `Q14` English visible at launch or prepared only; who translates further languages (needed before stage: v1). — blocks: — — status: `open`
