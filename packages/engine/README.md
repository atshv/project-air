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
- **Toolchain:** CMake 4.4.4, Emscripten 6.0.13, C++20; gate details in
  [docs/gates/cpp-cmake.md](../../docs/gates/cpp-cmake.md) and
  [docs/gates/wasm-emscripten.md](../../docs/gates/wasm-emscripten.md).
- **Tests:** CTest suites `engine_unit_tests` (toolchain smoke test) and `engine_core_tests`
  (document, camera, culling, command-buffer determinism on 50,000 rectangles).

`build/` and `build-wasm/` are gitignored and never committed.
