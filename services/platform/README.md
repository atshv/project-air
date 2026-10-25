# services/platform

HTTP API: workspaces, boards, notes, permissions.

- **Kind:** `service` · **Created in stage:** `backend-core` (P3-01)
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Runtime

Node ESM TypeScript without a framework: `node:http` router, `node:crypto` request ids, structured
logging on `process` and a `pg` pool. Run scripts from the repository root with
`pnpm --filter ./services/platform <script>`.

| Script | Command | Purpose |
| --- | --- | --- |
| `build` | `tsc --project tsconfig.json` | writes `dist/` (`dist/index.js`, `dist/db/migrate.js`) |
| `typecheck` | `tsc --noEmit --project tsconfig.json` | type check |
| `lint` | `eslint --max-warnings=0 .` | shared flat config |
| `test` | `node --test test/*.test.mjs` | router, config, health and migration tests |
| `start` | `node dist/index.js` | the HTTP service |

Tests import the TypeScript sources directly (Node type stripping); no build is needed to test.

## Configuration

The environment is parsed once at start-up; a missing or invalid value stops the process with
exit code 2 and a message that names the variable. Values are never logged.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL URL of the slot database |
| `PORT` | yes | HTTP port from `.polier-slot` (platform port) |
| `NODE_ENV` | no | `development` (default), `test` or `production` |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn` or `error` |
| `HOST` | no | bind address, default `127.0.0.1` |

## Endpoints (P3-01)

| Method and path | Answer |
| --- | --- |
| `GET /health` | 200, liveness: `{ "status": "ok", "service": "platform" }` |
| `GET /health/ready` | 200 when the database ping succeeds; 503 `SERVICE_UNAVAILABLE` when it does not |

Every response uses the JSON envelope `{ "requestId", "data" }` or
`{ "requestId", "error": { "code", "message" } }` and carries the `x-request-id` header. A client
`x-request-id` is kept when it is a plausible id, otherwise the router generates one.

## Migrations

`node src/db/migrate.ts` (or `dist/db/migrate.js` after a build) reads `DATABASE_URL` and applies
`infra/migrations/*.sql` in file-name order, recording each version with its SHA-256 checksum in
`schema_migrations`. It is idempotent and fails when an applied file changed or disappeared.
`bash tools/dev/reset-db` recreates the slot database and migrates it.

## Tests

`pnpm --filter ./services/platform test` needs the shared Compose stack (PostgreSQL; start it with
`bash tools/dev/setup`). The test helper uses `DATABASE_URL` when set, otherwise it derives the
slot owner connection from `.polier-slot` and the local Compose defaults. It refuses slot 0 and a
`.polier-slot` that belongs to another worktree.
