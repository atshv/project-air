# Architecture: packages/crdt

**Kind:** `package` · **Created in stage:** `later`

## Purpose

Holds board content so several people can change it at the same time and offline and still end at the same state. It exposes `BoardDoc` with `apply(op)`, `encodeUpdate()`, `applyUpdate()` and `snapshot()` behind its own interface, so the CRDT library stays replaceable. The library choice is still an open owner question (Q4 on the board).

## Inputs

- Operations typed by `packages/contracts`.
- Encoded updates from other replicas and stored snapshots.

## Outputs

- `BoardDoc` with `apply(op)`, `encodeUpdate()`, `applyUpdate()` and `snapshot()`.
- Encoded updates and snapshots that converge to the same final state.

## Invariants

- `AD-1` — Every change to board content is one operation from `packages/contracts` with its inverse; one gesture = one operation.
- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
