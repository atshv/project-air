# Project air

Details: `ARCHITECTURE.md`. Progress: `STATUS.md`. Structure: `docs/module-map.md`.

## Commands

- **Polier (pinned `v1.0.0`):** set `POLIER` to a checkout of that tag; CI does the same (P0-09).
- **Board check:** `python3 $POLIER/tools/check.py .` — before `pnpm install` (scans `node_modules/`).
- **Boundaries:** `python3 $POLIER/tools/boundaries.py .`
- **Status:** `python3 $POLIER/tools/render_status.py .` (lead only)
- **Worktree:** `python3 $POLIER/tools/worktree.py start <ID>` / `finish <ID>`
- **Gate:** `python3 $POLIER/tools/gate.py --task <ID> --name <gate> --shell "<command>"`
- **Git:** `git status --short` · `git diff` · `git log --oneline -5`
- **Install:** `pnpm install --frozen-lockfile` (lockfile committed).
- **Build, lint, typecheck, test:** `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` — Turborepo; per kind: `docs/module-map.md`.

## Deviations

- Profile L: code lives in `packages/`, `services/`, `apps/`, `tools/`, `infra/`; no root `src/`.
- `reference/`: unchanged prototype originals; read only when a brief lists them; never edit or import.
- `docs/owner/`: owner's German blueprint; read only when a brief lists it.
- Code, comments, commits, tests, briefs, reviews in English. UI text only from translation files (P0-18); German uses `ss`, never `ß`.

## Runtime

- Ports, database and bucket names only from `.polier-slot` (`python3 $POLIER/tools/slot.py show`). Never hard-code ports; never touch slot 0's data.
- Gates listed in a task's `exclusive` never run concurrently; wait for the lock or rerun alone.
- Never stop processes you did not start: no `kill`, `pkill`, `killall`.

## Rules

- One task per session, one live claim per task, work in the task's worktree (`worktrees: required`).
- Read `ARCHITECTURE.md`, `AGENTS.md`, `STATUS.md`, `docs/module-map.md` and your brief first. Unclear: `open_questions` in the result.
- Run every gate through `gate.py` with the names from `board.json`; commit `reviews/evidence/` with the task. Records with result `infra`, `busy` or `timeout` are not evidence.
- Stay inside `scope_write`. One commit per task: `<ID>: <title>`. No push, tag or PR without approval.
- Imports only per `packages[].may_import` (gate `boundaries`). Inside a TS package: UI → logic → data.
- **Change:** every code change adds `.changes/<ID>-<short-name>.md` (`pnpm run change -- <area> <kind> "<summary>"`).
- Versions only from manifests or cited docs; every dependency in `docs/versions.md`.
- No secrets in the repo, bundle or logs.
- Agents never publish; releases run in CI from tags (`docs/releasing.md`).

## Forbidden

- New dependencies, or changed/deleted tests, without approval.
- Placeholders or TODOs reported as done.
- Architecture invariants changed without an ADR and approval.
- Secrets, tokens or caches committed.
