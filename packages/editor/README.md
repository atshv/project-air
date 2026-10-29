# packages/editor

Note editor (rich text, links).

- **Kind:** `package`
- **Created in stage:** `web-app` (P6-07)
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## P6-07: own editor for the contract 0.4.0 note body

Framework-agnostic contenteditable editor (ADR-0013: no rich-text library, no
React import) over the structured contract document
`{ version: "1", blocks: [...] }`:

- **Blocks:** `paragraph`, `heading` (level 1–6) and `list` (ordered/unordered).
  `Enter` splits a block (a heading continues as a paragraph, a list continues as
  a list), `Enter` on an empty list item returns it to a paragraph, `Tab` turns a
  paragraph into a list item and `Shift+Tab` turns it back.
- **Marks:** `bold`, `italic`, `code` and `link` (block-level in contract 0.4.0,
  via the `Mod+B` / `Mod+I` / `Mod+E` shortcuts or the controller API). Link hrefs
  use the contract allow-list (`https:`, `http:`, `mailto:`, no whitespace,
  ≤ 2048 characters); invalid hrefs never enter the document.
- **Paste/drop:** plain text only. HTML from the clipboard is reduced to text
  (scripts/styles removed, entities decoded) and can never become markup.
- **IME:** `compositionstart`/`compositionend` are tracked; changes are reported
  once after the composition ends and the host can flush its autosave then.
- **Selection:** the DOM is only rebuilt for structural changes; external
  `setBody` changes keep the caret by block index and offset.
- **Accessibility:** the editable surface is a `role="textbox"` with
  `aria-multiline` and an `aria-label` supplied by the host's message catalog.
- **Plain text:** derived only by `packages/contracts/plaintext.mjs`
  (`derivePlainText`, with a `plaintext.d.mts` declaration); the host sends the
  derived text/checks it before saving.
- **Limits:** the contract limits (1000 blocks, 10000 characters per block,
  50000 characters of derived plain text) are validated by `validateBody` /
  `assertBodyWithinLimits`, which throw the typed `NoteValidationError`.
- **Placeholder:** the empty-note placeholder (L06) is a generated `::before`
  from `data-placeholder`, never part of the editable content and never saved;
  only an empty note focuses the editor on open.

## API

```ts
import { createEditor } from "@project-air/editor";

const editor = createEditor({ ariaLabel, placeholder, initialBody, onChange });
editor.mount(hostElement);
editor.focus();                 // empty note: caret at the start
editor.getBody();               // contract 0.4.0 note body
editor.setBody(body, { preserveSelection: true });
editor.toggleMark("bold");      // bold / italic / code
editor.setLink("https://example.test");
```

The host app owns persistence: one save = one `updateNoteBody` operation with its
inverse, built in `apps/web/src/board/operations.ts` and sent through the SDK's
one autosave path.

## Commands

- `pnpm --filter ./packages/editor build` / `typecheck` — `tsc --noEmit`.
- `pnpm --filter ./packages/editor lint` — ESLint with the root config.
- `pnpm --filter ./packages/editor test` — pure `node --test` suites for the
  contract model round trip, plainText consistency, limits/marks/links, paste
  sanitising, Enter/Tab insertion and the placeholder/focus helper. DOM behaviour
  is covered by the web app's e2e task.
