# Quality: Project air

## Definition of done (stage foundation)

Product-level items for later stages (contract, engine, backend, realtime, web, value, hardening,
v1) are added as D7 … when those stages are planned in detail.

- **D1** Workspace and package map: every `packages[]` folder exists with a README, stage-1
  packages have an `ARCHITECTURE.md`, the workspace installs reproducibly and every tool version
  is pinned in `docs/versions.md`.
- **D2** Parallel agents cannot collide: each worktree gets its own ports, database and bucket from
  `.polier-slot`; local services start with one command; local sessions and CI use Polier at the
  board's `generator_version`; two e2e runs wait for each other.
- **D3** Design is enforced: design rules and the canvas acceptance catalogue exist for this
  project, tokens generate CSS and a C++ header, and `design-check` rejects raw colours, off-grid
  spacing, unknown z-index and missing UI evidence.
- **D4** Language is enforced: German and English message files share the same English keys and
  `language-check` rejects German in code, UI text outside message files and `ß` in German text.
- **D5** Changes and releases: every code change carries a `.changes` entry, CHANGELOG.md starts
  at 0.0.1, releases are built by CI from a tag of a clean `main`, and release 0.0.1 plus one
  preview ran end to end with a smoke check.
- **D7** Contract (stage contract): the board-content model and its operations are versioned JSON
  Schema with valid and invalid fixtures; TypeScript and C++ read the same fixtures identically;
  the contract is tagged `0.1.0` and documented in `docs/contracts.md` with an ADR.
- **D8** Engine spike (stage engine-spike): the C++20 engine builds natively and to WebAssembly with
  the pinned CMake/Emscripten toolchain (`cpp-unit` and `wasm-build` green); 50,000 rectangles
  render at 60 fps on the reference hardware (MacBook Air M1, 8 GB, Chrome), the WASM artifact
  stays within 300 KiB gzip, and a measured performance report plus an ADR for the engine
  architecture exist.
- **D9** Backend core (stage backend-core): PostgreSQL migrations create the workspace/board/note/card
  schema and row-level security protects every workspace; the platform API serves those resources
  with allow-and-deny tests for every route (`api-tests`); `rls-tests` prove a second account sees
  nothing; a typed SDK script creates account, workspace, board and note; sessions come from the
  self-hosted Ory Kratos (ADR-0007).
- **D10** Engine core (stage engine-core): the playground shows a deterministic board with 10,000
  objects at 60 fps and no frame interval above 16 ms while panning and zooming (`perf`, measured on
  the documented M2 proxy until the M1 reference is re-measured in hardening); every engine entry of
  the canvas work orders has its engine-owned acceptance evidenced, and the reference images are
  green at 1440x900 and 390x844 for WebGL2 and WebGPU (`visual`); the engine renders titles and
  previews from tokens, every content gesture is one contract operation with its inverse, and WebGPU
  runs behind the command-buffer interface with a WebGL2 fallback.
- **D11** Realtime (stage realtime): `services/sync` persists every acknowledged operation in
  PostgreSQL before the ack, broadcasts CRDT updates and compacts the log into snapshots; presence
  (cursor, selection, name, colour) stays ephemeral; two offline clients converge after reconnect
  and a service restart loses no acknowledged change; 25 clients per board are served at p95 <= 150 ms
  (`load`) and 10,000 randomized convergence rounds run without divergence (`crdt-convergence`);
  `packages/crdt` keeps the CRDT library behind its own `BoardDoc` interface (Yjs, MIT, ADR-0011) and
  the SDK exposes one autosave path with status and sequence numbers (L05 realtime half).
- **D12** Web app (stage web-app): the product runs in `apps/web` on the SDK, engine and sync —
  login and boards list over the platform API, the board page with engine, toolbar/zoom, context
  menu/keyboard, panel with the own editor and title, live remote changes/presence and the L05 save
  status; the main e2e flows are green on a preview environment (`e2e`), every remaining canvas work
  order of the web phase has evidence, and `design-check` plus `language-check` are green repo-wide
  (React + Vite SPA, own editor, ADR-0013).
- **D6** Repository discipline: `main` accepts changes only through pull requests with green CI and
  one review; CI runs scope check, boundaries, board check, lint and typecheck on every pull
  request.

