# Handoff — Project air, new session

**As of:** 2026-10-25 21:10 (Europe/Zurich) · **Repository:** `/Users/rasulatashev/Desktop/KI Projekte/Project air` · **Base branch:** `main` · **Nothing pushed** (`origin/main` is still the scaffold).

Read `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md` and the task brief before working. Polier is pinned to v1.0.0: `export POLIER=/Users/rasulatashev/Desktop/Polier-main` then `bash tools/polier.sh --check`.

## State

- **Stage 1 Foundation:** complete, owner decision `continue`.
- **Stage 2 Contract:** complete, owner decision `continue`; contract `0.1.0` (16 schema files, fixtures/sync/api corpora, TS+C++ codegen/parity), `docs/contracts.md`, ADR-0005, `board.contracts[]`, Contract overview in the preview.
- **Stage 3 Engine spike:** complete, owner decision `continue`; C++20 core (doc/camera/spatial/render command buffer), WebGL2 instanced renderer, TS bridge `@project-air/engine`, `apps/engine-playground`, ADR-0006 + `docs/engine.md`; CMake 4.4.4 + Emscripten 6.0.13; WASM 49,925 B raw / 21,806 B gzip. Measured on the Mac mini M2 8 GB proxy: p95 2.00 ms (556 fps unlocked frame production), display-locked control p95 16.80 ms. **D8 caveat:** the MacBook Air M1 8 GB reference is unproven — re-measure before treating the hardware target as met.
- **Stage 4 Backend core:** complete, owner decision `continue`; tasks `P3-01` … `P3-06` done. `services/platform` + `services/auth`, self-hosted Ory Kratos v26.2.0 (ADR-0007; `identity` profile, Mailpit courier, test-session mode for tests, admin API bound to localhost), PostgreSQL migrations `0001`–`0004` with RLS and contract-valid account-id mapping, 20 `/v1` contract routes + `GET /v1/session`, typed SDK `@project-air/sdk`, `api-tests` 32, `rls-tests` 7, platform unit 74, acceptance script `PASS backend-core acceptance`; ADR-0008 (API/session model).
- **Done overall:** 37 of 41 tasks. Open only the remote-phase tasks `P0-02`, `P0-15`, `P0-16`, `P0-17` (stage remote, after hardening) plus planning of the later stages (engine-core, realtime, web-app, value, hardening).
- **Preview:** `apps/web/preview/` has the permanent Contract 0.1.0 overview as section 02 and the live two-note demo; its screenshots and README are the demo-cadence baseline (`reviews/evidence/P1-07-*`).
- **Checks:** `check.py` exit 0 (2 warnings: `budgets.status` override, P0-02 context pack), `boundaries.py` exit 0, `contracts.py check` exit 0, `design-check` exit 0, `language-check` OK, contract unit suite 88/88, engine CTest 2/2, `codegen`/`wasm-*` clean; DB suites need a Polier slot (they cannot run in the main checkout).
- **Reviews:** `reviews/P1-04.md` … `reviews/P3-06.md` committed; verdicts and findings are in the files.

## Backend-core follow-ups (recorded, not blockers)

- Member/invitation routes were out of stage scope; the schema and auth invitations exist, the platform route and SDK methods come with the web stage.
- Account ids: the contract needs UUIDv7; a real Kratos identity is UUIDv4 and is mapped to a platform v7 account (`profiles.kratos_identity_id`, `GET /v1/session` exposes the mapped id). Legacy non-v7 `account_id`s must be remapped transactionally before importing historical rows.
- SDK packaging: `dist/sdk/src/index.js` layout lacks declarations/types for a TS consumer — fix before `apps/web` imports the package.
- RLS suite imports the API test helper for the reset; move the reset helper to `test/helpers/` before parallel suites.
- Production database roles: the Compose superuser owns the schema; production needs a dedicated non-superuser table owner and a BYPASSRLS owner for the SECURITY DEFINER helpers (documented in 0003/0004/ADR-0008).
- Kratos hardening: admin API needs a network/proxy boundary (it has no built-in auth), 24 h sessions vs ADR-0007's short-lived sessions, committed fallback cookie/cipher secrets and the slot-1 browser URLs in `kratos.yml` need cleanup, 405/413/415 use the nearest contract codes, no `cache-control: no-store` yet, and the `.env` loader for the auth process is documented only in READMEs.

## Contract open points (documented in `docs/contracts.md`)

