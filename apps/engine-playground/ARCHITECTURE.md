# Architecture: apps/engine-playground

**Kind:** `app` · **Created in stage:** `engine-spike`

## Purpose

Develops and demonstrates the engine alone, without login and server: scenes (empty, 500, 10,000, stress), an FPS display, a WebGPU/WebGL2 switch and simulated foreign cursors.

## Inputs

- The engine from `packages/engine`, fixture scenes from `packages/test-kit` and tokens/components from `packages/ui-kit`.
- No backend: the app must work without any service.

## Outputs

- Scenes for empty, 500, 10,000 and stress loads.
- An FPS display, the WebGPU/WebGL2 switch and simulated foreign cursors.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`, `packages/ui-kit`, `packages/engine`, `packages/test-kit`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
