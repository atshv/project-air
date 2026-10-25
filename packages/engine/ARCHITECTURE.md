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

The pinned toolchain is CMake 4.4.4 and Emscripten 6.0.13 with C++20
([docs/versions.md](../../docs/versions.md)); the engine builds with CMake, not with pnpm.

- **Native build and unit test:**
  `cmake -S packages/engine -B packages/engine/build -DCMAKE_BUILD_TYPE=Debug && cmake --build packages/engine/build --parallel && ctest --test-dir packages/engine/build --output-on-failure`
- **WebAssembly build:** `bash packages/engine/tools/build-wasm.sh` from the repository root; the
  wrapper prepends the Homebrew Emscripten `PATH` (or trusts the CI emsdk) and runs the `emcmake`
  configure plus build.
- **Targets:** the `air_engine` library, the core modules `doc`, `camera`, `spatial` and `render`,
  the CTest suites `engine_unit_tests` and `engine_core_tests`, and the WASM module
  `build-wasm/engine.js` plus `engine.wasm` exporting `air_engine_version`.
- **Gate catalogue:** [docs/gates/cpp-cmake.md](../../docs/gates/cpp-cmake.md) and
  [docs/gates/wasm-emscripten.md](../../docs/gates/wasm-emscripten.md).

The committed generated headers (`packages/contracts/generated/contract.h`, `packages/ui-kit/tokens.h`)
are included read-only; the engine never copies or edits them.

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
