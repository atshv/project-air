# Architecture: packages/engine

**Kind:** `package` · **Created in stage:** `engine-spike`

## Purpose

Draws the canvas and processes gestures. It ships `engine.wasm` behind a thin TypeScript bridge (`createEngine(canvas, options)`) and knows neither network, database nor accounts: it receives and emits operations and events such as "operation created", "object clicked" and "selection changed".

## Inputs

- Operations and normalised input events (mouse, trackpad, touch, keyboard) from the host app.
- Generated `packages/contracts` C++ code and the `packages/ui-kit` token header.
- A canvas element, with WebGPU and a WebGL2 fallback.

## Outputs

- `engine.wasm` plus the TypeScript bridge `createEngine(canvas, options)`.
- Events: operation created, object clicked, selection changed.
- Rendered frames and an accessibility/test mirror of the visible objects.

## TypeScript layers

`src/` follows UI → logic → data (`docs/module-map.md`). The logic layer
(`src/logic/`) holds the gesture-result union (`gestures.ts`), the
gesture-to-operation builders with exactly one inverse (`operations.ts`), the
session undo/redo stack (`history.ts`) and the narrow document port
(`document-port.ts`). Logic writes only through the injected port — never the
WASM module, DOM or network — and every gesture goes through `history`, so input
code never writes the document directly (AD-1). Data is the bridge plus the
port's browser adapter; tests use the in-memory fake.

## Invariants

- `AD-1` — Every change to board content is one operation from `packages/contracts` with its inverse; one gesture = one operation.
- `AD-2` — The server is the source of truth; the engine holds a working copy and never talks to the network.
- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-7` — Visual values come only from `packages/ui-kit/tokens.json` (CSS and C++ generated).

## Allowed imports

`packages/contracts` and `packages/ui-kit` (`board.json` -> `packages[]` -> `may_import`).

## Commands

Pinned toolchain: CMake 4.4.4 + Emscripten 6.0.13, C++20
([docs/versions.md](../../docs/versions.md)); the engine builds with CMake, not pnpm.

- **Native and WASM:** native build, CTest suites `engine_unit_tests`/`engine_core_tests`/`engine_text_tests` and the
  WASM module use the commands in [docs/engine.md](../../docs/engine.md#build-and-check-commands).
- **TypeScript:** `pnpm --filter @project-air/engine run build|typecheck|lint|test`; `tsconfig.json`
  typechecks all of `src/` and `tsconfig.build.json` emits only the bridge to
  `dist/bridge/engine.js`; the package entry stays unchanged.
- **Gate catalogue:** [docs/gates/cpp-cmake.md](../../docs/gates/cpp-cmake.md) and
  [docs/gates/wasm-emscripten.md](../../docs/gates/wasm-emscripten.md).

The committed generated headers (`packages/contracts/generated/contract.h`, `packages/ui-kit/tokens.h`)
are included read-only; the engine never copies or edits them.

## References

- Root architecture and `AD-1` … `AD-10`: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map, layer rule and modules: [docs/module-map.md](../../docs/module-map.md) ·
  [docs/engine.md](../../docs/engine.md)
