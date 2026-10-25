# Gate Catalogue: Performance

> Project performance gates. The engine baseline is measured in a real browser with a real GPU.
> The values in this catalogue are authoritative; the harness mirrors them as constants
> (`P95_LIMIT_MS`, `TARGET_FPS`, rectangle/sample/warm-up counts), so a change must update both in
> the same task.

| Gate | Command | Expected |
| --- | --- | --- |
| `perf-baseline` | `node packages/engine/test/perf/run-perf.mjs` | exit 0, p95 frame time <= 16.7 ms at 50,000 rectangles (60 fps); JSON evidence `reviews/evidence/P2-04-perf-<timestamp>.json` written |
| `perf` | `node packages/engine/test/perf/run-perf.mjs --scenario engine-core` | exit 0, 10,000 board objects at 60 fps with p95 <= 16.7 ms and no frame interval above 16.7 ms while panning and zooming; the L01 basis (500 cards + 50 zones) and the final proof (< 50 ms) are recorded, every run within basis + 10 %; JSON evidence under `reviews/evidence/` (exclusive) |

## `perf` — engine-core stage gate (P4-03)

The stage gate set by P4-03 measures the canvas, not just the rectangle benchmark. The scenario
builds the deterministic sample board (500 cards, 50 zones and blocks) and a 10,000-object variant
from `packages/test-kit`, then runs two measurements on the real GPU with the same fail-closed
renderer check and the same Chrome for Testing flags as `perf-baseline`:

- **Interactive run (gate pass criterion):** 10,000 board objects, warm-up frames discarded, then
  pan and zoom are driven continuously for the sample window (`setCamera` per frame, no gesture
  input needed). The gate passes only when p95 frame time <= 16.7 ms **and** no frame interval after
  warm-up exceeds 16.7 ms — the catalogue's "no long task > 16 ms" is measured as frame intervals,
  because the browser Long Task API only reports tasks above 50 ms. The JSON records p50/p95/p99,
  mean, max, the frame-interval histogram and the count of intervals above 16.7 ms.
- **L01 basis / final proof:** the 500 cards + 50 zones scene is measured while panning and zooming;
  the basis record is written before the drawing and interaction tasks, the final proof (< 50 ms)
  repeats the same scene after them. Every run is compared with the basis and must stay within
  basis + 10 %.
- **Culling:** the final proof also asserts that offscreen objects are not drawn (command-buffer
  instance count equals the visible candidates, not the document size).
- **Backend:** WebGL2 is the measured default (owner Q19). A WebGPU run may be recorded as an
  observation next to the gate record; it never replaces or loosens the gate.
- **Evidence:** baseline, basis and final JSON plus the gate record under `reviews/evidence/`; the
  numbers with date and path are quoted in the L01 task results and `docs/engine/perf-baseline.md`.
- **Exclusive:** `perf` declares `exclusive: ["perf"]`; run it through
  `python3 $POLIER/tools/gate.py --task <ID> --name perf --shell "node packages/engine/test/perf/run-perf.mjs --scenario engine-core"`.
  If the harness shows GC or scheduling outliers on the proxy machine, the task must bring the
  evidence and an owner-approved deviation; budgets are never adjusted silently.

### Pitfalls (stage gate)

- Camera motion must not replace the document or rebuild the spatial index every frame; if it does,
  the scenario measures the harness, not the engine.
- The display clock stays unlocked for the gate; the display-locked control is an observation only.
- Run the gate before and after every drawing change; never compare numbers from different Chrome
  builds, flags or machines.

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
