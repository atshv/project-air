# services/auth

Accounts, sessions, invitations.

- **Kind:** `service` · **Created in stage:** `backend-core` (P3-01, Kratos integration P3-03)
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)
- **Identity decision:** [ADR-0007](../../docs/adr/ADR-0007-auth.md)

## Runtime

Node ESM TypeScript without a framework: `node:http` router, `node:crypto` request ids and HMAC,
structured logging on `process`, a `pg` pool and thin `fetch` clients for the Ory Kratos public and
admin APIs. Run scripts from the repository root with `pnpm --filter ./services/auth <script>`.

| Script | Command | Purpose |
| --- | --- | --- |
| `build` | `tsc --project tsconfig.json` | writes `dist/` (`dist/index.js`, `dist/db/migrate.js`) |
| `typecheck` | `tsc --noEmit --project tsconfig.json` | type check |
| `lint` | `eslint --max-warnings=0 .` | shared flat config |
| `test` | `node --test test/*.test.mjs` | router, config, health, Kratos client, session, invitation and test-session tests |
| `start` | `node dist/index.js` | the HTTP service |

Tests import the TypeScript sources directly (Node type stripping); they use a stub Kratos HTTP
server, so no build, Docker or live Kratos is needed.

## Configuration

The environment is parsed once at start-up; a missing or invalid value stops the process with
exit code 2 and a message that names the variable. Values are never logged.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL URL of the slot database |
| `AUTH_PORT` | yes | HTTP port from `.polier-slot` (auth port) |
| `AUTH_SESSION_SECRET` | yes | at least 32 characters; signs the HMAC test sessions |
| `KRATOS_PUBLIC_URL` | yes | Kratos public API, e.g. `http://127.0.0.1:8433` |
| `KRATOS_ADMIN_URL` | yes | Kratos admin API, e.g. `http://127.0.0.1:8434` |
| `KRATOS_ADMIN_TOKEN` | yes | shared bearer token for `POST /internal/invitations`, at least 16 characters |
| `AUTH_TEST_MODE` | no | `1` enables the test-session mode; impossible with `NODE_ENV=production` |
| `NODE_ENV` | no | `development` (default), `test` or `production` |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn` or `error` |
| `HOST` | no | bind address, default `127.0.0.1` |

Every secret comes from the environment and is never echoed; `tools/dev/setup` generates the local
cookie/cipher secrets and the admin token into the gitignored `infra/compose/.env`.

## Endpoints (P3-03)

| Method and path | Answer |
| --- | --- |
| `GET /health` | 200, liveness: `{ "status": "ok", "service": "auth" }` |
| `GET /health/ready` | 200 when the database and Kratos are reachable; 503 `INTERNAL` otherwise |
| `GET /session` | forwards the session cookie to Kratos `/sessions/whoami`; 200 `{ accountId, email, displayName }`; 401 `AUTH_REQUIRED` without a valid session. This is also the validation path of the sync service's browser WebSocket handshake (it forwards the upgrade cookie unchanged, P6-09) |
| `POST /internal/invitations` | admin-token protected; creates the Kratos identity via the admin API and returns `{ identityId, email }`; 401 without the token, 409 `CONFLICT` on a duplicate e-mail |
| `POST /test/session` | test mode only; mints an HMAC test session for integration tests |

Success responses use `{ "requestId", "data" }`. Every error uses the contract 0.1.0 envelope
`{ "requestId", "code", "messageKey", "details"?: { "fields": […] } }` with one of the seven
contract codes (`AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`,
`RATE_LIMITED`, `INTERNAL`) and a UUIDv7 request id; the `x-request-id` header mirrors it.

## Identity store

Kratos owns identities, credentials, sessions, magic links and verification e-mails (ADR-0007);
this service keeps no password or credential data. The Kratos configuration
([infra/kratos/kratos.yml](../../infra/kratos/kratos.yml)), identity schema and the Compose
`identity` profile are described in [infra/kratos/README.md](../../infra/kratos/README.md):

```bash
bash tools/dev/setup
docker compose -f infra/compose/compose.yaml --profile identity up -d --wait
```

## Test sessions

Only with `AUTH_TEST_MODE=1` and `NODE_ENV` other than `production`: `POST /test/session` mints
`base64url(accountId).base64url(expiry).signature` (HMAC-SHA256 with `AUTH_SESSION_SECRET`, TTL at
most one hour) and `GET /session` accepts it through the `x-test-session` header. The production
start-up refuses the test mode.
