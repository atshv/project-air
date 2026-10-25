# Architecture: packages/ui-kit

**Kind:** `package` · **Created in stage:** `foundation`

## Purpose

One look everywhere. It owns the design tokens (colours, spacing, radii, shadows, type, motion, thresholds) and generates both CSS variables and the C++ header `tokens.h`; it also provides SVG icons and the base components: buttons, menus, dialogs and tooltips.

## Inputs

- `tokens.json`, authored here: the only source of visual values.
- The design rules in `docs/design-rules.md` and the icon artwork.

## Outputs

- Generated CSS variables and the generated C++ header `tokens.h`.
- SVG icons and the base components with every state the design rules require.
- An example page per component.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-7` — Visual values come only from `packages/ui-kit/tokens.json` (CSS and C++ generated).

## Allowed imports

None. `board.json` -> `packages[]` -> `may_import` is empty, so this package imports no other workspace package.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
