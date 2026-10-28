# Handoff — Project air, new session

**As of:** 2026-10-27 22:55 (Europe/Zurich) · **Repository:** `/Users/rasulatashev/Desktop/KI Projekte/Project air` · **Base branch:** `main` · **Pushed:** `origin/main` now tracks `main` (owner request 2026-10-25, after the stage-5 plan); the remote commit `30626f0` (branding fix in `reference/`) was merged first with `fccf5c5`. The remote stage (`P0-02` branch protection, CI, release) is still pending.

Read `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md` and the task brief before working. Polier is pinned to v1.0.0: `export POLIER=/Users/rasulatashev/Desktop/Polier-main` then `bash tools/polier.sh --check`.

## State

- **Stage 1 Foundation:** complete, owner decision `continue`.
- **Stage 2 Contract:** complete, owner decision `continue`; contract `0.1.0` (16 schema files, fixtures/sync/api corpora, TS+C++ codegen/parity), `docs/contracts.md`, ADR-0005, `board.contracts[]`, Contract overview in the preview.
- **Stage 3 Engine spike:** complete, owner decision `continue`; C++20 core (doc/camera/spatial/render command buffer), WebGL2 instanced renderer, TS bridge `@project-air/engine`, `apps/engine-playground`, ADR-0006 + `docs/engine.md`; CMake 4.4.4 + Emscripten 6.0.13; WASM 49,925 B raw / 21,806 B gzip. Measured on the Mac mini M2 8 GB proxy: p95 2.00 ms (556 fps unlocked frame production), display-locked control p95 16.80 ms. **D8 caveat:** the MacBook Air M1 8 GB reference is unproven — re-measure before treating the hardware target as met.
- **Stage 4 Backend core:** complete, owner decision `continue`; tasks `P3-01` … `P3-06` done. `services/platform` + `services/auth`, self-hosted Ory Kratos v26.2.0 (ADR-0007; `identity` profile, Mailpit courier, test-session mode for tests, admin API bound to localhost), PostgreSQL migrations `0001`–`0004` with RLS and contract-valid account-id mapping, 20 `/v1` contract routes + `GET /v1/session`, typed SDK `@project-air/sdk`, `api-tests` 32, `rls-tests` 7, platform unit 74, acceptance script `PASS backend-core acceptance`; ADR-0008 (API/session model).
- **Stage 5 Engine core:** in progress, owner decision `continue`; 30 tasks (28 planned + `P4-29`/`P4-30`
  live-demo zone parity). **Done and merged:** `P4-01` … `P4-10`, `P4-14`, `P4-15`, `P4-16`, `P4-23`, `P4-25` (contract 0.2.0),
  `P4-26` (DB containment). `P4-10` (L02 titles on cards *and* zones, 40 px header chrome, zone content
  inset, zoom-bucket sharp text incl. 200 %, grown blocks, quiet DOM delete affordance, perf + idle
  re-tests) merged as `0a565b4`; review `reviews/P4-10.md` (changes-requested on evidence) was closed by
  the evidence-refresh commit `97798bf` (`exclusive: [perf, visual]`, fresh records on the merged head);
  six minor code follow-ups stay open (see the end note of `reviews/P4-10.md`). `P4-14` (L03 pointer
  input layer: one DOM-free state machine, 4 px click/drag threshold, card body vs 40 px header grip,
  field/scroll suppression, header hover chrome, cursors, one move operation per drag; review
  `reviews/P4-14.md` pass with minors — the package `input.js` export was fixed before the merge) and
  `P4-15` (L07 snapping: pure native edge/centre matching with token tolerance, line-over-grid
  precedence, `Shift` free, up to three 1 px accent guides in the chrome pass, snapped release as one
  operation; review `reviews/P4-15.md` pass with minors) and `P4-16` (L10 multi-selection: presentation
  selection set, Shift band by intersection, 1 px accent frames/accent-soft band, one group operation
  per joint drag and per selection delete, DOM count bar; review `reviews/P4-16.md` pass with minors)
  and `P4-23` (L18 field overlay: DOM host anchored through the camera, inline `Enter`/`Tab`/
  `Shift+Tab`/`Backspace` policy that only emits intents, 24 px token colour control; review
  `reviews/P4-23.md` pass with notes) and `P4-27` (L08 engine membership: `zoneId` through the move
  payloads, nested zones rejected, one group operation per zone drag, both `deleteZone` policies, the
  member-extent + 16 px guard and the 1 s `accent_line` highlight; review `reviews/P4-27.md` pass with
  notes) and `P4-29` (L08 zone parity I: pure auto-arrangement, live release preview with 25 %/24 px
  hysteresis, one `zone-arrange` operation, 300 ms settle, 2 reviewed `zone-parity-at-rest` baselines;
  review `reviews/P4-29.md` pass with notes) are merged. **Next chain to the zone demo:**
  `P4-23` (L18 overlay/inline) → `P4-27` (L08 engine membership/move) → `P4-29` → `P4-30` (zone parity
  I/II) → `P4-28` (L01 final proof + `visual-final`/`perf-final` + showcase). All chain briefs exist
  (`P4-14/15/16/23/27/28/29/30`). Exit gates: `cpp-unit` green; `visual-final`/`perf-final` only pass
  in `P4-28`, and P4-28's "two backends" part still needs `P4-11`…`P4-13` (WebGPU) plus
  `P4-19/21/22/24`, which are NOT in the current chain — record that as an open point in P4-28, never
  as a silent pass.
