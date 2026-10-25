# Gate Catalogue: WebAssembly / Emscripten

> Project gates for the WebAssembly engine. Toolchain: Emscripten 6.0.13 (`emcc --version` reports
> `6.0.13-git`) and CMake 4.4.4, pinned in [docs/versions.md](../versions.md). The flags below are
> verified with that version.

| Gate | Command | Expected |
| --- | --- | --- |
| `wasm-build` | `bash packages/engine/tools/build-wasm.sh` | exit 0; `packages/engine/build-wasm/engine.js` and `packages/engine/build-wasm/engine.wasm` written |
| `wasm-size` | `node packages/engine/tools/wasm-size.mjs` (ships with P2-03; P2-04 records the measured size) | exit 0, gzip size <= 307200 bytes (300 KiB) |

- `packages/engine/tools/build-wasm.sh` is the portable entry point and the only supported
  `wasm-build` command. When Homebrew provides Emscripten it prepends
  `$(brew --prefix emscripten)/bin` and `$(brew --prefix)/bin` to `PATH` (the launchers then find
  Homebrew Python 3.15 instead of the macOS system Python 3.9) and runs
  `emcmake cmake -S packages/engine -B packages/engine/build-wasm -DCMAKE_BUILD_TYPE=Release && cmake --build packages/engine/build-wasm --parallel`;
  without Homebrew it trusts `emcc`/`emcmake` on `PATH`, which is how CI runs a pinned emsdk
  installation.
- The WASM artifact is a JavaScript module without `main()` (`--no-entry`); the C ABI function
  `air_engine_version` is exported (`-sEXPORTED_FUNCTIONS=_air_engine_version`) and available on
  the module object as `_air_engine_version` (also callable through `ccall`).
- Export check (A3), loads the built module in Node and reads the version string:

  ```bash
  node -e "const create=require('./packages/engine/build-wasm/engine.js');create().then(m=>{const v=m.UTF8ToString(m._air_engine_version());if(v!=='0.1.0')throw new Error(v);console.log('engine.wasm exports air_engine_version:',v)})"
  ```

  → `engine.wasm exports air_engine_version: 0.1.0`.
- All Emscripten settings live in `packages/engine/CMakeLists.txt` inside `if(EMSCRIPTEN)`
  (`--no-entry`, `-sEXPORTED_FUNCTIONS=_air_engine_version`,
  `-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString`, `-sMODULARIZE=1`,
  `-sEXPORT_NAME=createAirEngine`), not on the command line.

## Pitfalls

- Do not call `emcmake` directly from a shell where Homebrew's bin is behind `/usr/bin`: CMake
  invokes the Emscripten `libexec` launcher, which resolves `python3` from `PATH` and fails with
  "emscripten requires python 3.10 or above" on the macOS system Python 3.9. Use the wrapper.
- Emscripten changes flag names and defaults between versions; an old command can silently produce
  a broken module — re-check against the pinned version after a toolchain update.
- `file://` loading fails for WASM: serve over HTTP (the playground dev server on the slot port) and
  test in the browser, not by opening the file.
- Node and browser builds differ; run the bridge smoke check the engine ships (P2-03).
- Keep debug assertions out of the Release build used for the size gate.
- Never commit `build-wasm/`; it is reproducible from the manifest.
- A WASM package is usually imported by an app: run the `boundaries` gate too
  ([node-ts.md](node-ts.md)).
