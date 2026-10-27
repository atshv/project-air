# Handoff — Project air, new session

**As of:** 2026-10-27 12:00 (Europe/Zurich) · **Repository:** `/Users/rasulatashev/Desktop/KI Projekte/Project air` · **Base branch:** `main` · **Pushed:** `origin/main` now tracks `main` (owner request 2026-10-25, after the stage-5 plan); the remote commit `30626f0` (branding fix in `reference/`) was merged first with `fccf5c5`. The remote stage (`P0-02` branch protection, CI, release) is still pending.

Read `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md` and the task brief before working. Polier is pinned to v1.0.0: `export POLIER=/Users/rasulatashev/Desktop/Polier-main` then `bash tools/polier.sh --check`.

## State

- **Stage 1 Foundation:** complete, owner decision `continue`.
- **Stage 2 Contract:** complete, owner decision `continue`; contract `0.1.0` (16 schema files, fixtures/sync/api corpora, TS+C++ codegen/parity), `docs/contracts.md`, ADR-0005, `board.contracts[]`, Contract overview in the preview.
- **Stage 3 Engine spike:** complete, owner decision `continue`; C++20 core (doc/camera/spatial/render command buffer), WebGL2 instanced renderer, TS bridge `@project-air/engine`, `apps/engine-playground`, ADR-0006 + `docs/engine.md`; CMake 4.4.4 + Emscripten 6.0.13; WASM 49,925 B raw / 21,806 B gzip. Measured on the Mac mini M2 8 GB proxy: p95 2.00 ms (556 fps unlocked frame production), display-locked control p95 16.80 ms. **D8 caveat:** the MacBook Air M1 8 GB reference is unproven — re-measure before treating the hardware target as met.
- **Stage 4 Backend core:** complete, owner decision `continue`; tasks `P3-01` … `P3-06` done. `services/platform` + `services/auth`, self-hosted Ory Kratos v26.2.0 (ADR-0007; `identity` profile, Mailpit courier, test-session mode for tests, admin API bound to localhost), PostgreSQL migrations `0001`–`0004` with RLS and contract-valid account-id mapping, 20 `/v1` contract routes + `GET /v1/session`, typed SDK `@project-air/sdk`, `api-tests` 32, `rls-tests` 7, platform unit 74, acceptance script `PASS backend-core acceptance`; ADR-0008 (API/session model).
- **Stage 5 Engine core:** planned and in progress, owner decision `continue`; 28 tasks `P4-01` …
  `P4-28` in five waves (measurement/gates, drawing + WebGPU, interaction, zones, final proof);
  `P4-01` (engine document, hit testing), `P4-02` (test-kit scenes, interactive playground) and
  `P4-03` (perf gate + L01 basis) are done and merged. **`P4-04` (visual gate) is in progress and
  blocked on nothing:** its worktree is at `/private/tmp/air-P4-04` (branch `task/P4-04`, commit
  `692529c`, visual gate PASS, clean), but it still needs an independent review and the merge; the
  previous session stopped there. Briefs are written through `P4-07` (JIT). Stage target: 10,000 objects at 60 fps, no frame above 16 ms while
  panning/zooming (`perf`, M2 proxy), engine entries L01–L03, L07, L08, L10–L14, L16–L20 and the
  desktop part of L15, WebGPU behind the command buffer as second backend, reference images green
  (`visual`, both viewports, both backends). ADR-0009 (text/overlay strategy) is recorded.
- **Done overall:** 45 of 69 tasks. Open: the rest of stage 5 plus the remote-phase tasks `P0-02`,
  `P0-15`, `P0-16`, `P0-17` (stage remote, after hardening) and the planning of the later stages
  (realtime, web-app, value, hardening).
- **Preview:** `apps/web/preview/` has the permanent Contract 0.1.0 overview as section 02 and the live demo: top-centre ten-tool toolbar and a zone with notepad + image window (P0-26), **bilingual EN/DE with a themed top-right switch** via `apps/web/preview/locales/{en,de}.json` (all visible text/aria/alt; 260 identical keys; `<html lang>`, localStorage persistence, safe fallback) (P0-27), **zone items that can be dragged out onto the canvas and docked back** with a 28 px progressive detach animation, 8 px dock hysteresis, grid-snap, no edge connection, reduced-motion (P0-28); **when both items are out the empty zone fades/scales away and becomes hidden/inert, and dragging the two free items together (≥25 % overlap or ≤48 px centres) groups them into a newly animated zone** that re-orients/re-fits on resize, plus refined spring motion and a smaller zoom pill (36×104, 32 px buttons) (P0-29); **zone layout follows the drop (side by side or stacked), docked items can be reordered/swapped inside the zone, drags track the pointer 1:1 with commit-on-release (no magnetism) and the +/−/fit controls are smaller (32×96 pill, 28 px painted, 32 px hit, 12 px glyphs)** (P0-30). **Cache rule:** every preview change bumps `?v=` on `tokens.css`/`preview.css`/`preview.js` in `index.html`; locale fetches inherit the script version. A cached `index.html` may still need one hard reload (an old HTML document cannot reference the new CSS). Demo-cadence baseline screenshots: `P0-27-*` (desktop/mobile EN+DE, owner 1426×583 DPR2) `P0-28-*` (docked/mid-detach/detached/redocked) `P0-29-*` (zone fading/overlap/grouped/zoom/mobile/resize/toolbar) and `P0-30-*` (horizontal/vertical/swapped/drop-hint/controls/masthead/zoom-150).
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
- DSH sessions: Chrome does not start inside the default workspace sandbox (sandbox init denied). The `perf`/`visual` gates need a one-shot wider approval or a run outside that sandbox; never replace the evidence with a screenshot from another build.
- Disk: ~19 GiB free (freed during the backend stage). Still clean `node_modules/`, build dirs, `dist/` and `/tmp` after each task.

