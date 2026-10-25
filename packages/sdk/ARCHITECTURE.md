# Architecture: packages/sdk

**Kind:** `package` · **Created in stage:** `later`

## Purpose

A typed client for every server call, so `apps/web` never assembles URLs itself. It covers the platform HTTP API and the sync WebSocket behind methods such as `api.boards.list()`, `api.notes.update()` and `sync.connect(boardId)`, always typed from the contracts.

## Inputs

- Generated contract types from `packages/contracts`.
- HTTP and WebSocket endpoints of `services/platform` and `services/sync`, plus a session token supplied by the caller.

## Outputs

- The typed API client and the typed sync client.
- Typed requests and responses that leave no URL construction to `apps/web`.

## Invariants

- `AD-2` — The server is the source of truth; the engine holds a working copy and never talks to the network.
- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
