# Architecture: services/platform

**Kind:** `service` · **Created in stage:** `later`

## Purpose

Durable data and rights. It serves the HTTP API for workspaces, members, boards, notes, links, templates and file metadata, and checks permission on every access. PostgreSQL row-level security is the second line of defence, so a foreign workspace stays unreadable even if the API logic is wrong. Services talk to each other over HTTP only, never by import.

## Inputs

- HTTP requests typed by `packages/contracts`.
- Session and identity evidence from `services/auth` and workspace permissions.
- SQL migrations from `infra/migrations/` and a PostgreSQL connection.

## Outputs

- The HTTP API for workspaces, members, boards, notes and links, plus templates and file metadata.
- Durable rows under row-level security, an audit log for permission changes and 30-day trash.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-4` — A note exists once; a card is only its placement on a board.
- `AD-5` — Authorisation is checked twice: in the API and by PostgreSQL row-level security.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
