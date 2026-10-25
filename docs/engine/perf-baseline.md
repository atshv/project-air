# Engine performance baseline — 50,000 rectangles

**As of:** 2026-10-25 · **Stage:** engine-spike · **Task:** P2-04 · **Gate:** `perf-baseline`

This report records the measured performance of the WebGL2 engine spike
(`apps/engine-playground`, `packages/engine`) and states explicitly how the local measurement
machine differs from the reference hardware. It is proxy evidence for the stage exit criterion
"50,000 rectangles at 60 fps"; the reference-device number is still unproven.

## What this proves and what it does not

- **Proven:** the engine renders a deterministic 50,000-rectangle document with one instanced
  WebGL2 draw per frame in Chrome for Testing on a real GPU (ANGLE Metal, Apple M2), and
  frame-production throughput (CPU submission and compositor pipeline) is far below the 16.7 ms
  frame budget. The WASM artefact stays within the 300 KiB gzip budget.
- **Not proven:** the reference hardware (MacBook Air M1, 8 GB) has not been measured. The local
  machine is a **Mac mini M2, 8 GB** (Apple M2, 8 logical cores), accepted by the owner as a
  documented proxy. macOS 26.5.2, headless Chrome and a different GPU class mean the M1 result must
  be re-measured on the reference device before the stage is called complete for that hardware.
- The measurement is frame-production throughput, **not GPU completion time**: the renderer issues
  no `glFinish`/fence, so the rAF interval covers CPU submission plus the compositor pipeline and
  carries no per-frame GPU sync point.
- The pass criterion is the baseline run with the display clock unlocked (see below); a
  display-locked control run is committed as a separate observation and is never a pass.

## Hardware and browser

| Item | Value |
| --- | --- |
| Measurement machine (local proxy) | Mac mini M2, 8 GB, Apple M2, 8 logical cores, arm64 |
| OS | macOS 26.5.2 (Darwin 25.5.0) |
| Reference machine (target) | MacBook Air M1, 8 GB, Chrome — **not measured here** |
| Browser | Chrome for Testing 156.0.8078.4 (`--headless=new`), revision `@f842f52ef39fd97b449eb27cff414bf05a98ddce` |
| Browser source | `local Playwright cache default` (`CHROME_PATH` wins when set; recorded in the JSON) |
| GPU renderer string | `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)` |
| Framebuffer | 1050×591 device pixels (canvas 1048×589 CSS, devicePixelRatio 1) |
| Node.js running the harness | v26.12.1 — the repository pins Node 24.22.1 (`.nvmrc`); the deviation is recorded and the reference-device run must use the pinned Node |
| Engine build | CMake `Release`, Emscripten 6.0.13 (`6.0.13-git`) |
| WASM artefact | 49,925 B raw, **21,806 B gzip** (budget 307,200 B) |

Baseline Chrome flags (recorded in the JSON):

```
--headless=new --use-angle=metal --enable-gpu --hide-scrollbars
--disable-frame-rate-limit --disable-gpu-vsync
--no-first-run --no-default-browser-check
--disable-background-timer-throttling --disable-renderer-backgrounding
--disable-backgrounding-occluded-windows --window-size=1440,900
```

`--use-angle=metal --enable-gpu` are required for a real GPU; without them headless Chrome silently
falls back to SwiftShader. The harness is **fail-closed**: it only passes when the renderer matches
`ANGLE (` and a known backend/GPU hint (Apple, Metal, OpenGL, Vulkan, NVIDIA, AMD, Intel, GeForce,
Radeon) and is not SwiftShader/llvmpipe/"software". `unknown` or `unavailable` renderer strings are
classified as `infra` (exit 3), never as a pass.

## Method

1. `pnpm --filter @project-air/engine run build` and `bash packages/engine/tools/build-wasm.sh`
   build the bridge and the WASM module; `node packages/engine/tools/wasm-size.mjs` records the gzip
   size.
2. `node packages/engine/test/perf/run-perf.mjs` reads the web port from `.polier-slot`, copies the
   playground, tokens CSS, bridge and WASM into a temporary folder, starts its own static server on
   that port and launches Chrome for Testing with the flags above.
3. The page runs `?bench=50000&samples=600&warmup=120`: a deterministic 50,000-rectangle document
   (250×200 cells, world 8000×4500), camera fitted to the document, one instanced draw per frame.
   The normal demo behaviour is unchanged without the query.
4. The page discards 120 warm-up frames (WASM fetch, shader compile, first compositor frames), then
   collects 600 frame intervals between consecutive rendered `requestAnimationFrame` callbacks.
5. The harness asserts the scenario before it can pass: the page must report exactly 50,000
   rectangles, 120 warm-up frames and 600 samples (`assertions` block in the JSON). It then computes
   p50/p95/p99/mean, writes `reviews/evidence/P2-04-perf-<timestamp>.json` with hardware, OS,
   browser, flags, renderer, build sizes, assertions and results, and exits 0 only if the renderer
   is a positively identified real GPU, the scenario matches, 600 samples exist and p95 ≤ 16.7 ms.
