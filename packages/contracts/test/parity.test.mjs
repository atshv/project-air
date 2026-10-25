// Fixture parity harness: the TypeScript canonical description of every fixture
// must be identical to the C++ one produced by the test-only program in
// test/cpp/parity.cpp, which reads the fixtures with its own JSON reader and
// includes the generated contract header.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalLines, diffCanonical } from "./parity/canonical.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(HERE);
const FIXTURES_DIR = join(PACKAGE_DIR, "fixtures");
const GENERATED_DIR = join(PACKAGE_DIR, "generated");
const PARITY_SOURCE = join(PACKAGE_DIR, "test/cpp/parity.cpp");

function fixturePaths(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...fixturePaths(absolute));
    } else if (entry.name.endsWith(".json")) {
      found.push(relative(PACKAGE_DIR, absolute).split("\\").join("/"));
    }
  }
  return found;
}

const FIXTURES = fixturePaths(FIXTURES_DIR).sort();
const WRAPPERS = new Map(FIXTURES.map((fixture) => [fixture, JSON.parse(readFileSync(join(PACKAGE_DIR, fixture), "utf8"))]));
const TS_LINES = canonicalLines(FIXTURES.map((fixture) => [fixture, WRAPPERS.get(fixture)]));

function findCompiler() {
  for (const candidate of ["clang++", "g++"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const COMPILER = findCompiler();
let parityBinary = null;
let parityDirectory = null;

after(() => {
  if (parityDirectory !== null) rmSync(parityDirectory, { recursive: true, force: true });
});

function compileParityProgram() {
  if (parityBinary !== null) return parityBinary;
  assert.ok(
    COMPILER !== null,
    "No C++ compiler found: the parity harness needs clang++ or g++ on PATH (see packages/contracts/README.md).",
  );
  parityDirectory = mkdtempSync(join(tmpdir(), "contracts-parity-"));
  const binary = join(parityDirectory, "contract-parity");
  const compiled = spawnSync(
    COMPILER,
    [
      "-std=c++20",
      "-Wall",
      "-Wextra",
      "-Wpedantic",
      "-Werror",
      "-O1",
      "-I",
      GENERATED_DIR,
      "-o",
      binary,
      PARITY_SOURCE,
    ],
    { encoding: "utf8" },
  );
  assert.equal(compiled.status, 0, `${COMPILER} failed to build the parity program:\n${compiled.stderr}`);
  parityBinary = binary;
  return parityBinary;
}

function runParityProgram() {
  const binary = compileParityProgram();
  const run = spawnSync(binary, FIXTURES, {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `the parity program failed:\n${run.stderr}`);
  return run.stdout.split("\n").filter((line) => line.length > 0);
}

test("every fixture has a canonical TypeScript result", () => {
  assert.equal(FIXTURES.length, 77, "the contract has 77 fixtures");
  assert.equal(TS_LINES.length, FIXTURES.length);
  assert.equal(new Set(TS_LINES).size, TS_LINES.length, "each fixture yields one distinct line");
  const invalid = FIXTURES.filter((fixture) => WRAPPERS.get(fixture).valid === false);
  assert.ok(invalid.length > 0);
  assert.equal(invalid.length, 45, "45 invalid fixtures are described too");
  const schemas = new Set(FIXTURES.map((fixture) => WRAPPERS.get(fixture).schema));
  assert.equal(schemas.size, 10, "all ten schemas are covered");
});

test("the canonical TypeScript description is deterministic", () => {
  const again = canonicalLines(FIXTURES.map((fixture) => [fixture, WRAPPERS.get(fixture)]));
  assert.deepEqual(again, TS_LINES);
  assert.equal(diffCanonical(TS_LINES, TS_LINES).length, 0);
});

test("the parity program compiles with the local C++ compiler", () => {
  assert.ok(COMPILER !== null, "clang++ or g++ must be available");
  assert.ok(compileParityProgram().length > 0);
});

test("TypeScript and C++ canonical results match for every fixture", () => {
  const cppLines = runParityProgram();
  assert.equal(cppLines.length, FIXTURES.length, "one C++ line per fixture");
  assert.deepEqual(diffCanonical(TS_LINES, cppLines), [], "TS and C++ describe every fixture identically");
});

test("a tampered canonical line is detected as a parity difference", () => {
  const tampered = [...TS_LINES];
  const index = tampered.findIndex((line) => line.includes("|true|"));
  assert.ok(index >= 0, "there is a valid fixture line to tamper with");
  tampered[index] = tampered[index].replace("|true|", "|false|");
  assert.notDeepEqual(diffCanonical(TS_LINES, tampered), []);
  assert.equal(diffCanonical(TS_LINES, TS_LINES).length, 0);
});

test("invalid fixtures keep their validity verdict and model fields in the canonical form", () => {
  const invalidFixtures = FIXTURES.filter((fixture) => WRAPPERS.get(fixture).valid === false);
  const lines = new Map(TS_LINES.map((line) => [line.split("|", 1)[0], line]));
  for (const fixture of invalidFixtures) {
    const line = lines.get(fixture);
    assert.ok(line !== undefined, `${fixture} has a canonical line`);
    assert.ok(line.includes("|false|"), `${fixture} keeps valid=false`);
  }
  const operationLines = TS_LINES.filter((line) => line.includes("schemas/operation.schema.json"));
  assert.ok(operationLines.length >= 42, "the operation fixtures are described");
  for (const line of operationLines) {
    const [fixture, schema, , type, inverse] = line.split("|");
    assert.equal(schema, "schemas/operation.schema.json");
    assert.notEqual(type, "", `${fixture} has an operation type`);
    assert.equal(typeof inverse, "string");
  }
});
