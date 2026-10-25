# Architecture: packages/contracts

**Kind:** `package` · **Created in stage:** `contract`

## Purpose

The common language of the workspace: everything two packages exchange is defined here. It is the single source of truth for the data model, the operations, the sync protocol and API errors, written as JSON Schema with generated TypeScript and C++ code; it also carries the contract version.

## Inputs

- JSON Schema sources and valid/invalid fixtures authored in this package.
- No runtime input from other workspace packages: the contract is dependency-free by design.

## Outputs

- Generated TypeScript types and generated C++ code.
- Versioned schemas with one valid and one invalid fixture per schema.
- The contract version consumed by every dependant package.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-4` — A note exists once; a card is only its placement on a board.

## Allowed imports

None. `board.json` -> `packages[]` -> `may_import` is empty, so this package imports no other workspace package.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
