# Architecture: packages/test-kit

**Kind:** `package` · **Created in stage:** `engine-spike`

## Purpose

The same test data and helpers for every package. It provides fixture boards (empty, small, 500 and 10,000 objects), a fake sync server, a login helper and the port lookup that reads `.polier-slot` instead of hard-coded ports.

## Inputs

- Contract fixtures and types from `packages/contracts`.
- Slot, port and database values from `.polier-slot`.

## Outputs

- Fixture boards: empty, small, 500 and 10,000 objects.
- A fake sync server, a login helper and a port lookup helper.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