- The GET `requestId` transport is resolved (`?requestId=`/`x-request-id`; mutations in the body).
- Contract version is negotiated once per connection (`hello`/`welcome`), while the owner blueprint §5.1 asks for a version field on every message.
- A fresh board's `serverSeq` bootstrap (0 vs 1) and a from-0 catch-up fixture are undefined.
- The session test does not enforce `hello`-first; the reconnect wrong-order fixture is only asserted weakly; `snapshotRef` `<boardId>:<serverSeq>` consistency is not cross-checked.

## Environment

- Docker Desktop (context `desktop-linux`) is the local runtime. The shared stack is `docker compose -f infra/compose/compose.yaml up -d --wait` (postgres, seaweedfs, mailpit); Kratos runs with `--profile identity up -d --wait` on host ports 8433 (public) / 8434 (admin, localhost only). It is currently running.
- `tools/dev/setup` creates the slot database, the restricted `app_user`, the shared `projectair_kratos` database and bucket; `tools/dev/reset-db` resets the slot DB and migrates. Secrets live in the gitignored `infra/compose/.env` (names only in `.env.example`).
- Backend dev loop: `pnpm install --frozen-lockfile`, `bash tools/dev/setup`, `bash tools/dev/reset-db`, start `node services/auth/src/index.ts` and `node services/platform/src/index.ts` with the slot env; `node tools/dev/acceptance-backend.mjs` is the self-contained stage acceptance.
- Board-check must run **before** `pnpm install` (it scans `node_modules/`).
- Engine toolchain: Apple clang plus CMake 4.4.4/Emscripten 6.0.13 via Homebrew (pinned in `docs/versions.md`); always build WASM through `bash packages/engine/tools/build-wasm.sh`.
- Perf measurement: Chrome for Testing 156.0.8078.4 from the Playwright cache with `--headless=new --use-angle=metal --enable-gpu` (real ANGLE Metal GPU); the harness rejects software renderers.
- Disk: ~19 GiB free (freed during the backend stage). Still clean `node_modules/`, build dirs, `dist/` and `/tmp` after each task.

## Next steps

1. Owner decision for **stage 5 engine-core**, then plan the stage: the engine module list from `docs/engine.md`, the full canvas-catalogue engine entries (L01 target: 10,000 objects at 60 fps, no long task over 16 ms; the spike caveat above stays), WebGPU behind the command-buffer interface, the engine-playground showcase, and the `perf` gate. Q4 (CRDT) is needed before realtime; Q15/Q16/Q17 stay open.
2. Then realtime (Q4), web-app (first real client of `packages/sdk`, fix its packaging first), value (imports/AI, Q8), hardening, and only at the very end the remote phase (`P0-02`, `P0-15`, `P0-16`, `P0-17`, GitHub/CI/branch protection/release, ADR-0003).
3. Before any contract change: bump the version in `board.contracts[]`, every schema `$id` and the root `contractVersion` in the same task, add valid+invalid fixtures, regenerate codegen, keep TS/C++ parity green, update `docs/contracts.md`, run the `contracts` gate.
4. Keep the demo cadence: every preview or design-system change updates the Contract overview, the live demo and its screenshots in the same task.

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
- `Q5` self-hosted Ory Kratos, community edition only, auth UI built by us (ADR-0007); `Q6` reference hardware MacBook Air M1, 8 GB, Chrome (local M2 proxy accepted); `Q7` agents under close guidance; `Q18` 50k@60fps for the spike, catalogue L01 for engine-core.
- `ADR-0002` local-first until the GitHub switch; `ADR-0003` remote stage after hardening, before v1; `ADR-0004` contract limits/visibility; `ADR-0005` contract source of truth; `ADR-0006` engine architecture; `ADR-0008` API/session model.
- Still open: Q3 hosting (tendency Infomaniak Public Cloud CH/EU; decision at P0-15), Q1 domain (contract base URI placeholder), Q4 CRDT (before realtime), Q8 import formats, Q9 pricing, Q14 languages, Q15/Q16/Q17 engine behaviour.

## New session prompt

> Lies `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md` und `HANDOFF.md`. Foundation, Contract, Engine-Spike und Backend-Core sind lokal fertig (37/41 Tasks; Engine-Spike-M1-Referenz noch offen; Kratos selbst gehostet nach ADR-0007). Kläre mit mir die Eigentümer-Entscheidung für Stage 5 `engine-core` und plane die Stage: Canvas-Katalog L01/Engine-Einträge, WebGPU hinter dem Command-Buffer, Engine-Playground, `perf`-Gate; danach die erste Aufgabe starten. Lokal arbeiten, nichts pushen.
