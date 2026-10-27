# Engine

**As of:** 2026-10-27 · **Package:** `packages/engine` ·
**Architecture decision:** [ADR-0006](adr/ADR-0006-engine-architecture.md)

The engine is a C++20 core compiled to WebAssembly behind the TypeScript bridge
`createEngine(canvas, options)` (`src/bridge/engine.ts`). It holds a working copy, never talks to
the network (AD-2), and reads the contract and tokens from generated headers.

## Modules

| Module | Files | Purpose | Inputs → outputs | Imports |
| --- | --- | --- | --- | --- |
| `doc` | `doc.h`, `doc.cpp` | Flat object document reserved for 50,000 objects: stable ids, live/removed slots, incremental mutations, fractional `z`, tone/layer, draw-order permutation | `BoardContent` / `Rectangle` / mutations → objects, ids, order, version, identity | `contract.h`, `tokens.h`, geometry, status |
| `camera` | `camera.h`, `camera.cpp` | Pan/zoom affine, world↔screen, visible bounds, 16 px grid/snapping, validating mutators, L19 fit (100 % cap, L02 top padding) and the dot-grid visibility threshold | pan/zoom/viewport → screen points, world bounds, fitted view | geometry, status, `tokens.h` |
| `spatial` | `spatial.h`, `spatial.cpp` | Uniform-grid culling (256 world-px cells), rebuilt on version change or patched incrementally per mutation; bounds and point queries | document + world bounds/point → candidate slots in document order | doc, geometry, status |
| `render` | `render.h`, `render.cpp` | Deterministic command buffer: culling, stable order, 24-byte instances, empty-on-failure `Status`; command-buffer hit testing | document + camera + viewport + index → instances, hit result | camera, doc, spatial, status, `tokens.h` |
| `render_gl` | `render_gl.h`, `render_gl.cpp` | WebGL2 instanced renderer (per-instance attributes, one `drawArraysInstanced`, inline GLSL 300 es) plus the exported C API; native stubs | command buffer / mutation and hit-test calls → pixels / C ABI results | render, camera, doc, spatial, `tokens.h`, GLES3, Emscripten |
| `text` | `text.h`, `text.cpp` | L02 runtime glyph atlas: token text styles, atlas plan with the texture-limit fallback, validated glyph table with a placeholder per role, glyph runs and the 32-byte glyph command buffer | token typography / glyph count, cell, DPR, texture limit / RGBA pixels + packed metrics / runs + camera → plan, CSS-px glyph metrics, glyph quads | camera, geometry, status, `tokens.h` |
| `text_gl` | `text_gl.h`, `text_gl.cpp` | Text C ABI (pure style/plan calls in both builds) and the WebGL2 glyph pass: atlas texture upload, one instanced glyph draw after the object pass | C ABI calls / glyph buffer → texture, pixels | text, `tokens.h`, GLES3 |
| C ABI | `engine.h`, `engine.cpp` | `air_engine_version()` and compile-time checks of `kContractVersion`/`tokens.h` | – → version string | `contract.h`, `tokens.h` |

Support headers: `geometry.h` (`Point`, `Bounds`) and `status.h` (`Status`; no exceptions
across the C ABI). The C API exports `engine_create`, `engine_resize`, `engine_set_camera`,
`engine_load_rectangles`, `engine_add_rectangle`, `engine_update_geometry`, `engine_update_z`,
`engine_remove_object`, `engine_hit_test`, `engine_visible_instance_count`, `engine_render_frame`,
`engine_fit_view`, the text calls `engine_text_style`, `engine_text_font_family`,
`engine_text_plan_atlas`, `engine_text_max_texture_size`, `engine_text_load_atlas`,
`engine_text_add_run`, `engine_text_clear_runs`, `engine_visible_glyph_count` (P4-08) and
`engine_last_error`; the TypeScript bridge exposes the same surface as typed methods.

## Gesture logic layers (TypeScript)

Next to the C++ core, `packages/engine/src/` follows the package layer rule UI → logic → data
(`docs/module-map.md`). The host app is the UI layer; data is the bridge (`src/bridge/engine.ts`)
plus the document port's browser adapter; the logic layer (`src/logic/`) is pure TypeScript: no DOM,
no `fetch`, no WASM import at runtime, so it runs unchanged in Node.

