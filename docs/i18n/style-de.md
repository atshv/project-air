# German style (de-DE)

Binding for every German value in the message files and for every German text the project shows.
Locale: `de-DE` (Swiss German spelling: always `ss`, never the German sharp-s character, never a
replacement by `sz`).

## Voice

- **Du-Form.** The person is addressed as "du": "Deine Notiz", "Öffne ein Board", "Bitte erneut
  versuchen". Never "Sie", never "man".
- **Calm and short.** A button is at most two words, a tooltip at most three, an error at most one
  sentence plus what the person can do.
- **No exclamation marks.** Never "Ups", never marketing tone, never a joke at the person's cost.
- **No technical terms.** No node, block ID, payload, token, request. Say what the person sees and
  does: "Notiz", "Karte", "Board".
- **One term per thing.** Use the entries of `docs/i18n/glossary.md`; never two words for the same
  thing and never one word for two things.

## Spelling and numbers

- Always `ss` where standard German writes the sharp-s character: "Schliessen", "Vergrössern",
  "Grösse", "gross". The sharp-s character must not appear in any message value or i18n document.
- Umlauts stay umlauts: "öffnen", "löschen", "für", "gehört".
- Format numbers, dates, times and lists with `Intl` in `de-DE`; display times in `Europe/Zurich`,
  store UTC. Never build a formatted number or date by hand.
- Use a real ellipsis "…", not three dots.
- Typographic quotes are „so“; the apostrophe stays straight.

## Placeholders and sentences

- One sentence is one message key. Never concatenate: no `t("a") + t("b")`, no template string with
  two texts.
- Placeholders are named and stay in every translation: `{count}`, `{name}`, `{total}`.
- The sentences around a placeholder must work for every value; German plural rules live in the
  ICU `plural` branches, not in code.

## Examples (from `apps/web/messages/de.json`)

| Good | Why |
| --- | --- |
| „Notiz hinzufügen“ | button, two words, verb first |
| „Speichert …“ | save status, calm, no exclamation mark |
| „Gespeichert“ | short confirmation |
| „Nicht gespeichert – erneut versuchen“ | error names the action |
| „Dieses Board gibt es nicht oder es gehört nicht zu deinem Konto.“ | one sentence, tells the person what is true |
| „Bitte melde dich erneut an.“ | one sentence plus the next step |

## Review

Every German change is checked by `node tools/language-check/index.mjs .` (gate `language-check`):
key parity, ICU syntax, placeholders, `ss`, and German text outside the message files. Style
questions go into `open_questions`; do not weaken the rule silently.
