# Architecture: tools/release

**Kind:** `tool` · **Created in stage:** `foundation`

## Purpose

Change entries and release commands. It keeps `.changes` entries and `CHANGELOG.md` coherent and provides the release and dry-run checks that CI runs from a tag of a clean `main`; agents never publish. It backs the `changelog-entry` and `release-dry` gates.

## Inputs

- `.changes` entries, `CHANGELOG.md`, the version and tag state, and the state of `main`.

## Outputs

- Changelog entries and the release/dry-run command output.
- The exit codes consumed as the `changelog-entry` and `release-dry` gates.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.
- `AD-10` — Releases are built by CI from tags of a clean `main`; agents never publish.
- The tools never write `CHANGELOG.md`; only the release tooling does, from `.changes/` entries.

## Allowed imports

None. `board.json` -> `packages[]` -> `may_import` is empty, so this package imports no other workspace package. It uses Node.js built-ins only and has no dependencies.

## Commands

- `pnpm run change -- <area> <kind> "<summary>"` — write `.changes/<task-id>-<short-name>.md`; the task id comes from the branch `task/<ID>`.
- `node tools/release/change.mjs --task <ID> --area <area> --kind <kind> "<summary>"` — same, explicit; `--force` overwrites.
- `node tools/release/check-changes.mjs --task <ID> --base main` — `changelog-entry` gate; exit 0 clean, 1 missing or invalid entry, 2 usage or configuration.
- `pnpm --filter ./tools/release test` — unit tests (Node built-in test runner, temporary git repositories).

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
