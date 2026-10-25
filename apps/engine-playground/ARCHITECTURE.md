# Architecture: apps/engine-playground

**Kind:** `app` · **Created in stage:** `engine-spike`

## Purpose

Develops and demonstrates the engine alone, without login and server: scenes (empty, 500, 10,000, stress), an FPS display, a WebGPU/WebGL2 switch and simulated foreign cursors.

## Inputs

- The engine from `packages/engine`, fixture scenes from `packages/test-kit` and tokens/components from `packages/ui-kit`.
- No backend: the app must work without any service.

## Outputs

- Scenes for empty, 500, 10,000 and stress loads.
- An FPS display, the WebGPU/WebGL2 switch and simulated foreign cursors.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`, `packages/ui-kit`, `packages/engine`, `packages/test-kit`.

## Commands

Static page, no bundler and no build step: `index.html` + `playground.css` + `main.js`, all values
from `packages/ui-kit/tokens.css`.

- **Bridge:** `pnpm --filter @project-air/engine run build` (compiles `packages/engine/dist/`).
- **WASM:** `bash packages/engine/tools/build-wasm.sh`.
- **Serve:** `python3 -m http.server <slot web port> --bind 127.0.0.1` from the repository root
  (port from `.polier-slot`), then open `/apps/engine-playground/` over HTTP — WASM cannot load
  from `file://`.
- **Size:** `node packages/engine/tools/wasm-size.mjs` (gzip budget 307200 bytes).
- **Evidence:** `node apps/engine-playground/tools/capture.mjs <desktop.png> [mobile.png]` starts
  headless Chrome for Testing with SwiftShader, emulates exact viewports, pauses the loop via
  `window.__enginePlayground` and prints the captured layout/fps; the page imports the bridge by
  package name through an import map (no bundler).


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
