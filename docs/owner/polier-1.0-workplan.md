# Polier 1.0 – work plan

> **Für den Owner (Deutsch):** Diese Datei ist der Arbeitsauftrag, um Polier 0.9.0 zu Polier 1.0
> auszubauen, damit ein grosses Monorepo-Projekt (Project air) sauber gestartet werden kann.
> Sie ist auf Englisch, weil Polier selbst englisch ist. Gib sie einer Polier-Lead-Session im
> Polier-Repo (`atshv/Polier`) und lass sie Aufgabe für Aufgabe abarbeiten. Reihenfolge und
> Abhängigkeiten stehen in Abschnitt 3. Jede Aufgabe ist ein eigener Branch, Commit und Review.

Date: 2026-10-25 · Base: Polier `0.9.0` (`main` at `59fcb0c`) · Target: `1.0.0`
Source of findings: running a real web project with two different agent harnesses in parallel,
and the Project air blueprint (monorepo, C++/WASM engine, own backend, realtime).

---

## 1. Why 1.0

Polier 0.9 plans and guards **one project with one active writer** well. Running a real project
with several agents exposed gaps that file-scope guarding cannot catch:

| Incident (real project, 2026-10-25) | Root cause in Polier |
| --- | --- |
| Two harnesses (a worker in one, a session in the other) edited the same working folder; changes mixed in the same files | worktrees optional; no cross-harness claim; guard cannot see another harness |
| Parallel e2e runs shared port 3101; one run killed the other's server with `pkill`; three gate runs failed with `ERR_CONNECTION_REFUSED` | no notion of runtime resources (ports, DBs) or exclusive gates |
| Failed gates looked like flaky tests and triggered retry loops (~40 min) | gate records do not distinguish infrastructure failures from test failures |
| Release script copied the working folder, shipping another agent's unfinished work live | no release/environment guidance; projects improvise |
| Preview deployment lacked the backend's env vars → every page 500 | no environment checklist or post-deploy smoke gate |
| Local `.generator/tools/check.py` differs from upstream | no drift detection between the in-project copy and `generator_version` |
| `STATUS.md` budget 300 words overridden to 850; task IDs `M01…M35` | budgets and ID scheme do not scale to profile L |
| The next project is a monorepo (packages, services, apps, C++/WASM) | templates assume one `src/` with 3–5 layers and JS/Python gates |

## 2. Rules for the session implementing this plan

- Work in the Polier repo. One task = one branch `task/<ID>` = one commit `<ID>: <title>` =
  one review. No push or release without owner approval.
- **Never break 0.9 projects silently.** Every schema or behaviour change is backwards
  compatible or has a migration step in `CHANGELOG.md` (house style: "**Migration:** …").
- `core/` stays Python 3.9+, standard library only. JS mirrors of core decisions are tested
  against the same decision tables (as `core/tests/write_cases.json` today).
- New tests for every behaviour; existing tests are not changed without owner approval (if an
  existing test encodes old behaviour that must change, list it in `open_questions` first).
- Gates for every task (unless the task names more):
  - `G1` `npm test` → exit 0
  - `G2` `python3 tools/check.py examples/minimal-cli` → exit 0
  - `G3` task-specific tests named in the task → exit 0
- Docs: `README.md`, `prompt/generator.md`, `prompt/dsh.md`, `guide/cheatsheet.md`,
  `adapters/*/README.md` updated in the same task as the behaviour they describe.

## 3. Order and dependencies

```text
Stage 1 (incident fixes)     PL-01 ─► PL-02 ─► PL-03
                             PL-04 ─► PL-05
Stage 2 (scale to L)         PL-06 ─► PL-07 ─► PL-08
                             PL-09
Stage 3 (release, contracts) PL-10 ─► PL-11
                             PL-12
Stage 4 (quality of briefs)  PL-13, PL-14, PL-15
Stage 5 (ship 1.0)           PL-16 ─► PL-17
```

