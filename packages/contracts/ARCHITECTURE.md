# Architecture: packages/contracts

**Kind:** `package` · **Created in stage:** `contract`

## Purpose

The common language of the workspace: everything two packages exchange is defined here. The first
contract (`0.1.0`) is the board-content data model as JSON Schema 2020-12 with valid and invalid
fixtures; operations, codegen, the sync protocol and API errors follow in later tasks.

## Inputs

- JSON Schema sources under `schemas/`, one file per entity plus the root board-content document.
- Valid and invalid fixtures under `fixtures/` in the `{schema, valid, reason, data}` wrapper.
- No runtime input from other workspace packages: the contract is dependency-free by design.

## Outputs

- Versioned schemas whose `$id` carries `0.1.0` and whose root document binds `contractVersion` to
  the same string.
- Fixtures that a later codegen and both test suites (TypeScript and C++) consume.
- `index.mjs`: the contract version and the schema/fixture paths, for dependants and tooling.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change
  updates every dependant in the same task and adds fixtures.
- `AD-4` — A note exists once; a card references the note id and never embeds note content.
- Parent relation: a board owns zones, cards and blocks; a card or block may point at one zone, and
  zones are never nested in v1.
- `z` is a fractional-index string, `x`/`y` are world pixels, sizes carry a numeric minimum per
  object type, ids are UUIDv7 strings and timestamps are ISO-8601 with timezone.
- Edges join note cards only; a card-to-zone edge is invalid.
- Fixed values are enums (`locale`, board `visibility`, block `type`); unknown block types fail.

## Allowed imports

None. `board.json` -> `packages[]` -> `may_import` is empty, so this package imports no other
workspace package. The tests use Node builtins only.

## Commands

From the repository root:

- `pnpm --filter ./packages/contracts test` — the unit suite (`node --test test/*.test.mjs`); without
  an install, `node --test packages/contracts/test/*.test.mjs` is equivalent.
- `pnpm --filter ./packages/contracts lint` — ESLint.

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
- Owner blueprint, contract sections 4.1 and 5.1: [docs/owner/canvas-suite-blueprint.md](../../docs/owner/canvas-suite-blueprint.md)
