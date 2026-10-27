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
- **Performance:** `node packages/engine/test/perf/run-perf.mjs` (exclusive `perf-baseline`, 50,000 rectangles, p95 ≤ 16.7 ms) and `node packages/engine/test/perf/run-perf.mjs --scenario engine-core` (the `perf` stage gate: 10,000-object interactive run plus the L01 basis/final proof; report [docs/engine/perf-baseline.md](engine/perf-baseline.md), gate catalogue [docs/gates/perf.md](gates/perf.md)).
- **Visual:** `node packages/engine/test/visual/run-visual.mjs` (the `visual` stage gate: four deterministic scenes at 1440×900 and 390×844 against the committed reference images under `reviews/evidence/visual-baselines/`; `--update` writes baselines as a reviewed update, never a gate pass; catalogue [docs/gates/visual-diff.md](gates/visual-diff.md)).
- **Bridge:** `pnpm --filter @project-air/engine run build|typecheck|lint`. Pins: CMake 4.4.4, Emscripten 6.0.13 in [docs/versions.md](versions.md); gates in [docs/gates/cpp-cmake.md](gates/cpp-cmake.md), [docs/gates/wasm-emscripten.md](gates/wasm-emscripten.md), [docs/gates/perf.md](gates/perf.md).

## Scenes and the playground

`apps/engine-playground` shows the engine alone (no backend). It loads a deterministic scene from
`packages/test-kit`, draws it with one instanced WebGL2 draw per frame, and keeps the data fixed while
the view moves.

| Scene | Query | Content |
| --- | --- | --- |
| sample (default) | `?scene=sample` | 500 note cards, 50 zones with 2–4 contained blocks each, all five zone tones, world 9600×5408 px |
| stress | `?scene=stress` | N objects on a tight grid, `?count=N` default 10,000, valid 0 … 50,000 |
| engine-core (perf) | `?scene=engine-core` / `?perf=engine-core` | 10,000 mixed board objects (9,200 cards, 200 zones, 600 blocks), world 19,200×10,816 px; the document of the `perf` gate |
| benchmark | `?bench=50000&samples=600&warmup=120` | unchanged 50,000-rectangle perf document for `packages/engine/test/perf/run-perf.mjs` |

- **Scene builders:** `packages/test-kit` (`@project-air/test-kit`) builds all scenes with a seeded
  PRNG and no ambient randomness or clock: ids `card-0001`/`zone-0001`/`block-0001` (stress:
  `stress-00001`), geometry on the 16 px canvas grid, the engine's tone and layer names, and
  metadata (world, bounds, counts, seed, fit at 1440×900 and 390×844). Scenes are pure functions of
  their arguments, so every machine gets identical objects and bounds;
  `pnpm --filter @project-air/test-kit test` proves determinism, the 500/50 counts, the engine-core
  10,000-object mix and the 10,000/0/50,000 stress sizes.
- **Fit and clamp:** the sample world is 9600×5408 px. The fit zoom is clamped to the engine camera
  range 0.1 … 8: the raw fit is **0.15** at 1440×900 (desktop) and **0.040625** at 390×844, so a
  narrow viewport clamps to **0.1** and crops the board instead of zooming further out.
- **Perf mode:** `?perf=engine-core&scene=<name>&samples=<n>&warmup=<n>[&verifyCulling=1]` loads
  the scene once and then calls exactly one `setCamera` and one `renderFrame` per frame along the
  documented camera path (one zoom cycle fit × 6 and back, one left-to-right pan sweep); the harness
  asserts the scene counts, warm-up and sample counts, a single document load and, for the L01 final,
  the culled command-buffer size against an independent visible-set check.
- **Interaction:** demo-level pointer-drag pan and wheel or two-pointer pinch zoom around the
  pointer; both only call `setCamera`, so the scene data never changes. L15 (P4-24) owns the final
  trackpad defaults.
