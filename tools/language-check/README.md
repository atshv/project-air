# tools/language-check

Dependency-free language and translation gate (`language-check`). It enforces `AD-8`: user-visible
text lives in the message files, German text stays out of code, and German always uses `ss`.

Node.js builtins only, ESM, no dependencies, no framework. Node.js `>= 24.22.1` (root `.nvmrc`).

## Usage

```sh
node tools/language-check/index.mjs [root] [--write-pseudo]
```

- `root` — project root, defaults to the current directory.
- `--write-pseudo` — regenerate `apps/web/messages/en-XA.json` deterministically from `de.json`.

Output is one finding per line: `file:line: rule: message`. Exit codes: `0` clean, `1` findings,
`2` usage or configuration error (for example a missing message file).

## Checks

1. **Keys** — `de.json`, `en.json` and `en-XA.json` have exactly the same key set; a missing or
   extra key is reported per key (`key-parity`). Every path segment is English `lowerCamelCase`
   and contains no umlauts (`key-format`).
2. **ICU MessageFormat** — balanced braces, known argument types, `other` branch for every
   plural/select, `one` branch for plurals, no duplicate selectors (`icu-syntax`, `icu-branches`).
   Placeholders must match the German message of the same key in every locale
   (`icu-placeholders`).
3. **Pseudo-locale** — `en-XA.json` must equal the deterministic pseudo transformation of
   `de.json` (`pseudo-drift`). The transformation accents every letter and grows each text
   segment by about 40 %; placeholders and ICU syntax stay unchanged.
4. **German in code** — `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.html` and `.css` under `apps/`,
   `packages/editor/`, `packages/ui-kit/` and `tools/` (outside `apps/web/messages/`) must not
   contain the German sharp-s character (`sharp-s-in-code`) and must not contain umlauts or
   German words in string literals (`german-in-code`).
5. **German sharp-s** — message files (`sharp-s-in-messages`) and `docs/i18n/*.md`
   (`sharp-s-in-i18n-docs`) must write `ss`.

## The German word list

`german-words.json` holds a deliberately small list of distinctive German words (for example
"notiz", "schliessen", "bitte"). It never contains short words that also occur in English
("in", "an", "die", "war", "hat"), because the umlaut rule already catches most German text and
false positives would weaken the gate. Extending the list is part of a task, never a silent
change; questionable hits go into `open_questions`.

Limitation: the rule scans string literals, not prose comments. A German word inside a comment
that is not a string literal is not reported; a German word in a comment that contains quotes can
be reported, which is accepted for this stage.

## Exclusions

- Ignored directories: `node_modules/`, `.git/`, `.turbo/`, build outputs, `reviews/`,
  `reference/` and `docs/` (except the sharp-s rule for `docs/i18n/`).
- The checker never scans its own fixtures and tests (`tools/language-check/test/`); they contain
  deliberate violations.
- `en-XA` is a layout test locale. It is never shipped as a real language.

## Tests

```sh
pnpm --filter ./tools/language-check test
```

or, without a workspace install:

```sh
node --test tools/language-check/test/*.test.mjs
```

Fixtures for the cases live in `tools/language-check/test/fixtures/`: clean, key drift, broken
ICU, sharp-s in code, German word in code and pseudo drift. `--write-pseudo` is tested by copying
a fixture to a temporary directory and regenerating the pseudo file twice.
