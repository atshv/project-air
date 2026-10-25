# Handoff — Project air, new session

**As of:** 2026-10-25 17:00 (Europe/Zurich) · **Repository:** `/Users/rasulatashev/Desktop/KI Projekte/Project air` · **Base branch:** `main` · **Nothing pushed** (`origin/main` is still the scaffold).

Read `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md` and the task brief before working. Polier is pinned to v1.0.0: `export POLIER=/Users/rasulatashev/Desktop/Polier-main` then `bash tools/polier.sh --check`.

## State

- **Stage 1 Foundation:** complete, owner decision `continue`.
- **Stage 2 Contract:** complete, owner decision `continue`; contract `0.1.0` (16 schema files, fixtures/sync/api corpora, TS+C++ codegen/parity), `docs/contracts.md`, ADR-0005, `board.contracts[]`, Contract overview in the preview.
- **Stage 3 Engine spike:** complete, owner decision `continue`; tasks `P2-01` … `P2-05` done. C++20 core (doc/camera/spatial/render command buffer), WebGL2 instanced renderer, TS bridge `@project-air/engine`, `apps/engine-playground`, ADR-0006 + `docs/engine.md`. Toolchain pinned: CMake 4.4.4, Emscripten 6.0.13. WASM 49,925 B raw / 21,806 B gzip (budget 300 KiB). Measured on the Mac mini M2 8 GB proxy: p50 1.80 / p95 2.00 / p99 2.20 ms, mean 556.1 fps unlocked frame production; display-locked control p95 16.80 ms. **D8 hardware caveat:** the MacBook Air M1 8 GB reference is unproven — re-measure there before treating the hardware target as met.
- **Done overall:** 31 of 35 tasks. Open only the remote-phase tasks `P0-02`, `P0-15`, `P0-16`, `P0-17` (stage remote, after hardening) plus planning of later stages (backend-core, engine-core, realtime, web-app, value, hardening).
- **Stage 4 Backend core:** not planned yet; the owner decision is `pending`, and Q5 (auth: build it ourselves or self-host an open-source server) must be answered before planning its tasks.
- **Contract 0.1.0:** three schema families, 16 schema files — board-content (10 top-level schemas), sync protocol (`schemas/sync/sync.schema.json`, 12 message types 6+6), REST API (`schemas/api/`, 4 resources × 7 envelopes + errors, 7 UPPER_SNAKE codes mapped to `errors.<camelCase>` keys). Fixtures: `fixtures/` 77 (32 valid/45 invalid) with the TS+C++ parity harness, `fixtures-sync/` 14/20, `fixtures-api/` 35/20, `fixtures-gate/` 2 Polier gate specimens. `board.contracts[]` declares `project-air-contract` 0.1.0 / `fixtures-gate` / empty dependants. Docs: `docs/contracts.md`, `docs/adr/ADR-0005-contract.md`. Logical tag `contracts@0.1.0` (no git tag until the remote phase, ADR-0002/0003).
- **Preview:** `apps/web/preview/` has the permanent Contract 0.1.0 overview as section 02 (facts, schema families/corpora, 19 operation chips, 6+6 sync messages, 7 code→key rows, parity/codegen proof, cadence line, doc/ADR links) above the design sections; the live two-note demo is unchanged. Evidence `P1-07-desktop.png`, `P1-07-mobile.png`, `P1-07-contract.png`, `P1-07-preview.log`.
- **Checks:** `check.py` exit 0 (2 warnings: `budgets.status` override, P0-02 context pack), `boundaries.py` exit 0, `contracts.py check` exit 0, `design-check` exit 0, `language-check` OK, contract unit suite 88/88, `codegen` clean, worktrees clean.
- **Reviews:** `reviews/P1-04.md` … `reviews/P1-07.md` committed; all four verdicts pass, findings fixed or recorded as open points.

## Contract open points (documented in `docs/contracts.md`; settle before realtime/SDK)

- GET carries no body: `requestId` transport is the response envelope (header/query decision for the SDK).
- Contract version is negotiated once per connection (`hello`/`welcome`), while the owner blueprint §5.1 asks for a version field on every message.
- A fresh board's `serverSeq` bootstrap (0 vs 1) and a from-0 catch-up fixture are undefined.
- The session test does not enforce `hello`-first; the reconnect wrong-order fixture is only asserted weakly; `snapshotRef` `<boardId>:<serverSeq>` consistency is not cross-checked.

## Environment

