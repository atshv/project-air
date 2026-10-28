# ADR-0006: Engine architecture

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes:** –

## Context

Project air needs a canvas that keeps a 50,000-rectangle board usable at 60 fps while reading the contract and design tokens instead of hand-written copies. The
blueprint fixes C++20 → WebAssembly for the engine and keeps network, accounts and persistence out of
it (AD-2); `packages/contracts` generates `contract.h` (ADR-0005) and `packages/ui-kit` generates
`tokens.h` (AD-7). WebGPU is not broadly available enough to bet the stage on; WebGL2 is, and the spike had to prove
or disprove the claim before engine-core invests.

Measured evidence (`reviews/evidence/`, Mac mini M2 8 GB proxy, Chrome for Testing 156.0.8078.4,
ANGLE Metal): p50 1.80 ms, p95 2.00 ms; mean frame time 1.80 ms = 556.1 fps unlocked frame
production (`P2-04-perf-20261025T151952Z.json`); the display-locked control shows the 60 Hz vsync boundary at
p95 16.80 ms (`P2-04-perf-control-20261025T151922Z.json`); gate record
`P2-04-perf-baseline-20261025T151950Z.json`. WASM is 49,925 B raw / 21,806 B gzip against the 300 KiB
budget. Reference MacBook Air M1 is **not** measured: these are proxy headroom numbers,
not a delivered M1 60 fps proof.

## Decision

We build the engine as a C++20 core in `packages/engine`:

- `doc` keeps rectangles in one flat array reserved for 50,000 entries, ordered by design layer, then
  the contract's fractional `z` string, then insertion order, with a precomputed draw-order
  permutation; it maps `BoardContent` onto rectangles.
- `camera` (pan/zoom affine, world↔screen, 16 px grid from `tokens::canvas_grid`), `spatial`
  (uniform-grid culling) and `render` (deterministic 24-byte instance command buffer, byte-identical
  for identical input) stay renderer-agnostic.
- `render_gl` draws the buffer with one instanced WebGL2 `drawArraysInstanced` per frame and inline
  GLSL; WebGPU later implements the same command-buffer interface.
- One CMake/Emscripten build (pinned CMake 4.4.4, Emscripten 6.0.13) produces native CTest suites and
  the WASM module; a thin TypeScript bridge (`createEngine(canvas, options)`) calls a few exported C
  functions and issues no per-object JS calls.
- The engine includes `contract.h`/`tokens.h`, holds a working copy and never talks to the network.

## Consequences

P4-11/P4-13 implemented the WebGPU backend behind the same 24-byte command buffer and the same
text/chrome core: objects, the dot grid, the chrome pass (header bands/rules, snap guides, selection
frames/band, zone highlight) and the glyph pass (atlas + sampler, same placements/palette) render on
WebGPU with one pipeline per pass, no second data path and the token palette. The playground selects
it with `?backend=webgpu` through the P4-12 capability probe and falls back to WebGL2 with a visible
reason; WebGL2 stays the measured default and its 28 reference images are byte-identical. WebGPU has
its own 28 reviewed reference images and the visual gate records a cross-backend comparison with a
reviewed antialiasing tolerance (≤3 % differing canvas pixels, zero interior differing pixels):
colour, draw order and layout are identical, pixel-exactness is not claimed. WebGPU-specific
performance is not claimed (perf/idle stay WebGL2).



- **Positive:** measured frame-production headroom far below the 16.7 ms budget; a deterministic
  command buffer a second backend can reuse; contract and tokens stay the single source for data and
  visual values; native CTest suites run in under a second; the renderer is a seam, not an
  architecture.
- **Negative:** a C++/Emscripten toolchain (Homebrew or pinned emsdk, Python PATH, 64 MiB fixed WASM
  memory) beside the TypeScript stack; one engine instance per module and `dispose()` only detaches
  the typed handle (no `engine_destroy` yet); headless GPU setup needs the fail-closed renderer check
  (SwiftShader never passes); the measurement is a proxy: M1 delivered 60 fps is unproven, there is no
  per-frame GPU sync/fence, and the unlocked run measures frame production, not GPU completion.
- **Binds:** `packages/engine/`, `apps/engine-playground/`, the perf gate and report; engine-core
  keeps the instance layout and draw order or versions them.
- **Prevents:** TypeScript/Canvas2D per-object drawing, network coupling inside the engine,
  renderer lock-in, per-object JS bridge calls, and silent drift of contract or token values.

## Alternatives

- **TypeScript + Canvas2D** — rejected: per-object draw calls and GC pressure make 50,000 rectangles
  at 60 fps implausible, and there would be no native test or reusable command buffer.
- **WebGPU-only** — rejected for the spike: browser/headless support is not mature enough for a
  trustworthy real-GPU baseline; WebGL2 is measured, WebGPU stays the planned second backend.
- **Rust/WASM** — rejected: the blueprint mandates C++20, contract codegen emits a C++ header and the
  CMake/Emscripten toolchain is pinned; a rewrite adds a toolchain without measured advantage.
- **Per-object JS draw calls or a canvas framework** — rejected: no single instanced draw, bridge
  overhead per object, less control over the measured loop.
