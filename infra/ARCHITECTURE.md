# Architecture: infra

**Kind:** `infra` · **Created in stage:** `foundation`

## Purpose

The shared substrate: container definitions, the local compose environment (PostgreSQL, S3, mail catcher, services), SQL migrations, infrastructure as code for the environments, backups and monitoring (logs, metrics, alarms). The sub-areas `containers/`, `compose/`, `migrations/` and `deploy/` are created by the tasks that fill them and are not created by P0-03.

## Inputs

- Service images and configuration; the deployment target; slot values from `.polier-slot` for local use.

## Outputs

- Container definitions, the local compose file, SQL migrations and environment definitions.
- Backup and monitoring configuration.

## Invariants

- `AD-5` — Authorisation is checked twice: in the API and by PostgreSQL row-level security.

## Allowed imports

None. `board.json` -> `packages[]` -> `may_import` is empty, so this package imports no other workspace package.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## Notes

The SQL migrations under `migrations/` are the second authorisation line of `AD-5`; local compose must take its ports, database and bucket names from `.polier-slot` (`AD-9`).

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../docs/module-map.md)
