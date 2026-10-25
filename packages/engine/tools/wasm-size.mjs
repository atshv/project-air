#!/usr/bin/env node
// gzip size gate for the engine WebAssembly artifact (P2-03).
//
//   node packages/engine/tools/wasm-size.mjs
//
// Exit codes: 0 within budget, 1 over budget or missing artifact, 2 usage error.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 307200; // 300 KiB gzip (docs/quality.md wasm-size)
const ARTIFACT = new URL("../build-wasm/engine.wasm", import.meta.url);

let raw;
try {
  raw = readFileSync(fileURLToPath(ARTIFACT));
} catch {
  console.error(
    `wasm-size: cannot read ${fileURLToPath(ARTIFACT)}; run "bash packages/engine/tools/build-wasm.sh" first`,
  );
  process.exit(1);
}

const gzip = gzipSync(raw, { level: 9 });
const withinBudget = gzip.length <= BUDGET_BYTES;
console.log(
  `wasm-size: engine.wasm raw ${raw.length} B, gzip ${gzip.length} B, budget ${BUDGET_BYTES} B → ${
    withinBudget ? "OK" : "OVER BUDGET"
  }`,
);
process.exit(withinBudget ? 0 : 1);
