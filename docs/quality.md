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
| `compose-config` | `docker compose -f infra/compose/compose.yaml config --quiet` | exit 0, exactly the three services with health checks |
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
| `cpp-unit` | `ctest --test-dir packages/engine/build --output-on-failure` | exit 0, "100% tests passed" |
| `wasm-build` | `emcmake cmake -S packages/engine -B packages/engine/build-wasm -DCMAKE_BUILD_TYPE=Release && cmake --build packages/engine/build-wasm --parallel` | exit 0, `engine.wasm` and `engine.js` written |
| `wasm-size` | `node packages/engine/tools/wasm-size.mjs` | exit 0, gzip size <= 307200 bytes (300 KiB) |
| `perf-baseline` | `node packages/engine/test/perf/run-perf.mjs` | exit 0, p95 frame time <= 16.7 ms at 50,000 rectangles on the reference hardware (exclusive) |
| `perf` | see `docs/gates/load.md` `[VERIFY: stage engine-core]` | exit 0, within budget (exclusive) |
| `api-tests`, `rls-tests` | see `docs/gates/postgres.md` `[VERIFY: stage backend-core]` | exit 0 |
| `crdt-convergence` | `[VERIFY: stage realtime]` | exit 0, 10,000 rounds without divergence |
| `load` | see `docs/gates/load.md` `[VERIFY: stage realtime]` | exit 0 (exclusive) |
| `visual` | see `docs/gates/visual-diff.md` `[VERIFY: stage engine-core]` | exit 0, within tolerance |
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
