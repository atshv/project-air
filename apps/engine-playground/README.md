# apps/engine-playground

Engine demo without backend.

- **Kind:** `app`
- **Created in stage:** `engine-spike`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Commands

Static page, no build step; it imports the compiled bridge, the compiled test-kit scenes and the
Emscripten module through an import map.

1. `pnpm install --frozen-lockfile` (workspace root)
2. `pnpm --filter @project-air/engine run build` (bridge and logic layer to `packages/engine/dist/`)
3. `pnpm --filter @project-air/test-kit run build` (scenes to `packages/test-kit/dist/`)
4. `bash packages/engine/tools/build-wasm.sh` (module to `packages/engine/build-wasm/`)
5. Serve the repository root on the slot's playground port, for example
   `python3 -m http.server 4160 --bind 127.0.0.1` from the repository root (port from
   `.polier-slot`; never hard-code it in the page), then open
   `http://127.0.0.1:4160/apps/engine-playground/?scene=sample`.
6. Evidence capture (headless Chrome for Testing, WebGL via SwiftShader):
   `node apps/engine-playground/tools/capture.mjs reviews/evidence/P4-02-desktop.png reviews/evidence/P4-02-mobile.png`
   — the helper reads the playground port from `.polier-slot`, emulates 1440×900 and 390×844, waits
   for `window.__enginePlayground.ready`, pauses the loop and prints layout, HUD and state it
   captured. `CHROME_PATH` overrides the browser, `PLAYGROUND_URL` the page URL.
7. L02 before/after evidence (P4-10): `node apps/engine-playground/tools/capture-titles.mjs --mode before|after|all`
   starts its own server and browser on the slot port and writes the before/after PNGs plus a JSON
   record with the camera, atlas raster scale, binding and affordance state per shot.
8. L03 pointer evidence (P4-14): `node apps/engine-playground/tools/input-check.mjs --task P4-14`
   starts its own server and browser and drives trusted pointer/wheel events: a card/block-header
   drag commits exactly one move operation, a block body, a field and a scroll area start no drag,
   empty-canvas drags pan the view only, the header hover band appears and the titles hover still
   works. It writes `reviews/evidence/<task>-input-<timestamp>.json`.
9. L07 snapping evidence (P4-15): `node apps/engine-playground/tools/capture-snap.mjs --task P4-15`
   drags one card into a neighbour's snap tolerance on the layers scene at 1440×900 and 390×844,
   screenshots the live guides (`P4-15-snap-<viewport>.png`), the Shift-free state
   (`P4-15-snap-shift-<viewport>.png`) and writes a record with the snapped position, guides, camera,
   tokens and the committed move operation (`reviews/evidence/<task>-snap-<timestamp>.json`).

### Scenes

- `?scene=sample` (default) — the deterministic sample board from `packages/test-kit`: 500 note
  cards and 50 zones with contained blocks.
- `?scene=stress` — the stress scene, 10,000 objects by default; `&count=N` sets any count from 0
  to 50,000.
- `?scene=engine-core` — the engine-core perf board from `packages/test-kit`: 10,000 mixed board
  objects (9,200 cards, 200 zones with three blocks each).
- `?scene=layers` — the L13 layers scene (P4-06): 2 zones, 2 blocks and 4 cards whose stored keys
  contradict the layers. It is loaded as contract objects through the engine's document port (the
  logic build `packages/engine/dist/logic/`, produced by step 2); a click (under 4 px of movement)
  brings the object to the front of its layer with exactly one `reorder` operation through the
  gesture seam, the keys persist in `localStorage` so a reload keeps the order, `&front=<scene id>`
  applies one front gesture at start and `&store=off` ignores the storage (the visual gate uses it).
- `?text=layout` — the P4-09 text layout demo (use with `?scene=stress&count=0&view=272,112,1`): a
  title that fits, a title cut with an ellipsis, a zone-name box and a wrapped preview clipped to
  three lines, laid out inside the engine; the `text-layout` visual scene.
- `?scene=layers&input=demo` — the L03 pointer demo (P4-14): the layers board plus one editable
  field and one scrollable area inside `block-0001`'s body. A press in the field or the scroll area
  never starts a drag (the scroll area keeps its own wheel), while the card bodies and the 40 px
  block/zone headers still drag; the caption explains it. The demo chrome exists only in this query
  mode, so no reference image or baseline changes.
