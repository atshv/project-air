# Orchestration — Project air

> How a task moves through this project with Polier 1.4, what the tools check and where the records
> live. The numbers live in `policy.json`, not in this file. Adopted 2026-10-29 (owner decision).

## Where the state lives

| File | Holds | Written by | Committed |
|---|---|---|---|
| `board.json` | plan: tasks, dependencies, scopes, status, stages | `tools/state.py` for status; the lead for plan fields | yes |
| `runs/<ID>.json` | execution: attempt counter, gate/review/state events, token usage | `tools/state.py`, gate events by `tools/gate.py`, usage by `tools/usage.py` | yes |
| `reviews/approvals/AP-NNN.json` | owner decisions: pending, granted, denied | `tools/approve.py` | yes |
| `policy.json` | limits, protected paths, approvals, denied commands | the owner | yes |
| `.polier-slot`, claims | liveness: ports per worktree, which session is on which task | `tools/slot.py`, `tools/claim.py` | no |

`$POLIER` points at the pinned Polier checkout: `export POLIER="$(bash tools/polier.sh --install)"`,
then `bash tools/polier.sh --check`.

`STATUS.html` is the local status page (`python3 $POLIER/tools/render_status.py . --html [--watch]`);
it is generated, never committed and changes no state.

## The task loop

The lead runs the transitions; the worker runs the gates and reports; the reviewer writes the review.

```bash
python3 $POLIER/tools/dispatch.py                   # next wave, blocked tasks, conflicts
python3 $POLIER/tools/worktree.py start <ID> --root . --session <name>
python3 $POLIER/tools/state.py set <ID> in_progress
# implement; run every gate from board.json with tools/gate.py
python3 $POLIER/tools/state.py set <ID> verifying
python3 $POLIER/tools/state.py set <ID> review
# reviewer writes reviews/<ID>.md with a plain line "verdict: pass"
python3 $POLIER/tools/state.py set <ID> done --note "review pass, gates green"
python3 $POLIER/tools/render_status.py . --html
```

`state.py show <ID>` prints the board status against the run record, gates, review, approvals and
attempts; `check <ID> <status>` evaluates without writing. A refused transition names the missing
precondition and the command that records it.

| To | Needs |
|---|---|
| `in_progress` | every dependency done; the token budget not used up; an attempt below the limit; fewer than `max_in_progress` tasks running; the stage not stopped or waiting |
| `verifying` | an open attempt in `runs/<ID>.json` |
| `review` | a passing record for every gate of the task |
| `done` | review `verdict: pass`; handoff when another task depends on this one; the run record; a granted `new_dependency` approval when a manifest is touched |
| `rework` | a note and a free review round |
| `blocked` | a note with the reason and what is needed |
| `failed` | a note |

**Attempts and rounds.** An attempt opens on `in_progress` and closes as `pass`, `fail` or
`cancelled` (limit `max_attempts_per_task`). A round is one review; `rework` adds one (limit
`max_review_rounds`). Never reset a counter by editing a file. At a limit: stop and escalate.

**Token budget.** `policy.json` → `budget.max_tokens_per_task` caps what one task may spend over all
its attempts and sessions (`null` = off); `warn_at` sets the warning point. Usage is recorded in
`runs/<ID>.json` by `tools/usage.py record` or the harness hook, and a repeated report replaces the
older one. `state.py` warns at `warn_at`, refuses `in_progress` when the budget is used up, and the
dispatch plan lists such a task as blocked.

## Tasks done before the adoption

Polier cannot tell tasks done under 1.0 from new ones. The owner decided on 2026-10-29: the policy
is strict from now on, and the evidence checks of old tasks are relaxed. `policy.json` therefore
sets `checks.review_before_done`, `handoff_before_done` and `run_record` to `false`, so `check.py`
and `audit.py` do not fail on 1.0 tasks without a `verdict:` line, handoff or run record. Every new
task still follows the full loop above: `state.py` writes its run record, its review carries
`verdict: pass` and it leaves a handoff. The 14 earlier tasks that touched a dependency manifest
have retroactive `new_dependency` approvals (`AP-001` … `AP-014`) that point to `docs/versions.md`.

## Approvals

The actions in `policy.json` → `approvals.actions` need a granted record in `reviews/approvals/`
before they happen: `new_dependency`, `scope_change`, `merge_to_base`, `release`, `reopen_done`,
`protected_path`, `state_override`.

```bash
python3 $POLIER/tools/approve.py request --action new_dependency --task <ID> --note "adds <package> <version> for <purpose>"
python3 $POLIER/tools/approve.py list --status pending
python3 $POLIER/tools/approve.py grant AP-015 --by owner --note "ok"
```

A granted record is the approval and does not expire. A denied one is final until there is new
information. Protected paths (`.env*`, keys, `reference/`, `docs/owner/`) are lead-only.

## Escalation

Do not retry around a refusal and do not force without an approval.

1. Stop; do not edit `board.json` status, `runs/` or `reviews/approvals/` by hand.
2. `python3 $POLIER/tools/state.py set <ID> blocked --note "<reason; what is needed>"`.
3. Ask the owner with two options and their consequences.
4. Resume as a new attempt after the decision.

## Rules

- State changes only with `tools/state.py`; gates only with `tools/gate.py`; approvals only with
  `tools/approve.py`.
- `runs/` and `reviews/approvals/` are never edited by hand; `runs/` and `policy.json` are committed.
- Run `tools/dispatch.py` before starting a task; the first wave is the plan.
- `tools/audit.py` is the compliance view; `tools/check.py .` is the project check. Run every tool
  from the repository root.
- `python3 $POLIER/tools/research.py check` validates `docs/versions.md` and `docs/research/`; keep
  it green when a dependency or a research note changes.

## What is not covered

Approvals are cooperative evidence, not authentication: whoever can write the file can forge a
grant. Runs are text files and can be edited. Command matching is static, and the tools are not a
sandbox. The dispatch plan is a snapshot; re-run it.
