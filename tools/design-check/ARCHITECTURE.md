# Architecture: tools/design-check

**Kind:** `tool` · **Created in stage:** `foundation`

## Purpose

The design-rules gate. It rejects raw colours, off-grid spacing, `z-index` values outside the layer
model and missing UI evidence for `apps/`, `packages/ui-kit/`, `packages/editor/` and
`packages/engine/src/render/`. It enforces `AD-7` and the design law as the `design-check` gate.

## Inputs

- `packages/ui-kit/tokens.json` — colour names, the spacing grid, size and radius values.
- `packages/ui-kit/layers.ts` — the layer order and allowed `z-index` values.
- Source files in the scanned paths. The allowed values are read at run time; none is duplicated in
  this tool.

## Outputs

- One `file:line: rule: message` line per finding, sorted by file, line and rule; `--json` adds the
  skipped values and a summary.
- Exit code: `0` clean, `1` findings, `2` usage or configuration error.

## Invariants

- `AD-7` — Visual values come only from `packages/ui-kit/tokens.json`; the gate takes its allowed
  values from that generated source and from `layers.ts`, never from its own constants.
- The scan is read-only and deterministic: sorted file walk, ascending line numbers, no network, no
  state outside the process. Fixtures of this tool are never scanned.
- Generated token files, `reference/`, `docs/`, `reviews/`, `node_modules/` and tests are ignored,
  so a derived file can never make the gate fail.
- `pnpm` and Node are the only tools; the package has no dependencies.

## Allowed imports

Node.js builtins only (`node:fs`, `node:path`, `node:child_process` in the tests). `board.json` ->
`packages[]` -> `may_import` is empty, so this package imports no other workspace package.

## Commands

From the repository root:

- `node tools/design-check/index.mjs .` — run the gate.
- `node tools/design-check/index.mjs <fixture> --task <ID> --json` — inspect a project or a task.
- `pnpm --filter ./tools/design-check test` — the unit suite (`node --test`); without an install,
  `node --test tools/design-check/test/*.test.mjs` is equivalent.

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
- Design law: [docs/design-rules.md](../../docs/design-rules.md)
