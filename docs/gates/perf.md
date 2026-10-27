# Gate Catalogue: Performance

> Project performance gates. The engine baseline is measured in a real browser with a real GPU.
> The values in this catalogue are authoritative; the harness mirrors them as constants
> (`P95_LIMIT_MS`, `TARGET_FPS`, rectangle/sample/warm-up counts), so a change must update both in
> the same task.

| Gate | Command | Expected |
| --- | --- | --- |
| `perf-baseline` | `node packages/engine/test/perf/run-perf.mjs` | exit 0, p95 frame time <= 16.7 ms at 50,000 rectangles (60 fps); JSON evidence `reviews/evidence/P2-04-perf-<timestamp>.json` written |
| `perf` | `node packages/engine/test/perf/run-perf.mjs --scenario engine-core` | exit 0, 10,000 board objects at 60 fps with p95 <= 16.7 ms and no frame interval above 16.7 ms while panning and zooming; the L01 basis (500 cards + 50 zones) and the final proof (< 50 ms) are recorded, the enforced production metrics (p50/p95/p99/mean) within basis + 10 % and the maximum frame duration reported as a 50 ms-bounded observation; JSON evidence under `reviews/evidence/` (exclusive) |

## `perf` — engine-core stage gate (P4-03)

The stage gate set by P4-03 measures the canvas, not just the rectangle benchmark. The scenario
builds the deterministic sample board (500 cards, 50 zones and 144 contained blocks) and a
10,000-object mixed board scene from `packages/test-kit`, then runs measurements on the real GPU
with the same fail-closed renderer check as `perf-baseline`:

- **Interactive run (gate pass criterion):** 10,000 board objects, warm-up frames discarded, then
  pan and zoom are driven continuously for the sample window. The harness drives the camera through
  a deterministic path — one zoom cycle from the fit zoom to six times the fit zoom and back, plus
  one left-to-right pan sweep, one `setCamera` per frame, no gesture input needed. The gate passes
  only when p95 frame time <= 16.7 ms **and** no frame interval after warm-up exceeds 16.7 ms — the
  catalogue's "no long task > 16 ms" is measured as frame intervals, because the browser Long Task
  API only reports tasks above 50 ms. The JSON records p50/p95/p99, mean, max, the raw frame
  intervals, the frame-interval histogram and the count of intervals above 16.7 ms.
- **Observation without interference:** the harness starts Chrome on `about:blank`, enables the
  DevTools domains and only then navigates to the measured page; it waits for the page's own
  `PERF_SCENARIO {…}` console event (`Runtime.consoleAPICalled`) instead of evaluating
  `window.__enginePerf` while the run is in flight, and reads the final state once afterwards.
  Enabling a DevTools domain or evaluating on the renderer main thread while frames are produced
  stalls the renderer and appears as a frame interval the engine did not cause; the measured window
  must stay untouched. This is observation hygiene, not a threshold change: the p95 and
  no-interval criterion, the basis comparison and the fail-closed renderer check are unchanged.
- **L01 basis / final proof:** the 500 cards + 50 zones scene is measured while panning and zooming
  with the same camera path. `--record basis` writes the basis before the drawing and interaction
  tasks; `--record final` repeats the same scene against the committed basis. The final proof
  additionally asserts that the command-buffer instance count equals the visible set computed from
  the scene geometry (up to 100 sampled cameras, every sampled frame's draw count compared with an
  independent inclusive bounds intersection) and that at least one checked frame draws fewer
  instances than the document, i.e. offscreen content is culled instead of drawn. All culling
  assertions are all-or-nothing: a final proof needs at least 50 culling cameras, zero
  command-buffer/visible-set mismatches and at least one frame drawn below the document size.
  The final proof requires a maximum frame duration below 50 ms.
- **Scenario constants** (mirrored in `packages/engine/test/perf/run-perf.mjs`,
  `apps/engine-playground/main.js` and here; a change touches all three):

  | Constant | Value |
  | --- | --- |
  | Interactive scene | `buildEngineCoreScene()`: 10,000 objects (9,200 cards, 200 zones, 600 blocks), world 19,200 x 10,816 px |
  | Interactive warm-up / samples | 120 frames / 2,000 frames |
  | Interactive threshold | p95 <= 16.7 ms and zero frame intervals above 16.7 ms after warm-up |
  | L01 scene | `buildSampleScene()`: 500 cards + 50 zones + 144 contained blocks = 694 objects, world 9,600 x 5,408 px |
  | L01 warm-up / samples | 120 frames / 2,000 frames |
  | L01 final threshold | maximum frame duration < 50 ms |
  | L01 culling proof | at least 50 sampled cameras, zero command-buffer/visible-set mismatches, at least one frame drawn below the document size |
  | Basis tolerance | current <= basis + 10 % on p50/p95/p99/mean, with a 0.2 ms resolution floor (two 0.1 ms rAF timestamp ticks) |
  | Max frame duration | a 50 ms-bounded observation, not part of the +10 % enforcement |
  | Camera path | one zoom cycle fit zoom -> 6 x fit zoom -> fit zoom, one left-to-right pan sweep, vertically centred, one `setCamera` per frame |

  2,000 samples per run instead of the rectangle baseline's 600: on the M2 proxy the 10,000-object
  scene produces frames well below a millisecond, so a 600-sample window would be far too short to
  cover the pan/zoom path. The evidence records the measured sample window (`sampleWindowMs`).