- Docker Desktop (context `desktop-linux`) is the local runtime; the compose stack is started/stopped with `docker compose -f infra/compose/compose.yaml up -d --wait` / `down`.
- The design preview is served from the main checkout on port 4000: `python3 -m http.server 4000` in the repo root → `http://127.0.0.1:4000/apps/web/preview/`. Worktree slots use their own web port from `.polier-slot`.
- Board-check must run **before** `pnpm install` (it scans `node_modules/`).
- Local C++ compiler: Apple clang (`clang++`); CMake 4.4.4 and Emscripten 6.0.13 are installed via Homebrew (pinned in `docs/versions.md`; always build WASM through `bash packages/engine/tools/build-wasm.sh`). The engine gates are `cpp-unit`, `wasm-build` (build + Node smoke), `wasm-size`, `perf-baseline`.
- Perf measurement: Chrome for Testing 156.0.8078.4 from the Playwright cache with `--headless=new --use-angle=metal --enable-gpu` (real ANGLE Metal GPU); the harness detects and rejects software renderers. The disk is nearly full (~1.9 GiB free): clean `node_modules/`, `packages/engine/build*`, `dist/` and `/tmp` after each task, and keep additions small.
- The preview has no build step, no fetch and no server; screenshots use the local Chromium headless shell from the Playwright cache.

## Next steps

1. Owner decision for **stage 4 backend-core**: answer Q5 (auth) and set the stage decision to `continue`; then plan the stage (API tests + RLS tests, PostgreSQL migrations, compose stack, `packages/sdk`) and write the first briefs. Q6/Q7/Q18 are answered; the engine-spike D8 hardware caveat (M1 unproven) stays recorded.
2. Later stages: engine-core (canvas catalogue L01 full target), realtime (Q4 CRDT), web-app, value, hardening. The remote phase (`P0-02`, `P0-15`, `P0-16`, `P0-17`, GitHub/CI/branch protection/release) stays at the very end before v1 (ADR-0003).
2. Before any contract change: bump the version in `board.contracts[]`, every schema `$id` and the root `contractVersion` in the same task, add valid+invalid fixtures, regenerate codegen, keep TS/C++ parity green, update `docs/contracts.md`, run the `contracts` gate.
3. Keep the demo cadence: every preview or design-system change updates the Contract overview, the live demo and its screenshots in the same task.
4. The remote phase (`P0-02`, `P0-15`, `P0-16`, `P0-17`, GitHub/CI/branch protection/release) stays at the very end before v1 (ADR-0003).

## Standard task loop

```
export POLIER=/Users/rasulatashev/Desktop/Polier-main
python3 $POLIER/tools/worktree.py start <ID> --root . --session lead --harness dsh
# set task in_progress in board.json, render_status.py, commit "chore: start <ID>"
# worker implements the brief in the worktree
cd <worktree>; bash tools/polier.sh --check; python3 $POLIER/tools/gate.py --task <ID> --name <gate> --shell "<command>"
# independent review -> reviews/<ID>.md, fix findings before the merge
# lead: squash-merge, board status done + evidence + handoff, render_status, check.py,
#       worktree.py finish <ID>, amend the one task commit, verify main
```

Rules: one commit per task (`<ID>: <title>`), change entry in `.changes/` (`pnpm run change -- …`), gates via `gate.py`, evidence in `reviews/evidence/`, no push/tag/PR, no new dependencies without owner approval.

## Owner decisions recorded

- `Q2` pnpm workspaces + Turborepo; `Q10` SemVer `0.0.1` + letter entries; `Q11` no AI release notes for now; `Q12` ICU message files now, library later; dev tools + GitHub Actions approved.
- `ADR-0002` local-first until the GitHub switch; `ADR-0003` remote stage after hardening, before v1; `ADR-0004` contract text limits (320/80/120/200/300) and visibility `private`/`workspace`/`link` (link read-only, revocable); `ADR-0005` contract is schema-first, versioned, with fixtures, deterministic TS/C++ codegen and a parity harness.
- Still open for later: Q3 hosting (before remote release), Q1 domain (contract base URI is a placeholder), Q6/Q7 engine (before engine-spike), Q15/Q16/Q17/Q18 engine behaviour questions.

## New session prompt

> Lies `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md` und `HANDOFF.md`. Foundation, Contract und Engine-Spike sind lokal fertig (31/35 Tasks, Engine-Spike mit gemessenem Report und ADR-0006; M1-Referenz noch offen). Kläre Q5 (Auth) mit mir, setze die Eigentümer-Entscheidung für die Stage 4 `backend-core` und plane die Stage: Aufgaben, Briefs, `api-tests`/`rls-tests`-Gates, PostgreSQL/RLS und Compose-Stack. Lokal arbeiten, nichts pushen.
