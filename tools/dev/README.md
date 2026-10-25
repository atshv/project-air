# tools/dev

Per-slot setup and teardown for local development (P0-06, satisfies D2).

- **Kind:** `tool`
- **Created in stage:** `foundation`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## What the scripts do

Every worktree has a runtime slot: `.polier-slot` is written by
`python3 $POLIER/tools/slot.py acquire` and names the worktree's ports, PostgreSQL database
(`db_name`) and S3 bucket (`bucket`). The two scripts read all of these values from that file; no
port, database name or bucket name is written in the scripts (AD-9).

`bash tools/dev/setup`:

1. Starts the shared local stack from [infra/compose/](../../infra/compose/README.md) with
   `docker compose -f infra/compose/compose.yaml up -d --wait` when it is not healthy. The stack is
   shared by every worktree and is never stopped by the scripts.
2. Creates the slot database with `psql` inside the `postgres` container; an existing database is
   kept.
3. Creates the slot bucket with `weed shell` inside the `seaweedfs` container; an existing bucket is
   kept.
4. Prints the database and bucket names and verifies that both exist.

`bash tools/dev/teardown`:

1. Ensures the shared stack is running, so the containers can drop the slot resources; it leaves
   the stack running.
2. Drops the slot database with `DROP DATABASE … WITH (FORCE)`; a missing database is not an error.
3. Deletes the slot bucket with `s3.bucket.delete`; a missing bucket is not an error.

Both scripts are idempotent: a second `setup` keeps the existing database and bucket and exits 0; a
second `teardown` finds nothing to remove and exits 0.

## Usage

From the worktree root:

```bash
python3 "$POLIER/tools/slot.py" acquire   # once per worktree, writes .polier-slot
bash tools/dev/setup
bash tools/dev/teardown
```

The scripts resolve the worktree root from their own location, so they also work when called from
another directory. They need Docker with Compose and Python 3 (standard library only); nothing is
installed and no host `psql`, `aws` or `minio` client is used.

## Safety rules

- **Slot 0 is refused.** Slot 0 belongs to the owner's main checkout. Both scripts exit non-zero
  with a clear message and change nothing when `.polier-slot` says slot 0. No script resets, drops
  or recreates slot 0 data.
- **Only this worktree's slot is touched.** The database and bucket names come from the worktree's
  `.polier-slot`; the scripts also refuse values whose `_slot_<N>`/`-slot-<N>` suffix does not match
  the slot number, and a slot file that names a different worktree.
- **Never `docker compose down -v`.** The shared volumes hold every slot's data. The scripts never
  pass `-v`, never remove volumes and never run `docker compose down`.
- **The shared stack is started but never stopped.** `setup` and `teardown` bring the shared stack
  up when it is not running and leave it running. Stop it manually with
  `docker compose -f infra/compose/compose.yaml down` when no worktree needs it; the volumes are
  kept.
- **No secrets are printed.** The scripts use the PostgreSQL role through the container
  environment (`$POSTGRES_USER`) and print only database and bucket names, never passwords or
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
