# Web message files

User-visible text of `apps/web` lives here, not in components (AD-8).

| File | Language | Role |
| --- | --- | --- |
| `de.json` | German (`de-DE`) | source language, complete |
| `en.json` | English | second language, always the same keys as `de.json` |
| `en-XA.json` | pseudo-locale | generated from `de.json`, layout tests only, never shipped |

The format is ICU MessageFormat as JSON, nested by area. The keys are English and stay German-free:
a German text is only ever a value.

## Key rules

- Keys are English `lowerCamelCase` path segments, grouped by place and purpose
  (`canvas.toolbar.addNote`, `errors.boardNotFound`), never the German text.
- A sentence is one key with named placeholders, for example
  `canvas.selection.count`: `{count, plural, one {# Element ausgewählt} other {# Elemente ausgewählt}}`.
  Never concatenate sentences in code.
- Every locale has exactly the same keys and the same placeholder names. A new key is added to
  every locale in the same change.
- Plural and select messages carry an `other` branch; plural messages for German and English also
  carry `one`.

## German values

- Du-Form, short labels, no exclamation marks, no technical terms; see `docs/i18n/style-de.md`.
- Always `ss`, never the German sharp-s character; terms follow `docs/i18n/glossary.md`.
- Placeholders are named and never translated (`{count}`, `{name}`).

## Error keys

The REST API error envelope (`packages/contracts/schemas/api/errors.schema.json`) names a stable,
language-neutral UPPER_SNAKE wire `code` and a required `messageKey`. The key is exactly
`errors.<camelCase(code)>`, because every key segment must be English `lowerCamelCase`:

| Code | Message key |
| --- | --- |
| `AUTH_REQUIRED` | `errors.authRequired` |
| `FORBIDDEN` | `errors.forbidden` |
| `NOT_FOUND` | `errors.notFound` |
| `VALIDATION` | `errors.validation` |
| `CONFLICT` | `errors.conflict` |
| `RATE_LIMITED` | `errors.rateLimited` |
| `INTERNAL` | `errors.internal` |

Never rename a code to fit a key: the code stays UPPER_SNAKE and the key stays lowerCamelCase. The
seven keys live under `errors` here; `language-check` requires them in every locale, and
`packages/contracts/test/api-errors.test.mjs` checks the mapping.

## The pseudo-locale `en-XA`

`en-XA.json` is generated deterministically from `de.json`: every literal character gets an
accented lookalike, each text segment grows by about 40 % and is wrapped in `[...]`. Placeholders
and ICU syntax stay unchanged. The result is deliberately not a real language; it exists so e2e
runs can show clipped or hard-coded text.

Regenerate it after any change to `de.json`:

```sh
node tools/language-check/index.mjs . --write-pseudo
```

The generator writes sorted keys with two-space indentation, so a second run produces no diff.
Do not add `en-XA` to the shipped languages.

## Add a language

1. Copy `en.json` to `<locale>.json` (BCP 47, for example `fr.json`).
2. Translate the values only: keep every key and every placeholder name.
3. Keep the ICU structure, including plural and select branches.
4. Run `node tools/language-check/index.mjs .` and fix every finding.
5. Add the locale to the language list of the app when the framework is chosen (web-app stage).
