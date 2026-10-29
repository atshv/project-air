# Project air

Details: `ARCHITECTURE.md`. Progress: `STATUS.md`. Structure: `docs/module-map.md`. Loop: `docs/orchestration.md`, rules: `policy.json`.

## Commands

- **Polier:** `export POLIER=...`, then `bash tools/polier.sh --check`.
- **Board check:** `python3 $POLIER/tools/check.py .` (before `pnpm install`).
- **Plan:** `python3 $POLIER/tools/dispatch.py` · **Audit:** `python3 $POLIER/tools/audit.py`
- **State (lead):** `python3 $POLIER/tools/state.py set <ID> <status>`, then `render_status.py .`
- **Worktree:** `python3 $POLIER/tools/worktree.py start <ID>` / `finish <ID>`
- **Gate:** `python3 $POLIER/tools/gate.py --task <ID> --name <gate> --shell "<command>"`
- **Boundaries:** `python3 $POLIER/tools/boundaries.py .` · **Git:** `git status --short` · `git diff`
- **Install:** `pnpm install --frozen-lockfile`
- **Build, lint, typecheck, test:** `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test`.

## Deviations

- Profile L: code in `packages/`, `services/`, `apps/`, `tools/`, `infra/`; no root `src/`.
- `reference/` and `docs/owner/`: read only when a brief lists them; never edit or import.
- Code, comments, commits, tests, briefs, reviews in English. UI text only from translation files; German uses `ss`, never `ß`.

## Runtime

- Ports, database and bucket names only from `.polier-slot`; never touch slot 0's data.
- `exclusive` gates never run concurrently; wait or rerun alone.
- Never stop processes others started: no `kill`, `pkill`, `killall`.

## Rules

- Start from `dispatch.py`; one task per session and claim, in the task's worktree.
- Read `ARCHITECTURE.md`, `STATUS.md` and your brief first. Unclear: `open_questions`.
- Status only through `state.py` (`in_progress` → `verifying` → `review` → `done`; others with a note); only the lead sets it.
- Gates only through `gate.py`, names from `board.json`; commit `reviews/evidence/`. `infra`, `busy`, `timeout` are not evidence.
- A review carries a plain `verdict: pass` line; a task others depend on leaves a handoff.
- A new dependency, merge, release or reopened task needs a granted record first (`approve.py request --action <action> --task <ID>`).
- Never hand-edit `runs/` or `reviews/approvals/`; commit `runs/` with the task.
- Stay inside `scope_write`. One commit per task: `<ID>: <title>`. No push, tag or PR without approval.
- Imports only per `packages[].may_import`. Inside a TS package: UI → logic → data.
- Every code change adds `.changes/<ID>-<short-name>.md` (`pnpm run change`).
- Versions only from manifests or cited docs; every dependency in `docs/versions.md`.
- No secrets in the repo, bundle or logs. Releases only from CI tags.

## Forbidden

- New dependencies, or changed/deleted tests, without approval.
- Placeholders or TODOs reported as done.
- Architecture invariants changed without an ADR and approval.
- Secrets, tokens or caches committed.
