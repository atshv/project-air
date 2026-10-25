# apps/engine-playground

Engine demo without backend.

- **Kind:** `app`
- **Created in stage:** `engine-spike`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Commands

Static page, no build step; it imports the compiled bridge and the Emscripten module.

1. `pnpm install --frozen-lockfile` (workspace root)
2. `pnpm --filter @project-air/engine run build` (bridge to `packages/engine/dist/`)
3. `bash packages/engine/tools/build-wasm.sh` (module to `packages/engine/build-wasm/`)
4. Serve the repository root on the slot's web port, for example
   `python3 -m http.server 4100 --bind 127.0.0.1` from the repository root, then open
   `http://127.0.0.1:4100/apps/engine-playground/`.
5. Evidence capture (headless Chrome for Testing, WebGL via SwiftShader):
   `node apps/engine-playground/tools/capture.mjs reviews/evidence/P2-03-playground.png`
   — the helper emulates 1440×900 and 390×844, pauses the loop through
   `window.__enginePlayground` and prints the layout and fps it captured. `CHROME_PATH` overrides
   the browser, `PLAYGROUND_URL` the page URL.

### Benchmark mode

`?bench=<rectangles>&samples=<n>&warmup=<n>` (for example
`?bench=50000&samples=600&warmup=120`) runs the deterministic scene with the display loop replaced by
a benchmark loop: it discards `warmup` frames, collects `samples` rAF frame intervals, exposes
`window.__engineBenchmark` (`status`, `count`, `warmup`, `samples`, `frameTimesMs`, `renderer`,
`canvas`) and logs one `PERF_RESULT` JSON line when done. Without the query the page behaves exactly
like the normal demo. The `packages/engine/test/perf/run-perf.mjs` harness drives this mode; its
`--display-locked` flag runs the same page with the normal 60 Hz display clock as a control
observation (no vsync-unlock flags).

The page must be served over HTTP: WASM does not load from `file://`. The port comes from
`.polier-slot`; never hard-code it in the page. The import map maps the package name
`@project-air/engine` to the compiled bridge at `packages/engine/dist/bridge/engine.js`; that deep
path is a spike detail of this bundle-less page, consumers use the package entry from
`packages/engine/package.json`.