- **Other sessions/repo state:** a second DSH/Claude session works in the same checkouts; it produced
  `P4-06`/`P4-08`/`P4-09`/`P4-10`/`P4-26`, reviewed and refreshed the P4-10 evidence (`97798bf`,
  `597185b`, `b50cd26`). Coordinate via claims/`in_progress` in `board.json`. Commit race documented
  below (`eff284b` carries the P4-07 content, `b4938dc` its bookkeeping). `origin/main` is pushed at
  the latest main commit (check `git log` / `git status -sb`).
- **Done overall:** 62 of 78 tasks. Open: the rest of stage 5 (the chain above plus `P4-11`…`P4-13`
  WebGPU, `P4-17`/`P4-18` resize/auto-pan, `P4-19`…`P4-24` placement/keyboard/undo/view/trackpad)
  plus the remote-phase tasks `P0-02`, `P0-15`, `P0-16`, `P0-17` (after hardening) and the planning
  of the later stages (realtime, web-app, value, hardening).
- **Preview:** `apps/web/preview/` has the permanent Contract 0.1.0 overview as section 02 and the live demo: top-centre ten-tool toolbar and a zone with notepad + image window (P0-26), **bilingual EN/DE with a themed top-right switch** via `apps/web/preview/locales/{en,de}.json` (all visible text/aria/alt; 260 identical keys; `<html lang>`, localStorage persistence, safe fallback) (P0-27), **zone items that can be dragged out onto the canvas and docked back** with a 28 px progressive detach animation, 8 px dock hysteresis, grid-snap, no edge connection, reduced-motion (P0-28); **when both items are out the empty zone fades/scales away and becomes hidden/inert, and dragging the two free items together (≥25 % overlap or ≤48 px centres) groups them into a newly animated zone** that re-orients/re-fits on resize, plus refined spring motion and a smaller zoom pill (36×104, 32 px buttons) (P0-29); **zone layout follows the drop (side by side or stacked), docked items can be reordered/swapped inside the zone, drags track the pointer 1:1 with commit-on-release (no magnetism) and the +/−/fit controls are smaller (32×96 pill, 28 px painted, 32 px hit, 12 px glyphs)** (P0-30). **Cache rule:** every preview change bumps `?v=` on `tokens.css`/`preview.css`/`preview.js` in `index.html`; locale fetches inherit the script version. A cached `index.html` may still need one hard reload (an old HTML document cannot reference the new CSS). Demo-cadence baseline screenshots: `P0-27-*` (desktop/mobile EN+DE, owner 1426×583 DPR2) `P0-28-*` (docked/mid-detach/detached/redocked) `P0-29-*` (zone fading/overlap/grouped/zoom/mobile/resize/toolbar) and `P0-30-*` (horizontal/vertical/swapped/drop-hint/controls/masthead/zoom-150).
- **Checks:** `check.py` exit 0 (40 warnings, all historical evidence-record commits; run it in the main checkout only with `node_modules/` absent — a pnpm install materialises `node_modules/.pnpm`, whose package READMEs break `check_links`), `boundaries.py` exit 0, design-check tool tests 16/16, engine node tests 59/59, engine CTest 4/4, `codegen`/`wasm-*` clean; DB suites need a Polier slot (they cannot run in the main checkout). Repo-wide `pnpm test` is still red for pre-existing env reasons — `services/platform` tests need the slot database, the release-tool tests flake under turbo concurrency (28/28 alone) and `language-check` flags the P4-10 German demo strings in `apps/engine-playground/main.js`; the `unit` gate therefore uses the documented `pnpm test --affected`.
- **Reviews:** `reviews/P1-04.md` … `reviews/P4-29.md` committed; verdicts and findings are in the files.

