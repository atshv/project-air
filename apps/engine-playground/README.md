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
2. `pnpm --filter @project-air/engine run build` (bridge to `packages/engine/dist/`)
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

### Scenes

- `?scene=sample` (default) — the deterministic sample board from `packages/test-kit`: 500 note
  cards and 50 zones with contained blocks.
- `?scene=stress` — the stress scene, 10,000 objects by default; `&count=N` sets any count from 0
  to 50,000.
- Pointer drag pans; wheel or two-pointer pinch zooms around the pointer. The scene data never
  changes; the HUD shows objects, visible instances, FPS and backend.

### Benchmark mode

`?bench=<rectangles>&samples=<n>&warmup=<n>` (for example
`?bench=50000&samples=600&warmup=120`) runs the deterministic benchmark scene with the display loop
replaced by a benchmark loop: it discards `warmup` frames, collects `samples` rAF frame intervals,
exposes `window.__engineBenchmark` (`status`, `count`, `warmup`, `samples`, `frameTimesMs`,
`renderer`, `canvas`) and logs one `PERF_RESULT` JSON line when done. The
`packages/engine/test/perf/run-perf.mjs` harness drives this mode; its `--display-locked` flag runs
the same page with the normal 60 Hz display clock as a control observation (no vsync-unlock flags).

The page must be served over HTTP: WASM does not load from `file://`. The import map maps the package
names `@project-air/engine` and `@project-air/test-kit` to the compiled artefacts; the test-kit
import is dynamic so benchmark mode also works in the perf harness copy that only carries engine
artefacts. Those deep paths are a spike detail of this bundle-less page, consumers use the package
entries from the manifests.
