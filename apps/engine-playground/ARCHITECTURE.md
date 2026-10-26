# Architecture: apps/engine-playground

**Kind:** `app` · **Created in stage:** `engine-spike`

## Purpose

Develops and demonstrates the engine alone, without login and server: deterministic scenes (sample
board, stress), pan/zoom over the fixed scene, an objects/visible/FPS/backend HUD and a deterministic
ready hook for the harnesses. The WebGPU/WebGL2 switch and simulated foreign cursors follow in later
engine-core tasks.

## Inputs

- The engine from `packages/engine`, scene builders from `packages/test-kit` and tokens/components
  from `packages/ui-kit`.
- No backend: the app must work without any service.

## Outputs

- The sample board (500 cards, 50 zones with blocks) and the stress scene (N objects, default
  10,000) drawn from `packages/test-kit` sources.
- An objects/visible/FPS/backend HUD, demo-level pointer pan and wheel/pinch zoom, and
  `window.__enginePlayground` with `ready`, `pause` and `getState` for the perf and visual harnesses.
- The unchanged benchmark mode (`?bench=…`, `window.__engineBenchmark`, `PERF_RESULT`) for
  `packages/engine/test/perf/run-perf.mjs`.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change
  updates every dependant in the same task.
- The page stays a static module with an import map (no bundler); values only from
  `packages/ui-kit/tokens.css`; pan and zoom only change the camera, never the scene data.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`, `packages/ui-kit`, `packages/engine`, `packages/test-kit`.

## Commands

Static page, no bundler and no build step: `index.html` + `playground.css` + `main.js`, all values
from `packages/ui-kit/tokens.css`.

- **Bridge:** `pnpm --filter @project-air/engine run build` (compiles `packages/engine/dist/`).
- **Scenes:** `pnpm --filter @project-air/test-kit run build` (compiles `packages/test-kit/dist/`).
- **WASM:** `bash packages/engine/tools/build-wasm.sh`.
- **Serve:** `python3 -m http.server <slot playground port> --bind 127.0.0.1` from the repository
  root (port from `.polier-slot`), then open `/apps/engine-playground/?scene=sample` over HTTP — WASM
  cannot load from `file://`.
- **Size:** `node packages/engine/tools/wasm-size.mjs` (gzip budget 307200 bytes).
- **Evidence:** `node apps/engine-playground/tools/capture.mjs <desktop.png> [mobile.png]` starts
  headless Chrome for Testing with SwiftShader, emulates exact viewports, waits for
  `window.__enginePlayground.ready`, pauses the loop and prints the captured layout/HUD/state.

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
- Scene, query and ready-hook contract: [docs/engine.md](../../docs/engine.md)
