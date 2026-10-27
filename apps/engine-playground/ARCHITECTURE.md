# Architecture: apps/engine-playground

**Kind:** `app` · **Created in stage:** `engine-spike`

## Purpose

Develops and demonstrates the engine alone: deterministic scenes (sample board, stress), pan/zoom
over the fixed scene, the L19 fit action and dot grid, on-demand rendering with an idle canvas, an
objects/visible/frames/backend HUD and a deterministic ready hook for the harnesses. The
WebGPU/WebGL2 switch and simulated foreign cursors follow later.

## Inputs

- The engine from `packages/engine`, scene builders from `packages/test-kit` and tokens/components
  from `packages/ui-kit`.
- No backend: the app must work without any service.

## Outputs

- The sample board (500 cards, 50 zones with blocks), the stress scene (N objects, default
  10,000) and the engine-core board (10,000 mixed board objects) drawn from `packages/test-kit`
  sources.
- An objects/visible/frames/backend HUD, demo-level pointer pan and wheel/pinch zoom, the L19 fit
  action (`f` / `fit()`), and `window.__enginePlayground` (`ready`, `pause`, `fit`, `frameCount`,
  `getState`). Outside the benchmark and perf modes the page renders only on change and schedules no
  frame while idle.
- The unchanged benchmark mode (`?bench=…`, `window.__engineBenchmark`, `PERF_RESULT`) for
  `packages/engine/test/perf/run-perf.mjs`.
- The engine-core measurement mode (`?perf=engine-core&scene=<engine-core|sample>`, plus
  `warmup`, `samples` and optional `verifyCulling`): a deterministic camera path with one
  `setCamera` per frame, frame intervals after the warm-up and (`verifyCulling`) the
  command-buffer instance count next to the visible set computed from geometry. It exposes
  `window.__enginePerf` for `run-perf.mjs` and never changes the document.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change
  updates every dependant in the same task.
- The page stays a static module with an import map (no bundler); values only from
  `packages/ui-kit/tokens.css`; camera changes never touch the scene data.

## Allowed imports

From `board.json` -> `packages[]` -> `may_import`: `packages/contracts`, `packages/ui-kit`, `packages/engine`, `packages/test-kit`.

## Commands

Static page, no bundler or build step: `index.html` + `playground.css` + `main.js`, all values
from `packages/ui-kit/tokens.css`.

- **Bridge:** `pnpm --filter @project-air/engine run build` (compiles `packages/engine/dist/`).
- **Scenes:** `pnpm --filter @project-air/test-kit run build` (compiles `packages/test-kit/dist/`).
- **WASM:** `bash packages/engine/tools/build-wasm.sh`.
- **Serve:** `python3 -m http.server <slot playground port> --bind 127.0.0.1` from the repository
  root (port from `.polier-slot`), then open `/apps/engine-playground/?scene=sample` over HTTP — WASM
  cannot load from `file://`.
- **Size:** `node packages/engine/tools/wasm-size.mjs` (gzip budget 307200 bytes).
- **Evidence:** `node apps/engine-playground/tools/capture.mjs <desktop.png> [mobile.png]` emulates
  exact viewports, waits for the ready hook, pauses the loop and prints layout/HUD/state.

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
- Scene, query and ready-hook contract: [docs/engine.md](../../docs/engine.md)
