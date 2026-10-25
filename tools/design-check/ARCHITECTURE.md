# Architecture: tools/design-check

**Kind:** `tool` · **Created in stage:** `foundation`

## Purpose

The design-rules gate. It rejects raw colours, off-grid spacing, unknown z-index values and missing UI evidence, taking the tokens and the design rules as its source. It is the `design-check` gate that enforces `AD-7` for `packages/ui-kit`, `packages/engine` and `apps/web`.

## Inputs

- Source files of the packages and apps, plus `packages/ui-kit/tokens.json`.
- The design rules in `docs/design-rules.md`.

## Outputs

- Findings with file and line for every violation.
- The exit code consumed as the `design-check` gate.

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