| File | Purpose |
| --- | --- |
| `src/logic/gestures.ts` | typed gesture-result union: drag single, drag group, resize, create, delete, keyboard-nudge series |
| `src/logic/operations.ts` | builds exactly one contract operation with its inverse per gesture; applies operations and inverses through the port |
| `src/logic/document-port.ts` | narrow data port (read, add, move, resize, remove, update z) with a pure in-memory fake for tests and a bridge adapter that maps contract UUIDs to engine slot handles |
| `src/logic/history.ts` | session undo/redo stack, depth 20, `push(operation, inverse)`, redo cleared on a new operation, `describe()` hint label |

- **One gesture = one operation (AD-1).** A single drag becomes one `moveCard`/`moveBlock`/`moveZone`;
  a multiple-selection drag becomes one `group` operation whose children are the per-object moves,
  never per-object history entries. A resize becomes `resize*`, a create becomes `create*`, deleting a
  card or block becomes `delete*`, and a keyboard-nudge series is one move with the accumulated delta.
- **Inverses come from the working copy, not the gesture.** Current positions, sizes, entities and
  fractional `z` values are read through the port, so an undo restores what the engine actually held
  and a byte-identical snapshot round trip is testable in Node.
- **No direct document writes.** Input code applies the operation through the port and pushes the
  pair into `history`; `undo()` applies the stored inverse, `redo()` re-applies the operation and a
  new operation clears the redo branch.
- **No-ops and rejections.** An empty or unchanged gesture produces no operation and no history
  entry; unknown or malformed ids, duplicate group members and sizes below the contract minimums
  throw `OperationError` and leave the working copy untouched.
- **Contract only.** Operation shapes come from `packages/contracts/generated/types.ts` and every
  built operation is validated against `operation.schema.json` in the unit suite; the layer never
  invents a parallel operation shape.

The `reorder` operation (contract 0.2.0, P4-25) is built by the `bring-to-front` gesture (P4-06) and
applied through `DocumentPort.kindOf` + `updateZ`, because its payload names only the item; the port's
`zIndices(kind)` lists one layer's keys. Deliberately not built here: `updateNote`
edits note content that the engine working copy does not hold; `updateBlock` changes only zone
membership, which belongs to P4-23/24; zone deletion gestures and membership also belong to L08 and
P4-23/24. The seam applies `deleteZone` with policy `delete` as the exactly one inverse of a zone
creation, which is how undoing a create works; policy `keep` (reparenting) is rejected until L08.
`payload-move-zone` is read as the moved zone id, matching the valid fixture and the corrected 0.2.0
schema description.

The suite runs with `pnpm --filter @project-air/engine test` (`node --test test/*.test.mjs`): one
gesture is one operation, a group drag is one operation, an inverse restores a byte-identical fake
snapshot, undo/redo depth and redo-clear semantics hold, invalid or unknown ids are rejected, and a
source scan proves no DOM or network use in the logic layer.

## Coordinates, order and the command buffer

- **World space** is the contract's board space in pixels; the 16 px world/canvas grid is
  `tokens::canvas_grid` (design rule §3). Camera: `u = (x - panX) * zoom`, `v = (y - panY) * zoom`, where pan is
  the world point at the viewport's top-left. The zoom clamp `0.1 … 8` is a provisional spike
  interaction value, not a UI token.
- **Fractional `z`** is the contract's string. Order is layer (design rule §8 → `tokens::layer_*`:
  zones 2, blocks 4, note cards 5), then `z` lexicographically, then insertion order, so equal `z`
  keeps insertion order. The layer always wins: a zone with the greatest key still draws below a card
  with the least. Keys are compared byte by byte, never parsed, so keys that are equal as doubles keep
  their order. The edge layer (3) is reserved and not drawn by the engine; chrome layers stay DOM.
- **Front of the layer (L13, P4-06).** "The last moved or selected element is on top of its layer"
  is stored, not computed: the `bring-to-front` gesture becomes exactly one contract `reorder`
  operation through the seam whose `z` is `keyAfter(highest key of the other objects of the same
  kind)` (the rightmost non-`z` character is raised by one and the rest dropped; a run of `z` gets a
  `1` appended), and whose inverse carries the previous key. An object already strictly on top, or
  alone in its layer, yields no operation; an equal key counts as a neighbour because insertion order
  would win the tie. A reload from the stored keys shows the same order, and the inverse restores the
  byte-identical command buffer. Collisions are not nudged (Q15).
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

