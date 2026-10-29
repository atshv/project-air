# Architecture: packages/editor

**Kind:** `package` · **Created in stage:** `web-app` (P6-07)

## Purpose

The note editor in the side panel. It keeps note content as the contract 0.4.0
structured JSON document (`{ version: "1", blocks: [...] }`), derives plain text
for search when saving, and provides the empty-note placeholder and focus
behaviour, IME-safe editing and selection preservation. Framework-agnostic: no
React import and no rich-text library (ADR-0013); `[[Link]]` suggestions with a
suggestion list are a later value-stage task.

## Inputs

- Note content as the contract note body typed by `packages/contracts`.
- Note identity, save state and the accessible label/placeholder text from the
  host app; base visual values from `packages/ui-kit` tokens.

## Outputs

- The contract note body after every editing change, plus the deterministic
  `plainText` derived through `packages/contracts/plaintext.mjs`.
- Typed `NoteValidationError`s for contract size limits and invalid link hrefs.
- Placeholder visibility/focus helpers for the L06 empty note.

## Module layout

- `src/model/` — pure contract model: types, limits and typed errors, body
  serialise/deserialise, marks, Enter/Tab editing, plain-text paste sanitising,
  caret/placeholder helpers. No DOM; covered by `node --test`.
- `src/controller/editor-controller.ts` — the DOM contenteditable controller
  (mount/unmount, focus, selection, composition, paste/drop, mark/link API).
- `src/editor.css` — token-only editor styles including the generated
  `::before` placeholder.

## Invariants

- `AD-1` — every save is one contract operation with its inverse; the editor
  emits the body, the host builds the operation.
- `AD-3` — the document is the contract's JSON Schema shape.
- `AD-4` — the editor edits the referenced note; it never creates one.
- `AD-7` — visual values come only from `packages/ui-kit/tokens.json`.
- `AD-8` — no user-visible text in this package; the host passes label,
  placeholder and error keys.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` ->
`may_import`: `packages/contracts`, `packages/ui-kit`.

## Commands

- `pnpm --filter ./packages/editor build` / `typecheck` — `tsc --noEmit`.
- `pnpm --filter ./packages/editor lint` — ESLint with the root config.
- `pnpm --filter ./packages/editor test` — `node --test test/*.test.mjs`.
- Root gates: `pnpm build`, `pnpm typecheck`, `pnpm test --affected`.

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
- Editor contract: [docs/contracts.md](../../docs/contracts.md) (`0.4.0`)
