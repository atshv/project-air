# Change entries

Every **code** change carries exactly one entry in `.changes/`; docs, board, STATUS, plan, review
and changelog work does not need one. The `changelog-entry` gate rejects code changes without a
valid entry, and the release tooling collects the entries into [CHANGELOG.md](../CHANGELOG.md) at
release time.

The tooling lives in [tools/release/](../tools/release/README.md).

## Write an entry

```bash
pnpm run change -- <area> <kind> "<summary>"
```

The task id comes from the current branch `task/<ID>`; pass `--task <ID>` when the branch name
differs. The writer creates `.changes/<task-id>-<short-name>.md`. A file that already exists is
only replaced with `--force`. The writer never edits `CHANGELOG.md`.

> In pnpm 12 `pnpm change` is pnpm's own command; invoke the project script with
> `pnpm run change` (both `pnpm run change <area> <kind> "..."` and
> `pnpm run change -- <area> <kind> "..."` work).

Example:

```bash
pnpm run change -- web patch "Panel overlays the canvas instead of shrinking it"
```

## Entry format

```markdown
area: web
kind: patch

Panel overlays the canvas instead of shrinking it.
```

- **File name:** `.changes/<task-id>-<short-name>.md`, one entry per task, even when the task
  touches several files. No release sections, no dates.
- **`area`:** one of `web`, `engine`, `sync`, `platform`, `auth`, `media`, `ai`, `contracts`,
  `infra`, `tooling`.
- **`kind`:** `patch`, `minor` or `major` (default `patch`).
- **Summary:** one English line. German belongs in the release title, not in the entry.
- A template is in [TEMPLATE.md](TEMPLATE.md).

## Gate

```bash
node tools/release/check-changes.mjs --task <ID> --base main
```

It inspects the committed changes against `--base` (`<base>...HEAD`) plus the working tree (staged,
unstaged and untracked files). Exit 0: no code change or a matching entry. Exit 1: code change
without a valid entry, an invalid entry, or more than one entry for the task. Exit 2: usage or
configuration error, e.g. an unknown area, a missing base branch or no task id.

Code means paths under `apps/`, `packages/`, `services/`, `tools/`, `infra/` and the root manifests
(`package.json`, lockfile, workspace, Turbo, TypeScript, ESLint and Node config). A path that is
both code and a test fixture counts as code.

## Owner exception

Only the owner may skip an entry: `--no-changelog "<reason>"` needs a non-empty reason and is
recorded in the gate output. Agents never use the exception on their own.
