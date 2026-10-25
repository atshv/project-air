# Architecture: packages/editor

**Kind:** `package` · **Created in stage:** `later`

## Purpose

The note editor in the side panel. It keeps note content as structured JSON, derives plain text for search when saving, and supports `[[Link]]` suggestions with a suggestion list, the empty-note placeholder and focus behaviour.

## Inputs

- Note content as structured JSON typed by `packages/contracts`.
- Note identity and save state from the host app; base components from `packages/ui-kit`.

## Outputs

- Structured JSON content for the note.
- Plain text derived for search on save.
- Link suggestions for `[[Link]]`; save status, placeholder and focus in an empty note.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`, `packages/ui-kit`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