## Fit, dot grid and idle drawing (L19)

- **Fit is pure and lives in the core.** `Camera::fitBounds(bounds, viewportWidth, viewportHeight,
  ViewFit&)` takes the board's world bounds and the canvas viewport and returns the pan/zoom:
  `zoom = min(viewportWidth / bounds.width, (viewportHeight − 64) / bounds.height, 1.0)` clamped to
  `0.1 … 1.0`; the content is centred horizontally in the viewport and vertically in the area below
  the L02 top padding, so at least **64 px** (bar 48 px + 16 px, tokens `space_48 + space_16`) stay
  free above it. A board whose raw fit is below the 0.1 camera minimum is cropped instead of zoomed
  further out, and then the padding cannot hold either. Empty or invalid bounds (zero, negative or
  non-finite area) are an explicit case: world origin at 100 % (pan 0/0, zoom 1), no division by
  zero and no NaN pan. A non-positive or non-finite viewport is rejected and leaves the result
  untouched.
- **C ABI and bridge:** `engine_fit_view(bounds_x, bounds_y, bounds_width, bounds_height,
  viewport_width, viewport_height, out_pan_zoom[3])` exports the same helper. It needs no renderer,
  so it lives in `engine.cpp` and is part of the native and the WebAssembly build;
  `createEngine(canvas).fitView(bounds, viewport)` wraps it, so a host app never duplicates the rule.
- **The dot grid is chrome.** Design rule §8 layer 1: `render_gl` draws it before any object, as one
  screen-space triangle whose fragment shader turns each pixel into world coordinates with the camera
  transform. Dots use `tokens::faint` over the `tokens::canvas` clear colour, 16 px world spacing
  from `tokens::canvas_grid` and a radius from `tokens::border_width`; the device pixel ratio is a
  uniform, so the pattern stays crisp when it changes. There are no per-dot instances and no
  command-buffer entry, so the grid cannot affect culling or hit testing. It is hidden below zoom
  **0.5** and visible at or above it (canvas catalogue L19); the `sample-zoom-in` captures at zoom 0.5
  were re-run through the documented, reviewed `--update` path in the same task (only the desktop
  image changed: the mobile 0.5 view is fully covered by board content, so the grid behind it adds no
  visible pixel), and `Camera::gridVisibleAtZoom` / `Camera::kGridMinZoom` are the single source for
  the test and the renderer. The grid pass is one
  program bind, one packed uniform upload and one draw, and the object pass uploads its constant
  palette once and its resolution only on a resize, so the extra chrome layer stays inside the perf
  gate's frame budget.
- **Only draw on change (playground).** Outside `?bench=…` and `?perf=engine-core` the page owns an
  on-demand scheduler: a camera (pan, zoom or fit), document or resize change requests exactly one
  frame, the frame callback renders once and schedules nothing, so an idle canvas produces zero
  frames. `?bench=…` and `?perf=engine-core` keep their continuous requestAnimationFrame loops
  unchanged, because the perf gate measures frame production. The HUD "Frames" item,
  `window.__enginePlayground.frameCount()` and `getState().framesRendered` expose the counter; the
  `f` key and `window.__enginePlayground.fit()` run the L19 fit action. The browser record
  `reviews/evidence/P4-07-idle-<timestamp>.json` proves that one idle second renders zero frames and
  that a camera change, a resize and the benchmark loop still render. The playground's initial
  camera stays the P4-04 at-rest view (plain world-centred fit, clamped to `0.1 … 8`); L17/P4-22
  will use the L19 helper for the initial and restored view.

## Text atlas and glyph pass (L02, P4-08)

ADR-0009 in code: the browser rasterises, the core plans, validates and draws; no font file exists
in the repository or the bundle.

- **Styles from tokens.** `textStyle(role)` returns the token typography: `title` =
  `font_sans`, `text_15`, `weight_semibold` (L02 card title 15 px/600), `body` = `font_sans`,
  `text_13`, `weight_regular`, both with `line_height`. The bridge reads them through
  `engine_text_style` / `engine_text_font_family` and composes the CSS `font` string, so it holds
  no typography value of its own.
