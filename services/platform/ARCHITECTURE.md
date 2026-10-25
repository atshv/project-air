# Architecture: services/platform

**Kind:** `service` · **Created in stage:** `backend-core` (P3-01; API routes P3-04)

## Purpose

Durable data and rights. It serves the HTTP API for workspaces, members, boards, notes, links, templates and file metadata, and checks permission on every access. PostgreSQL row-level security is the second line of defence, so a foreign workspace stays unreadable even if the API logic is wrong. Services talk to each other over HTTP only, never by import.

## Inputs

- HTTP requests typed by `packages/contracts` (REST envelopes of contract 0.1.0).
- Session and identity evidence from `services/auth`; workspace permissions from PostgreSQL.
- SQL migrations from `infra/migrations/` and a PostgreSQL connection.

## Outputs

- The HTTP API for workspaces, boards, notes and cards, plus templates and file metadata.
- Durable rows under row-level security, an audit log for permission changes and 30-day trash.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-4` — A note exists once; a card is only its placement on a board.
- `AD-5` — Authorisation is checked twice: in the API and by PostgreSQL row-level security.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Layers

`src/http/` is the transport layer (router with `:param` paths, contract error envelope, UUIDv7 request ids, health); `src/auth/` is the HTTP adapter to `services/auth` for the single session check (AD-5); `src/db/` holds the pools, the migration runner, the per-request `app_user` transaction and the Kratos-identity → UUIDv7 account mapping; `src/api/` holds the session route (`GET /v1/session`), the resource routes, entity mapping, explicit validation, cursor pagination and the permission checks.

## Commands

Node comes from `.nvmrc`; ESM only, strict TypeScript, tests with `node:test`. Run from the
repository root with `pnpm --filter ./services/platform <script>`.

| Script | What it runs |
| --- | --- |
| `build` | `tsc --project tsconfig.json` into `dist/` |
| `typecheck` | `tsc --noEmit --project tsconfig.json` |
| `lint` | `eslint --max-warnings=0 .` |
| `test` | `node --test --test-concurrency=1 test/*.test.mjs test/migrations/*.test.mjs` |
| `start` | `node dist/index.js` |

The `api-tests` gate runs `node --test services/platform/test/api/*.test.mjs` against the slot
database and both in-process services.

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
