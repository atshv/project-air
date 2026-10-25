# Architecture: packages/engine

**Kind:** `package` · **Created in stage:** `engine-spike`

## Purpose

Draws the canvas and processes gestures. It ships `engine.wasm` behind a thin TypeScript bridge (`createEngine(canvas, options)`) and knows neither network, database nor accounts: it receives operations and emits operations, plus events such as "operation created", "object clicked" and "selection changed". Gesture logic lives in C++; input is collected and normalised in JS.

## Inputs

- Operations and normalised input events (mouse, trackpad, touch, keyboard) from the host app.
- Generated C++ code from `packages/contracts`; the generated token header from `packages/ui-kit`.
- A canvas element, with WebGPU and a WebGL2 fallback.

## Outputs

- `engine.wasm` plus the TypeScript bridge `createEngine(canvas, options)`.
- Events: operation created, object clicked, selection changed.
- Rendered frames and an accessibility/test mirror of the visible objects.

## Invariants

- `AD-1` — Every change to board content is one operation from `packages/contracts` with its inverse; one gesture = one operation.
- `AD-2` — The server is the source of truth; the engine holds a working copy and never talks to the network.
- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-7` — Visual values come only from `packages/ui-kit/tokens.json` (CSS and C++ generated).

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`, `packages/ui-kit`.

## Commands

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
