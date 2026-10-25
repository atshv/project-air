# Architecture: services/worker

**Kind:** `service` · **Created in stage:** `later`

## Purpose

Everything that outlives one request: import, export, thumbnail recalculation, trash cleanup and snapshot compaction. Jobs use a PostgreSQL queue, so v1 needs no additional infrastructure.

## Inputs

- Job rows from the PostgreSQL queue and job payloads typed by `packages/contracts`.
- Artifacts and records from `services/media` and `services/platform`.

## Outputs

- Completed import, export and thumbnail jobs, trash cleanup and compacted snapshots.
- Updated queue state.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
