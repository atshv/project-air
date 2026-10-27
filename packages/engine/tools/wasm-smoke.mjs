#!/usr/bin/env node
// Node smoke check of the built WebAssembly module's exported C API (P2-03).
//
//   node packages/engine/tools/wasm-smoke.mjs
//
// The check runs without a browser: it loads build-wasm/engine.js (marked
// CommonJS by the build wrapper), verifies that engine_create fails cleanly when
// no WebGL2 canvas exists (0 plus a message on engine_last_error) and that the
// rectangle load before a successful create keeps reporting the pre-create error.
// P4-08/P4-09: the pure text calls (token style, font family, atlas plan with the
// texture-limit fallback) answer without a renderer, while the atlas upload and
// the glyph runs fail cleanly before engine_create. P4-10 adds the binding calls
// (bind object text, clear bindings, required preview height) to the same
// pre-create failure check.
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

const OUT_BYTES = 7 * 8;
const out = module._malloc(OUT_BYTES);
const outValues = () => Array.from(module.HEAPF64.subarray(out / 8, out / 8 + 7));
const styleResult = module.ccall("engine_text_style", "number", ["number", "number"], [0, out]);
const [titleSize, titleWeight] = outValues();
if (styleResult !== 1 || titleSize !== 15 || titleWeight !== 600) {
  fail(`engine_text_style(title) -> ${styleResult}, size ${titleSize}, weight ${titleWeight}`);
}
const family = module.UTF8ToString(
  module.ccall("engine_text_font_family", "number", ["number"], [0]),
);
if (!family.includes("system-ui")) {
  fail(`engine_text_font_family(title) is not the token font stack: ${family}`);
}
const planResult = module.ccall(
  "engine_text_plan_atlas",
  "number",
  ["number", "number", "number", "number", "number", "number"],
  [392, 12, 21, 3, 512, out],
);
const plan = outValues();
if (planResult !== 1 || plan[6] !== 1 || plan[0] > 512 || plan[1] > 512) {
  fail(`engine_text_plan_atlas fallback -> ${planResult}, plan ${plan.join(",")}`);
}
const tooSmall = module.ccall(
  "engine_text_plan_atlas",
  "number",
  ["number", "number", "number", "number", "number", "number"],
  [392, 12, 21, 2, 64, out],
);
if (tooSmall !== 0 || lastError().length === 0) {
  fail("engine_text_plan_atlas accepted an atlas above the texture limit");
}
module._free(out);
const atlasResult = module.ccall(
  "engine_text_load_atlas",
  "number",
  ["number", "number", "number", "number", "number", "number", "number"],
  [1, 1, 1, 0, 4, 0, 1],
);
const atlasError = lastError();
if (atlasResult !== 0 || !atlasError.includes("engine_create")) {
  fail(`engine_text_load_atlas before create -> ${atlasResult}, error: ${atlasError}`);
}
if (module.ccall("engine_text_max_texture_size", "number", [], []) !== -1) {
  fail("engine_text_max_texture_size reported a size before engine_create");
}
// P4-09: the box-run export exists and fails cleanly before engine_create.
const boxRunResult = module.ccall(
  "engine_text_add_box_run",
  "number",
  ["number", "number", "number", "number", "number", "number", "number", "number"],
  [0, 0, 0, 1, 100, 20, 0, 0],
);
const boxRunError = lastError();
if (boxRunResult !== 0 || !boxRunError.includes("engine_create")) {
  fail(`engine_text_add_box_run before create -> ${boxRunResult}, error: ${boxRunError}`);
}

// P4-10: the binding exports exist and fail cleanly before engine_create.
const bindResult = module.ccall(
  "engine_text_bind_object",
  "number",
  ["number", "number", "number", "number", "number"],
  [0, 0, 0, 0, 0],
);
const bindError = lastError();
if (bindResult !== 0 || !bindError.includes("engine_create")) {
  fail(`engine_text_bind_object before create -> ${bindResult}, error: ${bindError}`);
}
const clearBindingsResult = module.ccall("engine_text_clear_bindings", "number", [], []);
if (clearBindingsResult !== 0 || !lastError().includes("engine_create")) {
  fail(`engine_text_clear_bindings before create -> ${clearBindingsResult}`);
}
const requiredResult = module.ccall(
  "engine_text_required_height",
  "number",
  ["number", "number"],
  [0, 0],
);
if (requiredResult !== 0 || !lastError().includes("engine_create")) {
  fail(`engine_text_required_height before create -> ${requiredResult}`);
}

console.log(`wasm-smoke: engine_create without WebGL2 -> 0, error: ${createError}`);
console.log(`wasm-smoke: text plan fallback at DPR 3 / 512 px -> scale ${plan[6]}, ${plan[0]}x${plan[1]}`);
console.log(`wasm-smoke: engine_text_load_atlas before create -> 0, error: ${atlasError}`);
console.log(`wasm-smoke: engine_load_rectangles before create -> 0, error: ${loadError}`);
console.log(`wasm-smoke: engine_text_add_box_run before create -> 0, error: ${boxRunError}`);
console.log(`wasm-smoke: engine_text_bind_object before create -> 0, error: ${bindError}`);
console.log("wasm-smoke: OK");
