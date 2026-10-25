# Architecture: tools/language-check

**Kind:** `tool` · **Created in stage:** `foundation`

## Purpose

The dependency-free Node.js ESM gate for language and translation. It enforces `AD-8`: UI text
comes only from the message files, German text stays out of code, German uses `ss` and the locale
files never drift apart.

## Contents

- `index.mjs` — CLI and checks (`node tools/language-check/index.mjs [root] [--write-pseudo]`).
- `german-words.json` — small documented German word list used by the code check.
- `test/` — unit tests and fixtures with deliberate violations.

## Inputs

- `apps/web/messages/de.json`, `en.json`, `en-XA.json`.
- `docs/i18n/*.md`.
- Code under `apps/`, `packages/editor/`, `packages/ui-kit/` and `tools/` (outside
  `apps/web/messages/`).

## Outputs

- Findings `file:line: rule: message`, deterministic and sorted.
- Exit `0` clean, `1` findings, `2` usage or configuration error.
- With `--write-pseudo`, a regenerated `en-XA.json` (sorted keys, two-space indent, no diff on a
  second run).

## Checks

Key parity and English `lowerCamelCase` keys; ICU syntax, required plural/select branches and
placeholder parity; deterministic pseudo-locale of `de.json`; the German sharp-s character in
messages and i18n docs; German words and umlauts in user-facing string literals in code.

## Invariants

- `AD-8` — user-visible text comes only from translation files with English keys.
- `AD-3` — contracts stay the source of cross-package truth; this tool reads files, it does not
  define messages for other packages.
- Node.js builtins only; no dependency, no network, no clock-dependent output.

## Allowed imports

None (`board.json` -> `packages[]` -> `may_import` is empty).

## Commands

- Gate: `node tools/language-check/index.mjs .`
- Test: `pnpm --filter ./tools/language-check test` or
  `node --test tools/language-check/test/*.test.mjs`
- Lint: no `lint` script yet; the tool has no dependencies and the root ESLint setup does not
  cover `.mjs` in this stage (P0-04 defines the workspace lint).

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
- Message rules: [README.md](README.md) · [apps/web/messages/README.md](../../apps/web/messages/README.md)