- `?text=titles` — the P4-10 L02 titles gallery: the page-owned deterministic demo board (2 zones,
  2 blocks, 4 cards, world 1024×576) with a zone name, a cut zone name, ellipsis card titles,
  wrapped/clipped block previews, the 40 px header band with its rule, a block grown to its preview
  height and one quiet DOM delete affordance per object (28 px hit, 16 px icon, invisible at rest,
  visible on object hover, keyboard focus — `Tab` — and selection; no character icon). The gallery
  is presentation only: the engine document stores no text and the page needs no test-kit bundle.
  Use `?view=<worldX>,<worldY>,<zoom>` for a deterministic camera; zoom buckets 25/50/100/200/400 %
  re-rasterise the atlas so text stays sharp when zooming in. The `text-titles` and
  `text-titles-zoom-200` visual scenes use it at 100 % and 200 %.
- Snapping (P4-15, L07): dragging an object snaps it live to the left/centre/right and
  top/middle/bottom lines of visible neighbours and zones within the token 6 px screen tolerance; a
  line match beats the 16 px grid, and the chrome pass draws up to three 1 px `--accent` guides
  continuous across both elements plus 16 px. `Shift` frees the position (no line, no grid, no
  guide), and the released position is committed as one move operation. Nothing runs during pan or
  zoom.
- Pointer input (P4-14, L03) goes through one layer (`@project-air/engine/input.js`): a press that
  moves less than the 4 px `drag-threshold` is a click and writes nothing; a note card drags on its
  whole body, a block or zone only on its 40 px header band (a body press moves nothing); an empty
  canvas drag pans and a wheel or two-pointer pinch zooms around the pointer — pan/zoom stay
  view-only `setCamera` calls. On the sample and layers scenes a completed drag commits exactly one
  `drag-single` operation with its inverse through the P4-05 seam; the block/zone header shows the
  `--faint` hover band (120 ms) and the cursor is `grab` on a grip, `grabbing` while dragging,
  `text` over editable chrome and `default` elsewhere. `f` runs the L19 fit action ("show all": at
  most 100 %, L02 top padding, dot grid at and above zoom 0.5). The scene never changes. The HUD
  shows objects, visible instances, the rendered-frame counter and the backend.

### On-demand rendering (L19)

Outside the benchmark and perf modes the page renders only on change: a camera (pan, zoom or fit),
document or resize change requests exactly one frame, and while idle no animation frame is scheduled,
so an idle canvas produces no frames. The benchmark and perf modes below keep their continuous loops.
`window.__enginePlayground.frameCount()` and `getState().framesRendered` expose the rendered-frame
counter, `fit()` runs the fit action and `pause()` stops the scheduler for a capture.
`node packages/engine/test/idle/run-idle.mjs` measures this in a real browser and writes
`reviews/evidence/P4-07-idle-<timestamp>.json` (one idle second → zero frames; a fit, a resize and the
benchmark loop still render).

### Benchmark mode

`?bench=<rectangles>&samples=<n>&warmup=<n>` (for example
`?bench=50000&samples=600&warmup=120`) runs the deterministic benchmark scene with the display loop
replaced by a benchmark loop: it discards `warmup` frames, collects `samples` rAF frame intervals,
exposes `window.__engineBenchmark` (`status`, `count`, `warmup`, `samples`, `frameTimesMs`,
`renderer`, `canvas`) and logs one `PERF_RESULT` JSON line when done. The
`packages/engine/test/perf/run-perf.mjs` harness drives this mode; its `--display-locked` flag runs
the same page with the normal 60 Hz display clock as a control observation (no vsync-unlock flags).

### Engine-core measurement mode

`?perf=engine-core&scene=<engine-core|sample>&warmup=<n>&samples=<n>[&verifyCulling=1]` replaces the
demo loop with the deterministic measurement used by the `perf` gate: one `setCamera` per frame along
one zoom cycle plus one pan sweep, frame intervals collected after the warm-up, and (with
`verifyCulling`) the engine's command-buffer instance count compared with the visible set computed
from the scene geometry. The page exposes `window.__enginePerf` with the scene counts, warm-up and
sample counts, frame intervals, sampled cameras (culling checkpoints), document loads and the
culling result. `packages/engine/test/perf/run-perf.mjs --scenario engine-core` drives it.

The page must be served over HTTP: WASM does not load from `file://`. The import map maps the package
names `@project-air/engine` and `@project-air/test-kit` to the compiled artefacts; the test-kit
import is dynamic so benchmark mode also works in the perf harness copy that only carries engine
artefacts. Those deep paths are a spike detail of this bundle-less page, consumers use the package
entries from the manifests.