## Gates

`$POLIER` is a checkout of Polier `v1.0.0`. Commands marked `[VERIFY: …]` are fixed by the named
task from the project's manifests; until then the gate cannot pass.

| Gate | Command | Expected |
|---|---|---|
| `board-check` | `python3 $POLIER/tools/check.py .` (before `pnpm install`, see below) | exit 0 |
| `boundaries` | `python3 $POLIER/tools/boundaries.py .` | exit 0, no forbidden import |
| `branch-protection` | `gh api repos/atshv/project-air/branches/main/protection` | exit 0, required checks and reviews listed |
| `install` | `pnpm install --frozen-lockfile` | exit 0, lockfile unchanged |
| `unit` | `pnpm test` (root, affected packages) | exit 0, all tests pass |
| `compose-config` | `docker compose -f infra/compose/compose.yaml config --quiet` | exit 0, four services with health checks; Kratos runs behind the `identity` profile |
| `dev-setup` | `python3 $POLIER/tools/slot.py acquire && bash tools/dev/setup` | exit 0, slot database and bucket created |
| `ci-local` | `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest` | exit 0, no workflow findings |
| `ci-green` | `gh run list --workflow ci.yml --limit 1 --json conclusion --jq '.[0].conclusion'` | `success` |
| `polier-version` | `bash tools/polier.sh --check` | exit 0, Polier version equals `generator_version` |
| `tokens-codegen` | `pnpm --filter ./packages/ui-kit run codegen && git diff --exit-code -- packages/ui-kit` | exit 0, CSS, C++ header and layers regenerated without diff |
| `design-check` | `node tools/design-check/index.mjs .` | exit 0 |
| `language-check` | `node tools/language-check/index.mjs .` | exit 0 |
| `changelog-entry` | `node tools/release/check-changes.mjs --task <ID> --base main` | exit 0, entry present for code changes |
| `release-dry` | `[VERIFY: set by P0-15, release command in dry-run mode]` | exit 0, version and entries shown, nothing changed |
| `smoke` | `python3 $POLIER/tools/smoke.py --url <environment-url> --expect-status 200 --path /` | exit 0, `SMOKE OK` |
| `release` | `python3 $POLIER/tools/release_check.py .` | exit 0 on a tag of `main` |
| `contracts` | `python3 $POLIER/tools/contracts.py check` | exit 0 |
| `codegen` | `pnpm --filter ./packages/contracts run codegen && git diff --exit-code -- packages/contracts` | exit 0, generated TS/C++ unchanged |
| `cpp-unit` | `cmake -S packages/engine -B packages/engine/build -DCMAKE_BUILD_TYPE=Debug && cmake --build packages/engine/build --parallel && ctest --test-dir packages/engine/build --output-on-failure` | exit 0, "100% tests passed" |
| `wasm-build` | `bash packages/engine/tools/build-wasm.sh && node packages/engine/tools/wasm-smoke.mjs` | exit 0, `engine.wasm` and `engine.js` written, Node smoke passes |
| `wasm-size` | `node packages/engine/tools/wasm-size.mjs` | exit 0, gzip size <= 307200 bytes (300 KiB); P2-04 records the measured size |
| `perf-baseline` | `node packages/engine/test/perf/run-perf.mjs` | exit 0, p95 frame time <= 16.7 ms at 50,000 rectangles, real GPU renderer recorded, JSON evidence written (exclusive; see `docs/gates/perf.md`) |
| `perf` | `node packages/engine/test/perf/run-perf.mjs --scenario engine-core` | exit 0, 10,000 objects p95 <= 16.7 ms with continuous pan/zoom and no frame interval above 16.7 ms, 500 cards + 50 zones final proof < 50 ms with the culling proof (>= 50 sampled cameras, 0 mismatches), p50/p95/p99/mean within basis + 10 % while the maximum frame duration is a 50 ms-bounded observation, real GPU recorded (exclusive; see `docs/gates/perf.md`) |
| `perf-final` | `node packages/engine/test/perf/run-perf.mjs --scenario engine-core` | exit 0, 10,000 objects p95 <= 16.7 ms with continuous pan/zoom and no frame interval above 16.7 ms, 500 cards + 50 zones final proof < 50 ms with the culling proof (>= 50 sampled cameras, 0 mismatches), p50/p95/p99/mean within basis + 10 % while the maximum frame duration is a 50 ms-bounded observation, real GPU recorded; the stage-exit final proof recorded by P4-28 against the committed basis (exclusive; see `docs/gates/perf.md`) |
| `db-migrate` | `node services/platform/dist/db/migrate.js` | exit 0, migrations applied to the slot database |
| `api-tests` | `node --test services/platform/test/api/*.test.mjs` | exit 0, every route has an allow and a deny case |
| `rls-tests` | `node --test services/platform/test/rls/*.test.mjs` | exit 0, a second account sees nothing (exclusive) |
| `crdt-convergence` | `node packages/crdt/test/convergence-harness.mjs && node --test --test-concurrency=1 packages/sdk/test/offline-undo.test.mjs && node services/sync/test/offline-browser.mjs` | exit 0, 30,000 rounds (3 seeds × 10,000) without divergence, two offline SDK clients converge, own-op undo, and two offline headless-Chrome pages converge (browser: true, wire log in evidence) — exclusive; see docs/gates/crdt-convergence.md |
| `load` | `node packages/sdk/test/load/run-load.mjs` | exit 0 (exclusive), 25 SDK clients on one board, >= 5,000 ops / >= 30 s window (warm-up 5 s), p95 send->ack <= 150 ms, 0 errors, exact client<->fresh-join convergence; 3 repetitions recorded (see docs/gates/load.md) |
| `visual` | `node packages/engine/test/visual/run-visual.mjs` | exit 0, every committed WebGL2 reference image at 1440x900 and 390x844 within tolerance, real GPU recorded, capture record and diff PNGs under `reviews/evidence/` (exclusive; WebGPU reference images follow with P4-11 — see `docs/gates/visual-diff.md`) |
| `visual-final` | `node packages/engine/test/visual/run-visual.mjs` | exit 0, the stage-exit final reference-image proof recorded by P4-28: every reference image at 1440x900 and 390x844 within tolerance for WebGL2 and WebGPU (see `docs/gates/visual-diff.md`) |
| `e2e` | see `docs/gates/playwright.md` `[VERIFY: stage web-app]` | exit 0 (exclusive) |
| `import-tests` | `[VERIFY: stage value]` | exit 0 |

