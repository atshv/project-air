# Architecture: services/ai

**Kind:** `service` · **Created in stage:** `later`

## Purpose

Coach and search: suggestions that never ghostwrite, summaries and semantic search. AI runs server-side only; every answer is validated against a schema (invalid means an error and no change); budget per person/day and global/month is reserved atomically before the call; model identifiers exist only as constants in one place; answers are in the person's language.

## Inputs

- Coach, search and summary requests typed by `packages/contracts`.
- Board and note content, the search index and the current budget records.

## Outputs

- Schema-validated suggestions, summaries and search results; an invalid answer is an error without a change.
- Atomic budget reservations and usage records.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-6` — AI runs server-side only; every answer is schema-validated; budget is reserved before each call; the coach never writes user text.
- `AD-8` — User-visible text comes only from translation files with English keys.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
