# Tests

Cross-package tests for Project air: the layers that need more than one package. P0-03 creates only
this folder and this overview; no test tooling is installed here.

## Layers

The layers come from the monorepo structure in the blueprint (section 3).

| Layer | Folder | Purpose |
|---|---|---|
| integration | `tests/integration/` | services together, without a browser |
| e2e | `tests/e2e/` | browser and the whole stack |
| perf | `tests/perf/` | load and performance tests |

## Which task adds the tooling

- Workspace test command and runner configuration: P0-04, the workspace task.
- `integration` harness: the task of the backend-core stage that owns the `api-tests` gate
  ([docs/quality.md](../docs/quality.md)).
- `e2e` harness: the task of the web-app stage that owns the `e2e` gate
  ([docs/quality.md](../docs/quality.md)).
- `perf` harness: the tasks of the engine-spike and engine-core stages that own the
  `perf-baseline` and `perf` gates ([docs/quality.md](../docs/quality.md)).

No command and no directory below `tests/` is fixed here: the task that adds a layer's tooling also
creates its folder and command.

## Rules

- `AD-9` — ports, databases and buckets come only from `.polier-slot`; tests that use shared
  resources run through their exclusive gate.
- Tests are read-only against production code, as set out in the layer table of
  [docs/module-map.md](../docs/module-map.md).
- Rules and the definition of done: [ARCHITECTURE.md](../ARCHITECTURE.md).
