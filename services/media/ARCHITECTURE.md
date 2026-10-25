# Architecture: services/media

**Kind:** `service` · **Created in stage:** `later`

## Purpose

Files. It issues signed upload URLs, runs the virus check (still an owner decision), produces image thumbnails in several sizes for the engine's detail levels, renders PDF page images and extracts text for search. Files stay private per workspace and are delivered only through signed, short-lived URLs.

## Inputs

- Upload requests typed by `packages/contracts`, workspace permissions and stored objects.
- The object-storage bucket name from `.polier-slot`.

## Outputs

- Signed upload URLs and short-lived signed delivery URLs.
- Image thumbnails at several sizes, PDF page images and text excerpts for search.

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
