# Architecture: tools/language-check

**Kind:** `tool` · **Created in stage:** `foundation`

## Purpose

The language and translation gate. It rejects German in code, user-visible text outside the message files and the German sharp-s character (which must be `ss`), and it checks that German and English message files share the same English keys. It is the `language-check` gate that enforces `AD-8` for `apps/web`, `services/auth` and `services/ai`.

## Inputs

- Source files and the English-keyed message files.
- The glossary and style rules in `docs/i18n/`.

## Outputs

- Findings with file and line for every violation.
- The exit code consumed as the `language-check` gate.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

None. `board.json` -> `packages[]` -> `may_import` is empty, so this package imports no other workspace package.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
