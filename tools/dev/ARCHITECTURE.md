# Architecture: tools/dev

**Kind:** `tool` · **Created in stage:** `foundation`

## Purpose

Per-slot setup and teardown: it creates and removes the slot database, the restricted `app_user` role, the slot bucket and the shared local identity database from `.polier-slot`, seeds data and starts or stops the local services with one command each.

## Inputs

- The slot number and its values from `.polier-slot`.
- Compose definitions from `infra/compose/`.

## Outputs

- A per-slot database, role and bucket (or the shared `projectair_kratos` identity database), created or removed.
- The one-command local service start and teardown used as the `dev-setup` gate.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-5` — Authorisation is checked twice: in the API and by PostgreSQL row-level security. `app_user` never has `SUPERUSER` or `BYPASSRLS` and never owns tables.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

None. `board.json` -> `packages[]` -> `may_import` is empty, so this package imports no other workspace package.

## Commands

The scripts need bash, Docker with Compose, Node from `.nvmrc` and the Python 3 standard library; there is no install, lint, build or test step. Runtime values come only from `.polier-slot` (AD-9); slot 0 is refused and the shared stack is started but never stopped. Role passwords are generated or read from the gitignored env file and never printed.

| Command | What it does |
| --- | --- |
| `python3 $POLIER/tools/slot.py acquire` | take (or reuse) this worktree's slot; writes `.polier-slot` |
| `bash tools/dev/setup` | start the shared compose stack if needed, then create and verify the slot database, the restricted `app_user` role with its grants, the shared `projectair_kratos` database and the slot bucket |
| `bash tools/dev/reset-db` | drop and recreate the slot database, re-run the bootstrap and migrate it (destructive; this slot only) |
| `bash tools/dev/teardown` | drop the slot database and bucket idempotently; refuses slot 0 |
| `docker compose -f infra/compose/compose.yaml down` | stop the shared stack manually; volumes are kept and the scripts never run this |

The `dev-setup` gate is `python3 $POLIER/tools/slot.py acquire && bash tools/dev/setup` and is
recorded under `reviews/evidence/`; usage and safety rules are in [README.md](README.md).


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