## Next steps

1. **First resume `P4-04`** (visual gate): the task is implemented and committed in `/private/tmp/air-P4-04` but unreviewed/unmerged, and the board still lists it `in_progress`; get an independent review, merge, mark done, then finish the worktree. Then continue **stage 5 engine-core** in waves: (1) `P4-05` operation/undo seam; (1) `P4-06` L13, `P4-07` L19, `P4-08`/`P4-09` L02 text atlas + glyph layout, `P4-10` L02 titles/visible quality, `P4-11`/`P4-12` WebGPU pipeline + fallback, `P4-13` WebGPU switch + two-backend visual; (2) `P4-14` L03, `P4-15` L07, `P4-16` L10, `P4-17` L14, `P4-18` L16, `P4-19` L20, `P4-20` L12, `P4-21` L11, `P4-22` L17, `P4-23` L18, `P4-24` L15 desktop; (3) `P4-25`/`P4-26`/`P4-27` L08 contract, database, engine; (4) `P4-28` L01 final proof + stage showcase. Only the next briefs exist (JIT, `P4-01` … `P4-05`).
2. Then realtime (Q4), web-app (first real client of `packages/sdk`, fix its packaging first), value (imports/AI, Q8), hardening (M1 reference measurement, images, a11y mirror, touch), and only at the very end the remote phase (`P0-02`, `P0-15`, `P0-16`, `P0-17`, GitHub/CI/branch protection/release, ADR-0003).
3. Before any contract change: bump the version in `board.contracts[]`, every schema `$id` and the root `contractVersion` in the same task, add valid+invalid fixtures, regenerate codegen, keep TS/C++ parity green, update `docs/contracts.md`, run the `contracts` gate. The first one is the zones parent reference in `P4-23` (0.1.0 -> 0.2.0).
4. Keep the demo cadence: every preview or design-system change updates the Contract overview, the live demo and its screenshots in the same task; the engine playground showcase comes with `P4-02` and `P4-25`.

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

Rules: one commit per task (`<ID>: <title>`), change entry in `.changes/` (`pnpm run change -- …`), gates via `gate.py`, evidence in `reviews/evidence/`, no push/tag/PR without owner approval (owner approved pushing `main` on 2026-10-25; task branches stay local until the merge), no new dependencies without owner approval.

- `reference/` was edited remotely in `30626f0` (branding); the rules keep `reference/` read-only, the change is integrated as-is in `fccf5c5` — the owner decides whether to revert it before the remote stage.

- DSH sandboxed sessions cannot create the default sibling worktree (`../<repo>-<ID>` lies outside the workspace). Create it under `/tmp/air-<ID>` (`git worktree add /tmp/air-<ID> -b task/<ID> main`), acquire the slot there (`python3 $POLIER/tools/slot.py acquire`), take the claim with `--worktree /private/tmp/air-<ID> --slot N`, store that absolute path in `board.json`; `worktree.py finish <ID>` accepts the stored absolute path.

## Owner decisions recorded

- `Q2` pnpm workspaces + Turborepo; `Q10` SemVer `0.0.1` + letter entries; `Q11` no AI release notes for now; `Q12` ICU message files now, library later; dev tools + GitHub Actions approved.
- `Q5` self-hosted Ory Kratos, community edition only, auth UI built by us (ADR-0007); `Q6` reference hardware MacBook Air M1, 8 GB, Chrome — M2 proxy accepted for the local engine-core exit, M1 re-measured in hardening; `Q7` agents under close guidance; `Q18` 50k@60fps for the spike, catalogue L01 (10,000 objects) for engine-core.
- `Q15` clear layers only, no collision nudge; `Q16` two fingers pan, pinch zooms, Cmd/Ctrl+wheel zooms; `Q17` zones are containers (contract 0.2.0 parent reference, ADR + migration, no nested zones); `Q19` WebGL2 stays the measured default, WebGPU is the second backend with fallback and a two-backend image comparison; `Q20` images with detail levels and the a11y/test mirror move to hardening/web-app, the L15 touch part stays with hardening.
- 2026-10-25: owner approved the first push to `origin/main`; this is the GitHub switch in part (ADR-0002), while branch protection, CI and release remain the remote stage (`P0-02`, `P0-15` … `P0-17`).
- `ADR-0002` local-first until the GitHub switch; `ADR-0003` remote stage after hardening, before v1; `ADR-0004` contract limits/visibility; `ADR-0005` contract source of truth; `ADR-0006` engine architecture; `ADR-0008` API/session model.
- Still open: Q3 hosting (tendency Infomaniak Public Cloud CH/EU; decision at P0-15), Q1 domain (contract base URI placeholder), Q4 CRDT (before realtime), Q8 import formats, Q9 pricing, Q14 languages.

## New session prompt

> Lies `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md` und `HANDOFF.md`. Foundation, Contract, Engine-Spike, Backend-Core sind fertig; die Preview ist zweisprachig (DE/EN) mit Toolbar/Zone-Demo, Raus-/Reinziehen, Collapse/Re-Grouping, placementsabhängigem horizontalem/vertikalem Zonen-Layout, Reorder/Swap und kleineren Controls (P0-26…P0-30). Stage 5 `engine-core` läuft: P4-01…P4-03 sind gemergt, `P4-04` ist implementiert (in `/private/tmp/air-P4-04`), aber noch nicht reviewed/gemergt. Setze `P4-04` fort (Review, Merge, Worktree aufräumen) und arbeite die Stage-5-Wellen nach `HANDOFF.md` ab; Engine-Spike-M1-Referenz bleibt offen. Lokal arbeiten; `main` ist auf `origin/main`, Task-Branches bleiben lokal bis zum Merge.
