// A1/A4 support: the package metadata, docs and shipped files stay inside the
// design law - only tokens.json holds raw visual values, generated outputs are
// derived, no dependency is added and no placeholder ships.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const packageDir = new URL("../", import.meta.url);

test("package.json defines the five required scripts and no dependencies", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  for (const script of ["codegen", "build", "lint", "test", "typecheck"]) {
    assert.equal(typeof manifest.scripts[script], "string", `script ${script} exists`);
    assert.ok(manifest.scripts[script].length > 0, `script ${script} is not empty`);
  }
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    assert.equal(manifest[field], undefined, `no ${field}`);
  }
});

test("the generated files exist and are documented in README.md", () => {
  for (const name of ["tokens.css", "tokens.h", "layers.ts", "tokens.json", "codegen.mjs"]) {
    assert.ok(existsSync(new URL(name, packageDir)), `${name} exists`);
  }
  const readme = read("README.md");
  for (const name of ["tokens.css", "tokens.h", "layers.ts"]) {
    assert.ok(readme.includes(name), `README.md documents ${name}`);
  }
  assert.ok(readme.includes("pnpm --filter ./packages/ui-kit run codegen"));
  assert.ok(readme.includes("pnpm --filter ./packages/ui-kit test"));
});

test("the open questions live in README.md, not in tokens.json", () => {
  const readme = read("README.md");
  assert.ok(readme.includes("## Open questions"));
  for (const topic of ["Font families", "Reference-only colour tokens", "Layer 7a"]) {
    assert.ok(readme.includes(topic), `README.md documents the open question "${topic}"`);
  }
  assert.ok(!read("tokens.json").includes("open_questions"));
});

test("only tokens.json holds raw colour values; generated files are derived", () => {
  const files = [
    "codegen.mjs",
    "package.json",
    "tsconfig.json",
    "README.md",
    "ARCHITECTURE.md",
    ...readdirSync(new URL("icons/", packageDir)).map((name) => `icons/${name}`),
  ];
  const rawColour = /#[0-9a-fA-F]{3}(?![0-9a-fA-F])|#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\brgba?\(|\bhsla?\(/;
  for (const name of files) {
    assert.ok(!rawColour.test(read(name)), `${name} carries no raw colour value`);
  }
  // The generated outputs are the only place outside tokens.json where the
  // derived values may appear, and there only as codegen output.
  const tokens = JSON.parse(read("tokens.json"));
  const css = read("tokens.css");
  const header = read("tokens.h");
  for (const value of Object.values(tokens.colours)) {
    assert.ok(css.includes(value), `tokens.css contains the derived colour ${value}`);
    assert.ok(header.includes(value), `tokens.h contains the derived colour ${value}`);
  }
});

test("no placeholder or TODO ships in the package", () => {
  const files = [
    "codegen.mjs",
    "tokens.json",
    "package.json",
    "tsconfig.json",
    "README.md",
    "ARCHITECTURE.md",
    "tokens.css",
    "tokens.h",
    "layers.ts",
  ];
  for (const name of files) {
    assert.ok(!/\bTODO\b|\bTBD\b|\bFIXME\b|<\.\.\.>/.test(read(name)), `${name} has no placeholder`);
  }
});

test("ARCHITECTURE.md stays within the 400-word package budget and names commands", () => {
  const text = read("ARCHITECTURE.md");
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  assert.ok(words.length <= 400, `ARCHITECTURE.md has ${words.length} words`);
  assert.ok(text.includes("tokens.json"));
  assert.ok(text.includes("codegen"));
});

test("tsconfig.json includes the generated layer module", () => {
  const config = JSON.parse(read("tsconfig.json"));
  assert.ok(config.include.includes("layers.ts"));
  assert.equal(config.compilerOptions.noEmit, true);
});
