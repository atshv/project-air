# Gate Catalogue: PostgreSQL

> Project gates for the backend core. Database names come from `.polier-slot`
> (`<project>_slot_<N>`), never from a hard-coded string. The local server is the Compose
> `postgres` service; one server per machine, one database and one app role per slot.

| Gate | Command | Expected |
| --- | --- | --- |
| `db-migrate` | `node services/platform/dist/db/migrate.js` (reads `DATABASE_URL`) | exit 0, migrations applied, ids recorded in `schema_migrations` |
| `api-tests` | `node --test services/platform/test/api/*.test.mjs` | exit 0, every route has an allow and a deny case |
| `rls-tests` | `node --test services/platform/test/rls/*.test.mjs` | exit 0, a second account sees nothing (exclusive) |
| `db-reset` | `bash tools/dev/reset-db` (drops and recreates the slot database, runs migrations) | exit 0, empty schema rebuilt |

## Roles and security

- The migration runner connects as the slot owner (Compose `POSTGRES_USER`).
- Application code and the RLS tests connect as the restricted `app_user` role: no `SUPERUSER`,
  no `BYPASSRLS`, no table ownership. Only it is subject to the row-level-security policies.
- The API sets `app.account_id` (via `SET LOCAL`) inside every transaction before it queries;
  policies compare the row's workspace against `workspace_members` for that account.
- Never print, log or commit `DATABASE_URL` or role passwords; they come from `.polier-slot` and
  the environment (`.env.example` lists names only).

## Local commands

```sh
docker compose -f infra/compose/compose.yaml up -d --wait
bash tools/dev/setup                       # creates the slot database, app role and buckets
node services/platform/dist/db/migrate.js  # applies migrations to the slot database
```

- One database and one app role per slot; never touch slot 0's data.
- `db-reset` and the RLS tests are destructive/order-sensitive: mark tasks with
  `"exclusive": ["db"]` and run them only against your slot.
- Close pools in `after()` hooks; set a statement timeout so a lock wait fails instead of hanging.
- Never edit an applied migration; add a new numbered migration.

## Pitfalls

- A failing migration leaves the slot database dirty: run `db-reset`, then migrate again.
- RLS is invisible to a superuser: a green test as `POSTGRES_USER` proves nothing. Always test as
  `app_user`.
- `SET LOCAL` only lives inside a transaction; leaking a connection without resetting the setting
  hands the next request a foreign account.
- Tests that share rows must create their own accounts/workspaces; never rely on another test.
- Ports and database names come from the slot formula, not 5432/`projectair`.
