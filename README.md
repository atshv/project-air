# project-air

Working title **Project air**: a web whiteboard with its own engine (C++/WebAssembly/WebGPU), its
own backend and realtime collaboration. This repository is planned and guarded with Polier
`v1.1.0`.

## Start here

| File | Purpose |
| --- | --- |
| `ARCHITECTURE.md` | system shape, invariants, gates |
| `AGENTS.md` | commands and rules for every agent |
| `STATUS.md` | progress, generated from `board.json` |
| `board.json` | stages, packages, tasks, resources, open questions |
| `policy.json` | Polier 1.1 rules: limits, protected paths, approvals, denied commands |
| `docs/orchestration.md` | the task loop: state changes, gates, approvals, escalation |
| `runs/` | execution record per task (attempts, gate and state events) |
| `reviews/approvals/` | owner decisions on high-risk actions |
| `tasks/` | briefs for the next tasks |
| `docs/module-map.md` | package map and allowed imports |
| `docs/quality.md` | definition of done and gates |
| `docs/owner/` | owner blueprint (German) |
| `reference/` | unchanged originals from an earlier prototype, input for stage 1 tasks |

## Status

Stage 1 "Foundation": scaffold in place, no product code yet. See `STATUS.md` for the tasks that
can start.
