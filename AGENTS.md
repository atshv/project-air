# Project air

Details: `ARCHITECTURE.md`. Progress: `STATUS.md`. Structure: `docs/module-map.md`.

## Commands

- **Polier (pinned `v1.0.0`):** set `POLIER` to a checkout of that tag; CI does the same (P0-09).
- **Board check:** `python3 $POLIER/tools/check.py .`
- **Boundaries:** `python3 $POLIER/tools/boundaries.py .`
- **Status:** `python3 $POLIER/tools/render_status.py .` (lead only)
- **Worktree:** `python3 $POLIER/tools/worktree.py start <ID>` / `finish <ID>`
- **Gate:** `python3 $POLIER/tools/gate.py --task <ID> --name <gate> --shell "<command>"`
- **Git:** `git status --short` · `git diff` · `git log --oneline -5`
- **Install, build, lint, typecheck, test:** defined by P0-04 in `docs/module-map.md`; until then only the board check exists.

## Deviations

- Profile L monorepo; `src/` at the root does not exist. Code lives in `packages/`, `services/`, `apps/`, `tools/`, `infra/`.
- `reference/` holds unchanged originals from an earlier prototype. Read them when a brief lists them; never edit or import them.
- `docs/owner/` is the owner's German blueprint. Read only when a brief lists it.
- Code, comments, commits, tests, briefs and reviews in English. User-visible text only from translation files (from P0-18); German uses `ss`, never `ß`.

## Runtime

- Ports, database and bucket names only from `.polier-slot` (`python3 $POLIER/tools/slot.py show`). Never hard-code ports; never touch slot 0's data.
- Gates listed in a task's `exclusive` never run concurrently; wait for the lock or rerun alone.
- Never stop processes you did not start: no `kill`, `pkill`, `killall`.

## Rules

- One task per session, one live claim per task, work in the task's worktree (`worktrees: required`).
- Read `ARCHITECTURE.md`, `AGENTS.md`, `STATUS.md`, `docs/module-map.md` and your brief first. Unclear: `open_questions` in the result; do not guess.
- Run every gate through `gate.py` with the names from `board.json`; commit `reviews/evidence/` with the task. Records with result `infra`, `busy` or `timeout` are not evidence.
- Stay inside `scope_write`. One commit per task: `<ID>: <title>`. No push, tag or PR without approval.
- Imports only per `packages[].may_import` (gate `boundaries`). Inside a TS package: UI → logic → data.
- Versions only from manifests or cited docs; every dependency in `docs/versions.md`.
- No secrets in the repo, bundle or logs.
- Agents never publish; releases run in CI from tags (`docs/releasing.md`).

## Forbidden

- New dependencies, or changed/deleted tests, without approval.
- Placeholders or TODOs reported as done.
- Architecture invariants changed without an ADR and approval.
- Secrets, tokens or caches committed.
