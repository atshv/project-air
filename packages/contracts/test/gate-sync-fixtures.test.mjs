// P5-01: the gate corpus carries the 0.3.0 version-negotiation specimens as
// byte-identical copies of the canonical sync fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PACKAGE_DIR, gateFixturePath } from "../index.mjs";

const SPECIMENS = [
  { validity: "valid", file: "sync-hello.json", source: "fixtures-sync/valid/client-hello.json" },
  { validity: "invalid", file: "sync-hello-missing-contract-version.json", source: "fixtures-sync/invalid/client-hello-missing-token-ref.json" },
];

test("the sync gate specimens are byte-identical copies of canonical fixtures", () => {
  for (const specimen of SPECIMENS) {
    assert.deepEqual(readFileSync(gateFixturePath(specimen.validity, specimen.file)), readFileSync(join(PACKAGE_DIR, specimen.source)));
  }
});
