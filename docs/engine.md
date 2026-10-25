# Engine

**As of:** 2026-10-25 · **Package:** `packages/engine` ·
**Architecture decision:** [ADR-0006](adr/ADR-0006-engine-architecture.md)

The engine is a C++20 core compiled to WebAssembly behind the TypeScript bridge
`createEngine(canvas, options)` (`src/bridge/engine.ts`). It holds a working copy, never talks to
the network (AD-2), and reads the contract and tokens from generated headers.

## Modules

| Module | Files | Purpose | Inputs → outputs | Imports |
| --- | --- | --- | --- | --- |
| `doc` | `doc.h`, `doc.cpp` | Flat object document reserved for 50,000 objects: stable ids, live/removed slots, incremental mutations, fractional `z`, tone/layer, draw-order permutation | `BoardContent` / `Rectangle` / mutations → objects, ids, order, version, identity | `contract.h`, `tokens.h`, geometry, status |
| `camera` | `camera.h`, `camera.cpp` | Pan/zoom affine, world↔screen, visible bounds, 16 px grid/snapping, validating mutators | pan/zoom/viewport → screen points, world bounds | geometry, status, `tokens.h` |
| `spatial` | `spatial.h`, `spatial.cpp` | Uniform-grid culling (256 world-px cells), rebuilt on version change or patched incrementally per mutation; bounds and point queries | document + world bounds/point → candidate slots in document order | doc, geometry, status |
| `render` | `render.h`, `render.cpp` | Deterministic command buffer: culling, stable order, 24-byte instances, empty-on-failure `Status`; command-buffer hit testing | document + camera + viewport + index → instances, hit result | camera, doc, spatial, status, `tokens.h` |
| `render_gl` | `render_gl.h`, `render_gl.cpp` | WebGL2 instanced renderer (per-instance attributes, one `drawArraysInstanced`, inline GLSL 300 es) plus the exported C API; native stubs | command buffer / mutation and hit-test calls → pixels / C ABI results | render, camera, doc, spatial, `tokens.h`, GLES3, Emscripten |
| C ABI | `engine.h`, `engine.cpp` | `air_engine_version()` and compile-time checks of `kContractVersion`/`tokens.h` | – → version string | `contract.h`, `tokens.h` |

Support headers: `geometry.h` (`Point`, `Bounds`) and `status.h` (`Status`; no exceptions
across the C ABI). The C API exports `engine_create`, `engine_resize`, `engine_set_camera`,
`engine_load_rectangles`, `engine_add_rectangle`, `engine_update_geometry`, `engine_update_z`,
`engine_remove_object`, `engine_hit_test`, `engine_visible_instance_count`, `engine_render_frame`
and `engine_last_error`; the TypeScript bridge exposes the same surface as typed methods.

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

## Object identity and mutations

`Document` keeps one storage slot per object and assigns a monotonic `ObjectId` on insert
(`addObject`; ids start at 1 and are never reused, not after `removeObject`, not after `clear()`).
Every slot carries a live/removed flag. A removed object becomes a tombstone whose slot a later
insert may reuse, while its id stays dead: `slotForId` rejects it and a stale handle can never
resolve to the new object.

The incremental mutations `updateGeometry`, `updateZ` and `removeObject` (plus `addObject` for an
insert) validate before they mutate: non-finite or overflowing geometry and unknown/removed ids
return a `Status` and leave the document untouched. Each accepted mutation increments `version()`
once and keeps the storage reserved for 50,000 slots. Geometry changes do not touch the draw order;
a `z` change marks it dirty and the permutation is rebuilt lazily on the next `drawOrder()` /
`drawOrderRank()` call. Removed slots never appear in the draw order, and every remaining object
keeps its id, geometry and relative draw order.

## Spatial queries

The uniform-grid index is bound to the document identity and version: it is rebuilt only when the
document changes (never per frame and never on a camera move), and `CommandBuffer::build` and
`CommandBuffer::hitTest` reject a stale or foreign index. Inserts, moves and removals patch the
grid per object (`updateSlot`, `removeSlot`) instead of rebuilding it for the whole document; a
z-only change only syncs the version.

`query` (bounds) and `queryPoint` fill a caller-owned vector with the live slot indices whose cells
intersect the query, deduplicated and in document (slot) order. The index reuses its own scratch and
stamp buffers, so a query allocates nothing itself; a rectangle spanning several cells is offered
once, and an oversized one is always a candidate for the command buffer's exact filter.

## Hit testing

`CommandBuffer::hitTest` maps a screen point through the camera, asks the spatial index for its
candidates and returns the topmost live object in draw order: highest layer, then greatest
fractional `z`, then latest insertion order. A point without objects returns the empty
`HitResult` (`found == false`, `kNoObject`); a non-finite point, a viewport that is not positive
and finite, or a stale index returns a `Status`. Bounds include their edges and corners, so a point
on a shared edge or corner hits every rectangle that includes it and the draw-order rule picks one
deterministically. The bridge calls this once per hit test; there is no JS-side hit testing.

## Loading and stale-index defence

`engine_load_rectangles` replaces the whole document content. The packed array is validated
completely before the document is cleared, so a rejected load returns a failure and leaves the
previous document, its slot handles and its spatial index untouched; a successful load invalidates
every slot handle. Before each incremental C ABI mutation patches the grid, it rebuilds an index
that is stale for the current document, so a patch never trusts a grid that a failed path left
behind. The same `SpatialIndex::ensureCurrent` guard is covered by the native suite.

## Build and check commands

- **Native build + tests:** `cmake -S packages/engine -B packages/engine/build -DCMAKE_BUILD_TYPE=Debug && cmake --build packages/engine/build --parallel && ctest --test-dir packages/engine/build --output-on-failure` (suites `engine_unit_tests`, `engine_core_tests`).
- **WASM:** `bash packages/engine/tools/build-wasm.sh` then `node packages/engine/tools/wasm-smoke.mjs`; size: `node packages/engine/tools/wasm-size.mjs` (budget 307,200 B gzip). The wrapper keeps the Emscripten cache under `build-wasm/.emscripten-cache` unless `EM_CACHE` is set, so a read-only package cache (sandboxed agents) or a shared user cache cannot break the build.
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
- **Canvas behaviours:** gestures, selection, editing, snapping, zones, undo, keyboard, text, images,
  edges, cursors and the accessibility mirror are not implemented. Hit testing exists at the
  document/command-buffer level (P4-01); interaction policy, selection state and overlays are not.
- **Contracts of the mutation API:** the `ObjectId` stays inside the C++ core for now; the C ABI
  addresses live objects by their document slot index, and the bridge owns the contract-UUID mapping
  that a later task may expose.
- **WebGPU:** no backend; only the command-buffer seam is ready.
- **Lifecycle:** one engine per WASM module; `dispose()` detaches the handle only (no
  `engine_destroy`/teardown yet).
