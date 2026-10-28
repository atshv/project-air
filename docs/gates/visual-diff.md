# Gate Catalogue: Visual diff

> Project visual gates. The canvas is verified against committed reference images in a real browser
> on a real GPU. The values in this catalogue are authoritative; the harness mirrors them as
> constants (viewport set, scene list, camera states, tolerance, backend), so a change must update
> both in the same task.

| Gate | Command | Expected |
| --- | --- | --- |
| `visual` | `node packages/engine/test/visual/run-visual.mjs` | exit 0, every committed WebGL2 reference image within tolerance at 1440x900 and 390x844; capture record and diff PNGs under `reviews/evidence/` (exclusive) |
| `visual-update` | `node packages/engine/test/visual/run-visual.mjs --update` | baselines written; an explicit review action, never a gate pass |

## Constants mirrored by the harness

`packages/engine/test/visual/run-visual.mjs` mirrors the values below as constants; a change touches
the harness and this catalogue in the same task.

| Constant | Value |
| --- | --- |
| Viewports | `desktop` 1440x900 and `mobile` 390x844, device pixel ratio 1 |
| Viewport emulation | DevTools protocol `Emulation.setDeviceMetricsOverride`; the decoded screenshot size and `window.innerWidth/innerHeight` are asserted against the viewport, never trusted |
| Scenes | `sample-at-rest`, `sample-zoom-in`, `sample-zoom-out`, `engine-core-at-rest`, `one-card-fit`, `layers-at-rest`, `layers-front`, `text-layout`, `text-titles`, `text-titles-zoom-200` |
| `sample` document | `buildSampleScene()` from `packages/test-kit`: 500 cards, 50 zones, 144 blocks = 694 objects, world 9600x5408 px |
| `engine-core` document | `buildEngineCoreScene()` from `packages/test-kit`: 9,200 cards, 200 zones, 600 blocks = 10,000 objects, world 19,200x10,816 px |
| `one-card-fit` document | `buildStressScene(1)` from `packages/test-kit`: one card, world 64x22 px; the scene runs the L19 fit action before the capture (P4-07) |
| `layers` document | `buildLayersScene()` from `packages/test-kit`: 2 zones, 2 blocks, 4 cards, world 1024x576 px, loaded as contract objects with `?store=off`; `layers-front` adds `&front=card-0001` (one `reorder` through the seam, P4-06) |
| `text-layout` document | `buildStressScene(0)` (empty world) plus the playground's `?text=layout` runs (P4-09): world (272, 112) at zoom 1 — the atlas raster scale; the P4-10 zoom buckets keep this reference byte-identical at 100 % |
| `text-titles` document | the playground's page-owned titles gallery (`?text=titles`, P4-10): 2 zones, 2 blocks, 4 cards, world 1024x576 px, no test-kit scene; world (512, 288) at zoom 1 — the 100 % atlas raster scale and the committed text reference |
| `text-titles-zoom-200` document | the same gallery at world (512, 240) at zoom 2: the zoom bucket re-rasterises the atlas at raster scale 2 for the 200 % capture (the pixel-crispness proof) |
| Camera anchor | the centre of the sample board's `zone-0001`, world (648, 664) |
| `sample-zoom-in` camera | anchor at zoom 0.5, the L19 dot-grid boundary (grid visible at and above 0.5) |
| `sample-zoom-out` camera | anchor at the engine camera minimum zoom 0.1 |
| `*-at-rest` camera | the playground initial camera: plain world-centred fit, clamped to 0.1 … 8 |
| `one-card-fit` camera | the L19 fit action: content below the 64 px top padding, zoom at most 100 % (one card → exactly 100 %) |
| Fit constants | top padding 64 px (bar 48 px + 16 px tokens), maximum fit zoom 100 %, minimum zoom 0.1, mirrored in `packages/engine/src/camera.cpp` and the harness |
| Backend | `webgl2` today; filename suffix `-webgl2` (WebGPU arrives with P4-11's `?backend=webgpu`) |
| Tolerance | `MAX_DIFFERING_PIXELS = 0`, `MAX_DIFFERING_PIXEL_RATIO = 0`, `MAX_CHANNEL_DELTA = 0` (exact match) |
| Baselines | `reviews/evidence/visual-baselines/<scene>-<viewport>-<backend>.png` |
| Capture record | `reviews/evidence/<task-id>-visual-run-<timestamp>.json`; `<task-id>` comes from `--task <id>` (default P4-04, the gate's origin) and the report's `task` field follows it |
| Failure diff | `reviews/evidence/<task-id>-visual-<timestamp>-<scene>-<viewport>-<backend>.diff.png` (same `--task` prefix) |
| Gate record | `reviews/evidence/<task-id>-visual-<timestamp>.json` + `.log` (written by `gate.py`, named after the running task) |
| Reference machine | Mac mini M2, macOS 27.2 (Darwin 27.2.0), Chrome for Testing 156.0.8078.4, ANGLE Metal — a documented proxy, not the MacBook Air M1 reference device; the environment recorded in the capture record supersedes this prose |

### Committed reference set (P4-04, extended by P4-07, P4-06 and P4-09)

| Scene | Desktop | Mobile |
| --- | --- | --- |
| `sample-at-rest` | `sample-at-rest-desktop-webgl2.png` | `sample-at-rest-mobile-webgl2.png` |
| `sample-zoom-in` | `sample-zoom-in-desktop-webgl2.png` | `sample-zoom-in-mobile-webgl2.png` |
| `sample-zoom-out` | `sample-zoom-out-desktop-webgl2.png` | `sample-zoom-out-mobile-webgl2.png` |
| `engine-core-at-rest` | `engine-core-at-rest-desktop-webgl2.png` | `engine-core-at-rest-mobile-webgl2.png` |
| `one-card-fit` (P4-07) | `one-card-fit-desktop-webgl2.png` | `one-card-fit-mobile-webgl2.png` |
| `layers-at-rest` (P4-06) | `layers-at-rest-desktop-webgl2.png` | `layers-at-rest-mobile-webgl2.png` |
| `layers-front` (P4-06) | `layers-front-desktop-webgl2.png` | `layers-front-mobile-webgl2.png` |
| `text-layout` (P4-09) | `text-layout-desktop-webgl2.png` | `text-layout-mobile-webgl2.png` |
| `text-titles` (P4-10) | `text-titles-desktop-webgl2.png` | `text-titles-mobile-webgl2.png` |
| `text-titles-zoom-200` (P4-10) | `text-titles-zoom-200-desktop-webgl2.png` | `text-titles-zoom-200-mobile-webgl2.png` |

P4-07 re-ran the two `sample-zoom-in` captures through the documented `--update` review path because
the L19 dot grid is visible at the 0.5 boundary (canvas catalogue L19, "hides below zoom 0.5"). Only
the **desktop** image changed; the mobile 0.5 view is fully covered by board content, so the grid
behind the opaque cards and zones adds no visible pixel and that image is byte-identical. Every other
P4-04 image is unchanged, and the two `one-card-fit` images are a reviewed addition. P4-06 adds the
four `layers-*` images as a reviewed addition (L13 order and the front state); no existing image
changed. P4-09 adds the two `text-layout` images as a reviewed addition. P4-10 adds the four
`text-titles*` images (the titles gallery at 100 % and 200 %, L02) as a reviewed addition through
`--update`; every pre-existing image stayed 0-diff in the same task's gate run.

## `visual` — engine-core stage gate (P4-04)

The stage gate set by P4-04 captures deterministic playground states and compares them with
committed reference images. It is dependency-free: it reuses the local Chrome for Testing binary and
the Chrome DevTools protocol like `apps/engine-playground/tools/capture.mjs`, decodes and encodes PNG
in Node with `node:zlib` and the five scanline filters (no pixel-diff library), and writes the diff
before it fails. The harness starts and stops its own static server and browser on
`ports.playground` from `.polier-slot`, copies the built playground, bridge, test-kit bundle and WASM
into a temporary folder, and removes that folder.

- **States:** the ten named scenes above, each served with `?scene=sample`, `?scene=engine-core` or
  `?scene=stress&count=1`, the P4-09/P4-10 text scenes with `?text=layout`/`?text=titles` and, for the
  zoom states, the deterministic `?view=<worldX>,<worldY>,<zoom>` camera hook. The `one-card-fit`
  scene runs the playground's L19 fit action after the ready hook and asserts that the fit rendered a
  frame; the page-owned `text-titles` scene declares its expected counts and world explicitly (it is
  not built by the test-kit). Each scene waits for the engine's ready hook, pauses the scheduler,
  hides the volatile rendered-frame HUD item and captures the canvas plus the playground chrome.
- **Camera determinism:** the at-rest scenes use the page's initial camera. The zoom states use the
  documented read-only view hook, which only calls `setCamera`; the harness asserts the effective
  camera (zoom and pan) against the requested state, so a broken hook is a capture failure, not a
  plausible image. The `one-card-fit` camera is asserted against the L19 fit rule (64 px top
  padding, at most 100 %, centred). The scene data never changes between captures. Every per-capture
  log line prints the capture URL and the effective camera (`panX`, `panY`, `zoom`), so the gate log
  alone documents which deterministic view produced each comparison.
- **Mobile fit:** at 390x844 the raw test-kit viewport fit of both worlds —
  `min(390 / world.width, 844 / world.height)` — is below the engine camera minimum: 0.040625 for the
  sample (390/9600) and 0.0203125 for engine-core (390/19200). The page canvas is smaller than the
  viewport, so the page's own fit is smaller still. The at-rest *mobile* reference images are
  therefore the documented clamped view at zoom 0.1: a section of the board, not the whole board.
  Fitting the whole board on a narrow viewport needs a lower camera minimum, which is a
  camera/interaction decision (L02/L19), not a visual-gate decision; the cropped mobile view is the
  committed contract.
- **Backends:** WebGL2 is the committed backend (baseline suffix `-webgl2`). WebGPU reference images
  run through the same harness once P4-11 adds the `?backend=webgpu` switch and commits its own
  `<scene>-<viewport>-webgpu.png` set; a backend that is genuinely unavailable is recorded as a
  skipped capture with the detected reason, never as a silent pass.
- **Tolerance:** exact match — 0 differing pixels, 0 differing-pixel ratio, 0 channel delta. A
  tolerance is allowed only for documented antialiasing noise (per-channel delta and a pixel-count
  ratio in the gate record), and it is approved in review, not chosen by the task.
- **Baselines:** committed under `reviews/evidence/visual-baselines/` with scene, viewport and
  backend in the filename. Updating one needs a reviewer who saw the before and after images;
  `--update` reports an update, never a gate pass.
- **Failure diffs:** the harness writes the capture record
  `reviews/evidence/<task-id>-visual-run-<timestamp>.json` (per capture: scene, viewport, backend,
  renderer, baseline path, differing pixels, differing-pixel ratio, worst channel delta, assertion
  results) and one diff PNG per failing capture
  `reviews/evidence/<task-id>-visual-<timestamp>-<scene>-<viewport>-<backend>.diff.png` (current
  pixels with every differing pixel marked red). A changed reference image is exit 1, never `infra`.
- **Task prefix:** `--task <task-id>` names the capture record and its `task` field after the task
  that runs the gate (default P4-04, the gate's origin); a later task passes its own id so its record
  does not masquerade as P4-04 evidence. The option changes no scene, camera or tolerance; the gate
  record and log are always named by `gate.py` after the running task.
- **Modes:** `--scene <name>` and `--viewport <name>` restrict a local run (the record says
  `partial: true`); the gate runs the full set. `--update` writes the reference images for the
  selected scenes/viewports. `--task <id>` only changes the capture-record prefix and its `task`
  field (see above).
- **Exclusive:** the harness starts and stops its own server and browser on the slot port; the gate
  declares `exclusive: ["visual"]` and is never run next to another browser gate.
- **Exit codes:** 0 pass (or baselines written with `--update`), 1 a reference image differs or a
  capture assertion fails, 2 usage/build problem (missing artefacts, missing/undecodable baseline,
  unknown filter), 3 infra (software or unknown renderer, no Chrome, page not ready, port busy).
- **PNG codec self-test:** before the first capture the harness encodes and decodes known pixels with
  every scanline filter; a broken decoder fails the run (exit 2) instead of comparing garbage.
- **Determinism:** paused scheduler, hidden rendered-frame HUD item, settled web fonts, two animation frames and a
  150 ms compositor settle before the screenshot, hidden scrollbars, DPR 1 through the protocol, and
  no animations. The reference images are captured on the same machine class, OS kernel series, GPU
  family and Chrome build; a different machine or OS is a new baseline set plus review.

### Hardware and browser rules

- **Chrome for Testing:** `CHROME_PATH` wins; otherwise the harness scans the local Playwright cache
  (the documented local default) and then the `/Applications` fallbacks. The capture record stores
  the executable, its source, the flags and the renderer string.
- **Flags:** the `perf-baseline` flags (`--headless=new --use-angle=metal --enable-gpu
  --hide-scrollbars --disable-frame-rate-limit --disable-gpu-vsync --no-first-run
  --no-default-browser-check --disable-background-timer-throttling
  --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
  --window-size=1440,900`) plus `--no-sandbox`. Chrome's own sandbox cannot initialise inside the
  sandboxed harness environment ("sandbox initialization failed: Operation not permitted"); the flag
  is local to this tool, never shipped, and does not touch the renderer check.
- **Fail-closed renderer:** the renderer must be positively identified as a real GPU — it must match
  `ANGLE (` and carry a known backend/GPU hint (Apple, Metal, OpenGL, Vulkan, NVIDIA, AMD, Intel,
  GeForce, Radeon) and must not be software. Everything else — SwiftShader/llvmpipe/"software",
  `unknown`, `unavailable` — makes the run `infra` with exit code 3 and must be repeated on a machine
  with a real GPU. `board.resources.infra_patterns` contains the software-renderer phrases, so a
  software run becomes an `infra` gate record, never a pass.

### Pitfalls

- Screenshots depend on OS, fonts, device pixel ratio, browser version and GPU; pin all of them or
  record the documented tolerance. A different GPU family is a different measurement.
- Animations, timestamps, the rendered-frame counter and the HUD change; the harness pauses the
  scheduler and removes the counter item from the layout, so only deterministic values remain in the
  image.
- A viewport mismatch (Chrome clamps window size) produces a false diff; set the metrics override
  through the DevTools protocol and assert the decoded screenshot size.
- Never update baselines to make a gate pass; that hides the regression the gate exists for.
- A run is compared only with the committed baselines on the same machine class, OS kernel series,
  Chrome build and flags. A software-renderer capture looks plausible but is `infra`, not evidence.
- The harness never stops a process it did not start, and it removes its temporary folder. Leave no
  server or browser behind.

### `visual-update` (review action)

`node packages/engine/test/visual/run-visual.mjs --update` writes the reference images for the
selected scenes/viewports and exits 0 with result `update`; it prints the written paths and states
that it is an update, not a gate pass. The committed images are the ones the next `visual` gate
compares against, so an update needs a reviewer who saw both the old and the new images.

### Baseline history

- **2026-10-28 — P4-30 L08 lifecycle/names: six reviewed images added.** The deterministic scenes
  `zone-grouping-ghost`, `zone-emptied` and `zone-names` (layers scene at world (512, 288) zoom 1,
  desktop and mobile, `?zoneLifecycle=...`) capture the dashed grouping ghost frame with its landing
  slot, the emptied dashed/dimmed frame and the zone title in the 40 px header. They were written via
  the documented per-scene `--update` review path and the full gate passes afterwards; every
  pre-existing reference image stayed 0-diff.


- **2026-10-28 — P4-29 L08 zone parity: two reviewed images added.** The `zone-parity-at-rest`
  scene (layers scene, `?zoneParity=1`, world (512, 288) at zoom 1, desktop and mobile) captures the
  deterministic auto-arranged zone (sizes + 16 px padding + 12 px gap below the 40 px header) with
  the dashed landing slot of the release preview. The two images were written through the documented
  `--update` review path for this scene only and reviewed with P4-29; every pre-existing reference
  image stayed 0-diff and the full gate passes afterwards. The scene is page-owned and deterministic:
  the arrangement runs through one `zone-arrange` group operation through the P4-05 seam.


- **2026-10-27 — P4-10 L02 titles gallery: two scenes added as a reviewed addition.** The `visual`
  gate gained the page-owned `text-titles` scene (2 zones, 2 blocks, 4 cards at world 1024x576,
  captured at 100 %) and `text-titles-zoom-200` (the same gallery at 200 %, so the zoom bucket's
  raster-scale-2 atlas is part of the reference set). The four images were written through the
  documented `--update` review path and reviewed with P4-10; every pre-existing reference image was
  0-diff in the same task's gate run, and the P4-09 `text-layout` images are byte-identical because
  the 100 % bucket keeps raster scale 1 and the P4-10 binding adds no text to that scene. The
  titles scene runs only with `?text=titles`, so no other scene, the benchmark or a perf document
  carries text. The capture record stores `textAtlas.rasterScale` per capture (1 at 100 %, 2 at
  200 %) next to the camera, so the bucket is evidenced by numbers and pixels.
- **2026-10-27 — P4-07 L19 dot grid: the `sample-zoom-in` captures were re-run.** The canvas
  catalogue defines the grid as hidden below zoom 0.5, so the at-0.5 captures changed when the grid
  was added. The update went through the documented `--update` review path and was reviewed with
  P4-07. Only the desktop image changed: 57,556 pixels differ (4.4 % of the image, worst channel
  delta <= 28). 55,866 of them are `tokens::faint` dots on the unchanged `tokens::canvas` background;
  the other 1,690 are antialiased object-edge fringe pixels where the dot behind the edge shifts the
  composited edge colour — no interior object pixel changed, and board geometry, camera and HUD are
  unchanged. The mobile 0.5 image is byte-identical because that view is fully covered by board
  content, so the grid behind it adds no visible pixel. Every other P4-04 image is 0-diff, and the two
  `one-card-fit` images were added as a reviewed addition in the same task. The capture record of the
  gate run after the update is the committed evidence.
- **2026-10-27 — regenerated after an OS kernel-series change (Darwin 25.5.0 → 27.2.0).** The initial
  P4-04 set was captured on 2026-10-26 while the host ran Darwin 25.5.0. The committed set was
  captured after the host moved to Darwin 27.2.0 (macOS 27.2); that OS change — not just a reboot —
  is what altered text rasterisation. Every glyph-bearing element differed (about 2,100 pixels per
  image, worst channel delta <= 45) while board geometry, colours and layout stayed identical. Text
  antialiasing is OS-dependent, so a run on Darwin 25.5.0 reproduces the old glyph rasterisation and
  must not be compared with the committed set: the kernel series, Chrome build, flags, GPU family
  and DPR are part of the baseline contract. The difference was inspected before the update, and the
  new images are committed and were reviewed like the initial set. The per-run environment is stored
  in the capture record (`hardware.os`, `browser.product`, `browser.flags`); the record supersedes
  this prose where they disagree.