- **View hook:** `?view=<worldX>,<worldY>,<zoom>` places that world point at the canvas centre at
  that zoom (clamped to the camera range) and only calls `setCamera`; the document and its spatial
  index never change. It is the deterministic camera state for the visual gate
  (`packages/engine/test/visual/run-visual.mjs`); without the parameter the page keeps its fit
  camera, and an invalid value fails closed with the engine error instead of falling back to a
  different view.
- **HUD:** object, card and zone counts, visible instances, FPS and active backend (`WebGL2` today)
  in DOM chrome below the canvas, not an overlay; the text updates once per second so it adds no
  per-frame layout work to the measured frame.
- **Ready hook:** `window.__enginePlayground.ready` is a Promise that resolves once the first full
  HUD second is drawn (`{ ok: true, scene, counts, objectCount, visibleCount }`) or with
  `{ ok: false, error }` when the engine failed. `window.__enginePlayground.pause()` stops the loop
  for a capture and `getState()` reports scene, counts, FPS, backend and camera.
- **Serve:** from the repository root, `python3 -m http.server <slot playground port> --bind
  127.0.0.1`, then open `http://127.0.0.1:<port>/apps/engine-playground/?scene=sample`; the port is
  `ports.playground` from `.polier-slot`, never hard-coded in the page.
- **Import map:** `@project-air/engine` → `packages/engine/dist/bridge/engine.js` and
  `@project-air/test-kit` → `packages/test-kit/dist/scenes.js` (build the test-kit with
  `pnpm --filter @project-air/test-kit run build`). The test-kit import is dynamic so the benchmark
  mode keeps working in the perf harness copy, which only carries the engine artefacts.
- **Capture:** build the bridge, WASM and test-kit, serve, then `node
  apps/engine-playground/tools/capture.mjs reviews/evidence/P4-02-desktop.png
  reviews/evidence/P4-02-mobile.png`; it emulates 1440×900 and 390×844, waits for the ready hook,
  pauses the loop and prints layout, HUD and state per shot.

## Canvas acceptance catalogue

The stage table in [docs/canvas-acceptance.md](canvas-acceptance.md) maps blueprint phase 2
(`engine-spike`) to **L01 — Performance basis and proof**. The spike delivered the engine-spike/D8
performance basis: 50,000 rectangles at p95 ≤ 16.7 ms, committed JSON evidence and gate record
(see [docs/engine/perf-baseline.md](engine/perf-baseline.md)). `engine-core` adds the L01 basis
fixtures — the deterministic 500-card/50-zone sample board and the stress scene from
`packages/test-kit` — and demo-level pan/zoom in the playground. The measured L01 basis and final
proof, the `perf` gate and the reference images remain with P4-03, P4-04 and P4-28 (board Q18).
Other engine-owned entries — L02, L03, L07, L08, L10–L20 — belong to those stages; their interaction
behaviours are not implemented.

## What the spike does not prove yet

- **Reference hardware:** the MacBook Air M1, 8 GB target is not measured; the M2 numbers are a proxy
  and must be re-measured on the M1 before that hardware's stage exit.
- **Measurement shape:** frame production (unlocked display, no per-frame GPU sync/fence), not GPU
  completion, long tasks while panning/zooming, or the L01 final proof (500 cards + 50 zones, no long
  task > 50 ms).
- **Canvas behaviours:** the playground has demo-level pan/zoom over a fixed scene; gestures,
  selection, editing, snapping, zone membership, undo, keyboard, text, images, edges, cursors and the
  accessibility mirror are not implemented. Hit testing exists at the document/command-buffer level
  (P4-01); interaction policy, selection state and overlays are not.
- **Contracts of the mutation API:** the `ObjectId` stays inside the C++ core for now; the C ABI
  addresses live objects by their document slot index, and the bridge owns the contract-UUID mapping
  that a later task may expose.
- **WebGPU:** no backend; only the command-buffer seam is ready.
- **Lifecycle:** one engine per WASM module; `dispose()` detaches the handle only (no
  `engine_destroy`/teardown yet).
