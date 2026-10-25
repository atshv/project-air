# Gate Catalogue: C++ / CMake

> Project gates for the C++ engine. Toolchain: CMake 4.4.4 and Apple clang 21.0.0 with C++20, pinned
> in [docs/versions.md](../versions.md). The build drives `packages/engine/CMakeLists.txt`, which
> declares the library target `air_engine` and the test executable `engine_unit_tests`.

| Gate | Command | Expected |
| --- | --- | --- |
| `configure` | `cmake -S packages/engine -B packages/engine/build -DCMAKE_BUILD_TYPE=Debug` | exit 0, "Configuring done" |
| `build` | `cmake --build packages/engine/build --parallel` | exit 0, "Built target air_engine" and "Built target engine_unit_tests" |
| `cpp-unit` | `cmake -S packages/engine -B packages/engine/build -DCMAKE_BUILD_TYPE=Debug && cmake --build packages/engine/build --parallel && ctest --test-dir packages/engine/build --output-on-failure` | exit 0, "100% tests passed", test `engine_unit_tests` |

- Target names, sources, include paths and the C++ standard come from
  `packages/engine/CMakeLists.txt`; do not rename a target inside a gate.
- `cpp-unit` is an exit gate of the engine stages and runs configure, build and CTest in one shell.
- The native unit build uses `-DCMAKE_BUILD_TYPE=Debug`; the WASM build uses `Release`
  ([wasm-emscripten.md](wasm-emscripten.md)).
- Compiler warnings are errors: `-Wall -Wextra -Wpedantic -Werror` is set in the package
  `CMakeLists.txt` for every target, native and Emscripten.
- Include paths point at the committed generated headers
  `packages/contracts/generated/contract.h` and `packages/ui-kit/tokens.h`; the engine never copies
  or edits them.

## Pitfalls

- A stale `build/` hides changes: configure into a fresh directory or delete the build tree. Never
  commit `build/`.
- The project has no `CMakePresets.json`; the documented `-D` options are the interface.
- Sanitizers are not configured in the spike; a task that adds ASan/UBSan gives them their own gate
  and pins the compiler in `docs/versions.md`.
- Include paths are relative to the package `CMakeLists.txt`, so the `-S packages/engine` form works
  from the repository root and the absolute `build/` cache paths stay out of git.
- Tests that need a file or port use the slot's paths and ports; a test must not leave a process
  running.
- Do not stop processes you did not start: no `kill`, `pkill` or `killall`.
