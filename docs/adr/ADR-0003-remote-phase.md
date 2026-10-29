# ADR-0003: Remote phase as the last stage before v1

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes:** – (refines ADR-0002)

## Context

The owner decided that the switch to GitHub, branch protection, CI and hosting comes only at the
very end of the build. ADR-0002 deferred that work but left its place in the stage plan open. The
local build must continue through the product stages without waiting for a remote workflow.

## Decision

The stage plan gets one new stage, `remote`, after `hardening` and before `v1`. It contains the
remote work: `P0-02` (branch protection), `P0-08` (CI), `P0-09` (pinned Polier in CI), `P0-15`
(release command and tag-based CI release), `P0-16` (dependency updates) and `P0-17` (release
0.0.1). `v1` depends on `remote`.

The `foundation` stage closes with local criteria and local gates only: `board-check`, `install`,
`boundaries`, `dev-setup`, `compose-config`, `tokens-codegen`, `design-check`, `language-check`
and `changelog-entry`. The CI wiring of `design-check`, `language-check` and `changelog-entry`
moves into `P0-08` at the switch; those tools and gates are built and proven locally in
`foundation`. `P0-14` (change entries and changelog gate) stays local and no longer depends on
`P0-08`.

`contract` through `hardening` proceed locally after `foundation`; only `v1` waits for the remote
stage.

**Update 2026-10-25:** `P0-08` (CI skeleton) and `P0-09` (pinned Polier) moved from the
remote stage into `foundation` and are proven locally with actionlint plus the workflow's
step commands; the real GitHub run and the remaining remote tasks (`P0-02`, `P0-15`,
`P0-16`, `P0-17`) stay in the `remote` stage.

**Update 2026-10-29:** the first pull request against `main` ran the workflow on GitHub and
exposed failures that the local checks had missed. By owner decision, `P6-23` makes the real
GitHub run green in the `web-app` stage. Branch protection, releases and dependency updates
(`P0-02`, `P0-15`, `P0-16`, `P0-17`) stay in `remote`.

## Consequences

- **Positive:** the product can be built and verified locally without a paid GitHub plan or a
  hosting decision; no remote dependency blocks the contract, engine, backend or web stages.
- **Negative:** `main` stays unprotected and CI does not run until the remote stage; every merge
  before then relies on the lead review and local `gate.py` records. Releases remain untagged
  until then.
- **Binds:** stage order and exit gates on `board.json`, the task stages of the six remote tasks,
  the CI wiring in `P0-08`, the release flow.
- **Prevents:** silently assuming CI or branch protection exists during the local build.

## Alternatives

- **Switch to GitHub after `foundation`** — rejected by the owner; it would interrupt the local
  build.
- **No CI or branch protection at all** — rejected: AD-10 requires releases from CI and the
  blueprint requires a protected `main`.
