# Architecture: tools/import-export

**Kind:** `tool` · **Created in stage:** `later`

## Purpose

Takes data in and out: import from common whiteboard export formats (which formats is still an open owner question after a legal check) and export as PDF, PNG, Markdown-ZIP and the project's own lossless JSON format. It ships as a library and a CLI.

## Inputs

- External whiteboard export files and board JSON typed by `packages/contracts`.
- The contract schemas as the target format.

## Outputs

- Boards as contract JSON plus a per-object import report.
- PDF, PNG, Markdown-ZIP and lossless JSON exports.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
