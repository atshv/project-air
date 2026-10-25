# tools/release

Change entries, changelog gate and release commands.

- **Kind:** `tool`
- **Created in stage:** `foundation`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Change entries

Every code change carries one entry in `.changes/`; the `changelog-entry` gate rejects code
changes without a valid entry. The release tooling collects the entries into `CHANGELOG.md`;
agents never edit that file.

- `pnpm run change -- <area> <kind> "<summary>"` — writes the entry for the task on the current
  `task/<ID>` branch.
- `node tools/release/change.mjs --task <ID> --area <area> --kind <kind> "<summary>"` — explicit
  form; an existing file is only replaced with `--force`.
- `node tools/release/check-changes.mjs --task <ID> --base main` — the `changelog-entry` gate:
  committed changes against `--base` plus the working tree; exit 0 clean, 1 missing or invalid
  entry, 2 usage or configuration error. `--no-changelog "<reason>"` is the owner-only exception.
- `pnpm --filter ./tools/release test` — unit tests in temporary git repositories.

Areas, kinds and the file naming are documented in [.changes/README.md](../../.changes/README.md).