- **Basis comparison:** every later L01 measurement is compared with the committed basis record. The
  enforced production metrics — p50, p95, p99 and mean frame time — must stay within basis + 10 %;
  the rAF timestamp is quantised to 0.1 ms, so the tolerance has a 0.2 ms resolution floor (the
  quantisation error of a difference). The maximum frame duration is listed in the comparison table
  and bounded by the L01 50 ms long-task target instead, because a single scheduling spike at 0.1 ms
  timer resolution is not a regression signal. That is a **documented deviation from L01's "every
  measurement within basis + 10 %" wording**: the gate enforces the production percentiles and mean
  and bounds the maximum by the 50 ms target, and it prints that qualification in the gate log and
  records it in the final JSON (`comparison.enforcedMetrics` / `comparison.observationMetrics`). The
  floor never relaxes the 16.7 ms frame budget, the 50 ms bound or the scenario assertions.
- **Evidence:** `reviews/evidence/P4-03-perf-engine-core-<timestamp>.json` (interactive run),
  `reviews/evidence/P4-03-perf-basis-<timestamp>.json` (L01 basis),
  `reviews/evidence/P4-03-perf-final-<timestamp>.json` (L01 final proof, including the basis
  comparison and the culling check) and the gate record
  `reviews/evidence/P4-03-perf-<timestamp>.json` + `.log` for the P4-03 runs. The numbers with date
  and path are quoted in the L01 task results and in
  [docs/engine/perf-baseline.md](../engine/perf-baseline.md).