`board-check` scans every `*.md` under the project root, including `node_modules/`. Run it before
`pnpm install` or remove `node_modules/` first; CI runs `board-check` before the install job (P0-08).
Third-party README links inside `node_modules/` are not project defects.

A gate passes when command, exit code and expected output match; the output is the evidence.
The task passes when all gates are green, every acceptance criterion is evidenced and the
reviewer gives `pass` with no blockers.

## Demo cadence

The owner wants to see the product after larger changes, not only at the end: build, show, continue.

- After every stage that produces UI or engine output, and after `P0-19` in foundation, build the
  runnable artifact, serve it locally on the worktree's slot ports, capture desktop (1440×900) and
  mobile (390×844) screenshots into `reviews/evidence/`, commit them and show them in the result.
- A small task inside a stage does not need its own demo; the stage showcase is enough.
- A demo supplements the gates, it does not replace them.
- The live two-note connection demo in `apps/web/preview/` stays permanently: every change to the
  preview or to the design system updates the demo and its screenshot in the same task.

## Review

- The reviewer is not the author and sees diff, acceptance criteria and gate records only.
- Every finding: `severity`, `file`, `line`, `criterion`, `issue`, `evidence`, `fix_hint`; results
  go to `reviews/<ID>.md`.
- A record with result `infra`, `busy` or `timeout` is not evidence.
- For UI paths the reviewer checks `docs/design-rules.md`; a value that is not a token is a finding.

## Human checklist per task

- [ ] Claim, slot and worktree taken; task set to `in_progress` by the lead.
- [ ] Gates actually run and output seen.
- [ ] Acceptance A1..An evidenced individually.
- [ ] Diff only within the task scope; `reference/` untouched.
- [ ] No tests changed without approval; no placeholders or TODOs.
- [ ] `STATUS.md` regenerated; commit `<ID>: <title>`.
