# Architecture: packages/contracts

**Kind:** `package` · **Created in stage:** `contract`

## Purpose

The common language of the workspace: everything two packages exchange is defined here. Contract
`0.1.0` holds the board-content data model and every board change as an operation with exactly one
inverse, as JSON Schema 2020-12 with valid and invalid fixtures.

## Inputs

- JSON Schema sources under `schemas/`, one file per entity plus the operation envelope and the
  root board-content document.
- Valid and invalid fixtures under `fixtures/` in the `{schema, valid, reason, data}` wrapper.
- No runtime input from other workspace packages: the contract is dependency-free by design.

## Outputs

- Versioned schemas whose `$id` carries `0.1.0`; the root document binds `contractVersion` to the
  same string.
- Fixtures that a later codegen and both test suites (TypeScript and C++) consume.
- `index.mjs`: the contract version, the operation type vocabulary and the schema/fixture paths.

## Invariants

- `AD-1` — Every board change is one operation with its inverse; one gesture = one operation. A
  `group` bundles ordered children and its inverse is the reversed list of child inverses.
- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change
  updates every dependant in the same task and adds fixtures.
- `AD-4` — A note exists once; a card references the note id and never embeds note content. A
  `deleteNote` stores its card placements and restores them with a group inverse.
- Every operation carries `id`, `boardId`, `actorId`, `createdAt`, `type`, `payload` and exactly one
  `inverse` with the same `boardId` and target id.
- Creates invert to deletes, updates and moves/resizes store the previous values, deletes store the
  object; a multi-object delete has a group inverse. Groups do not nest.
- `z` is a fractional-index string, sizes carry a numeric minimum per object type, ids are UUIDv7
  and timestamps are ISO-8601 with timezone; edges join note cards only.

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
- Owner blueprint, contract sections 4.1, 5.1 and 5.2: [docs/owner/canvas-suite-blueprint.md](../../docs/owner/canvas-suite-blueprint.md)
