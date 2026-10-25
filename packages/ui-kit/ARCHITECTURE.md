# Architecture: packages/ui-kit

**Kind:** `package` · **Created in stage:** `foundation`

## Purpose

One look everywhere. It owns the design tokens (colours, spacing, sizes, radii, typography,
motion, shadows and layers) and generates the CSS custom properties for the web app and the C++
header `tokens.h` for the engine; it also provides the canvas toolbar icons as SVG files. Base
components (buttons, menus, dialogs, tooltips) follow in a later stage.

## Inputs

- `tokens.json`, authored here: the only source of visual values. Every value traces to
  `docs/design-rules.md` and blueprint section 21.1 first; concrete values the blueprint summary
  does not spell out (the `tone-*` hexes, exact alpha colours, shadows, font stacks) come from
  `reference/src/app/globals.css`. Unnamed design-law values are given systematic names; open
  points live in the package README, never as data in `tokens.json`.
- The design law and its icon artwork.

## Outputs

- `tokens.css`: generated `:root { --…: …; }` custom properties.
- `tokens.h`: generated `#pragma once` header with typed `constexpr` values in `namespace tokens`.
- `layers.ts`: generated typed layer order (1–11 including 7a) read by the web app and the engine.
- `icons/*.svg`: ten standalone toolbar icons, 24×24 grid, stroke 1.6, `currentColor`, no fill.

All generated files are committed. `codegen.mjs` (Node.js builtins only) writes them
deterministically: stable ordering, LF endings, no timestamps, so a second run leaves the tree
clean.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change
  updates every dependant in the same task.
- `AD-7` — Visual values come only from `packages/ui-kit/tokens.json`; `tokens.css`, `tokens.h`
  and `layers.ts` are derived output and are never edited by hand.
- No raw colour value exists outside `tokens.json` and its generated outputs; spacing stays on the
  4-px series, and radii, shadows and motion durations use only the design-law tokens.
- No `z-index` above 10 without an entry in `layers.ts`.

## Allowed imports

None. `board.json` -> `packages[]` -> `may_import` is empty, so this package imports no other
workspace package.

## Commands

From the repository root:

- `pnpm --filter ./packages/ui-kit run codegen` — regenerate `tokens.css`, `tokens.h`, `layers.ts`.
- `pnpm --filter ./packages/ui-kit run build` — same as `codegen`; the generated files are the
  build output.
- `pnpm --filter ./packages/ui-kit lint`, `… typecheck`, `… test` — ESLint, `tsc --noEmit` and
  `node:test` (no dependencies).

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
- Design law: [docs/design-rules.md](../../docs/design-rules.md)