6. The gate runs through `gate.py` as `perf-baseline`, so the exclusive `perf` resource lock applies;
   the harness stops only its own server and browser and removes its temporary folder.

## Results — baseline (display clock unlocked)

Scenario: 50,000 rectangles, 600 samples after 120 warm-up frames, 1440×900 window.

| Metric | Value |
| --- | --- |
| p50 frame time | **1.80 ms** |
| p95 frame time | **2.00 ms** |
| p99 frame time | 2.20 ms |
| Mean frame time | 1.80 ms |
| Mean fps (1000 / mean frame time) | **556.1 fps** |
| Min / max frame time | 1.60 ms / 3.20 ms |
| Samples / warm-up | 600 / 120 |
| Threshold | p95 ≤ 16.7 ms (60 fps) |
| Renderer identification | positive (`ANGLE (` + Apple/Metal), software: false |
| Verdict | **pass** (p95 8.35× under the 60 fps budget) |

The display clock is unlocked (`--disable-frame-rate-limit --disable-gpu-vsync`) so the rAF
interval measures frame production instead of the 60 Hz display clock. A browser locked to a 60 Hz
display cannot exceed ~60 fps regardless of engine headroom; the control run below shows that
boundary.

## Results — display-locked control (not a pass criterion)

The same harness, page and machine with the display clock left locked
(`node packages/engine/test/perf/run-perf.mjs --display-locked`; the two vsync-unlock flags are
omitted). This is a committed control observation, not a gate result: it says the browser is
vsync-bound, not that the engine is slow.

| Metric | Value |
| --- | --- |
| p50 frame time | 16.70 ms |
| p95 frame time | 16.80 ms |
| p99 frame time | 16.80 ms |
| Mean frame time | 16.67 ms |
| Mean fps | 60.0 fps |
| Result | `control` (exit 0, never labelled pass) |

Evidence: `reviews/evidence/P2-04-perf-control-20261025T151922Z.json` and
`reviews/evidence/P2-04-perf-control-20261025T151922Z.log`.

The control confirms the reason for unlocking: at 60 Hz the display quantises the interval at
~16.67 ms, so a display-locked measurement can only show whether the engine misses a vsync, not how
much headroom it has. The spike's pass criterion is therefore the unlocked frame-production
baseline, and the control is recorded next to it (major finding from the P2-04 review).

## Evidence

- Baseline measurement JSON: `reviews/evidence/P2-04-perf-20261025T151952Z.json`
- Display-locked control JSON: `reviews/evidence/P2-04-perf-control-20261025T151922Z.json`
- Display-locked control log: `reviews/evidence/P2-04-perf-control-20261025T151922Z.log`
- Gate record + log (command, flags, renderer, numbers, evidence path):
  `reviews/evidence/P2-04-perf-baseline-20261025T151950Z.json` and
  `reviews/evidence/P2-04-perf-baseline-20261025T151950Z.log`
- Harness: [`packages/engine/test/perf/run-perf.mjs`](../../packages/engine/test/perf/run-perf.mjs)
- Benchmark mode: [`apps/engine-playground/main.js`](../../apps/engine-playground/main.js)
  (`?bench=50000&samples=600&warmup=120`)
- Gate catalogue: [`docs/gates/perf.md`](../gates/perf.md)

Reproduce (from a worktree with a slot and the built bridge + WASM):

```bash
node packages/engine/test/perf/run-perf.mjs                  # baseline pass run
node packages/engine/test/perf/run-perf.mjs --display-locked # committed control observation
```

## Deviations and limitations

- **Hardware deviation:** local Mac mini M2 vs reference MacBook Air M1 — different CPU, GPU class,
  thermal envelope and display path. The M1 number remains unproven.
- **Node deviation:** the gate ran with the machine's Node v26.12.1 while the repository pins Node
  24.22.1; the harness records `hardware.node`, and the reference-device measurement must use the
  pinned Node.
- **Headless browser:** `--headless=new` differs from a visible browser window (no window server,
  reduced presentation path); the flags and renderer string are recorded so the run is reproducible.
- **Display clock:** the baseline unlocks vsync to measure frame production; the display-locked
  control above is the supported way to show the 60 Hz boundary.
- **No GPU sync point:** the rAF interval measures frame-production throughput (CPU submission and
  compositor pipeline); the renderer has no `glFinish`/fence, so per-frame GPU completion is not
  measured.
- **Single machine, single run:** the numbers are one 600-sample run on an 8 GB machine; background
  load and thermal state can move them. Re-run before using the JSON as a regression baseline.
- **Scene scope:** one deterministic rectangle document with tone colour variation and the three
  design layers; no text, images, edges, gestures or editing (those land in engine-core).

## Related

- Size gate: `docs/gates/wasm-emscripten.md` (`wasm-size`), measured 21,806 B gzip.
- Perf gate: [`docs/gates/perf.md`](../gates/perf.md).
- Version: Chrome for Testing 156.0.8078.4 in [`docs/versions.md`](../versions.md) (local
  measurement tool only, not bundled; Node deviation noted there too).
