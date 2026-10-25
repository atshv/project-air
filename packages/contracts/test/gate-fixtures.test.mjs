// Gate fixture specimens for the Polier `contracts` gate (P1-06).
//
// Polier 1.0 requires fixtures_dir/valid/*.json and fixtures_dir/invalid/*.json
// as direct files. The specimens under fixtures-gate/ are byte-identical copies
// of canonical board-content fixtures; this test keeps them identical so the
// gate never validates a drifted copy and keeps the canonical fixtures/ tree
// untouched.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { GATE_FIXTURE_DIRS, PACKAGE_DIR, fixturePath, gateFixturePath } from "../index.mjs";

const SPECIMENS = [
  { validity: "valid", file: "board-content.json", source: "fixtures/board-content/valid.json" },
  { validity: "invalid", file: "board-content.json", source: "fixtures/board-content/invalid-missing-board.json" },
];

test("the gate specimens are byte-identical copies of canonical fixtures", () => {
  for (const specimen of SPECIMENS) {
    const copy = readFileSync(gateFixturePath(specimen.validity, specimen.file));
    const source = readFileSync(join(PACKAGE_DIR, specimen.source));
    assert.deepEqual(copy, source, `${specimen.validity}/${specimen.file} equals ${specimen.source}`);
    assert.ok(copy.length > 0, `${specimen.validity}/${specimen.file} is not empty`);
  }
  assert.equal(fixturePath("board-content", "valid.json"), join(PACKAGE_DIR, "fixtures/board-content/valid.json"));
});

test("the gate fixture directories hold direct JSON files for Polier", () => {
  assert.deepEqual(GATE_FIXTURE_DIRS, { valid: "fixtures-gate/valid", invalid: "fixtures-gate/invalid" });
  for (const validity of ["valid", "invalid"]) {
    const directory = join(PACKAGE_DIR, GATE_FIXTURE_DIRS[validity]);
    const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
    assert.ok(files.length >= 1, `${validity}/ has at least one direct JSON fixture`);
    for (const file of files) assert.match(file, /^[a-z0-9-]+\.json$/, `${file} is a flat fixture name`);
  }
  assert.throws(() => gateFixturePath("broken", "x.json"), /unknown gate fixture validity/);
});

test("the gate specimens keep the fixture wrapper", () => {
  for (const specimen of SPECIMENS) {
    const wrapper = JSON.parse(readFileSync(gateFixturePath(specimen.validity, specimen.file), "utf8"));
    assert.deepEqual(Object.keys(wrapper).sort(), ["data", "reason", "schema", "valid"]);
    assert.equal(wrapper.schema, "schemas/board-content.schema.json");
    assert.equal(wrapper.valid, specimen.validity === "valid");
  }
});