- **Atlas plan and texture-limit fallback.** `planAtlas` takes the glyph count, the CSS cell size,
  the device pixel ratio (finite, `(0, 8]`) and the GPU `MAX_TEXTURE_SIZE` and returns the smallest
  power-of-two atlas (smallest area, then the squarer one) with uniform cells of
  `ceil(css × scale) + 2` raster px (1 px transparent padding per side, so linear sampling never
  bleeds). The raster scale starts at the device pixel ratio and halves, never below 1, until the
  atlas fits; a ratio below 1 is used as is and not halved; if the last scale does not fit, the plan
  fails with a `Status` and the output is untouched. Example: 392 cells of 12×21 CSS px at DPR 3 and
  a 512 px limit fall back 3 → 1.5 → 1 (256×512).
- **Glyph table.** `GlyphAtlas::load` validates the whole upload before replacing anything: power of
  two sides within the texture limit, a raster scale in `(0, 8]`, exactly `width × height × 4` RGBA
  bytes, and per glyph nine finite floats (role, code point, atlas x/y, width, height, bearing x/y,
  advance; raster px), an integral role and code point up to U+10FFFF, a rectangle inside the atlas,
  a non-negative advance, no duplicate role/code point and one placeholder (code point 0) per role.
  A rejected upload keeps the previous atlas, pixels and generation. Metrics are reported in CSS px
  (raster px / scale), so a run lays out identically at DPR 1, 2 and 3. `resolve` returns the
  role's placeholder for a missing code point — an outlined box, never a silent gap and never a
  character used as an icon.
- **Runs and the glyph buffer.** A run is a world-anchored line box (top-left) of code points in one
  role; `TextRuns` rejects non-finite anchors, unknown roles, code points above U+10FFFF, more than
  4,096 runs or 65,536 glyphs. `GlyphBuffer::build` places glyphs by advance only (wrapping,
  ellipsis and card binding are P4-09), maps them through the camera (quads scale with the zoom),
  culls quads outside the viewport and writes 32-byte `GlyphInstance` records (screen x, y, width,
  height, normalised atlas u0, v0, u1, v1); it is reserved once and byte-identical for identical
  input. Without an atlas it succeeds with no glyphs.
- **Renderer.** `engine_text_load_atlas` uploads the validated pixels once per atlas build
  (`RGBA8`, linear, clamp to edge); a frame with runs builds the glyph buffer and issues one
  instanced draw after the object pass, sampling only the alpha coverage and tinting it with
  `tokens::fg` (blend `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`, like the grid). A frame without runs or
  without an atlas touches no GL state for text, so the perf gate's frame cost is unchanged.
- **Bridge.** `buildTextAtlas()` (`src/bridge/text-atlas.ts`) rasterises one placeholder per role
  plus the default set — printable ASCII and the Latin-1 supplement (umlauts) — with OffscreenCanvas
  (fallback: a detached `<canvas>`) as white coverage on transparent pixels, one uniform cell per
  glyph (`measureText` boxes rounded outward), and uploads pixels and packed metrics in a single
  call; it returns size, raster scale, glyph count and the texture limit. After the first build,
  `resize` rebuilds the atlas whenever the device pixel ratio changes (zoom-bucket re-rasterisation
  is P4-10). `addTextRun({ x, y, text, role })` passes the string's code points (a lone surrogate
  stays its own code unit and draws the placeholder); `clearTextRuns()` and `visibleGlyphCount()`
  complete the surface.
- **Playground.** `?text=1` (e.g. `?text=1&view=200,64,2`) builds the atlas and draws a title and
  a body run with Latin-1 letters and one missing glyph; `getState().textAtlas` reports the atlas.
  Off by default, so scenes, `visual` baselines and perf documents are unchanged.
- **Tests.** `engine_text_tests` (CTest) covers token styles, the plan at DPR 1/2/3, the fallback
  and its failures, upload validation and atomicity, DPR-independent CSS metrics, the placeholder,
  run validation and the glyph buffer (placement, zoom, culling, determinism, atlas replacement);
  `wasm-smoke` checks the pure text calls and the pre-create failures in the WebAssembly build.

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

