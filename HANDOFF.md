# Handoff — Project air, new session

**As of:** 2026-10-25 12:50 (Europe/Zurich) · **Repository:** `/Users/rasulatashev/Desktop/KI Projekte/Project air` · **Base branch:** `main` · **Nothing pushed** (`origin/main` is still the scaffold).

Read `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md` and the task brief before working. Polier is pinned to v1.0.0: `export POLIER=/Users/rasulatashev/Desktop/Polier-main` then `bash tools/polier.sh --check`.

## State

- **Stage 1 Foundation:** complete, owner decision `continue` (15 tasks, all exit gates).
- **Stage 2 Contract:** 3 of 6 tasks done — `P1-01` data model, `P1-02` operations/inverses/group, `P1-03` TS+C++ codegen with fixture parity (77 fixtures, 49 tests).
- **Done overall:** 22 of 26 tasks. Contract version is `0.1.0`; no tag yet (P1-06).
- **Open tasks:** `P1-04` sync protocol, `P1-05` API resources/error codes, `P1-06` docs/ADR/tag + `board.contracts[]`; the visible Contract overview in the preview is not yet a task. Remote stage (after hardening): `P0-02`, `P0-15`, `P0-16`, `P0-17`.
- **Checks:** `check.py` exit 0, `boundaries.py` exit 0, STATUS fresh, worktrees clean.

## Environment

- Docker Desktop (context `desktop-linux`) is the local runtime; the compose stack is started/stopped with `docker compose -f infra/compose/compose.yaml up -d --wait` / `down`.
- The design preview is served from the main checkout on port 4000: `python3 -m http.server 4000` in the repo root → `http://127.0.0.1:4000/apps/web/preview/`. The demo must be updated with every preview/design change in the same task (see `docs/quality.md`, demo cadence).
- Board-check must run **before** `pnpm install` (it scans `node_modules/`).
- Local C++ compiler: Apple clang 21 (`clang++`); no CMake/Emscripten yet (engine stage will install/plan them).

## Next steps

1. Start `P1-04` (brief is ready in `tasks/P1-04.md`): create the worktree, set status, run gates (`board-check`, `codegen`, `unit`), review, squash-merge, mark done, finish the worktree.
2. Then `P1-05` (depends on P1-04; brief ready): API resources/error codes plus `errors.<CODE>` keys in `apps/web/messages/`, with `language-check` green.
3. Then `P1-06` (task exists, **brief must be written**): `docs/contracts.md`, ADR "Vertrag und Versionen", fill `board.contracts[]` with the contract metadata (lead), run the `contracts` gate; tag `contracts@0.1.0` logically (no git tag until the remote phase).
4. Then `P1-07` (task exists, **brief must be written**): add the **Contract overview** to `apps/web/preview/` (schemas/operations/fixtures as a visible page, kept in sync like the live demo).
5. Start stage 3 (engine spike) locally afterwards; the remote GitHub/CI/release phase stays at the very end (ADR-0003).

## Standard task loop

```
export POLIER=/Users/rasulatashev/Desktop/Polier-main
python3 $POLIER/tools/worktree.py start <ID> --root . --session lead --harness dsh
# set task in_progress in board.json, render_status.py, commit "chore: start <ID>"
# worker implements the brief in the worktree
cd <worktree>; bash tools/polier.sh --check; python3 $POLIER/tools/gate.py --task <ID> --name <gate> -- <command>
# lead: squash-merge, board status done + evidence + handoff, render_status, check.py,
#       worktree.py finish <ID>, amend the one task commit, verify main
```

Rules: one commit per task (`<ID>: <title>`), change entry in `.changes/` (`pnpm run change -- …`), gates via `gate.py`, evidence in `reviews/evidence/`, no push/tag/PR, no new dependencies without owner approval.

## Owner decisions recorded

- `Q2` pnpm workspaces + Turborepo; `Q10` SemVer `0.0.1` + letter entries; `Q11` no AI release notes for now; `Q12` ICU message files now, library later; dev tools + GitHub Actions approved.
- `ADR-0002` local-first until the GitHub switch; `ADR-0003` remote stage after hardening, before v1; `ADR-0004` contract text limits (320/80/120/200/300) and visibility `private`/`workspace`/`link` (link read-only, revocable).
- Still open for later: Q3 hosting (before remote release), Q1 domain (contract base URI is a placeholder), Q15/Q16/Q17/Q18 engine behaviour questions.

## New session prompt

> Lies `AGENTS.md`, `ARCHITECTURE.md`, `STATUS.md`, `docs/module-map.md` und `HANDOFF.md`. Setze die Contract-Stage fort: starte P1-04 (tasks/P1-04.md), merge es, dann P1-05 (tasks/P1-05.md), dann P1-06 und die Contract-Übersicht in der Preview. Halte die Demo-/Preview-Sync-Regel ein. Lokal arbeiten, nichts pushen.
