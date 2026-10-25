# services/auth

Accounts, sessions, invitations.

- **Kind:** `service` · **Created in stage:** `backend-core` (P3-01)
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)
- **Identity decision:** [ADR-0007](../../docs/adr/ADR-0007-auth.md)

## Runtime

Node ESM TypeScript without a framework: `node:http` router, `node:crypto` request ids, structured
logging on `process` and a `pg` pool. Run scripts from the repository root with
`pnpm --filter ./services/auth <script>`.

| Script | Command | Purpose |
| --- | --- | --- |
| `build` | `tsc --project tsconfig.json` | writes `dist/` (`dist/index.js`, `dist/db/migrate.js`) |
| `typecheck` | `tsc --noEmit --project tsconfig.json` | type check |
| `lint` | `eslint --max-warnings=0 .` | shared flat config |
| `test` | `node --test test/*.test.mjs` | router, config, health and migration-file tests |
| `start` | `node dist/index.js` | the HTTP service |

Tests import the TypeScript sources directly (Node type stripping); no build is needed to test.

## Configuration

The environment is parsed once at start-up; a missing or invalid value stops the process with
exit code 2 and a message that names the variable. Values are never logged.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL URL of the slot database |
| `AUTH_PORT` | yes | HTTP port from `.polier-slot` (auth port) |
| `AUTH_SESSION_SECRET` | yes | at least 32 characters; never logged or returned |
| `NODE_ENV` | no | `development` (default), `test` or `production` |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn` or `error` |
| `HOST` | no | bind address, default `127.0.0.1` |

## Endpoints (P3-01)

| Method and path | Answer |
| --- | --- |
| `GET /health` | 200, liveness: `{ "status": "ok", "service": "auth" }` |
| `GET /health/ready` | 200 when the database ping succeeds; 503 `SERVICE_UNAVAILABLE` when it does not |

Every response uses the JSON envelope `{ "requestId", "data" }` or
`{ "requestId", "error": { "code", "message" } }` and carries the `x-request-id` header. A client
`x-request-id` is kept when it is a plausible id, otherwise the router generates one.

## Identity store

The identity configuration for Ory Kratos (ADR-0007) arrives in P3-03; P3-01 only pins the image in
`infra/compose/compose.yaml` and creates the shared `projectair_kratos` database in
`tools/dev/setup`. Accounts, sessions and invitation routes are out of scope here.
