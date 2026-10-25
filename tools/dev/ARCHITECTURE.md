# Architecture: tools/dev

**Kind:** `tool` · **Created in stage:** `foundation`

## Purpose

Per-slot setup and teardown: it creates and removes the slot database and bucket from `.polier-slot`, seeds data and starts or stops the local services with one command each.

## Inputs

- The slot number and its values from `.polier-slot`.
- Compose definitions from `infra/compose/`.

## Outputs

- A per-slot database and bucket, created or removed; seed data.
- The one-command local service start and teardown used as the `dev-setup` gate.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

None. `board.json` -> `packages[]` -> `may_import` is empty, so this package imports no other workspace package.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
