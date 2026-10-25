# Engine

**As of:** 2026-10-25 · **Package:** `packages/engine` ·
**Architecture decision:** [ADR-0006](adr/ADR-0006-engine-architecture.md)

The engine is a C++20 core compiled to WebAssembly behind the TypeScript bridge
`createEngine(canvas, options)` (`src/bridge/engine.ts`). It holds a working copy, never talks to
the network (AD-2), and reads the contract and tokens from generated headers.

## Modules

| Module | Files | Purpose | Inputs → outputs | Imports |
| --- | --- | --- | --- | --- |
| `doc` | `doc.h`, `doc.cpp` | Flat rectangle document reserved for 50,000, fractional `z`, tone/layer, draw-order permutation | `BoardContent` / `Rectangle` → rectangles, order, version, identity | `contract.h`, `tokens.h`, geometry, status |
| `camera` | `camera.h`, `camera.cpp` | Pan/zoom affine, world↔screen, visible bounds, 16 px grid/snapping, validating mutators | pan/zoom/viewport → screen points, world bounds | geometry, status, `tokens.h` |
| `spatial` | `spatial.h`, `spatial.cpp` | Uniform-grid culling (256 world-px cells), rebuilt on version change | document + world bounds → candidate indices | doc, geometry |
| `render` | `render.h`, `render.cpp` | Deterministic command buffer: culling, stable order, 24-byte instances, empty-on-failure `Status` | document + camera + viewport + index → instances | camera, doc, spatial, status, `tokens.h` |
| `render_gl` | `render_gl.h`, `render_gl.cpp` | WebGL2 instanced renderer (per-instance attributes, one `drawArraysInstanced`, inline GLSL 300 es) plus the exported C API; native stubs | command buffer → pixels / C ABI results | render, camera, doc, spatial, `tokens.h`, GLES3, Emscripten |
| C ABI | `engine.h`, `engine.cpp` | `air_engine_version()` and compile-time checks of `kContractVersion`/`tokens.h` | – → version string | `contract.h`, `tokens.h` |

Support headers: `geometry.h` (`Point`, `Bounds`) and `status.h` (`Status`; no exceptions
across the C ABI). The C API exports `engine_create`, `engine_resize`, `engine_set_camera`, `engine_load_rectangles`,
`engine_render_frame`, `engine_last_error`.

## Coordinates, order and the command buffer

- **World space** is the contract's board space in pixels; the 16 px world/canvas grid is
  `tokens::canvas_grid` (design rule §3). Camera: `u = (x - panX) * zoom`, `v = (y - panY) * zoom`, where pan is
  the world point at the viewport's top-left. The zoom clamp `0.1 … 8` is a provisional spike
  interaction value, not a UI token.
- **Fractional `z`** is the contract's string. Order is layer (design rule §8 → `tokens::layer_*`:
  zones 2, blocks 4, note cards 5), then `z` lexicographically, then insertion order, so equal `z`
  keeps insertion order.
- **Instance layout (24 bytes, `static_assert`):**

  | Offset | Field | Meaning |
  | --- | --- | --- |
  | 0 | `float x` | screen-space left (CSS px) |
  | 4 | `float y` | screen-space top (CSS px) |
  | 8 | `float width` | screen-space width |
  | 12 | `float height` | screen-space height |
  | 16 | `uint32 tone` | tone ordinal → `tokens::card`, `tone_a` … `tone_e` |
  | 20 | `uint32 layer` | design-rules layer (2/4/5) |

  `CommandBuffer` reserves for the maximum document once, then clears/rebuilds without growth;
  identical input gives byte-identical builds. `render_gl` uploads the records once per frame and
  issues one instanced draw; no per-object JS call.

## Build and check commands

- **Native build + tests:** `cmake -S packages/engine -B packages/engine/build -DCMAKE_BUILD_TYPE=Debug && cmake --build packages/engine/build --parallel && ctest --test-dir packages/engine/build --output-on-failure` (suites `engine_unit_tests`, `engine_core_tests`).
- **WASM:** `bash packages/engine/tools/build-wasm.sh` then `node packages/engine/tools/wasm-smoke.mjs`; size: `node packages/engine/tools/wasm-size.mjs` (budget 307,200 B gzip).
- **Performance:** `node packages/engine/test/perf/run-perf.mjs` (exclusive `perf-baseline`, 50,000 rectangles, p95 ≤ 16.7 ms; report [docs/engine/perf-baseline.md](engine/perf-baseline.md)).
- **Bridge:** `pnpm --filter @project-air/engine run build|typecheck|lint`. Pins: CMake 4.4.4, Emscripten 6.0.13 in [docs/versions.md](versions.md); gates in [docs/gates/cpp-cmake.md](gates/cpp-cmake.md), [docs/gates/wasm-emscripten.md](gates/wasm-emscripten.md), [docs/gates/perf.md](gates/perf.md).

## Canvas acceptance catalogue

The stage table in [docs/canvas-acceptance.md](canvas-acceptance.md) maps blueprint phase 2
(`engine-spike`) to **L01 — Performance basis and proof**. This spike delivers the engine-spike/D8
performance basis: 50,000 rectangles at p95 ≤ 16.7 ms, committed JSON evidence and gate record
(see [docs/engine/perf-baseline.md](engine/perf-baseline.md)). L01's basis (500 cards +
50 zones, long tasks ≤ 16 ms while panning/zooming) and final proof (500 cards + 50 zones, long tasks
≤ 50 ms) remain open for `engine-core`, `realtime` and `hardening` (board Q18). Other engine-owned
entries — L02, L03, L07, L08, L10–L20 — belong to those stages; their interaction behaviours are
not implemented.

## What the spike does not prove yet

- **Reference hardware:** the MacBook Air M1, 8 GB target is not measured; the M2 numbers are a proxy
  and must be re-measured on the M1 before that hardware's stage exit.
- **Measurement shape:** frame production (unlocked display, no per-frame GPU sync/fence), not GPU
  completion, long tasks while panning/zooming, or the L01 final proof (500 cards + 50 zones, no long
  task > 50 ms).
- **Canvas behaviours:** gestures, hit testing, selection, editing, snapping, zones, undo, keyboard,
  text, images, edges, cursors and the accessibility mirror are not implemented.
- **WebGPU:** no backend; only the command-buffer seam is ready.
- **Lifecycle:** one engine per WASM module; `dispose()` detaches the handle only (no
  `engine_destroy`/teardown yet).