- **Native build + tests:** `cmake -S packages/engine -B packages/engine/build -DCMAKE_BUILD_TYPE=Debug && cmake --build packages/engine/build --parallel && ctest --test-dir packages/engine/build --output-on-failure` (suites `engine_unit_tests`, `engine_core_tests`, `engine_text_tests`).
- **WASM:** `bash packages/engine/tools/build-wasm.sh` then `node packages/engine/tools/wasm-smoke.mjs`; size: `node packages/engine/tools/wasm-size.mjs` (budget 307,200 B gzip). The wrapper keeps the Emscripten cache under `build-wasm/.emscripten-cache` unless `EM_CACHE` is set, so a read-only package cache (sandboxed agents) or a shared user cache cannot break the build.
- **Performance:** `node packages/engine/test/perf/run-perf.mjs` (exclusive `perf-baseline`, 50,000 rectangles, p95 ≤ 16.7 ms) and `node packages/engine/test/perf/run-perf.mjs --scenario engine-core` (the `perf` stage gate: 10,000-object interactive run plus the L01 basis/final proof; report [docs/engine/perf-baseline.md](engine/perf-baseline.md), gate catalogue [docs/gates/perf.md](gates/perf.md)).
- **Visual:** `node packages/engine/test/visual/run-visual.mjs` (the `visual` stage gate: five
  deterministic scenes at 1440×900 and 390×844 against the committed reference images under
  `reviews/evidence/visual-baselines/`; the L19 `one-card-fit` scene runs the fit action and shows the
  dot grid at 100 %; `--update` writes baselines as a reviewed update, never a gate pass; catalogue
  [docs/gates/visual-diff.md](gates/visual-diff.md)).
- **Bridge and logic:** `pnpm --filter @project-air/engine run build|typecheck|lint|test`. `tsconfig.json` typechecks all of `src/`; `tsconfig.build.json` emits only the bridge, so the package entry stays `dist/bridge/engine.js`. Pins: CMake 4.4.4, Emscripten 6.0.13 in [docs/versions.md](versions.md); gates in [docs/gates/cpp-cmake.md](gates/cpp-cmake.md), [docs/gates/wasm-emscripten.md](gates/wasm-emscripten.md), [docs/gates/perf.md](gates/perf.md).

## Scenes and the playground

`apps/engine-playground` shows the engine alone (no backend). It loads a deterministic scene from
`packages/test-kit`, draws it with one instanced WebGL2 draw per frame, and keeps the data fixed while
the view moves.

| Scene | Query | Content |
| --- | --- | --- |
| sample (default) | `?scene=sample` | 500 note cards, 50 zones with 2–4 contained blocks each, all five zone tones, world 9600×5408 px |
| stress | `?scene=stress` | N objects on a tight grid, `?count=N` default 10,000, valid 0 … 50,000 |
| engine-core (perf) | `?scene=engine-core` / `?perf=engine-core` | 10,000 mixed board objects (9,200 cards, 200 zones, 600 blocks), world 19,200×10,816 px; the document of the `perf` gate |
| layers (L13) | `?scene=layers[&front=<id>][&store=off]` | 2 zones, 2 blocks, 4 cards, world 1024×576 px, keys that contradict the layers; loaded as contract objects through the document port (browser build `packages/engine/dist/logic/`), a click brings an object to the front with one `reorder`, keys persist in `localStorage` (`store=off` ignores them), `front=<id>` applies one front gesture at start |
| benchmark | `?bench=50000&samples=600&warmup=120` | unchanged 50,000-rectangle perf document for `packages/engine/test/perf/run-perf.mjs` |

- **Scene builders:** `packages/test-kit` (`@project-air/test-kit`) builds all scenes with a seeded
  PRNG and no ambient randomness or clock: ids `card-0001`/`zone-0001`/`block-0001` (stress:
  `stress-00001`), geometry on the 16 px canvas grid, the engine's tone and layer names, and
  metadata (world, bounds, counts, seed, fit at 1440×900 and 390×844). Scenes are pure functions of
  their arguments, so every machine gets identical objects and bounds;
  `pnpm --filter @project-air/test-kit test` proves determinism, the 500/50 counts, the engine-core
  10,000-object mix and the 10,000/0/50,000 stress sizes.