- **Evidence prefix:** `--task <task-id>` sets the engine-core evidence prefix and the record `task`
  field (default `P4-03`, the gate's origin), so a later task that runs the gate writes
  `<task-id>-perf-engine-core-<timestamp>.json` and `<task-id>-perf-final-<timestamp>.json` and its
  records do not masquerade as P4-03 evidence. The committed P4-03 basis record is read-only and
  keeps its own prefix; the gate record and log are always named by `gate.py` after the running task.
- **Modes:** `node packages/engine/test/perf/run-perf.mjs --scenario engine-core` (default) runs the
  interactive gate plus the L01 basis (written only when none exists) and the final proof;
  `--record basis` writes only the basis and refuses when one already exists; `--record final` writes
  only the final proof and fails when no basis exists; `--task <task-id>` only names the evidence files
  and their `task` field (see above) and changes no threshold or scenario.
- **Backend:** WebGL2 is the measured default (owner Q19). A WebGPU run may be recorded as an
  observation next to the gate record; it never replaces or loosens the gate.
- **Exclusive:** `perf` declares `exclusive: ["perf"]`; run it through
  `python3 $POLIER/tools/gate.py --task <ID> --name perf --shell "node packages/engine/test/perf/run-perf.mjs --scenario engine-core"`.
  The harness serves on `ports.playground` from `.polier-slot` (the rectangle baseline keeps
  `ports.web`) and starts and stops only its own server and browser.
- **Exit codes:** 0 pass, 1 fail, 2 usage/build problem (for example a missing basis for
  `--record final`), 3 infra (software or unknown renderer, or the gate's environment).
- **Local browser flag:** the engine-core scenario passes `--no-sandbox` in addition to the
  `perf-baseline` flags. Chrome's own sandbox cannot initialise inside the sandboxed harness
  environment ("sandbox initialization failed: Operation not permitted"), so the browser would crash
  before measuring. The flag is recorded in the evidence, only used by this local measurement tool,
  and never shipped; it does not touch the renderer check, the thresholds or the scenario
  assertions. A software or unknown renderer is still classified `infra` (exit 3).
- **Pitfalls (stage gate):** camera motion must not replace the document or rebuild the spatial
  index every frame (the harness asserts one document load); the display clock stays unlocked and
  the display-locked control remains an observation only; interface constants live in the harness,
  the page and this catalogue, never in three places; and a run is compared only with the committed
  basis on the same machine, Chrome build and flags. If a run shows scheduling outliers, re-run it
  once on an idle machine and keep the evidence; budgets are never adjusted silently.

### `perf` pitfalls

- Camera motion must not replace the document or rebuild the spatial index every frame; if it does,
  the scenario measures the harness, not the engine.
- The display clock stays unlocked for the gate; the display-locked control is an observation only.
- Run the gate before and after every drawing change; never compare numbers from different Chrome
  builds, flags or machines.

### `perf-baseline` (P2-04, unchanged)

- **Exclusive:** `perf-baseline` declares `exclusive: ["perf"]`; run it through
  `python3 $POLIER/tools/gate.py --task P2-04 --name perf-baseline --shell "node packages/engine/test/perf/run-perf.mjs"`
  so the resource lock applies. Never run two benchmark runs against the same port.
- **Real GPU required, fail-closed:** the harness records `WEBGL_debug_renderer_info` and only
  passes when the renderer is positively identified as a real GPU: it must match `ANGLE (` and
  carry a known backend/GPU hint (Apple, Metal, OpenGL, Vulkan, NVIDIA, AMD, Intel, GeForce,
  Radeon). Everything else — SwiftShader/llvmpipe/"software", `unknown`, `unavailable` — is
  classified as `infra`, the exit code is `3`, and the run must be repeated on a machine with a real
  GPU. `board.resources.infra_patterns` contains the software-renderer phrases, so a software run
  becomes an `infra` gate record, never a pass.
- **Scenario assertions:** the harness fails unless the page reports exactly 50,000 rectangles,
  120 warm-up frames and 600 samples; the expected and actual values are written to the JSON
  (`assertions`), so a query or playground regression cannot pass while being labelled 50,000.
- **Display-locked control:** `node packages/engine/test/perf/run-perf.mjs --display-locked`
  (or `PERF_DISPLAY_LOCKED=1`) omits `--disable-frame-rate-limit --disable-gpu-vsync`, writes
  `reviews/evidence/P2-04-perf-control-<timestamp>.json` and exits 0 with result `control`; it is a
  control observation of the 60 Hz vsync boundary, never a gate pass.
- **Browser:** Chrome for Testing 156.0.8078.4 with `--headless=new --use-angle=metal --enable-gpu`
  reports the real GPU (ANGLE Metal). Without those flags headless falls back to SwiftShader. The
  harness finds Chrome through `CHROME_PATH` first and otherwise scans the local Playwright cache
  (the current machine path is only the documented local default); the executable and the source
  (`CHROME_PATH` / `local Playwright cache default` / `Applications fallback`) are recorded in the
  evidence. The baseline passes `--disable-frame-rate-limit --disable-gpu-vsync` so the rAF interval
  measures frame production instead of the 60 Hz display clock; the flags are recorded.
- **Scenario:** deterministic 50,000-rectangle document, camera fitted to the document, one
  instanced WebGL2 draw per frame; warm-up 120 frames, 600 samples; frame time is the interval
  between consecutive rendered rAF callbacks after warm-up. The measurement is frame-production
  throughput (CPU submission plus compositor pipeline); the renderer issues no per-frame GPU
  sync/fence, so GPU completion time is not measured.
- **Hardware rules:** reference hardware is a MacBook Air M1, 8 GB, Chrome (owner decision
  2026-10-25). The local measurement machine is a Mac mini M2, 8 GB, macOS 26.5.2 — a documented
  proxy, not the reference device. The report must name the deviation and what remains unproven.
- The harness reads the web port from `.polier-slot`, copies the built playground + WASM into a
  temporary folder, starts and stops **its own** static server and Chrome, and removes its temporary
  directory. It never stops a process it did not start.

## Pitfalls

- Headless Chromium silently falls back to SwiftShader; always check the recorded renderer string.
- A cold WASM fetch, shader compile or first compositor frame skews the start; use the warm-up frames.
- A busy machine or a thermal-throttled laptop makes the numbers unstable; record the machine state
  and treat a borderline result as proxy evidence, not as the reference answer.
- Display vsync quantises rAF to ~16.7 ms and hides engine headroom; the harness unlocks the display
  clock and records that in the evidence. A display-locked browser cannot show more than ~60 fps.
- Browser version and flags matter; a different Chrome build or GPU backend is a different
  measurement. Record both.
- Leave no processes or ports behind: the server and browser are children of the harness and are
  stopped in its `finally` block.
- Build the bridge and WASM before the run (`pnpm --filter @project-air/engine run build`,
  `bash packages/engine/tools/build-wasm.sh`); the harness fails with the missing artefact name.
