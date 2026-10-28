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
| `text_gl` | `text_gl.h`, `text_gl.cpp` | Text C ABI (pure style/plan calls in both builds), the WebGL2 glyph pass (atlas texture upload, one instanced glyph draw after the object pass), the bound title/preview runs and the header/snap-guide/selection chrome pass (P4-10/P4-15/P4-16) | C ABI calls / glyph buffer / bound text / snap guides / selection → texture, pixels | text, text_binding, snap, `tokens.h`, GLES3 |
| `text_binding` | `text_binding.h`, `text_binding.cpp` | L02 (P4-10) presentation binding: caller-supplied titles and previews bound to visible objects (ellipsis titles, wrapped/clipped previews), the 40 px header/inset chrome geometry, block growth, header chrome quads | document + camera + viewport + index + caller text → runs, chrome quads, required preview height | doc, spatial, text, geometry, status, `tokens.h` |
| `overlay` (bridge) | `src/bridge/overlay.ts`, `include/engine/` (none) | L18 (P4-23) DOM overlay host: pure anchor math through the camera (pan/zoom/DPR), viewport hide, focus wrap, the inline Enter/Tab/Shift+Tab/Backspace intents and the 24 px colour field, plus the DOM host that positions anchored fields, owns focus open/close/restore and stops field pointer events at the field | world rect + camera/viewport → CSS rectangle; field list + key → intent; pointer events → stopped at the field | none (DOM APIs only, ADR-0009) |
| `input` (bridge) | `src/bridge/input.ts` | L03/L07/L10 (P4-14/P4-15/P4-16) DOM-free pointer input layer: click/drag threshold, card/header grip policy, field/scroll suppression, pointer capture/cancel, right-button and multi-touch rejection, cursor and header-hover state, snap requests, the selection set, the Shift rubber band, joint drags and injected seam commits | pointer samples + hit test + camera/selection callbacks → drag preview/commit/revert, joint-drag members, selection/band state, hover, cursor, pan/zoom | none at runtime (types only) |
| `snap` | `snap.h`, `snap.cpp`, `snap_gl.h` | L07 (P4-15) snapping core: pure edge/centre candidates of visible neighbours and zones within the token screen tolerance, per-axis line-over-grid decision, Shift free, deterministic guide selection (at most three) and the guide C ABI | document + spatial index + camera + viewport + dragged slot and position → snapped world position + up to three world guide lines | camera, doc, spatial, status, `tokens.h` |
| C ABI | `engine.h`, `engine.cpp` | `air_engine_version()` and compile-time checks of `kContractVersion`/`tokens.h` | – → version string | `contract.h`, `tokens.h` |

Support headers: `geometry.h` (`Point`, `Bounds`) and `status.h` (`Status`; no exceptions
across the C ABI). The C API exports `engine_create`, `engine_resize`, `engine_set_camera`,
`engine_load_rectangles`, `engine_add_rectangle`, `engine_update_geometry`, `engine_update_z`,
`engine_remove_object`, `engine_hit_test`, `engine_visible_instance_count`, `engine_render_frame`,
`engine_fit_view`, the text calls `engine_text_style`, `engine_text_font_family`,
`engine_text_plan_atlas`, `engine_text_max_texture_size`, `engine_text_load_atlas`,
`engine_text_add_run`, `engine_text_add_box_run`, `engine_text_clear_runs`,
`engine_visible_glyph_count` (P4-08/P4-09), the binding calls `engine_text_bind_object`,
`engine_text_clear_bindings`, `engine_text_required_height` (P4-10), the snapping calls
`engine_snap_position`, `engine_snap_guide`, `engine_snap_clear` (P4-15), the selection chrome calls
`engine_set_selection`, `engine_set_band` (P4-16) and `engine_last_error`; the TypeScript bridge
exposes the same surface as typed methods. The L18 field overlay is DOM-only and adds no C ABI: it
anchors through the same camera transform the renderer uses and never touches the document or the
command buffer.

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
  `f` key and `window.__enginePlayground.fit()` run the L19 fit action. The idle harness's browser
  record `reviews/evidence/<task-id>-idle-<timestamp>.json` (the P4-10 re-run is
  `P4-10-idle-<timestamp>.json`; P4-07 is the harness origin) proves that one idle second renders
  zero frames and that a camera change, a resize and the benchmark loop still render. The playground's initial
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
  4,096 runs or 65,536 glyphs. `GlyphBuffer::build` places `line` runs by advance only and
  `ellipsis`/`wrap` runs from their cached layout (below), maps them through the camera (quads
  scale with the zoom),
  culls quads outside the viewport and writes 32-byte `GlyphInstance` records (screen x, y, width,
  height, normalised atlas u0, v0, u1, v1); it is reserved once and byte-identical for identical
  input. Without an atlas it succeeds with no glyphs.
- **Layout (P4-09).** `layoutText` turns a run's code points into glyph placements relative to the
  anchor, in CSS px from the atlas metrics, so it is independent of the device pixel ratio and of the
  zoom (a line never re-breaks on zoom). Line height = token font size × token line height. Flows:
  `line` (P4-08 behaviour, byte-identical buffers), `ellipsis` (one line; a line feed reads as a
  space; cut so the kept glyphs plus U+2026 fit the box width, trailing spaces before the cut
  dropped; three full stops when the atlas lacks U+2026; nothing when even the ellipsis is wider than
  the box) and `wrap` (greedy word wrap at U+0020, hard break at U+000A, an empty line stays a line, a
  word wider than the box breaks between characters, spaces at a line start dropped and at a line end
  not placed; `floor(height / line height)` lines are visible, the rest clipped and the last visible
  line ended with the ellipsis even if it would fit). A box width of 0 draws nothing. A run keeps its
  layout and recomputes it only when the atlas generation changes; an `ellipsis`/`wrap` run reserves
  three extra glyphs against the 65,536 limit. C ABI: `engine_text_add_box_run(x, y, role, flow,
  width, height, codePoints, count)`; `engine_text_add_run` stays the `line` flow.
- **Renderer.** `engine_text_load_atlas` uploads the validated pixels once per atlas build
  (`RGBA8`, linear, clamp to edge); a frame with runs builds the glyph buffer and issues one
  instanced draw after the object pass, sampling only the alpha coverage and tinting it with
  `tokens::fg` (blend `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`, like the grid). A frame without runs or
  without an atlas touches no GL state for text, so the perf gate's frame cost is unchanged.