- **Fit and clamp:** the sample world is 9600×5408 px. The **initial** camera is fitted with the
  pre-L19 plain rule and clamped to the engine camera range 0.1 … 8: the raw fit is **0.15** at
  1440×900 (desktop) and **0.040625** at 390×844, so a narrow viewport clamps to **0.1** and crops
  the board instead of zooming further out. The **fit action** (`f`, `fitView`, `engine_fit_view`)
  instead applies the L19 rule above: at most 100 %, the 64 px top padding, and the same 0.1 camera
  floor.
- **Perf mode:** `?perf=engine-core&scene=<name>&samples=<n>&warmup=<n>[&verifyCulling=1]` loads
  the scene once and then calls exactly one `setCamera` and one `renderFrame` per frame along the
  documented camera path (one zoom cycle fit × 6 and back, one left-to-right pan sweep); the harness
  asserts the scene counts, warm-up and sample counts, a single document load and, for the L01 final,
  the culled command-buffer size against an independent visible-set check.
- **Interaction:** demo-level pointer-drag pan and wheel or two-pointer pinch zoom around the
  pointer, plus the L19 fit action on the `f` key; all of them only call `setCamera`, so the scene
  data never changes. L15 (P4-24) owns the final trackpad defaults.
- **View hook:** `?view=<worldX>,<worldY>,<zoom>` places that world point at the canvas centre at
  that zoom (clamped to the camera range) and only calls `setCamera`; the document and its spatial
  index never change. It is the deterministic camera state for the visual gate
  (`packages/engine/test/visual/run-visual.mjs`); without the parameter the page keeps its initial
  camera (the P4-04 at-rest view), and an invalid value fails closed with the engine error instead
  of falling back to a different view.
- **HUD:** object, card and zone counts, visible instances, the rendered-frame counter and the active
  backend (`WebGL2` today) in DOM chrome below the canvas, not an overlay; the volatile counter is
  hidden for reference captures, and the visible/frame text updates at most four times per second
  and only when a frame renders, so the HUD adds no per-frame layout work to the measured frame.
- **Ready hook:** `window.__enginePlayground.ready` is a Promise that resolves once the first frame is
  drawn and the HUD is filled (`{ ok: true, scene, counts, objectCount, visibleCount }`) or with
  `{ ok: false, error }` when the engine failed. `window.__enginePlayground.pause()` stops the
  scheduler for a capture, `fit()` runs the L19 fit action, `frameCount()` reports the rendered-frame
  counter and `getState()` reports scene, counts, visible instances, rendered frames, backend and
  camera.
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
**L19 — Canvas feel** is delivered by P4-07: the fit helper, the dot grid and on-demand drawing are
documented above, with native fit/grid tests, the `visual` reference image `one-card-fit` and the
`P4-07-idle-*` browser record. Other engine-owned entries — L02, L03, L07, L08, L10–L18, L20 —
belong to those stages; their interaction behaviours are not implemented.

## What the spike does not prove yet

- **Reference hardware:** the MacBook Air M1, 8 GB target is not measured; the M2 numbers are a proxy
  and must be re-measured on the M1 before that hardware's stage exit.
- **Measurement shape:** frame production (unlocked display, no per-frame GPU sync/fence), not GPU
  completion, long tasks while panning/zooming, or the L01 final proof (500 cards + 50 zones, no long
  task > 50 ms).
- **Canvas behaviours:** the playground has demo-level pan/zoom over a fixed scene plus the L19 fit
  action and dot grid; gesture input handling, selection, editing, snapping, zone membership, the
  undo UI, keyboard input, text layout (the P4-08 atlas draws advance-placed runs only), images, edges, cursors and the accessibility mirror are not
  implemented. The gesture-to-operation seam and the undo history core exist behind the TypeScript
  logic layer (P4-05) but are not wired to input yet. Hit testing exists at the
  document/command-buffer level (P4-01); interaction policy, selection state and overlays are not.
  The initial and restored viewport (L17/P4-22) still uses the pre-L19 plain fit; only the fit action
  uses the padded 100 % fit.
- **Contracts of the mutation API:** the `ObjectId` stays inside the C++ core for now; the C ABI
  addresses live objects by their document slot index, and the bridge owns the contract-UUID mapping
  that a later task may expose.
- **WebGPU:** no backend; only the command-buffer seam is ready.
- **Lifecycle:** one engine per WASM module; `dispose()` detaches the handle only (no
  `engine_destroy`/teardown yet).