| ID | Title | Prio | Size | Depends on | Parallel with |
| --- | --- | --- | --- | --- | --- |
| PL-01 | Board schema 1.0 (IDs, stages, resources, claims) | P0 | M | – | – |
| PL-02 | Runtime slots: ports and test databases per worktree | P0 | M | PL-01 | PL-04 |
| PL-03 | Exclusive gates and infra-failure classification | P0 | M | PL-01, PL-02 | PL-05 |
| PL-04 | Cross-harness task claims with heartbeat | P0 | M | PL-01 | PL-02 |
| PL-05 | Worktree enforcement and foreign-change detection | P0 | M | PL-04 | PL-03 |
| PL-06 | Monorepo layout and per-package files (profile L) | P0 | L | PL-01 | PL-09 |
| PL-07 | Import-boundary check between packages | P0 | M | PL-06 | – |
| PL-08 | Stage exit gates and stop points | P0 | S | PL-01, PL-06 | – |
| PL-09 | Profile-dependent size budgets | P1 | S | PL-01 | PL-06 |
| PL-10 | Release and environment templates + release gate | P0 | M | PL-06 | PL-12 |
| PL-11 | Post-deploy smoke gate and environment checklist check | P1 | S | PL-10 | – |
| PL-12 | Machine-readable contracts with version rules | P1 | L | PL-06 | PL-10 |
| PL-13 | Gate catalogue per stack (incl. C++/CMake/WASM) + `docs/versions.md` | P1 | M | PL-06 | PL-14, PL-15 |
| PL-14 | UI task brief fields and `design-rules` template | P1 | S | – | PL-13, PL-15 |
| PL-15 | Generator drift detection | P1 | S | – | PL-13, PL-14 |
| PL-16 | Guard extras: kill/pkill warning, case-insensitive paths | P2 | S | PL-02 | – |
| PL-17 | Release 1.0: migration guide, example L project, version bump | P0 | M | all P0/P1 | – |

Optional, after 1.0: PL-18 changelog-letter convention template, PL-19 migration mode
(move a brownfield project into a monorepo), PL-20 German owner-facing output.

---

## 4. Tasks

Format per task: **Goal · Files · Specification · Acceptance (WHEN–THEN) · Tests/Gates ·
Migration**.

### PL-01 – Board schema 1.0

- **Goal:** `board.json` can describe large multi-package projects, stages with exit criteria,
  runtime resources and claims – while 0.9 boards stay valid.
- **Files:** `templates/board.schema.json`, `core/board.py`, `core/tests/test_board.py` (new),
  `tools/check.py`, `tools/render_status.py`, `examples/minimal-cli/board.json` (unchanged, must
  still validate).
- **Specification:**
  - Task `id` pattern widened from `^M[0-9]{2,3}$` to `^(M[0-9]{2,3}|[A-Z][A-Z0-9]{0,5}-[0-9]{2,3})$`
    (e.g. `M03`, `P3-02`, `ENG-14`).
  - New optional task fields: `package` (string, folder of the package/service/app),
    `exclusive` (array of resource names, e.g. `["e2e"]`), `resources` (array of named resources
    the task's gates need: `ports`, `db`, `bucket`), `claim` (object, see PL-04; written by
    tooling only).
  - New optional board fields: `stages` (array of `{id, title, goal, exit_criteria[],
    exit_gates[], owner_decision: "pending"|"continue"|"stop", depends_on[]}`), `packages`
    (array of `{path, kind: "package"|"service"|"app"|"tool"|"infra", may_import[]}`),
    `resources` (`{slots: int, port_base: int, port_stride: int, services: {name: offset}}`),
    `budgets` (see PL-09).
  - `stage` on tasks may reference `stages[].id` (int stays valid).
  - `schema_version` field on the board: absent = 0.9, `"1.0"` = new fields allowed. Validation
    is strict on unknown fields per version.