- **Bridge.** `buildTextAtlas()` (`src/bridge/text-atlas.ts`) rasterises one placeholder per role
  plus the default set — printable ASCII, the Latin-1 supplement (umlauts) and, since P4-09, en/em
  dash, single and double quotes incl. „ and ‚, the bullet and U+2026 — with OffscreenCanvas
  (fallback: a detached `<canvas>`) as white coverage on transparent pixels, one uniform cell per
  glyph (`measureText` boxes rounded outward), and uploads pixels and packed metrics in a single
  call; it returns size, raster scale, glyph count and the texture limit. `addTextRun({ x, y, text,
  role, flow, box })` passes the string's code points (a lone surrogate stays its own code unit and
  draws the placeholder); `clearTextRuns()` and `visibleGlyphCount()` complete the surface.
- **Playground.** `?text=1` (e.g. `?text=1&view=200,64,2`) builds the atlas and draws a title and
  a body run with Latin-1 letters and one missing glyph; `getState().textAtlas` reports the atlas.
  Off by default, so scenes, `visual` baselines and perf documents are unchanged. `?text=layout`
  (P4-09, with `?scene=stress&count=0&view=272,112,1`) shows a fitting title, a title cut with an
  ellipsis, a zone-name box with an em dash and a wrapped preview clipped to three lines; it is the
  `text-layout` visual scene. `?text=titles` (P4-10, below) is the titles gallery. The browser
  harnesses (visual, perf, idle) copy `dist/bridge/text-atlas.js` next to `engine.js` since P4-09
  (P4-08 added the import).
- **Tests.** `engine_text_tests` (CTest) covers token styles, the plan at DPR 1/2/3, the fallback
  and its failures, upload validation and atomicity, DPR-independent CSS metrics, the placeholder,
  run validation and the glyph buffer (placement, zoom, culling, determinism, atlas replacement);
  `wasm-smoke` checks the pure text calls and the pre-create failures in the WebAssembly build.

## Titles, previews and L02 chrome (P4-10)

The binding module turns the P4-09 layout into what L02 asks the canvas to show: titles bound to
objects, previews clipped inside them, 40 px headers and a block that grows instead of scrolling.
It is **presentation input**, not board state (AD-4): the caller supplies the text, the document and
the operation seam keep none, and a reload drops the binding.

- **Binding store.** `TextBindings::set(document, slot, title, preview)` binds the text of the live
  object at a document slot. Entries are keyed by the document's stable `ObjectId`, so they can never
  match another object after a reload, and the store drops every entry as soon as the document
  instance changes (a different document instance never accumulates stale entries). The C ABI is
  `engine_text_bind_object(index, title, titleCount, preview, previewCount)` and
  `engine_text_clear_bindings()`; the bridge wraps them as `bindObjectText(index, { title, preview })`
  and `clearObjectText()`.
- **Culling with the object.** `TextBindings::bindVisible` fills the bound run store only for objects
  that are visible in the viewport: the camera's visible world bounds query the spatial index, the
  exact bounds are filtered and the title/preview boxes come from the object's own geometry. Two
  guards keep a full board bounded: an object whose on-screen height is smaller than one title line
  binds no text (text at that size would be unreadable), and a documented run budget (2,048 runs)
  stops a viewport from exhausting the P4-09 run/glyph limits. Text is therefore bound in world
  space and culled with the object, never per DOM node; the glyph buffer still culls quads.
- **Header and inset geometry (tokens only).** Zones and blocks carry a 40 px header band
  (`tokens::header_height`) with the title centred in it and a 1 px rule (`tokens::border_width`) at
  the band's bottom edge; their content starts at the `40 + 16` px inset
  (`header_height + space_16`), and the preview box is the remaining height minus the bottom
  `space_16` — so a preview is clipped to its own block, never scrolled. A card has no band: its
  title starts at `space_16` from the top, and its preview follows the title line box plus
  `space_8`. Every title box reserves the quiet delete affordance width (`button_card + space_8`), so
  a title never runs under the control that appears on hover, focus or selection. An object shorter
  than its header keeps the band inside its own height and drops the rule.
- **Title and preview flows.** A zone name and a card/block title are one `ellipsis` run at the token
  title role (`font_sans`, `text_15`, `weight_semibold`, L02 15 px/600); the preview is one `wrap`
  run in the body role (`text_13`, `weight_regular`) with its box as the clip. Empty text draws
  nothing (and an empty title or preview is a valid binding). The layout is computed in CSS px from
  the atlas metrics, so the line breaks are independent of the device pixel ratio and of the zoom.
- **Blocks grow.** `TextBindings`/`engine_text_required_height` reports the height a block needs for
  its bound preview: the inset above the preview plus the **unclipped** laid-out preview height plus
  the bottom padding. The playground applies it with `updateGeometry`, so the block's own height
  grows to the content instead of gaining an inner scrollbar; the document still stores no text and
  the value is a presentation-derived geometry input, not a board operation.
