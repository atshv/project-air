# packages/ui-kit

Design tokens, generated CSS custom properties, the generated C++ header and the toolbar icons.

- **Kind:** `package`
- **Created in stage:** `foundation`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)
- **Design law:** [docs/design-rules.md](../../docs/design-rules.md)

## Single source

`tokens.json` is the only file that holds visual values (AD-7). Its keys are the token names
without the CSS `--` prefix. Values come from `docs/design-rules.md` and blueprint section 21.1
first; where the blueprint summary gives no concrete value (the `tone-*` hexes and the exact
alpha values), the value comes from `reference/src/app/globals.css`. The design law names the
colour, radius, shadow, font and layer tokens; for values it gives without a name (spacing, sizes,
the type scale, motion, borders and the focus outline) the token names are systematic
(`--space-4` … `--space-48`, `--border-width`, `--outline-width`, `--text-28`, `--motion-hover`, …).
No value is invented.

## Open questions

Tracked here and in the task report; `tokens.json` carries token values only.

- **Font families.** The reference stacks start with the framework font variables
  (`--font-inter`, `--font-source-serif`); the design law names only "Serif" and "Sans". The tokens
  keep the reference's explicit fallback families; loading the real families and their licences is
  the web-app task.
- **Reference-only colour tokens.** `reference/src/app/globals.css` also defines `--accent-strong`,
  `--on-light`, `--button` and `--button-hover`, which the design law does not name. They are
  deliberately not tokens; adding them needs approval (design rule §2).
- **Layer 7a.** The remote-cursor layer cannot take a separate integer CSS `z-index` between 7 and
  8. `tokens.json` keeps the design-law numbers (remote cursors share z-index 7) and `layers.ts`
  records order `7a` so the web app and the engine render them after snap guides.
- **Tooltip radius (resolved in review).** The 6 px tooltip radius from design rule §3 is now the
  token `--radius-tooltip`; the design law gives no name for it, so the name is systematic.

## Generated files (committed, never edit by hand)

| Path | Content |
| --- | --- |
| `tokens.css` | `:root { --…: …; }` custom properties for the web app |
| `tokens.h` | `#pragma once` header with one typed `constexpr` per token in `namespace tokens` |
| `layers.ts` | the design-law layer order from 1 to 11 including 7a as typed data |

`codegen.mjs` reads `tokens.json` and writes all three files with Node.js builtins only. It is
deterministic: stable ordering, LF endings, no timestamps, so a second run leaves the tree clean.

## Icons

`icons/` holds exactly the ten canvas toolbar icons as standalone SVG files: `note`, `source`,
`image`, `file`, `zone`, `checklist`, `palette`, `columns`, `timeline`, `table`. Each file uses
`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, stroke width 1.6 and round caps and
joins. The web app and the engine texture atlas use the same files.

## Commands

Run from the repository root:

```sh
pnpm --filter ./packages/ui-kit run codegen   # regenerate tokens.css, tokens.h and layers.ts
pnpm --filter ./packages/ui-kit run build     # same as codegen (the generated files are the output)
pnpm --filter ./packages/ui-kit lint
pnpm --filter ./packages/ui-kit typecheck
pnpm --filter ./packages/ui-kit test          # node:test, no dependencies
```

The `tokens-codegen` gate runs `codegen` and then `git diff --exit-code -- packages/ui-kit`, so a
drift between `tokens.json` and the committed outputs fails the gate.