- **Acceptance:**
  - A1 WHEN a 0.9 board (example project) is validated, THEN it passes without changes.
  - A2 WHEN a board uses `P3-02` IDs, `stages`, `packages`, `resources`, THEN `check.py` passes
    and `render_status.py` renders them.
  - A3 WHEN a task references an unknown stage or package, THEN `check.py` exits 1 naming it.
  - A4 WHEN `schema_version` is absent and a 1.0 field appears, THEN `check.py` exits 1 with
    "set schema_version to 1.0".
- **Tests:** `core/tests/test_board.py` with 0.9 and 1.0 fixture boards (valid + invalid).
- **Migration:** none required; to use new fields set `"schema_version": "1.0"`.

### PL-02 – Runtime slots: ports and test databases per worktree

- **Goal:** two worktrees can run servers and tests at the same time without port or database
  collisions.
- **Files:** `core/slots.py` (new), `core/tests/test_slots.py` (new), `tools/slot.py` (new CLI),
  `templates/AGENTS.template.md`, `prompt/generator.md` (Phase G), `prompt/dsh.md` (§5),
  `guide/cheatsheet.md`.
- **Specification:**
  - A slot is an integer `N` (0 = owner's main checkout, 1…`resources.slots`-1 = worktrees).
  - `tools/slot.py acquire` in a worktree picks the lowest free `N`, writes `.polier-slot`
    (JSON: `N`, worktree path, ports per service, `db_name`, `bucket`) in the worktree root, and
    registers it in `<git-common-dir>/polier/slots.json` (shared by all worktrees of the repo).
    `release` removes both. `show` prints the file. `list` shows all slots and stale ones
    (worktree path missing).
  - Port formula: `port_base + port_stride·N + services[name]`. DB name `<project>_slot_N`,
    bucket `<project>-slot-N`. Defaults if `resources` missing: base 4000, stride 100.
  - Polier does not create databases; it prints the names. Projects provide
    `tools/dev/setup` that reads `.polier-slot` (template snippet in `prompt/generator.md`).
  - `.polier-slot` is added to the generated `.gitignore`.
  - Generated `AGENTS.md` rule: "Read ports and DB names only from `.polier-slot`; never
    hard-code ports; never touch slot 0's data."
- **Acceptance:**
  - A1 WHEN two worktrees run `slot.py acquire`, THEN they get different `N` and disjoint ports.
  - A2 WHEN a worktree folder is deleted without `release`, THEN `slot.py list` marks it stale
    and `acquire --reclaim-stale` reuses it.
  - A3 WHEN all slots are taken, THEN `acquire` exits 1 with a clear message and changes nothing.
  - A4 WHEN `acquire` runs in the main checkout, THEN it returns slot 0 without registering a
    worktree.
- **Tests:** `core/tests/test_slots.py` with temporary git repos and two worktrees.
- **Migration:** optional; projects adopt by adding `resources` and a `tools/dev/setup`.

### PL-03 – Exclusive gates and infra-failure classification

- **Goal:** gates that need a shared resource (e2e, perf, DB reset) never run concurrently, and
  infrastructure failures are not mistaken for test failures.
- **Files:** `core/gate.py`, `core/locks.py` (new), `core/evidence.py`, `tools/gate.py`,
  `tools/check.py`, `adapters/dsh/index.mjs` (`pl_gate`), `core/tests/test_gate.py` (extend
  with new cases only), `core/tests/test_locks.py` (new).
- **Specification:**
  - `gate.py --exclusive <resource>` (and automatically for gate names listed in the task's
    `exclusive`) acquires a lock file `<git-common-dir>/polier/locks/<resource>.lock` containing
    holder (task, slot, harness, pid, host, start time). Lock is released in `finally`.
  - If held: wait up to `--lock-wait` seconds (default 1800), printing the holder every 60 s;
    then exit 75 ("resource busy"), writing a record with `result: "busy"`.
  - Stale lock (pid not alive on same host, or older than `--lock-ttl`, default 3600 s) is taken
    over with a warning in the record.
  - Records gain fields: `slot`, `exclusive`, `lock_wait_s`, `result` ∈ `pass | fail | timeout
    | busy | infra`.
  - `infra` classification: exit ≠ 0 and the output matches a project-configurable list of
    infra patterns (default: `ECONNREFUSED`, `ERR_CONNECTION_REFUSED`, `EADDRINUSE`,
    `is already used, make sure that nothing is running on the port`, `address already in use`).
    Configurable in `board.json` → `resources.infra_patterns`.
  - `check.py`: records with `result: infra|busy|timeout` never count as evidence for `done`;
    the message says "infrastructure failure, rerun alone" instead of "gate failed".
- **Acceptance:**
  - A1 WHEN two `gate.py --exclusive e2e` start at the same time, THEN the second waits until the
    first finishes and both records show their `lock_wait_s`.
  - A2 WHEN the lock holder process is dead, THEN the next gate takes over the lock and records
    a warning.
  - A3 WHEN a gate's output contains `ERR_CONNECTION_REFUSED` and exits 1, THEN the record says
    `result: infra` and `check.py` does not accept it as evidence.
  - A4 WHEN `pl_gate` is used through the plugin adapter, THEN it honours the same lock (shared file, same format).
- **Tests:** concurrency test with two subprocesses and a sleep command; stale-lock test;
  classification table test.
- **Migration:** none; exclusivity is opt-in per gate/task. Recommend adding `"exclusive":
  ["e2e"]` to e2e-gated tasks.

### PL-04 – Cross-harness task claims with heartbeat

- **Goal:** any session in any harness (plugin adapter, hook adapter, plain shell) can see who works on which
  task right now, and two sessions cannot claim the same task.
- **Files:** `core/claims.py` (new), `core/tests/test_claims.py` (new), `tools/claim.py` (new
  CLI), `adapters/dsh/index.mjs`, `adapters/dsh/lib/project.mjs`,
  `adapters/claude-code/hook.py`, `adapters/claude-code/README.md`, `prompt/dsh.md`.
- **Specification:**
  - Claims live in `<git-common-dir>/polier/claims/<task>.json`: task, harness (adapter id: `plugin`,
    `hooks`, `cli`), session id, worktree path, slot, started, last heartbeat.
  - `claim.py take <task>` fails if a live claim exists (heartbeat < 10 min); `release`; `beat`;
    `list`.
  - Plugin adapter (`adapters/dsh/`): `/pl task <ID>` takes the claim; every tool call refreshes the heartbeat
    (throttled to 1/min); `pl_status` lists all live claims.
  - Hook adapter (`adapters/claude-code/`): when `POLIER_TASK` is set, `PreToolUse` takes/refreshes the claim; a
    write is denied if another live claim for the same task exists from a different session.
  - `board.json` is **not** written by claims (avoids merge conflicts); `render_status.py` reads
    claims and shows "in progress by <harness> since <time>".
- **Acceptance:**
  - A1 WHEN a plugin-adapter session claims `P3-02` and a hook-adapter session with
    `POLIER_TASK=P3-02` tries to write, THEN the write is denied naming the first session.
  - A2 WHEN the first session stops sending heartbeats for 10 min, THEN the claim is stale and can
    be taken over.
  - A3 WHEN `pl_status` or `claim.py list` runs in any worktree, THEN it shows all live claims of
    the repo.
- **Tests:** core unit tests; adapter tests with simulated events (existing patterns in
  `adapters/claude-code/tests` and `adapters/dsh/test`).
- **Migration:** none; adapters start claiming automatically after update.

### PL-05 – Worktree enforcement and foreign-change detection

- **Goal:** at profile M/L, task work happens only in the task's worktree; changes made by others
  in a shared folder are recognised, not blamed on the current task.
- **Files:** `core/scope.py`, `core/tests/test_scope.py` (new cases), `adapters/dsh/index.mjs`,
  `adapters/claude-code/hook.py`, `prompt/generator.md` (Phase E), `prompt/dsh.md` (§5),
  `tools/worktree.py` (new helper: create worktree + branch + slot + claim in one step).
- **Specification:**
  - Board option `worktrees: "required" | "recommended" | "off"` (default: `required` for M/L,
    `off` for S).
  - With `required`: a worker write in the main checkout while the bound task has a `worktree`
    set is denied with "work in <worktree path>".
  - `tools/worktree.py start <task>`: `git worktree add ../<repo>-<task> -b task/<task>
    <base_branch>`, `slot.py acquire`, `claim.py take`, sets `worktree` on the task (lead
    action). `finish <task>`: release claim and slot, remove worktree (refuses with uncommitted
    changes).
  - Stop check: files changed in the working tree that are inside another live claim's scope are
    reported as "foreign changes (task X, harness Y)" and not as scope violations of the current
    task; files in nobody's scope stay violations.
- **Acceptance:**
  - A1 WHEN `worktrees: required` and a worker writes in the main checkout for a task with a
    worktree, THEN the write is denied with the worktree path.
  - A2 WHEN another live claim's scope contains a changed file, THEN the stop check lists it as
    foreign, not as a violation.
  - A3 WHEN `worktree.py finish` runs with uncommitted changes, THEN it exits 1 and removes
    nothing.
- **Tests:** temporary repos with two worktrees and two claims.
- **Migration:** 0.9 M/L boards default to `recommended` until the owner sets `required`.

### PL-06 – Monorepo layout and per-package files (profile L)

- **Goal:** Polier can plan and scaffold a monorepo with packages, services and apps, each with
  its own short context, without bloating the root files.
- **Files:** `prompt/generator.md` (Phase 0.3, C, D, F, G), `templates/monorepo-layout.md`
  (new), `templates/package-ARCHITECTURE.md` (new), `templates/package-AGENTS.md` (new),
  `templates/module-map.md`, `prompt/rubric.md`, `tools/check.py`.
- **Specification:**
  - Profile L definition rewritten: "several deployable parts or packages with their own
    builds, integrated through contracts". L requires `packages` on the board (PL-01).
  - Root `ARCHITECTURE.md` (≤ 800 words) states system shape, package kinds, dependency
    direction, invariants; each package gets `ARCHITECTURE.md` (≤ 400 words: purpose, inputs,
    outputs, invariants) and optional `AGENTS.md` (≤ 200 words: commands, deviations). Harnesses that load
    nested `AGENTS.md` automatically get them for free; others read them via the context pack.
  - `module-map.md` becomes the package map (table: path, kind, owner, may_import, build/test
    commands).
  - Briefs: context pack lists root files + the package's own files only.
  - `check.py`: every `packages[].path` exists after scaffold (or is created by a named task);
    every task with `package` has `scope_write` inside that package (or explicitly lists
    contract paths, PL-12).
- **Acceptance:**
  - A1 WHEN Polier plans an L project, THEN it proposes a package map and writes per-package
    files only for packages created in stage 1.
  - A2 WHEN a task's `scope_write` leaves its `package` without a contract exception, THEN
    `check.py` exits 1.
  - A3 WHEN the cold-start test runs for a package task, THEN the agent needs only root files +
    package files + brief.
- **Tests:** new example `examples/monorepo-mini/` (PL-17 extends it) validated by `check.py` in
  CI; rubric items for L.
- **Migration:** existing projects unaffected (S/M unchanged).

### PL-07 – Import-boundary check between packages

- **Goal:** the dependency rules from the package map are enforced mechanically.
- **Files:** `tools/boundaries.py` (new), `core/boundaries.py` (new), `core/tests/test_boundaries.py`
  (new), `templates/AGENTS.template.md`, `prompt/generator.md` (gate list).
- **Specification:**
  - Reads `packages[].may_import` from the board. Scans source files of each package for
    imports: TS/JS (`import … from`, `require(`), Python (`import`, `from … import`),
    C/C++ (`#include "…"` resolving into another package). Path aliases from `tsconfig.json`
    `paths` are resolved; unknown aliases are reported as warnings.
  - Exit 0 clean, 1 violations (file, line, from-package → to-package), 2 config error.
  - Offered as a standard gate `boundaries` for L projects.
- **Acceptance:**
  - A1 WHEN `apps/web` imports `services/sync`, and `may_import` of `apps/web` lacks it, THEN
    exit 1 with file and line.
  - A2 WHEN only allowed imports exist, THEN exit 0.
  - A3 WHEN a C++ file includes a header from a package not in `may_import`, THEN exit 1.
- **Tests:** fixture tree with TS, Python and C++ files.
- **Migration:** opt-in gate.

### PL-08 – Stage exit gates and stop points

- **Goal:** a stage ends only when its exit criteria are met and, where defined, the owner
  decides continue/stop (e.g. after an engine spike).
- **Files:** `core/board.py`, `tools/render_status.py`, `tools/check.py`, `prompt/generator.md`
  (Phase D, "Next stage" prompt), `guide/cheatsheet.md`.
- **Specification:**
  - `ready_tasks` excludes tasks whose stage depends on a stage that is not complete
    (`exit_gates` have passing records **and** `owner_decision` is `continue` if the stage has a
    decision).
  - `render_status.py` shows per stage: open exit criteria, missing gate records, pending owner
    decision.
  - `check.py` errors if a task of a later stage is `in_progress` while an earlier blocking stage
    is incomplete.
- **Acceptance:**
  - A1 WHEN stage 2 has `owner_decision: pending`, THEN no stage-3 task appears under "Ready now".
  - A2 WHEN the owner sets `continue` and exit gates have records, THEN stage-3 tasks become ready.
  - A3 WHEN `owner_decision: stop`, THEN dependent stages are shown as "stopped" and
    `check.py` warns on any work there.
- **Tests:** board fixtures for each case.
- **Migration:** none; stages are optional.

### PL-09 – Profile-dependent size budgets

- **Goal:** word budgets fit the project size instead of being overridden ad hoc.
- **Files:** `prompt/generator.md` (artifact map), `tools/check.py`, `templates/board.schema.json`
  (`budgets`).
- **Specification:** defaults S/M/L for `ARCHITECTURE.md` (600/700/800), `AGENTS.md`
  (300/350/400), `STATUS.md` (300/500/900), brief (800/800/900), package files (L: 400/200).
  Board `budgets` may override with a `reason` string; `check.py` reports overrides.
- **Acceptance:** A1 WHEN an L project has a 850-word `STATUS.md`, THEN no warning. A2 WHEN an
  override lacks `reason`, THEN `check.py` exits 1.
- **Migration:** none.

### PL-10 – Release and environment templates + release gate

- **Goal:** projects release only from a clean, tagged state through CI, and every environment
  has a checked configuration list.
- **Files:** `templates/releasing.md` (new), `templates/environments.md` (new),
  `prompt/generator.md` (Phase G, I), `tools/release_check.py` (new), `core/tests/test_release_check.py`
  (new), `guide/cheatsheet.md`.
- **Specification:**
  - `releasing.md` template: trunk-based flow, tag naming, CI-only release, preview per PR,
    staging → production with approval, rollback, "never publish from a working folder".
  - `environments.md` template: table per environment (local, preview, staging, production) ×
    required variables (names only, never values), where they are set, who may change them,
    smoke check URL.
  - `release_check.py`: exit 1 if the working tree is dirty, HEAD is not a tag (or `--allow-untagged`
    for previews), the tag's commit is not on `base_branch`, or any task in a released stage lacks
    `done`. Offered as gate `release-clean`.
  - Generated `AGENTS.md` rule: "Agents never publish; releases run in CI from tags."
- **Acceptance:**
  - A1 WHEN uncommitted changes exist, THEN `release_check.py` exits 1 listing them.
  - A2 WHEN HEAD is tagged on `main` and clean, THEN exit 0.
  - A3 WHEN Polier scaffolds an L project, THEN `docs/releasing.md` and `docs/environments.md`
    exist with project-specific names.
- **Tests:** temporary repos (dirty, untagged, tagged).
- **Migration:** optional; recommended for any project that deploys.

### PL-11 – Post-deploy smoke gate and environment checklist check

- **Goal:** a deployment with missing configuration is caught immediately.
- **Files:** `tools/smoke.py` (new), `tools/check.py`, `templates/environments.md`.
- **Specification:** `smoke.py --url <u> --expect-status 200 --path /login --path /` (multiple
  paths), optional `--header` for protected previews (values from env vars only). Records via
  `gate.py`. `check.py` warns if `environments.md` lists an environment without a smoke URL.
- **Acceptance:** A1 WHEN a path returns 500, THEN exit 1 with status and first 300 bytes.
  A2 WHEN all paths return expected status, THEN exit 0.
- **Migration:** none.

### PL-12 – Machine-readable contracts with version rules

- **Goal:** shared interfaces between packages are schemas with fixtures and versions, and a
  change updates all dependants in the same task.
- **Files:** `prompt/generator.md` (side strand, L), `templates/contract.md` (rewrite:
  prose + pointer to schema), `tools/contracts.py` (new), `core/tests/test_contracts.py` (new),
  `templates/board.schema.json` (`contracts` list).
- **Specification:**
  - Board `contracts`: `[{name, path, version, schema_files[], fixtures_dir, dependants[]}]`.
  - `contracts.py check`: every schema has ≥ 1 valid and ≥ 1 invalid fixture; if any file under
    `path` changed since the base branch, `version` must have changed (SemVer: major for
    removed/renamed fields detected by a simple JSON-Schema diff, else minor/patch) and the
    task's `scope_write` must include every `dependants` path (or the task lists
    `contract_followups` approved by the lead).
  - Schema format: JSON Schema 2020-12 (no new dependency; validation of fixtures is the
    project's own gate, Polier checks presence and versioning).
- **Acceptance:**
  - A1 WHEN a contract schema changes without a version bump, THEN exit 1.
  - A2 WHEN a field is removed with only a minor bump, THEN exit 1 ("major required").
  - A3 WHEN the task scope misses a dependant, THEN exit 1 naming it.
- **Migration:** existing `docs/contracts/*.md` keep working as prose; machine checks apply only
  to contracts listed on the board.

### PL-13 – Gate catalogue per stack + `docs/versions.md`

- **Goal:** Polier proposes correct, real gate commands for the stacks it plans, including C++
  and WebAssembly, and every version is pinned with a source.
- **Files:** `templates/gates/` (new folder: `node-ts.md`, `python.md`, `cpp-cmake.md`,
  `wasm.md`, `postgres.md`, `browser-e2e.md`, `visual-diff.md`, `load.md`),
  `templates/versions.md` (new), `prompt/generator.md` (Phase D, rule 8), `tools/check.py`.
- **Specification:** each catalogue file lists typical gate names, command shapes marked
  `[VERIFY: from manifest/docs]` (no invented flags), expected output, and pitfalls.
  `versions.md` table: tool/library, exact version, source URL, date checked, approved by.
  `check.py` warns if a manifest dependency is missing in `versions.md` (L only).
- **Acceptance:** A1 WHEN Polier plans a C++/WASM package, THEN its tasks get `cpp-unit` and
  `wasm-build` gates with commands taken from the project's manifests or marked `[UNVERIFIED]`.
  A2 WHEN `package.json` has a dependency missing in `versions.md` (L), THEN `check.py` warns.
- **Migration:** none.

### PL-14 – UI task brief fields and `design-rules` template

- **Goal:** UI tasks are specified with numbers and states, not adjectives.
- **Files:** `templates/task-brief.md` (new optional section "UI specification"),
  `templates/design-rules.md` (new, generic design law: tokens, spacing, states, motion, layers),
  `prompt/rubric.md`, `prompt/generator.md` (Phase F).
- **Specification:** UI section with required fields: target values (px, ms, tokens), states
  (rest, hover, pressed, focus, selected, dragging, disabled, saving, error), "do not",
  evidence screenshots (paths, viewports). Rubric item: UI tasks without target values fail.
- **Acceptance:** A1 WHEN a brief touches UI paths, THEN the rubric requires the UI section.
  A2 WHEN the UI section uses words like "nicer", "cleaner" without values, THEN the rubric
  flags it.
- **Migration:** none.

### PL-15 – Generator drift detection

- **Goal:** a project knows when its in-project Polier copy differs from the version it claims.
- **Files:** `tools/check.py`, `install.sh`, `update.sh`, `tools/manifest.json` (new, generated
  at release: SHA-256 per shipped file).
- **Specification:** `check.py` locates the package (`.generator/` or plugin path), compares file
  hashes with `tools/manifest.json` of the claimed `generator_version`; differences → warning
  listing files ("local edits or outdated copy"). `update.sh` shows the same diff before
  updating.
- **Acceptance:** A1 WHEN `.generator/tools/check.py` was edited locally, THEN `check.py` warns
  naming it. A2 WHEN the copy matches, THEN no warning.
- **Migration:** reinstall/update once to get the manifest.

### PL-16 – Guard extras

- **Goal:** close two gaps listed in the README that bit or could bite.
- **Files:** `core/shell.py`, `core/scope.py`, `core/tests/write_cases.json` (add rows),
  `adapters/claude-code/hook.py`, `README.md` (gaps list).
- **Specification:**
  - `kill`, `pkill`, `killall`, `lsof … | xargs kill` in a worker's Bash command → warning
    (hook adapter: `ask` decision; plugin adapter: message) "do not stop processes you did not start; use
    your slot's ports".
  - Case-insensitive comparison of guarded paths on macOS/Windows (`board.json` vs `Board.json`).
- **Acceptance:** A1 WHEN a worker runs `pkill -f "dev-server"`, THEN the hook asks/warns.
  A2 WHEN a worker writes `Board.json` on macOS, THEN it is treated as `board.json`.
- **Migration:** none.

### PL-17 – Release 1.0

- **Goal:** ship 1.0 with a complete migration path and a reference L example.
- **Files:** `VERSION`, `package.json`, `CHANGELOG.md`, `README.md`, `guide/cheatsheet.md`,
  `examples/monorepo-mini/` (complete: 2 packages, 1 service, 1 app, contracts, stages,
  resources), `.github/workflows/test.yml` (also validate `examples/monorepo-mini`).
- **Specification:** `CHANGELOG.md` 1.0 section in house style with **Migration** for: S/M
  projects (nothing required; optional slots/exclusive gates), L projects (schema_version,
  packages, worktrees required), plugin-adapter and hook-adapter users (reinstall). README "What the
  guard does not cover" updated.
- **Acceptance:** A1 WHEN CI runs, THEN `npm test`, `check.py examples/minimal-cli` and
  `check.py examples/monorepo-mini` pass. A2 WHEN a 0.9 project runs `check.py` with 1.0, THEN it
  passes or prints only migration warnings. A3 Owner approves the CHANGELOG.
- **Migration:** this task writes it.

---

## 5. Definition of done for Polier 1.0

- All P0 and P1 tasks `done` with gate records and independent reviews.
- A fresh L project scaffolded by Polier 1.0 (Project air phase 0) passes `check.py`,
  `boundaries`, `release_check.py --allow-untagged`, and two worktrees run e2e back to back via
  the exclusive lock without collision.
- An existing 0.9 project passes `check.py` under 1.0 with migration warnings only.

## 6. Prompt to start the Polier session

```text
You are the lead for Polier 1.0 in the Polier repository.
Read README.md, CHANGELOG.md, prompt/generator.md, templates/board.schema.json, core/*.py and
this work plan (polier-1.0-workplan.md).
Create board.json entries for PL-01 … PL-17 from section 4 (stages and dependencies from
section 3), render STATUS.md, and show me the plan for PL-01 before writing code.
Rules: one task per branch task/<ID>, one commit "<ID>: <title>", gates G1–G3 plus the task's
tests, independent review per task, no push or release without my approval, never break 0.9
projects without a migration note.
```
