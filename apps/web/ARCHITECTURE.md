# Architecture: apps/web

**Kind:** `app` · **Created in stage:** `later`

## Purpose

The product people see: start page, login, board list, board with the engine, panel with the editor, templates, library, search, settings and sharing. It reaches servers only through `packages/sdk` and never imports a service.

## Inputs

- User interactions, plus typed data from `packages/sdk`.
- Engine events from `packages/engine`, note content from `packages/editor`, tokens and components from `packages/ui-kit`, and contract types from `packages/contracts`.

## Outputs

- The product UI: start page, login, board list, board, editor panel, templates, library, search, settings and sharing.
- API calls only through `packages/sdk`, and UI text only from translation files.

## Invariants

- `AD-1` — Every change to board content is one operation from `packages/contracts` with its inverse; one gesture = one operation.
- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-4` — A note exists once; a card is only its placement on a board.
- `AD-6` — AI runs server-side only; every answer is schema-validated; budget is reserved before each call; the coach never writes user text.
- `AD-7` — Visual values come only from `packages/ui-kit/tokens.json` (CSS and C++ generated).
- `AD-8` — User-visible text comes only from translation files with English keys.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`, `packages/ui-kit`, `packages/editor`, `packages/engine`, `packages/sdk`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
