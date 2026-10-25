# services/platform

HTTP API: workspaces, boards, notes, permissions.

- **Kind:** `service` · **Created in stage:** `backend-core` (P3-01; API routes P3-04)
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Runtime

Node ESM TypeScript without a framework: `node:http` router, `node:crypto` request ids and structured
logging on `process`. The API connects to PostgreSQL as the restricted `app_user` role and runs every
request in one transaction with `SET LOCAL app.account_id` (AD-5); sessions come from
`services/auth`. Run scripts from the repository root with `pnpm --filter ./services/platform <script>`.

| Script | Command | Purpose |
| --- | --- | --- |
| `build` | `tsc --project tsconfig.json` | writes `dist/` (`dist/index.js`, `dist/db/migrate.js`) |
| `typecheck` | `tsc --noEmit --project tsconfig.json` | type check |
| `lint` | `eslint --max-warnings=0 .` | shared flat config |
| `test` | `node --test --test-concurrency=1 test/*.test.mjs test/migrations/*.test.mjs` | router, config, health and migration/RLS tests |
| `start` | `node dist/index.js` | the HTTP service |

The API contract suite is separate and needs the slot stack:
`node --test services/platform/test/api/*.test.mjs` (`api-tests` gate; it resets and migrates the
slot database and boots both services in-process).

## Configuration

The environment is parsed once at start-up; a missing or invalid value stops the process with
exit code 2 and a message that names the variable. Values are never logged.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | owner connection: migrations and operations |
| `APP_DATABASE_URL` | yes | restricted `app_user` connection used by the API (AD-5) |
| `AUTH_SERVICE_URL` | yes | base URL of `services/auth`, e.g. `http://127.0.0.1:4120` |
| `PORT` | yes | HTTP port from `.polier-slot` (platform port) |
| `NODE_ENV` | no | `development` (default), `test` or `production` |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn` or `error` |
| `HOST` | no | bind address, default `127.0.0.1` |

## Endpoints

Contract: [packages/contracts](../../packages/contracts/README.md) `0.1.0`
([schemas/api/](../../packages/contracts/schemas/api/) and [docs/contracts.md](../../docs/contracts.md)).

| Method and path | Answer |
| --- | --- |
| `GET /health` | 200 liveness `{requestId, data:{status, service}}` |
| `GET /health/ready` | 200 when the database answers; 503 `INTERNAL` otherwise |
| `GET /v1/workspaces` | member workspaces, `{requestId, items, nextCursor}` |
| `POST /v1/workspaces` | create a workspace owned by the caller |
| `GET/PATCH/DELETE /v1/workspaces/:id` | workspace; update = owner/editor, delete = owner |
| `GET/POST /v1/workspaces/:id/boards` | boards of a workspace; create = owner/editor |
| `GET/PATCH/DELETE /v1/boards/:id` | board; write = owner/editor |
| `GET/POST /v1/workspaces/:id/notes` | notes of a workspace; create = owner/editor |
| `GET/PATCH/DELETE /v1/notes/:id` | note; write = owner/editor, delete with cards = 409 |
| `GET/POST /v1/boards/:id/cards` | cards of a board; create = owner/editor |
| `GET/PATCH/DELETE /v1/cards/:id` | card; write = owner/editor |

- Reads are allowed for every workspace member (`owner`, `editor`, `reader`); a non-member receives
  `NOT_FOUND` (no existence leak).
- Envelopes: list `{requestId, items, nextCursor}`, single `{requestId, workspace|board|note|card}`,
  delete `{requestId, deletedId}`, error `{requestId, code, messageKey, details?}` with one of the
  seven contract codes and a UUIDv7 request id. Mutations echo the body `requestId`; GETs accept an
  optional `?requestId=` (or the `x-request-id` header).
- Validation is explicit (no library): ADR-0004 lengths, page size 1–100, opaque cursor over
  `(created_at, id)`, UUIDv7 ids, card geometry/z limits. `details.fields` names the invalid paths.

## Migrations

`node src/db/migrate.ts` (or `dist/db/migrate.js` after a build) reads `DATABASE_URL` and applies
`infra/migrations/*.sql` in file-name order, recording each version with its SHA-256 checksum in
`schema_migrations`. `bash tools/dev/reset-db` recreates the slot database and migrates it.

## Tests

`pnpm --filter ./services/platform test` needs the shared Compose stack (PostgreSQL). The test
helper uses `DATABASE_URL` when set, otherwise it derives the slot owner connection from
`.polier-slot` and the local Compose defaults.

`node --test services/platform/test/api/*.test.mjs` (the `api-tests` gate) additionally needs the
`infra/compose/.env` app_user password written by `tools/dev/setup`; it resets the slot database,
starts `services/auth` in test mode and asserts an allow and a deny case for every route.
