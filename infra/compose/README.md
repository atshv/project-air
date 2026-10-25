# Local services compose

Local development stack for Project air (task P0-07, satisfies D2): PostgreSQL, an S3-compatible
object store (SeaweedFS) and a mail catcher (Mailpit). One command starts all three with health
checks. The stack is **shared by every worktree** of this repository; it is started once per
machine and used from any checkout. Ports follow `AD-9`: only machine-wide services live here,
per-worktree values come from `.polier-slot`.

## Runtime

The local stack runs on **Docker Desktop for Mac** (owner decision, 2026-10-25): Docker Desktop
4.96.3, Docker Engine 29.9.2, Compose v5.6.1, context `desktop-linux`. Any Docker Engine with
Compose v2 works; always start and stop the stack with the same Docker context that owns it.
OrbStack may keep running side by side for other projects — this stack lives in the active Docker
context, not in a specific runtime. If an image pull fails with
`docker-credential-desktop: executable file not found`, either install the Docker Desktop CLI
tools or remove `"credsStore": "desktop"` from `~/.docker/config.json` (public images need no
credentials).

## Services

| Compose service | Image (tag and digest pinned in [compose.yaml](compose.yaml)) | Version | Licence | Host port (default) | Purpose |
| --- | --- | --- | --- | --- | --- |
| `postgres` | `postgres:17.11-alpine3.23` | PostgreSQL 17.11 | PostgreSQL licence (permissive exception: PostgreSQL is mandated by the blueprint) | `5433` | database server for every slot database |
| `seaweedfs` | `chrislusf/seaweedfs:4.50` | SeaweedFS 4.50 | Apache-2.0 | `8333` | S3 API; master (`9333`) and filer (`8888`) stay inside the compose network |
| `mailpit` | `axllent/mailpit:v1.32.0` | Mailpit 1.32.0 | MIT | `1025` (SMTP), `8025` (web inbox) | catches development e-mail and shows it in a web inbox |

Upstream sources: <https://hub.docker.com/_/postgres>, <https://github.com/seaweedfs/seaweedfs>,
<https://github.com/axllent/mailpit>. The lead adds these rows to `docs/versions.md`.

Every published port binds to `127.0.0.1` only. All host ports are **outside the slot range
4000-4999**, so two worktrees never collide with these shared services. Every service has a
health check: `pg_isready` for PostgreSQL, `GET /cluster/healthz` for SeaweedFS and `mailpit readyz`
for Mailpit.

## Start

From the repository root, one command:

```bash
docker compose -f infra/compose/compose.yaml up -d --wait
```

`--wait` blocks until all three services are `healthy` (well under 60 seconds on a warm image
cache) and exits 0. From another worktree the same command controls the same stack, because the
compose project name (`project-air-local`) is fixed in the file.

Check the state:

```bash
docker compose -f infra/compose/compose.yaml ps
```

Follow logs of one service:

```bash
docker compose -f infra/compose/compose.yaml logs -f postgres
```

## Stop

```bash
docker compose -f infra/compose/compose.yaml down
```

Stops and removes the three containers and the network. The named volumes (all local data) are
kept, so the next start resumes with the same databases, buckets and mails.

## Reset local data

```bash
docker compose -f infra/compose/compose.yaml down -v
docker compose -f infra/compose/compose.yaml up -d --wait
```

`down -v` deletes the named volumes `postgres-data`, `seaweedfs-data` and `mailpit-data` — that is
**every local database, bucket and mail of every slot**, including slot 0. Run it only when all
local data may be lost, then start the stack again and rerun `tools/dev/setup` (P0-06) to recreate
the per-slot database and bucket.

**No script resets slot 0 data.** Slot 0 is the owner's main checkout; the tooling reads its
`.polier-slot` but never drops or recreates slot 0's database or bucket. The reset above is a
manual, explicit command a person runs against the shared stack, not a script, and it removes
slot 0 data together with every other slot's data.

## Per-slot databases and buckets

This compose file creates only the base role and base database from the variables below. The
per-worktree database `project-air_slot_<N>` and bucket `project-air-slot-<N>` are **not** defined
here: they come from the `.polier-slot` of the worktree and are created by `tools/dev/setup`
(P0-06). Never hard-code a slot number, database name or bucket name in this folder.

## Host ports and variables

| Variable | Default | Container port | Service |
| --- | --- | --- | --- |
| `POSTGRES_HOST_PORT` | `5433` | `5432` | PostgreSQL |
| `SEAWEEDFS_S3_HOST_PORT` | `8333` | `8333` (S3 API) | SeaweedFS |
| `MAILPIT_SMTP_HOST_PORT` | `1025` | `1025` (SMTP) | Mailpit |
| `MAILPIT_HTTP_HOST_PORT` | `8025` | `8025` (web inbox) | Mailpit |

All of these defaults also work without any `.env` file. To override them, copy
[.env.example](.env.example) to `infra/compose/.env` and fill in local values. That `.env` file is
gitignored and must never be committed.

If a port is already in use on this machine, change the matching variable in
`infra/compose/.env` and start the stack again. Never stop the process that owns the port — it is
not part of this stack.

## Credentials

The variables and their local development defaults are in [compose.yaml](compose.yaml); the names
are listed in [.env.example](.env.example). The defaults are local-only fixture values for a
loopback-bound development stack, not secrets, and must never be reused outside a developer
machine. Real values go into the gitignored `infra/compose/.env`.

| Variable | Used for |
| --- | --- |
| `POSTGRES_USER` | base PostgreSQL role |
| `POSTGRES_PASSWORD` | password of that role |
| `POSTGRES_DB` | base database created on first start |
| `SEAWEEDFS_S3_ACCESS_KEY` | S3 access key ID |
| `SEAWEEDFS_S3_SECRET_KEY` | S3 secret access key |

Connections from the host:

- PostgreSQL: `postgresql://127.0.0.1:5433/<database>` with the role above.
- S3: endpoint `http://127.0.0.1:8333`, path-style addressing, the access key pair above.
- Mailpit: SMTP `127.0.0.1:1025`, web inbox <http://127.0.0.1:8025>.

Example queries:

```bash
docker compose -f infra/compose/compose.yaml exec postgres psql -U projectair -d projectair -c 'select version();'
docker compose -f infra/compose/compose.yaml exec seaweedfs weed shell -master=localhost:9333 -c 'cluster.check'
```

## Data location

All state is stored in Docker named volumes, never inside the repository:

| Volume | Mounted in | Contents |
| --- | --- | --- |
| `postgres-data` | `postgres` at `/var/lib/postgresql/data` | PostgreSQL data directory |
| `seaweedfs-data` | `seaweedfs` at `/data` | object store volumes and filer metadata |
| `mailpit-data` | `mailpit` at `/data` | captured mails |

## Validate the configuration

The gate `compose-config` (see [docs/quality.md](../../docs/quality.md)) is the compose CLI's own
validation:

```bash
docker compose -f infra/compose/compose.yaml config --quiet
```

It exits 0 and fails on unknown keys, unresolved variables or a malformed file. To list the three
services with their images and health checks, run the same command without `--quiet`.

## References

- Architecture and invariant `AD-9`: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Quality gates: [docs/quality.md](../../docs/quality.md)
- PostgreSQL gate catalogue: [docs/gates/postgres.md](../../docs/gates/postgres.md)