- **Header chrome class.** A visible zone/block with a bound title emits two chrome quads, not
  object instances: the header band tinted with `tokens::faint` and the rule with `tokens::border`.
  They are drawn in the glyph pass (before the glyphs of the frame) through a small instanced
  program with a per-instance tint, so the object command buffer and its instance counts are
  unchanged (the perf/count path stays exactly the document's objects). Chrome is dropped when a
  higher-layer visible object covers the band, so a card on top of a zone header is never overpainted.
- **DPR-independent binding.** The binding emits world-space runs and screen-space chrome quads; the
  atlas raster scale follows the device pixel ratio times the zoom bucket (below), while the CSS
  metrics divide it out again. `engine_binding_tests` builds DPR 1 and DPR 2 atlases of the same CSS
  typography and gets identical placements and box geometry.
- **Tests.** `engine_binding_tests` (CTest, a fourth suite) covers the header geometry (40 px band,
  rule at the boundary, title centred), the zone content inset (`40 + 16`), the card title/preview
  stack, the ellipsis title placement and box overflow, the preview clip (`floor(height / line
  height)` visible lines), the required height and the grown block, culling (visible/far/zoomed-out
  and an empty viewport), the header chrome and its occlusion, DPR independence and determinism, and
  input validation (unknown slot, code point above U+10FFFF, null pointers with a count, empty text).
  `wasm-smoke` checks the pre-create failures of the new C ABI.

### Zoom bucket and sharp text (P4-10)

P4-08 rebuilt the atlas on a device-pixel-ratio change only, so zooming in upscaled the 100 % atlas
and text blurred at 200 %. Since P4-10 the bridge picks a **zoom bucket**: the smallest power of two
at or above the camera zoom, clamped to 25 %, 50 %, 100 %, 200 % and 400 % (`atlasZoomBucket`), and
the atlas raster scale is `min(devicePixelRatio × bucket, 4)` (`atlasRasterScale`,
`MAX_ATLAS_RASTER_SCALE`). Only the raster scale changes between buckets — the P4-09 layout stays in
CSS px — so a line never re-breaks and the metrics stay DPR-independent. `setCamera` and `resize`
rebuild the atlas only when the resulting scale changes, so a session re-rasterises at most five
times (fewer at a device pixel ratio above 1, where the cap repeats a scale) and a plain pan or a
zoom inside a bucket touches nothing. The bucket is documented as interaction/performance geometry,
not a design value; the 400 % cap bounds the atlas at 4× the CSS resolution (4096² at the worst
cell size is avoided by the plan's texture-limit/halving path). The visual reference set captures the
titles gallery at **100 %** (raster scale 1, the committed text reference) and at **200 %** (raster
scale 2, `text-titles-zoom-200`), where the glyphs now sample twice the CSS resolution; the capture
records store the atlas `rasterScale` next to the camera, so the bucket is evidenced by numbers and
pixels.

### L02 defects and their before/after evidence

The engine-owned L02 defects are evidenced by `apps/engine-playground/tools/capture-titles.mjs` in
`reviews/evidence/` before and after the binding (the before shots are the same build with
`?text=titles` off — the P4-09 presentation — and the after shots are the titles gallery; the
capture records store the camera, atlas raster scale and affordance state next to every image):

| L02 defect (engine-owned) | Before | After |
| --- | --- | --- |
| Card title absent, or cut off / no ellipsis | `P4-10-before-titles-desktop.png` (bare cards) | `P4-10-after-titles-desktop.png`: one `ellipsis` title per card at 15 px/600, cut with U+2026 (`Ausflug an den …`, `Café-Notizen fü…`) |
| Title cut at the wrong width (CSS vs device px) | `P4-10-before-titles-zoom200-desktop.png` | `P4-10-after-titles-zoom200-desktop.png`: the title box is world/CSS px wide, so the cut lands inside the card at 100 % and 200 % |
| No 40 px header; header height not visible | `P4-10-before-titles-desktop.png` | `P4-10-after-titles-desktop.png`: the `faint` band and its `border` rule mark the 40 px header on both zones and blocks |
| Zone content under the header | `P4-10-before-titles-desktop.png` (no header to inset from) | `P4-10-after-titles-desktop.png`: the blocks start at the `40 + 16` px inset, directly below the rule |
| Inner scrollbar / clipped block preview | `P4-10-before-titles-desktop.png` (no preview) | `P4-10-after-titles-desktop.png`: both blocks grew to the preview height and show every wrapped line — no scroll area exists |
| Delete affordance absent, or loud / character icon | `P4-10-before-delete-hover-desktop.png` (nothing appears) | `P4-10-after-delete-rest-desktop.png` (invisible at rest), `-hover-`/`-selection-` (visible on object hover and on selection) and `-focus-desktop.png` (visible on `Tab`, `aria-label` "Delete", inline stroke SVG — `iconCharacters: []` in the record) |
| Floating / doubled text not bound to an object | `P4-10-before-floating-text-desktop.png` (`?text=layout`: runs at world coordinates, no object ownership) | `P4-10-after-titles-desktop.png`: exactly one title run and at most one preview run per visible object, bound and culled with it |
| Blurry text when zooming in (owner note at 200 %) | `P4-10-before-titles-zoom200-desktop.png` (no text) | `P4-10-after-titles-zoom200-desktop.png`: the atlas re-rasterises at raster scale 2 for the 200 % bucket (records: `textAtlas.rasterScale` 1 → 2) |

### Visual references and the perf/idle path

The `text-titles` scenes are the reviewed 100 % and 200 % additions to the committed WebGL2
reference set (desktop 1440×900 and mobile 390×844); every pre-existing reference image stayed
0-diff in the P4-10 gate run, and the `text-layout` 100 % reference is byte-identical because zoom 1
selects the same raster scale it always used. The scenes run only with `?text=titles`, so the
benchmark and perf documents stay textless. After the binding, the P4-10 `perf` gate still reports
10,000 objects at p95 0.2 ms with 0 frame intervals above 16.7 ms, every enforced metric within the
committed basis + 10 %, and the idle harness still shows zero rendered frames in idle seconds; the
records are `reviews/evidence/P4-10-perf-*.json` and the idle record written by `run-idle.mjs`. A
frame without an atlas or a binding returns from the glyph pass before any GL state is touched, so
the perf path keeps its measured cost.

## Pointer input: click, drag and edit (L03, P4-14)

L03 asks the canvas to separate click, drag and edit: clicking opens, dragging on the grip moves,
clicking in text edits — never two at the same time. The decision lives in one DOM-free input layer,
`src/bridge/input.ts`, and the playground binds pointer and wheel events to it; no second pointer
handler exists in the page. The layer is exported as `@project-air/engine/input.js` next to the
bridge and has no runtime imports, so it runs in Node tests and the page alike.

- **One state machine.** A press becomes a click candidate, an object drag, a pan or a pinch; the
  layer tracks the active pointers, the down point, the grip and the grabbed world offset, and
  reports its phase. A press that moves less than the token `drag_threshold` (4 px, screen pixels,
  `packages/ui-kit/tokens.json`) is a click: on release the layer reports a tap and writes nothing —
  no operation, no history entry, no document write. Once the movement reaches the threshold a drag
  starts exactly once and follows the pointer 1:1 (the grabbed world point under the finger stays
  under the finger; positions are world px while the threshold is screen px, so a zoom never changes
  the L03 rule). The layer never snaps or repositions by itself (P4-15 owns snapping).
- **Grip policy.** A note card drags on its whole body; a block or a zone only inside its
  `header_height` (40 px) band. A press below the header of a block or zone is consumed and moves
  nothing; the press is *not* a pan either, so the object never jitters and the view stays put. The
  band in world px is measured from the object's top through the camera transform, so it follows
  zoom correctly.
- **Suppressed targets.** A press on `input`, `textarea`, `select`, `button`, `[contenteditable]`,
  `[data-field]` or an element whose computed `overflow-x/y` is `auto`/`scroll`/`overlay` never starts
  a drag and is not captured: the element keeps its own pointer and wheel handling. The playground
  derives the descriptor from the DOM (`describeSuppression`) and the policy function lives in the
  input layer (`isSuppressedTarget`, `cursorForSuppressed`). Wheel events over a suppressed target are
  not intercepted either, so a scrollable chrome area keeps its native scrolling.
- **Capture, cancel and buttons.** A primary pointer is captured on the surface and released on up,
  `pointercancel`, `lostpointercapture` and window blur; a cancelled drag is reverted to the working
  copy position without an operation or history entry. Right/middle mouse buttons and non-primary
  buttons never drag or pan (the context menu belongs to L20); a second pointer cancels a running
  drag and turns the gesture into the two-pointer pinch zoom.
- **View-only pan and zoom.** An empty-canvas press is a pan candidate: dragging it moves the camera
  only (`setCamera`); a wheel or a two-pointer pinch zooms around the pointer (clamped to the engine
  camera range). Neither path writes the document.
- **One drag = one operation.** On release the layer calls the scene's `commitDrag`, which builds
  exactly one `drag-single` gesture with `buildOperation` on the `DocumentPort`, applies it through
  the same port and pushes the operation/inverse pair onto the P4-05 history (AD-1). While dragging,
  `previewDrag` moves the rectangle through the bridge without a document write, so the port still
  holds the start position when the operation and its inverse are built. The bridge module receives
  the seam functions through its host (injected by the playground), keeping the module-map direction
  UI → logic → data intact.
- **Presentation chrome (ADR-0009).** Cursors are `grab` on a grip, `grabbing` while dragging, `text`
  over editable targets and `default` elsewhere; the canvas is not permanently a grab cursor. A
  hovered block or zone header shows a DOM `--faint` band (`.header-surface`) that fades in with the
  120 ms `motion_hover` token (design rule §6/§7), repositioned on every camera change and fully
  transparent at rest — it is DOM chrome, never a canvas glyph or document state, so the committed
  visual references stay 0-diff. Hover chrome never appears in the at-rest captures because there is
  no pointer.
- **Playground.** The sample and layers scenes get a drag session: the layers scene reuses its
  existing contract document port/history (a click still brings the object to the front, P4-06),
  and the sample board — loaded as packed rectangles — projects the same objects onto its already
  assigned engine slots (`loadRectangleDragSession`), so its pixels, document load count and
  reference images are unchanged while a drag commits one contract move operation. `?input=demo`
  (`?scene=layers&input=demo`) adds one editable field and one scrollable area inside `block-0001`'s
  body to demonstrate the suppression policy; the chrome exists only in that mode. The titles gallery
  is presentation-only and keeps its hover/select path through the same layer. The page exposes
  `window.__engineInput` (phase, cursor, hover, token values, whether a drag session exists) and
  `window.__engineDrag.last()` (the last committed operation/inverse types) for evidence.
- **Tests and evidence.** `test/input.test.mjs` drives the state machine directly: the 3.9/4.1 px
  threshold, click-writes-nothing, the grip policy per kind, field/scroll suppression, cursor
  mapping, header-hover state, right-button and multi-touch rejection, pointer capture, pan/zoom
  view-only, one operation per drag through the real seam with the inverse restoring a byte-identical
  working copy, and cancel reverting without a write. `apps/engine-playground/tools/input-check.mjs`
  repeats the engine-owned cases in a real browser with trusted pointer/wheel events
  (`reviews/evidence/<task>-input-<timestamp>.json`). The native suites are unchanged (`cpp-unit`).

## Snapping and guide chrome (L07, P4-15)

L07 ("everything stands neatly aligned to its neighbours automatically") is a pure native core plus a
presentation pass: the core decides one snapped world position and up to three world guide lines per
drag frame; the chrome pass draws the guides as 1 px `tokens::accent` quads. Nothing enters the
document, an operation payload or the command-buffer instance counts, and nothing runs during a pan,
a zoom or an idle frame.

- **Candidates.** From the dragged rectangle's live document slot the core queries the spatial index
  with the camera's visible world bounds and visits the candidates in document slot order. Candidates
  are the left/centre/right and top/middle/bottom lines of every live, visible neighbour and zone;
  the dragged object's own slot is skipped, so a drag can never stick to itself. The tolerance is the
  token `snap_tolerance` (6 px) in **screen** px, converted to world px by dividing by the camera zoom
  (`world = 6 / zoom`), so the tolerance is the same on screen at 50 %, 100 % and 200 %. The same
  conversion keeps a world-px guide span stable while zooming.
- **One decision per axis.** For each axis the nearest candidate line pair within tolerance wins (a
  line match); on an equal distance the first visited pair wins, which keeps the result deterministic.
  A line match beats `Camera::snapToGrid`; only when no line is in tolerance does the 16 px grid apply
  (`tokens::canvas_grid`). `Shift` (`free`) bypasses both: the pointer position is returned unchanged
  and no guide is produced. The two axes are decided independently, so a drag can snap to an x line
  and fall back to the grid on y.
- **Guides.** The matched line is the first guide; the core then adds the other lines of the same
  neighbour that coincide with a dragged line after the snap (a same-width neighbour aligns left,
  centre and right at once). Vertical guides come before horizontal ones, line kinds in their fixed
  order, and the total is capped at `kMaxSnapGuides = 3` (L07 "no lines beyond 3"). A guide's span is
  the union of the dragged and the matched element on the perpendicular axis plus the token 16 px
  (`tokens::space_16`) on both ends, continuous across both elements.
- **No hot-path allocation.** The renderer owns one `SnapScratch` (a slot vector reserved once) and
  one `SnapResult`; a drag frame reuses them. The C ABI is `engine_snap_position(index, x, y, free,
  out_xy)` (returns the guide count, `-1` on failure), `engine_snap_guide(i, out_guide)` (orientation,
  position, start, end) and `engine_snap_clear()`. The bridge wraps them as
  `snapDrag(index, position, free) → { position, guides }` and `clearSnapGuides()`.
- **Guide chrome.** `text_gl.cpp` reads the world guides from the renderer's frame view and draws
  each as one screen-space quad of `tokens::border_width` (1 px) in `tokens::accent`, mapping position
  and span through the camera. The guides use the same instanced chrome program as the P4-10 header
  band (a per-instance tint), never the object command buffer; a frame without guides touches no
  extra GL state. The 1 px line is centred on the guide coordinate and an empty span draws nothing.
- **Input and playground.** The P4-14 input layer asks for a snap on every drag move (and at the drag
  start) with the event's `shiftKey`, previews the returned position and, on release, commits exactly
  that snapped position through the P4-05 seam as one `drag-single` operation with its inverse. A
  `Shift` move returns the free pointer position and clears the guides; the layer clears the guides on
  commit, cancel and pointer loss. The playground exposes `window.__engineSnap.last()` (position,
  guides, free) for evidence and shows the guides natively; the cursor and header hover band keep
  their P4-14 behaviour.
- **Tests and evidence.** `engine_snap_tests` (fifth CTest suite) covers edge and centre matches, the
  tolerance just below/at/above 6 px at zooms 0.5, 1 and 2, line-over-grid precedence, grid fallback,
  Shift free, at most three guides with deterministic order, dragged-object exclusion,
  invisible-candidate filtering, guide spans (+16 px), byte-identical repeatability and the
  invalid-input paths. `test/input.test.mjs` adds the snap integration: the previewed and released
  position is the snapped one, Shift travels to the host, and panning/zooming never request a snap.
  `apps/engine-playground/tools/capture-snap.mjs` drives a real drag on the layers scene at 1440×900
  and 390×844, writes the screenshots and a record with the live snapped position/guides and the
  committed operation (`reviews/evidence/P4-15-snap-*.json`). The guide chrome is drag-only, so the
  committed reference images stay 0-diff and the `perf` scene never runs the snapping core.

## Selection and the rubber band (L10, P4-16)

L10 ("several objects can be selected, moved and deleted together as one action") is presentation
state in the P4-14 input layer plus chrome drawn by the existing pass: the document, the operation
payload and the command-buffer instance counts never contain the selection, the band or the frames.

- **Selection set.** `PointerInput` keeps a selection of `InputTarget`s outside the document (ids,
  slots and current world geometry). A press/release below the 4 px threshold is a click: a plain
  click replaces the selection with the clicked object (dragging an *unselected* object does the same
  before the drag starts), `Shift`-click toggles one object in or out, a plain empty click clears the
  set, and `keyDown("Escape")` (forwarded from the page's `keydown`) clears it too. The set is
  presentation state: it is never persisted, never serialised into an operation, and the core clears
  its chrome on every `engine_load_rectangles`. Every change is reported through
  `onSelectionChange(targets)`, so the playground can apply the native chrome and the count bar.
- **Rubber band.** A `Shift`-drag on the empty canvas enters the band phase: the layer converts the
  press and current points to world space, reports the normalised world rectangle through
  `onBandChange` and draws no selection until release. On release `targetsInRect(rect)` returns every
  live object whose bounds intersect the rectangle and the set replaces the selection. The rule is
  the exported `worldRectsIntersect` (bounds intersection, touching edges included, not
  containment), shared by the playground and the unit suite. Without `Shift` the drag pans exactly as
  in P4-14; a band never pans, and a second pointer ends the band into the pinch.
- **Selection chrome.** The renderer stores the selected document slots and the live band world
  rectangle in presentation state. The P4-10/P4-15 chrome pass draws one 1 px `tokens::accent` frame
  per *visible* selected object and the live band as a `tokens::accent_soft` fill with a 1 px
  `tokens::accent` border; both use the existing instanced chrome program and a reusable 512-quad
  batch, so a large selection neither allocates per frame nor enters the object command buffer. The
  band is cleared on release/cancel and the frames on selection clear; nothing draws at rest, so the
  reference images stay 0-diff. C ABI: `engine_set_selection(indices, count)` and
  `engine_set_band(x, y, width, height, visible)`; the bridge wraps them as `setSelection(indices)` and
  `setBand(bounds | null)`.
- **Joint drag.** When the drag starts on a selected object and the selection holds several objects,
  the layer records the members' current geometry and, on every move, applies the same world delta
  (the snapped delta of the grabbed object) to all of them through `previewGroupDrag` — no document
  write. On release it calls `commitGroupDrag` once: the playground builds one `drag-group` gesture
  through the P4-05 seam, which becomes exactly one `group` operation of `moveCard`/`moveBlock`/
  `moveZone` children with the reversed child inverses as its inverse. A cancelled joint drag calls
  `revertGroupDrag` (the port still holds the original geometry) and writes nothing; the selection
  always survives the release, the cancel and the drag itself.
- **Count bar and delete.** The playground keeps one DOM count bar (ADR-0009) above the selection
  bounding box: "n selected" in the playground's demo-text convention plus a delete button with the
  inline stroke SVG (no character or "×", `aria-label` "Delete selection"). The bar follows the
  camera transform, flips inside the box when it would leave the canvas, and is clamped to the
  visible canvas so the delete control is always clickable. Delete builds one `delete-selection`
  gesture → one `group` operation whose children are the single `deleteCard`/`deleteBlock` operations
  and whose inverse is the reversed `createCard`/`createBlock` group (zones are skipped; zone
  deletion is L08/P4-27). The delete button stops pointer propagation, so the input layer never starts
  a gesture from it.
- **Playground and evidence.** The sample and `?scene=layers` boards consume the layer; the page
  exposes `window.__engineSelection` (size, ids, bounds, bar visible, live band, last committed
  operation types) for evidence. `apps/engine-playground/tools/capture-selection.mjs` drives
  Shift-clicks, a joint drag, the bar delete, a Shift band and a plain pan at 1440×900 and 390×844,
  writes the frames/band screenshots and a record with the selection, band, bar and operation children
  (`reviews/evidence/P4-16-selection-*.json`).
- **Tests.** `test/multi-selection.test.mjs` covers add/remove/replace via Shift-click and plain
  click, empty-click and Esc clearing, the world-space band intersection rule, plain-drag panning, one
  `drag-group` operation per joint drag (with the shared delta and snapping), the selection surviving
  the drag and the cancel, the unselected-drag selection replacement, one `delete-selection` group
  operation with its inverse (round trip on the in-memory port) and duplicate/empty rejection. The
  native suites are unchanged (`cpp-unit`); the selection chrome is selection/drag-only, so the
  committed reference images and the perf scene stay untouched.

## Field overlay and inline comfort (L18, P4-23)

The canvas draws the board; every field people type into is a plain DOM element in a transparent
layer above it. The overlay is presentation and input only (ADR-0009): it owns no board state, is not
a save path and never writes the document — L05's single autosave stays out of scope.

- **Anchoring.** `OverlayHost.register({id, world, element})` puts one field element into the layer;
  `update(camera, viewport, devicePixelRatio)` positions it in CSS px with
  `anchorToScreen` — `x = (world.x - panX) * zoom`, the same transform as the object pass — and sets
  `hidden` while `rectIntersectsViewport` is false (the field's object left the viewport). The update
  only changes styles and visibility, never the nodes, so focus survives every camera change. The
  device pixel ratio does not change the anchor (the DOM is CSS px; only the canvas backing store is
  scaled). A stale/non-finite camera or a disposed engine hides the fields (`anchorToScreen` returns
  a hidden zero rectangle; `OverlayHost.dispose()` removes them). `setWorld` re-anchors a field after
  an inline insert/remove.
- **Focus and routing.** `OverlayHost.open(id)` remembers the previously focused element and focuses
  the field; `close()` restores that focus; `onFocusChange` reports the active field for a HUD or the
  demo. `bindFieldPointerRouting(element)` stops pointer/mouse/click/wheel events at the field, so the
  P4-14 input layer on the canvas wrapper never sees them and can never start a drag, a selection or a
  canvas zoom from a field — while never calling `preventDefault`, so a scrollable field keeps its
  native wheel scrolling.
- **Inline keyboard policy.** `applyInlineKey(fields, focusedIndex, {key, shiftKey})` is a pure
  function over the focus-ordered field list: `Enter` inserts a new entry directly below the focused
  one and focuses it (`insert`), `Tab`/`Shift+Tab` move focus to the next/previous field with the
  documented wrap rule (`nextFocusIndex`: past the last wraps to the first, before the first wraps to
  the last), `Backspace` in an empty entry removes it and focuses the previous field (`remove`; the
  first entry focuses the new first, the last remaining field leaves focus empty), and every other
  key — including `Backspace` in a non-empty entry — stays with the field (`none`). The policy returns
  intents only: it never mutates the field list, carries no content and never persists anything. The
  demo applies the intents to its own DOM, which is the seam `packages/editor` will consume.
- **Colour field.** The colour control is a 24 px field (`COLOUR_FIELD_PX`, the `space-24` token
  value; the playground CSS sizes `.inline-colour` with `var(--space-24)`), keyboard-reachable, not an
  oversized native colour button.
- **Playground demo.** `apps/engine-playground/?edit=inline` forces the layers scene and overlays a
  checklist (three entries over block-0001), a column (two entries over block-0002), a table (two
  entries over zone-0002), a scrollable note and the colour field; `Esc` closes the editing field. The
  page exposes `window.__inlineDemo` (fields with world/screen anchors, focus, last intent, colour
  size, counts, board writes) for evidence, and the caption states that nothing writes board content.
  `tools/capture-inline.mjs` drives click/Enter/Tab/Shift+Tab/Backspace/Escape, the wheel and a camera
  pan at 1440×900 and 390×844 and writes the screenshots plus a record with the anchors, focus order,
  intents and the zero board writes (`reviews/evidence/P4-23-inline-*.json`).
- **Tests.** `test/inline-overlay.test.mjs` covers the anchor math at pan/zoom (and the DPR
  independence), the viewport hide rule, the stale-camera result, the focus wrap at both ends, the
  `Enter`/`Tab`/`Shift+Tab`/`Backspace` intents (empty vs non-empty, first/last/single entry), the
  policy writing nothing, the 24 px token colour field and the field pointer routing (stop at the
  field, wheel default allowed). The overlay adds no C++ and no visual baseline.

## Zone membership and zone move (L08, P4-27)

Zones are containers (ADR-0010, contract 0.2.0). Membership is working-copy state on cards and blocks
(`zoneId`), written only through the existing `moveCard`/`moveBlock` payloads — never a separate write
or per-frame state — and the pure helpers live in `src/logic/zones.ts`.

- **Drop policy.** On release the dragged object's world centre (`rectCentre`) is tested against the
  live zones in draw order (`zoneAtPoint`, edges inside, topmost wins); `dropZoneId` returns the zone
  id or `null`. The move operation carries exactly that membership (`payload.zoneId`), so dropping in
  and dragging out are one operation with one inverse; a zone is never given a parent
  (`buildMoveOperation` rejects it), and the playground only commits on release.
- **Zone move.** Dragging a zone commits exactly one `drag-group` gesture; the group operation moves
  `moveZone` plus one `moveCard`/`moveBlock` per member by the same delta, and its one inverse restores
  every position (no per-member operation).
- **Highlight.** A successful drop calls `engine_set_zone_highlight(slot)`; the chrome pass outlines
  the zone for one second in `tokens::accent_line` (`ZoneHighlightState`, one chrome quad per edge,
  never a command-buffer instance or document state). The state expires on a steady clock and clears
  on a document load.
- **Delete policy.** `delete-zone` / a selection delete containing a zone builds one `deleteZone`
  operation with the contract's content policy: `keep` returns the members to the board
  (`zoneId: null`) in the same operation, `delete` removes them with the zone; the inverse is one
  `group` that recreates the zone and reparents (`moveCard`/`moveBlock`) or recreates (`createCard`/
  `createBlock`) every member. The confirmation dialog belongs to the web app.
- **Geometry guard.** `minimumZoneSize(members)` = member extent + `tokens::space_16` (16 px), applied
  by the seam in `resizeZone` (design minimum 256×192 still applies); the resize gesture itself is
  P4-17.
- **Playground and tests.** On the sample and layers scenes a drop shows the accent-line highlight for
  1 s, a member dragged out returns to the board, a zone drag moves its content, and `Delete` /
  `Shift+Delete` delete the selected zone with keep/delete content in memory. `window.__engineZones`
  exposes membership, last drop/delete and the highlight for the deterministic capture
  (`tools/capture-zones.mjs`, records under `reviews/evidence/P4-27-zones-*`); the native
  `engine_zone_tests` covers the one-second highlight state and `test/zone-membership.test.mjs` covers
  drop/out/reject, one group move with inverse, both delete policies and the minimum size.

## Zone parity: arrangement and release preview (L08, P4-29)

The engine now behaves like the read-only live demo (`apps/web/preview`, never imported). The pure
rules live in `src/bridge/zone-parity.ts` and are mirrored in `include/engine/zone_layout.h` for the
native suite.

- **Arrangement.** Members are laid out from their sizes with `tokens::space_16` padding,
  `tokens::space_12` gap and the `tokens::header_height` (40 px) band. The orientation comes from the
  size-normalised centre spread with 1.25 dominance and a half-item hold; the order comes from the
  centre with a 12 px band. An arrangement that does not fit the visible surface falls back to the
  other orientation without changing the stored request. The release writes the arranged positions
  and the frame size as exactly one `group` operation (`zone-arrange`: `resizeZone` when the frame
  changed plus one move per member) with one inverse.
- **Release preview.** `previewZoneRelease` computes the presentation state from drag-start
  positions: entering needs the pointer over the frame or 25 % coverage; staying keeps a 24 px catch
  margin (screen px converted by the zoom); leaving previews a detach and shrinks the frame around the
  member that stays; a dock that implies the other orientation previews that orientation; the
  landing slot and the make-room hop are presentation only. Nothing commits before the release;
  `Escape`, `pointercancel` and a lost capture cancel with no operation and leave a byte-identical
  working copy.
- **Motion.** A release settles over 300 ms `cubic-bezier(0.2, 0, 0, 1)` with no overshoot and the
  drag keeps the 1.02 lift; reduced motion applies the end states instantly (`zoneSettlePolicy`).
  Frame changes use a FLIP-style resize so the header never stretches.
- **Playground and evidence.** `?scene=layers&zoneParity=1` shows the deterministic arrangement, the
  dashed landing slot and the frame outline in the DOM overlay (ADR-0009); `window.__zoneParity`
  exposes the preview, the last release and a canonical working-copy snapshot for the capture
  (`tools/capture-zone-parity.mjs`, side-by-side screenshots against the live demo at 1440×900 and
  390×844). The new reviewed baseline is `zone-parity-at-rest` (2 images; all older images 0-diff).
- **Tests.** `test/zone-parity.test.mjs` covers dominance/hold, order band, fit fallback, enter/stay
  hysteresis, shrink-on-out, one operation per release with exact inverse, cancel and reduced motion;
  the native `engine_zone_layout_tests` pins orientation, order, fit, enter/stay and shrink.

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

- **Native build + tests:** `cmake -S packages/engine -B packages/engine/build -DCMAKE_BUILD_TYPE=Debug && cmake --build packages/engine/build --parallel && ctest --test-dir packages/engine/build --output-on-failure` (suites `engine_unit_tests`, `engine_core_tests`, `engine_text_tests`, `engine_binding_tests`).
- **WASM:** `bash packages/engine/tools/build-wasm.sh` then `node packages/engine/tools/wasm-smoke.mjs`; size: `node packages/engine/tools/wasm-size.mjs` (budget 307,200 B gzip). The wrapper keeps the Emscripten cache under `build-wasm/.emscripten-cache` unless `EM_CACHE` is set, so a read-only package cache (sandboxed agents) or a shared user cache cannot break the build.
- **Performance:** `node packages/engine/test/perf/run-perf.mjs` (exclusive `perf-baseline`, 50,000 rectangles, p95 ≤ 16.7 ms) and `node packages/engine/test/perf/run-perf.mjs --scenario engine-core` (the `perf` stage gate: 10,000-object interactive run plus the L01 basis/final proof; report [docs/engine/perf-baseline.md](engine/perf-baseline.md), gate catalogue [docs/gates/perf.md](gates/perf.md)).
- **Visual:** `node packages/engine/test/visual/run-visual.mjs` (the `visual` stage gate: ten
  deterministic scenes at 1440×900 and 390×844 against the committed reference images under
  `reviews/evidence/visual-baselines/`; the L19 `one-card-fit` scene runs the fit action and shows the
  dot grid at 100 %; since P4-10 the `text-titles` and `text-titles-zoom-200` scenes capture the
  titles gallery at 100 % and 200 %; `--update` writes baselines as a reviewed update, never a gate
  pass; catalogue `docs/gates/visual-diff.md`).
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
| titles (L02, P4-10) | `?text=titles[&view=<x>,<y>,<zoom>]` | the playground's own deterministic titles gallery, 2 zones, 2 blocks, 4 cards, world 1024×576 px: zone names, ellipsis card titles, wrapped/clipped previews, 40 px headers with the band chrome, the grown block and the quiet DOM delete affordance. The gallery is page-owned (no test-kit scene and no board state); `?scene=` is ignored in this mode. The `text-titles` and `text-titles-zoom-200` visual scenes use it at 100 % and 200 % |
| benchmark | `?bench=50000&samples=600&warmup=120` | unchanged 50,000-rectangle perf document for `packages/engine/test/perf/run-perf.mjs` |

- **Scene builders:** `packages/test-kit` (`@project-air/test-kit`) builds all scenes with a seeded
  PRNG and no ambient randomness or clock: ids `card-0001`/`zone-0001`/`block-0001` (stress:
  `stress-00001`), geometry on the 16 px canvas grid, the engine's tone and layer names, and
  metadata (world, bounds, counts, seed, fit at 1440×900 and 390×844). Scenes are pure functions of
  their arguments, so every machine gets identical objects and bounds;
  `pnpm --filter @project-air/test-kit test` proves determinism, the 500/50 counts, the engine-core
  10,000-object mix and the 10,000/0/50,000 stress sizes. The `?text=titles` gallery is built by the
  playground itself (a pure array in `main.js`), so it needs no test-kit bundle and carries its own
  expected counts; the visual harness declares those counts explicitly for the page-owned scene.
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
  counter and `getState()` reports scene, counts, visible instances, rendered frames, backend, camera
  and (in the titles scene) the atlas. `?text=titles` also exposes `window.__engineTitles.summary()`
  with the bound title/preview count, the grown-block count, the atlas, the hovered/selected object
  and the affordance count for the evidence tool.
- **Titles scene chrome (P4-10).** `?text=titles` binds the gallery text through
  `bindObjectText`, grows the blocks with `requiredTextHeight` and puts one DOM delete affordance per
  object in the overlay `#overlay` above the canvas: a 28 px button (`--button-card`) with a 16 px
  inline-SVG icon (`--icon-card`, 24 grid, stroke 1.6, `currentColor`), `opacity: 0` and
  `pointer-events: none` at rest — an invisible control is never a click target — and visible with
  pointer events enabled on object hover, keyboard focus and selection; `Tab` reaches every button
  and the focus outline is never removed. The capture record proves the rule with
  `invisibleHitTests: 0`: `elementFromPoint` at the corner of every invisible button hits the
  canvas, not the button. The icon is an inline SVG in the overlay because
  `packages/ui-kit/icons/` has no delete entry and adding one would change
  `packages/ui-kit/tests/icons.test.mjs`, which is outside this task's write scope; it is still a
  stroke icon and never a character, emoji or native tooltip.
  The canvas owns the object geometry and the bound text; the overlay owns only the affordance —
  it holds no board state (ADR-0009). In the other modes the overlay stays empty, so the reference
  images and the perf documents are unchanged.
- **Evidence capture:** `node apps/engine-playground/tools/capture-titles.mjs --mode before|after|all`
  starts its own server and browser on the slot port, waits for the ready hook and writes the
  before/after PNGs plus `reviews/evidence/P4-10-capture-<mode>-<timestamp>.json` with the camera,
  atlas raster scale, binding and affordance state (including the pointer-events/hit-test check)
  of every shot.
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
`P4-07-idle-*` browser record (re-run for P4-10 as `P4-10-idle-*`). **L03 — Dragging vs editing** is
delivered for the engine-owned part by P4-14: the 4 px click/drag threshold, the card/header grip
policy, field/scroll suppression, the header hover band, cursors and one move operation per drag,
documented in the pointer-input section above. **L07 — Snapping** is delivered for the
engine-owned part by P4-15: the 6 px screen tolerance, edge/centre line matching with grid fallback,
Shift free, the three-guide accent chrome and the snapped release as one operation, documented in the
snapping section above. **L10 — Multi-select** is delivered for the engine-owned part by P4-16:
Shift-click toggling, the plain-click replace, the Shift rubber band with the world-intersection
rule, the 1 px accent frames and accent-soft band in the chrome pass, the count bar with its
single-operation delete and the one-group joint drag, documented in the selection section above.
**L08 — Zones as containers** is delivered for the engine-owned part by P4-27: contract-0.2.0
membership on cards and blocks written by the move operations, the world-centre drop policy with no
nested zones, the one-second accent-line highlight, the one-group zone drag and both `deleteZone`
content policies with inverses, documented in the zone section above. **L18 — Inline comfort** is
delivered for the engine-owned part by P4-23: the DOM field overlay
anchored through the camera, focus open/close/restore, the Enter/Tab/Shift+Tab/Backspace policy over
the field list, the 24 px token colour field and the playground `?edit=inline` demo with a
deterministic capture, documented in the field-overlay section above. **L02 — Visible quality** is
delivered by P4-08, P4-09 and P4-10 for
the engine-owned part: the runtime atlas, the layout flows and, since P4-10, the title/preview
binding, the 40 px header geometry with the zone content inset, the grown block, the quiet delete
affordance in the DOM overlay and the sharp zoom buckets, with native binding tests, the
`text-titles` reference images and the `P4-10` capture records. The remaining engine-owned entries —
L08, L11–L18, L20 — belong to those stages; their interaction behaviours are not
implemented.

## What the spike does not prove yet

- **Reference hardware:** the MacBook Air M1, 8 GB target is not measured; the M2 numbers are a proxy
  and must be re-measured on the M1 before that hardware's stage exit.
- **Measurement shape:** frame production (unlocked display, no per-frame GPU sync/fence), not GPU
  completion, long tasks while panning/zooming, or the L01 final proof (500 cards + 50 zones, no long
  task > 50 ms).
- **Canvas behaviours:** the playground has demo-level pan/zoom over a fixed scene plus the L19 fit
  action and dot grid; the L03 click/drag/edit separation with its pan/zoom (P4-14), the L07
  snapping (P4-15) and the L10 multi-selection, rubber band, joint drag and selection delete (P4-16)
  are implemented above, while document editing/persistence, zone membership, the undo UI, keyboard
  input beyond the inline field comfort rules, title editing (L09 owns it), images, edges and the
  accessibility mirror are not. The input layer is
  DOM-driven: a real e2e for fields inside a block arrives with the editor overlay (P4-23). Text is presentation input: titles and previews are bound to visible
  objects by the caller (P4-10), but the engine document still stores no note content, and a
  title/preview that overlaps a higher-layer object is not clipped per pixel (the titles scene and
  its reference images place the gallery without overlap). The gesture-to-operation seam and the
  undo history core exist behind the TypeScript logic layer (P4-05) and a completed drag now reaches
  them through the input layer; selection state and overlays are not wired yet.
  The initial and restored viewport (L17/P4-22) still uses the pre-L19 plain fit; only the fit action
  uses the padded 100 % fit.
- **Contracts of the mutation API:** the `ObjectId` stays inside the C++ core for now; the C ABI
  addresses live objects by their document slot index, and the bridge owns the contract-UUID mapping
  that a later task may expose.
- **WebGPU:** no backend; only the command-buffer seam is ready.
- **Lifecycle:** one engine per WASM module; `dispose()` detaches the handle only (no
  `engine_destroy`/teardown yet).