## Backend-core follow-ups (recorded, not blockers)

- Member/invitation routes were out of stage scope; the schema and auth invitations exist, the platform route and SDK methods come with the web stage.
- Account ids: the contract needs UUIDv7; a real Kratos identity is UUIDv4 and is mapped to a platform v7 account (`profiles.kratos_identity_id`, `GET /v1/session` exposes the mapped id). Legacy non-v7 `account_id`s must be remapped transactionally before importing historical rows.
- SDK packaging: `dist/sdk/src/index.js` layout lacks declarations/types for a TS consumer — fix before `apps/web` imports the package.
- RLS suite imports the API test helper for the reset; move the reset helper to `test/helpers/` before parallel suites.
- Production database roles: the Compose superuser owns the schema; production needs a dedicated non-superuser table owner and a BYPASSRLS owner for the SECURITY DEFINER helpers (documented in 0003/0004/ADR-0008).
- Kratos hardening: admin API needs a network/proxy boundary (it has no built-in auth), 24 h sessions vs ADR-0007's short-lived sessions, committed fallback cookie/cipher secrets and the slot-1 browser URLs in `kratos.yml` need cleanup, 405/413/415 use the nearest contract codes, no `cache-control: no-store` yet, and the `.env` loader for the auth process is documented only in READMEs.

## Engine-core follow-ups (recorded, not blockers)

- **Bound text is not depth-ordered (P4-10 review finding 1).** Bound titles/previews draw in one
  glyph pass after the object pass, so on an overlapping board a back card's title can overpaint a
  front card. The `text-titles` gallery is non-overlapping and `docs/engine.md` discloses the
  limitation; depth-sort bound runs by document draw order in a follow-up engine task before L02/L13
  can be called fully green.
- **Delete affordance presentation (P4-10 review findings 3–4).** The 28 px delete button is an
  inline SVG in the playground, not an icon in `packages/ui-kit/icons/`, and its label is hardcoded
  English (AD-8 wants translation files). The playground has no message catalogue yet; move both in
  L09/web-app when the affordance enters `apps/web`.
- **Repo-wide `pnpm test` (P4-14 review finding 2), follow-up before CI stage.** Three pre-existing
  reds: `services/platform` tests need a slot database (`tools/dev/setup`), the release-tool tests
  flake under turbo concurrency (pass alone), and `language-check` flags 10 German demo strings in
  `apps/engine-playground/main.js` that P4-10 added. Decide whether the engine playground is exempt
  from the translation rule (it is a demo without a message catalogue) or move the demo text to a
  locale file; do not silence the language gate without owner approval.
- **Playground architecture (P4-14 review finding 3).** `apps/engine-playground/ARCHITECTURE.md` does
  not mention the P4-14 input layer yet (README and `docs/engine.md` do).
- **`perf-final`/`visual-final` prerequisites.** `visual-final` names WebGL2 *and* WebGPU reference
  images, but WebGPU (`P4-11`…`P4-13`) is still open; P4-28 must record the missing backend instead
  of claiming two-backend proof (see the note in the stage-5 state above).

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
- DSH sessions: Chrome for Testing starts inside the workspace sandbox when the harness passes its own `--user-data-dir` and `--no-sandbox` (the perf/visual/idle harnesses do); the P4-10 run produced real ANGLE Metal evidence this way. Never replace evidence with a screenshot from another build.
- Disk: ~19 GiB free (freed during the backend stage). Still clean `node_modules/`, build dirs, `dist/` and `/tmp` after each task.

## Next steps

1. **Continue the stage-5 chain** sequentially, one worktree per task under `/tmp/air-<ID>`: `P4-14`
   (L03 drag/edit separation) → `P4-15` (L07 snapping) → `P4-16` (L10 multi-selection) → `P4-23` (L18
   DOM overlay/inline comfort) → `P4-27` (L08 engine membership + zone move) → `P4-29` → `P4-30`
   (live-demo zone parity, refine their JIT briefs against the P4-27 engine API) → `P4-28` (L01 final
   proof + stage showcase). All briefs exist and pass `check.py`; P4-10 is merged and its review is
   `reviews/P4-10.md`. Still open outside the chain: `P4-11`…`P4-13` (WebGPU), `P4-17` resize,
   `P4-18` auto-pan, `P4-19` placement, `P4-20` keyboard/context menu, `P4-21` undo/redo, `P4-22`
   remember view, `P4-24` trackpad/wheel.
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

