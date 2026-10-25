# tools/dev

Per-slot setup and teardown for local development (P0-06, extended by P3-01; satisfies D2).

- **Kind:** `tool`
- **Created in stage:** `foundation`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## What the scripts do

Every worktree has a runtime slot: `.polier-slot` is written by
`python3 $POLIER/tools/slot.py acquire` and names the worktree's ports, PostgreSQL database
(`db_name`) and S3 bucket (`bucket`). The scripts read all of these values from that file; no
port, database name or bucket name is written in the scripts (AD-9).

`bash tools/dev/setup`:

1. Starts the shared local stack from [infra/compose/](../../infra/compose/README.md) with
   `docker compose -f infra/compose/compose.yaml up -d --wait` when it is not healthy. The stack is
   shared by every worktree and is never stopped by the scripts.
2. Creates the slot database with `psql` inside the `postgres` container; an existing database is
   kept.
3. Creates or repairs the restricted `app_user` role: `LOGIN`, no `SUPERUSER`, no `CREATEDB`,
   no `CREATEROLE`, no `REPLICATION` and, for AD-5, no `BYPASSRLS`. It never owns tables, so the
   row-level-security policies apply to it. The password comes from the `APP_USER_PASSWORD`
   environment variable or from the gitignored `infra/compose/.env`; when neither has one, a random
   password is generated and stored there (mode 600). The password is never printed.
4. Grants that role `CONNECT` on the slot database, `USAGE` on `public` (and on `app` once it
   exists) and `SELECT, INSERT, UPDATE, DELETE` on current and future tables and sequences created
   by the slot owner, without making it a table owner.
5. Creates the shared local identity database `projectair_kratos` for Ory Kratos (P3-01, configured
   in P3-03); an existing database is kept. One Kratos database serves every local slot — a
   local-development limitation documented in the compose README; tests never depend on it.
6. Creates the slot bucket with `weed shell` inside the `seaweedfs` container; an existing bucket is
   kept.
7. Prints the database and bucket names and verifies that the database, the role attributes, the
   grants and the bucket exist.

`bash tools/dev/reset-db` (P3-01):

1. Starts the shared stack when it is not running, then drops the slot database with
   `DROP DATABASE … WITH (FORCE)` and recreates it.
2. Re-runs `bash tools/dev/setup` so the role grants, the identity database and the bucket are in
   place again.
3. Applies the migrations from `infra/migrations/` with the platform migration runner (Node runs
   the TypeScript source directly). The repository must be installed (`pnpm install`) for that.
4. Leaves the shared stack, the shared Kratos database and every other slot untouched.

`bash tools/dev/teardown`:

1. Ensures the shared stack is running, so the containers can drop the slot resources; it leaves
   the stack running.
2. Drops the slot database with `DROP DATABASE … WITH (FORCE)`; a missing database is not an error.
3. Deletes the slot bucket with `s3.bucket.delete`; a missing bucket is not an error.

The scripts are idempotent: a second `setup` keeps the existing database, role and bucket and exits
0; a second `teardown` finds nothing to remove and exits 0.

## Usage

From the worktree root:

```bash
python3 "$POLIER/tools/slot.py" acquire   # once per worktree, writes .polier-slot
bash tools/dev/setup
bash tools/dev/reset-db                   # destructive: this slot's database only
bash tools/dev/teardown
```

The scripts resolve the worktree root from their own location, so they also work when called from
another directory. They need Docker with Compose and Python 3 (standard library only); nothing is
installed and no host `psql`, `aws` or `minio` client is used.

## Safety rules

- **Slot 0 is refused.** Slot 0 belongs to the owner's main checkout. All scripts exit non-zero
  with a clear message and change nothing when `.polier-slot` says slot 0. No script resets, drops
  or recreates slot 0 data.
- **Only this worktree's slot is touched.** The database and bucket names come from the worktree's
  `.polier-slot`; the scripts also refuse values whose `_slot_<N>`/`-slot-<N>` suffix does not match
  the slot number, and a slot file that names a different worktree.
- **Never `docker compose down -v`.** The shared volumes hold every slot's data. The scripts never
  pass `-v`, never remove volumes and never run `docker compose down`.
- **The shared stack is started but never stopped.** `setup`, `reset-db` and `teardown` bring the
  shared stack up when it is not running and leave it running. Stop it manually with
  `docker compose -f infra/compose/compose.yaml down` when no worktree needs it; the volumes are
  kept.
- **The identity database is shared.** `projectair_kratos` is local-only and is never dropped by
  these scripts; dropping it would lose every local identity.
- **No secrets are printed.** The scripts use the PostgreSQL role through the container
  environment (`$POSTGRES_USER`) and print only database, role and bucket names, never passwords or
  connection strings.

## Gate

The `dev-setup` gate (see [docs/quality.md](../../docs/quality.md)) runs:

```bash
python3 $POLIER/tools/slot.py acquire && bash tools/dev/setup
```

## References

- Compose stack start, stop and reset: [infra/compose/README.md](../../infra/compose/README.md)
- Quality gates: [docs/quality.md](../../docs/quality.md)
- Architecture and invariant `AD-9`: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- PostgreSQL gates (migrations, app role): [docs/gates/postgres.md](../../docs/gates/postgres.md)
