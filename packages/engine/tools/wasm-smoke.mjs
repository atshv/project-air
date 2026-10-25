#!/usr/bin/env node
// Node smoke check of the built WebAssembly module's exported C API (P2-03).
//
//   node packages/engine/tools/wasm-smoke.mjs
//
// The check runs without a browser: it loads build-wasm/engine.js (marked
// CommonJS by the build wrapper), verifies that engine_create fails cleanly when
// no WebGL2 canvas exists (0 plus a message on engine_last_error) and that the
// rectangle load before a successful create keeps reporting the pre-create error.
// Exit codes: 0 pass, 1 failure.
//
// The GPU path itself is covered by the playground and the headless screenshot.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REQUIRE = createRequire(import.meta.url);
const MODULE_PATH = fileURLToPath(new URL("../build-wasm/engine.js", import.meta.url));

function fail(message) {
  console.error(`wasm-smoke: ${message}`);
  process.exit(1);
}

// Minimal DOM shim: the Emscripten module loads outside a browser. It is enough
// for the canvas lookup to fail cleanly instead of throwing.
globalThis.document = { querySelector: () => null };

let create;
try {
  create = REQUIRE(MODULE_PATH);
} catch {
  fail(`cannot load ${MODULE_PATH}; run "bash packages/engine/tools/build-wasm.sh" first`);
}
if (typeof create !== "function") {
  fail("engine.js did not export the module factory");
}

const module = await create({});
if (typeof module.ccall !== "function" || typeof module.UTF8ToString !== "function") {
  fail("the module does not expose ccall/UTF8ToString");
}

const lastError = () =>
  module.UTF8ToString(module.ccall("engine_last_error", "number", [], []));

const createResult = module.ccall("engine_create", "number", ["string"], ["#no-webgl2-canvas"]);
const createError = lastError();
if (createResult !== 0) {
  fail(`engine_create reported success without a WebGL2 canvas: ${createResult}`);
}
if (createError.length === 0) {
  fail("engine_last_error() is empty after a failed engine_create");
}

const loadResult = module.ccall(
  "engine_load_rectangles",
  "number",
  ["number", "number"],
  [0, 0],
);
const loadError = lastError();
if (loadResult !== 0) {
  fail("engine_load_rectangles succeeded before a successful engine_create");
}
if (loadError.length === 0) {
  fail("engine_last_error() is empty after a pre-create rectangle load");
}

console.log(`wasm-smoke: engine_create without WebGL2 -> 0, error: ${createError}`);
console.log(`wasm-smoke: engine_load_rectangles before create -> 0, error: ${loadError}`);
console.log("wasm-smoke: OK");