- **History anomaly 2026-10-27 (two DSH sessions, shared main checkout):** a commit race put the
  P4-07 task content into commit `eff284b` (message `chore: start P4-06`) and only the P4-07
  bookkeeping (HANDOFF/STATUS/board) into `b4938dc`. The tree is correct, `check.py` passes and both
  commits are pushed; treat `eff284b` as the P4-07 content commit and do not rewrite pushed history
  without an owner decision. P4-06 is owned by the other session (worktree `../Project air-P4-06`,
  slot 2).
- **Board-check and node_modules (2026-10-28):** `python3 $POLIER/tools/check.py .` scans every
  `*.md` including `node_modules/`, and a pnpm install materialises `node_modules/.pnpm` READMEs with
  dead relative links, so the check fails after an install. Worktrees: run `board-check` **before**
  `pnpm install` (documented order). Main checkout: move `node_modules/` aside while running
  `check.py` (and keep it out if the checkout is only used for bookkeeping).
- DSH sandboxed sessions cannot create the default sibling worktree (`../<repo>-<ID>` lies outside the workspace). Create it under `/tmp/air-<ID>` (`git worktree add /tmp/air-<ID> -b task/<ID> main`), acquire the slot there (`python3 $POLIER/tools/slot.py acquire`), take the claim with `--worktree /private/tmp/air-<ID> --slot N`, store that absolute path in `board.json`; `worktree.py finish <ID>` accepts the stored absolute path.

## Owner decisions recorded

- `Q2` pnpm workspaces + Turborepo; `Q10` SemVer `0.0.1` + letter entries; `Q11` no AI release notes for now; `Q12` ICU message files now, library later; dev tools + GitHub Actions approved.
- `Q5` self-hosted Ory Kratos, community edition only, auth UI built by us (ADR-0007); `Q6` reference hardware MacBook Air M1, 8 GB, Chrome — M2 proxy accepted for the local engine-core exit, M1 re-measured in hardening; `Q7` agents under close guidance; `Q18` 50k@60fps for the spike, catalogue L01 (10,000 objects) for engine-core.
- `Q15` clear layers only, no collision nudge; `Q16` two fingers pan, pinch zooms, Cmd/Ctrl+wheel zooms; `Q17` zones are containers (contract 0.2.0 parent reference, ADR + migration, no nested zones); `Q19` WebGL2 stays the measured default, WebGPU is the second backend with fallback and a two-backend image comparison; `Q20` images with detail levels and the a11y/test mirror move to hardening/web-app, the L15 touch part stays with hardening.
- 2026-10-25: owner approved the first push to `origin/main`; this is the GitHub switch in part (ADR-0002), while branch protection, CI and release remain the remote stage (`P0-02`, `P0-15` … `P0-17`).
- `ADR-0002` local-first until the GitHub switch; `ADR-0003` remote stage after hardening, before v1; `ADR-0004` contract limits/visibility; `ADR-0005` contract source of truth; `ADR-0006` engine architecture; `ADR-0008` API/session model.
- Still open: Q3 hosting (tendency Infomaniak Public Cloud CH/EU; decision at P0-15), Q1 domain (contract base URI placeholder), Q4 CRDT (before realtime), Q8 import formats, Q9 pricing, Q14 languages.

## New session prompt

> Lies `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md`, `docs/canvas-acceptance.md`
> und `HANDOFF.md`. Stage 5 (`engine-core`) läuft: `P4-01`…`P4-10`, `P4-25`, `P4-26` sind gemerged,
> `P4-14` ist gemerged; die Kette `P4-15` (L07) → `P4-16` (L10) → `P4-23` (L18) → `P4-27` (L08) →
> `P4-29` → `P4-30` → `P4-28` ist als Nächstes dran (alle Briefs existieren). Lokal arbeiten; `main`
> wird gepusht; nichts ohne Freigabe taggen.
> Worktrees unter `/tmp/air-<ID>` (DSH-Sandbox), Slot aus `.polier-slot`, `board-check` vor
> `pnpm install`, Chrome-Gates mit `--no-sandbox`, Evidenz in `reviews/evidence/`, ein Commit pro Task.
