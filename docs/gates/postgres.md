# Gate Catalogue: PostgreSQL

> Project gates for the backend core. Database names come from `.polier-slot`
> (`<project>_slot_<N>`), never from a hard-coded string. The local server is the Compose
> `postgres` service; one server per machine, one database per slot and one shared `app_user` role
> whose password is rotated by each worktree's `tools/dev/setup` (the last setup wins). Backend
> tasks run sequentially and are exclusive on `db`, so the shared role is safe; parallel worktrees
> must not run DB tests at the same time.

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
bash tools/dev/setup                       # creates the slot database, app role, identity database and bucket
node services/platform/dist/db/migrate.js  # applies migrations to the slot database
bash tools/dev/reset-db                    # drops/recreates the slot database, then migrates it
```

- The `unit` gate runs the migration test against the slot database. The test helper uses
  `DATABASE_URL` when set, otherwise it derives the slot owner connection from `.polier-slot` and
  the local Compose defaults; it refuses slot 0.
- The migration runner also runs from source under the pinned Node
  (`node services/platform/src/db/migrate.ts`, type stripping), which `tools/dev/reset-db` uses so
  resetting does not need a build.

- One database per slot and one shared `app_user` role (last `setup` wins); backend tasks are
  exclusive on `db` and run sequentially. Never touch slot 0's data.
- The backend suites live in `services/platform/test/migrations/`, `services/platform/test/api/`
  and `services/platform/test/rls/`; the `unit` gate runs the first two together.
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
