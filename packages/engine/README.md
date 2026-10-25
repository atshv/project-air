# packages/engine

C++ to WebAssembly canvas engine and TS bridge.

- **Kind:** `package`
- **Created in stage:** `engine-spike`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Commands

The engine is the workspace's C++ package: it builds with the pinned CMake/Emscripten toolchain
from [docs/versions.md](../../docs/versions.md), not through pnpm.

- **Native build and unit test:**
  `cmake -S packages/engine -B packages/engine/build -DCMAKE_BUILD_TYPE=Debug && cmake --build packages/engine/build --parallel && ctest --test-dir packages/engine/build --output-on-failure`
- **WebAssembly build:** `bash packages/engine/tools/build-wasm.sh` from the repository root —
  writes `build-wasm/engine.js` and `build-wasm/engine.wasm`. The wrapper sets the toolchain `PATH`
  itself (Homebrew locally, a pinned emsdk on CI) and runs the `emcmake` configure plus build.
- **TypeScript bridge:** `pnpm --filter @project-air/engine run build` compiles
  `src/bridge/engine.ts` to `dist/`; `pnpm --filter @project-air/engine run typecheck` and
  `pnpm --filter @project-air/engine run lint` are the checks. The package entry
  (`main`/`types`/`exports` → `dist/bridge/engine.js`) exposes
  `createEngine(canvas, options)` over the exported WebGL2 C API.
- **WASM smoke:** `node packages/engine/tools/wasm-smoke.mjs` — loads the built module in Node
  and checks the exported C API failure contract (no browser needed); the `wasm-build` gate runs
  it after the wrapper.
- **WASM size:** `node packages/engine/tools/wasm-size.mjs` — fails above 307200 bytes gzip.
- **Performance baseline:** `node packages/engine/test/perf/run-perf.mjs` — exclusive `perf-baseline`
  gate: launches Chrome for Testing with a real GPU, measures 50,000 rectangles
  (`?bench=50000&samples=600&warmup=120`), writes `reviews/evidence/P2-04-perf-<timestamp>.json` and
  exits 0 only when p95 frame time is <= 16.7 ms; see [docs/gates/perf.md](../../docs/gates/perf.md)
  and [docs/engine/perf-baseline.md](../../docs/engine/perf-baseline.md). The display-locked
  control run is `node packages/engine/test/perf/run-perf.mjs --display-locked` (result `control`,
  never a pass).
- **Toolchain:** CMake 4.4.4, Emscripten 6.0.13, C++20; gate details in
  [docs/gates/cpp-cmake.md](../../docs/gates/cpp-cmake.md) and
  [docs/gates/wasm-emscripten.md](../../docs/gates/wasm-emscripten.md).
- **Tests:** CTest suites `engine_unit_tests` (toolchain smoke test) and `engine_core_tests`
  (document, camera, culling, command-buffer determinism on 50,000 rectangles).

`build/` and `build-wasm/` are gitignored and never committed.
