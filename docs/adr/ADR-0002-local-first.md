# ADR-0002: Local-first build until the GitHub switch

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes:** –

## Context

The repository lives on GitHub as a private repository on the free plan. GitHub rejects branch
protection and repository rulesets for private repositories on that plan (`403: Upgrade to
GitHub Pro or make this repository public`). The owner wants to build the foundation locally
first and move the guarded workflow to GitHub later.

## Decision

Build and verify the project locally with the pinned Polier `v1.0.0`; `gate.py` records are the
evidence. Work continues in task worktrees with claims and one commit per task on `main`, but
nothing is pushed, tagged, opened as a pull request or published until the owner switches to
GitHub. Branch protection, CI runs, preview deployments and tag-based releases are deferred to a
later remote phase. The tasks that need them — `P0-02` and the remote parts of `P0-08`, `P0-09`,
`P0-15`, `P0-16` and `P0-17` — are carried out at that switch. Stage exit criteria and gates that
name `ci-green`, `release-dry`, `smoke` or `branch-protection` are adjusted when the remote phase
is planned.

## Consequences

- **Positive:** the foundation is not blocked by a paid GitHub plan; every local gate stays
  reproducible through `gate.py` on the pinned tool version.
- **Negative:** `main` is unprotected and CI does not run during the local phase, so a bad merge
  is not caught mechanically until the switch; releases stay untagged.
- **Binds:** board tasks and stage exit gates, the release flow, `AGENTS.md` runtime rules.
- **Prevents:** silent assumptions that branch protection, CI runs or previews exist while
  working locally.

## Alternatives

- **GitHub Pro or Team now** — deferred by the owner to the second phase.
- **Public repository** — rejected: the blueprint requires a private monorepo.
- **A different git host now** — deferred; it would add migration work before any product code.
