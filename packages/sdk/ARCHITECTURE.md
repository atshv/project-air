# Architecture: packages/sdk

**Kind:** `package` · **Created in stage:** `backend-core` (P3-05)

## Purpose

A typed client for the platform HTTP API, so no caller assembles URLs or parses envelopes itself. The SDK is dependency-free, uses only `fetch` (injected), and always carries the contract error. `apps/web` and the stage acceptance use it; the sync WebSocket client is added later.

## Inputs

- Generated contract types from `packages/contracts` (type-only import).
- The platform base URL and a session: a Kratos cookie (`{ cookie }`) or a non-production test session (`{ testSession }`).
- A `fetch` implementation from the host (browser or Node 18+); an optional UUIDv7 request-id factory for tests.

## Outputs

- `createClient({baseUrl, session})` with typed `workspaces`, `boards`, `notes` and `cards` resources (list, get, create, update, delete).
- Contract envelopes as typed values: `ListResult<T>` (`items`, `nextCursor`, `requestId`), the entity, or `DeleteResult`.
- A typed `ApiError` with `status`, `code`, `messageKey`, `requestId` and `details.fields`.

## Invariants

- `AD-2` — The server is the source of truth; the SDK never caches or writes locally.
- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- The SDK imports nothing but `packages/contracts` and host APIs; no runtime dependency, no deep import into `services/`.
- Request ids are never dropped: success envelopes and errors both expose the `requestId`.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Layers

`src/transport.ts` owns base URL, session headers, request ids and the single fetch call; `src/envelopes.ts` parses the three success envelopes and maps errors; `src/errors.ts` is the typed `ApiError`; `src/workspaces.ts`, `boards.ts`, `notes.ts` and `cards.ts` are one resource each; `src/client.ts` wires them; `src/index.ts` is the public surface.

## Commands

| Script | What it runs |
| --- | --- |
| `build` | `tsc --project tsconfig.json` into `dist/` |
| `typecheck` | `tsc --noEmit --project tsconfig.json` |
| `lint` | `eslint --max-warnings=0 .` |
| `test` | `node --test test/*.test.mjs` |

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- API and session model: [ADR-0008](../../docs/adr/ADR-0008-api-session-model.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
