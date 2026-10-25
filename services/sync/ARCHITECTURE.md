# Architecture: services/sync

**Kind:** `service` · **Created in stage:** `later`

## Purpose

Realtime. It exposes a WebSocket endpoint per board, distributes CRDT updates and presence (cursor, selection, name, colour), persists updates immediately in PostgreSQL and compacts them into snapshots. Scope for v1: 25 people per board, reconnect catch-up, merging offline changes and horizontal scaling; a restart must lose no acknowledged change.

## Inputs

- CRDT updates and presence from clients over WebSocket, using the sync protocol from `packages/contracts` and `BoardDoc` from `packages/crdt`.
- Permission checks from `services/platform` and session evidence from `services/auth`, over HTTP.

## Outputs

- Broadcast CRDT updates and presence (cursor, selection, name, colour).
- A durable PostgreSQL update log, periodic snapshots and the reconnect catch-up stream.

## Invariants

- `AD-1` — Every change to board content is one operation from `packages/contracts` with its inverse; one gesture = one operation.
- `AD-2` — The server is the source of truth; the engine holds a working copy and never talks to the network.
- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`, `packages/crdt`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
