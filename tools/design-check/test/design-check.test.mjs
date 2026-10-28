// Unit tests for the design rules gate: every rule, the ignore list, the CLI
// contract (exit codes and output format) and a clean run on this repository.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkProject,
  ConfigError,
  formatFinding,
  isIgnored,
  loadDesignSource,
  RULES,
} from "../check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(HERE, "../../..");
const FIXTURES = join(HERE, "fixtures");
const CLI = join(TOOL_DIR, "index.mjs");
const SOURCE = loadDesignSource(REPO_ROOT);

const runCli = (args) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: REPO_ROOT, encoding: "utf8" });

function tempDir(t) {
  const directory = mkdtempSync(join(tmpdir(), "design-check-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A temporary project with the real design source copied in plus extra files. */
function tempProject(t, files = {}) {
  const directory = tempDir(t);
  mkdirSync(join(directory, "packages", "ui-kit"), { recursive: true });
  cpSync(
    join(REPO_ROOT, "packages", "ui-kit", "tokens.json"),
    join(directory, "packages", "ui-kit", "tokens.json"),
  );
  cpSync(
    join(REPO_ROOT, "packages", "ui-kit", "layers.ts"),
    join(directory, "packages", "ui-kit", "layers.ts"),
  );
  writeFiles(directory, files);
  return directory;
}

function writeFiles(directory, files) {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(directory, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}

test("the design source is read from tokens.json and layers.ts", () => {
  assert.equal(SOURCE.grid, 4);
  assert.deepEqual(SOURCE.spacingValues, [4, 8, 12, 16, 24, 32, 48]);
  assert.deepEqual(SOURCE.zIndexes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(SOURCE.layers.length, 12);
  assert.ok(SOURCE.colourNames.includes("accent"));
  assert.ok(SOURCE.tokenNames.includes("space-4"));
  assert.ok(SOURCE.tokenNames.includes("radius-tooltip"));
  assert.equal(SOURCE.grid, 4, "the 4-px spacing grid comes from the smallest token");
});

test("the clean fixture has no findings", () => {
  const result = checkProject(join(FIXTURES, "clean"), { source: SOURCE });
  assert.deepEqual(result.findings, []);
  assert.ok(result.summary.files >= 3);
  assert.equal(result.task, null);
});

test("the repository itself is clean", () => {
  const result = checkProject(REPO_ROOT);
  assert.deepEqual(result.findings, []);
  // Values the scanner cannot judge automatically are informational skips, not
  // findings. They are listed explicitly so a new skip still fails this test and
  // must be reviewed: percentage centring and calc() offsets built from spacing
  // tokens are legitimate CSS (P0-24/P0-25 preview zoom pill, extended by the
  // P0-28…P0-32 zone preview), and the preview.js arithmetic expressions are
  // scanner-unparsed JS in the zone layout that never reaches a raw spacing
  // value. Refreshed after P0-31/P0-32 changed the preview files (owner approval
  // 2026-10-28); no test logic changed.
  assert.deepEqual(
    result.skipped.map(({ file, line, rule, property, value, reason }) => ({
      file,
      line,
      rule,
      property,
      value,
      reason,
    })),
    [
      {
        file: "apps/web/preview/preview.css",
        line: 1007,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset-inline-start",
        value: "50%",
        reason: "non-px unit",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1077,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset-block-start",
        value: "calc(100% + var(--space-8))",
        reason: "function value (calc() etc.)",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1078,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset-inline-start",
        value: "50%",
        reason: "non-px unit",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1116,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset-block-start",
        value: "50%",
        reason: "non-px unit",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1117,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset-inline-start",
        value: "50%",
        reason: "non-px unit",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1183,
        rule: RULES.OFF_GRID_SPACING,
        property: "margin-inline-start",
        value: "calc(-1 * var(--space-4))",
        reason: "function value (calc() etc.)",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1294,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset",
        value: "calc(-1 * var(--border-width))",
        reason: "function value (calc() etc.)",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1505,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset",
        value: "calc(var(--space-4) / 2)",
        reason: "function value (calc() etc.)",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1560,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset-block-start",
        value: "50%",
        reason: "non-px unit",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1561,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset-inline-start",
        value: "50%",
        reason: "non-px unit",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1603,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset-block-start",
        value: "50%",
        reason: "non-px unit",
      },
      {
        file: "apps/web/preview/preview.css",
        line: 1604,
        rule: RULES.OFF_GRID_SPACING,
        property: "inset-inline-start",
        value: "calc(100% + var(--space-8))",
        reason: "function value (calc() etc.)",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 761,
        rule: RULES.OFF_GRID_SPACING,
        property: "left",
        value: "left,",
        reason: "unrecognised spacing value",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 762,
        rule: RULES.OFF_GRID_SPACING,
        property: "top",
        value: "top,",
        reason: "unrecognised spacing value",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 763,
        rule: RULES.OFF_GRID_SPACING,
        property: "right",
        value: "+",
        reason: "unrecognised spacing value",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 763,
        rule: RULES.OFF_GRID_SPACING,
        property: "right",
        value: "rect.w",
        reason: "unrecognised spacing value",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 763,
        rule: RULES.OFF_GRID_SPACING,
        property: "right",
        value: "*",
        reason: "unrecognised spacing value",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 763,
        rule: RULES.OFF_GRID_SPACING,
        property: "right",
        value: "ratio,",
        reason: "unrecognised spacing value",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 764,
        rule: RULES.OFF_GRID_SPACING,
        property: "bottom",
        value: "+",
        reason: "unrecognised spacing value",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 764,
        rule: RULES.OFF_GRID_SPACING,
        property: "bottom",
        value: "rect.h",
        reason: "unrecognised spacing value",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 764,
        rule: RULES.OFF_GRID_SPACING,
        property: "bottom",
        value: "*",
        reason: "unrecognised spacing value",
      },
      {
        file: "apps/web/preview/preview.js",
        line: 764,
        rule: RULES.OFF_GRID_SPACING,
        property: "bottom",
        value: "ratio,",
        reason: "unrecognised spacing value",
      },
    ],
  );
});

test("raw colours are reported; var() and currentColor are allowed", () => {
  const result = checkProject(join(FIXTURES, "raw-colours"), { source: SOURCE });
  assert.deepEqual([...new Set(result.findings.map((finding) => finding.rule))], [
    RULES.RAW_COLOUR,
  ]);
  assert.equal(result.findings.length, 9);
  const css = result.findings.filter((finding) => finding.file === "apps/web/colours.css");
  assert.deepEqual(css.map((finding) => finding.line), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(css.some((finding) => finding.message.includes("#ff0000")));
  const engine = result.findings.find((finding) =>
    finding.file.endsWith("packages/engine/src/render/render.cc"),
  );
  assert.equal(engine.line, 2);
  assert.match(
    formatFinding(engine),
    /^packages\/engine\/src\/render\/render\.cc:2: raw-colour: raw colour #00ff00/,
  );
});

test("off-grid spacing is reported and non-px values are skipped", () => {
  const result = checkProject(join(FIXTURES, "off-grid-spacing"), { source: SOURCE });
  const css = result.findings.filter((finding) => finding.file === "apps/web/spacing.css");
  assert.deepEqual(css.map((finding) => finding.line), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...new Set(css.map((finding) => finding.rule))], [RULES.OFF_GRID_SPACING]);
  assert.ok(css.some((finding) => finding.message.includes("margin-inline-start")));
  assert.equal(result.findings.length, 8);
  const html = result.findings.filter((finding) => finding.file.endsWith("index.html"));
  assert.equal(html.length, 1);
  assert.equal(html[0].line, 8);
  assert.equal(result.skipped.length, 3);
  assert.ok(result.skipped.some((entry) => entry.reason.includes("function value")));
  assert.ok(result.skipped.some((entry) => entry.reason === "non-px unit"));
  for (const entry of result.skipped) {
    assert.equal(entry.rule, RULES.OFF_GRID_SPACING);
    assert.equal(typeof entry.file, "string");
    assert.equal(typeof entry.line, "number");
    assert.equal(typeof entry.value, "string");
  }
});

test("numeric z-index values must come from layers.ts", () => {
  const result = checkProject(join(FIXTURES, "z-index"), { source: SOURCE });
  assert.deepEqual(
    result.findings.map((finding) => [finding.line, finding.rule]),
    [
      [5, RULES.Z_INDEX],
      [6, RULES.Z_INDEX],
      [7, RULES.Z_INDEX],
      [8, RULES.Z_INDEX],
    ],
  );
  assert.ok(result.findings.every((finding) => finding.message.includes("layers.ts")));
});

test("ignored directories, generated token files and test files are skipped", () => {
  const result = checkProject(join(FIXTURES, "ignored"), { source: SOURCE });
  assert.deepEqual(
    result.findings.map((finding) => [finding.file, finding.line]),
    [["apps/web/visible.css", 1]],
  );
  assert.equal(result.summary.files, 2);
});

test("node_modules, VCS, cache and build directories are skipped", (t) => {
  const bad = ".ignored { color: #ff0000; margin: 5px; z-index: 42; }\n";
  const directory = tempProject(t, {
    "apps/web/clean.css": ".clean { color: var(--fg); padding: var(--space-8); }\n",
    "apps/web/visible.css": ".visible { margin: 6px; }\n",
    "apps/web/node_modules/pkg/bad.css": bad,
    "apps/web/.git/bad.css": bad,
    "apps/web/.turbo/bad.css": bad,
    "apps/web/dist/bad.css": bad,
    "apps/web/build/bad.css": bad,
    "apps/web/coverage/bad.css": bad,
    "apps/web/reference/bad.css": bad,
  });
  const byDefault = checkProject(directory);
  assert.deepEqual(
    byDefault.findings.map((finding) => [finding.file, finding.line, finding.rule]),
    [["apps/web/visible.css", 1, RULES.OFF_GRID_SPACING]],
  );
});

test("isIgnored covers generated, ignored and test paths", () => {
  for (const path of [
    "packages/ui-kit/tokens.css",
    "packages/ui-kit/tokens.h",
    "packages/ui-kit/tokens.json",
    "packages/ui-kit/layers.ts",
    "apps/web/node_modules/pkg/bad.css",
    "apps/web/reference/bad.css",
    "apps/web/docs/bad.css",
    "apps/web/reviews/bad.css",
    "apps/web/fixtures/bad.css",
    "apps/web/tests/bad.css",
    "apps/web/bad.test.css",
    "apps/web/bad.spec.mjs",
  ]) {
    assert.ok(isIgnored(path), `${path} is ignored`);
  }
  for (const path of ["apps/web/clean.css", "packages/editor/editor.ts"]) {
    assert.ok(!isIgnored(path), `${path} is scanned`);
  }
});

test("allowed values come from the project's own tokens.json and layers.ts", (t) => {
  const directory = tempProject(t, {
    "apps/web/local.css": ".a { z-index: 3; padding: 16px; }\n.b { z-index: 2; padding: 12px; }\n",
  });
  // A project-local design source with an 8-px grid and the single layer z-index 3.
  writeFileSync(
    join(directory, "packages", "ui-kit", "tokens.json"),
    JSON.stringify({ colours: { accent: "#8fbfaf" }, spacing: { "space-8": "8px" } }),
  );
  writeFileSync(
    join(directory, "packages", "ui-kit", "layers.ts"),
    'export const LAYERS = [{ name: "only-layer", order: "1", zIndex: 3 }] as const;\n',
  );
  const result = checkProject(directory);
  assert.deepEqual(
    result.findings.map((finding) => [finding.line, finding.rule]),
    [
      [2, RULES.OFF_GRID_SPACING],
      [2, RULES.Z_INDEX],
    ],
  );
});

test("--task requires the before and after screenshots", (t) => {
  const directory = tempProject(t, { "apps/web/clean.css": ".a { color: var(--fg); }\n" });
  const missing = checkProject(directory, { task: "P1-99" });
  assert.equal(missing.findings.length, 2);
  assert.ok(missing.findings.every((finding) => finding.rule === RULES.MISSING_EVIDENCE));
  assert.deepEqual(
    missing.findings.map((finding) => [finding.file, finding.line]),
    [
      ["reviews/evidence", 0],
      ["reviews/evidence", 0],
    ],
  );
  const messages = missing.findings.map((finding) => finding.message).sort();
  assert.ok(messages[0].includes("P1-99-after-*.png"));
  assert.ok(messages[1].includes("P1-99-before-*.png"));

  writeFiles(directory, {
    "reviews/evidence/P1-99-before-1440.png": "",
    "reviews/evidence/P1-99-after-390.png": "",
  });
  assert.deepEqual(checkProject(directory, { task: "P1-99" }).findings, []);
});

test("an empty project is clean", () => {
  const result = checkProject(join(FIXTURES, "empty"), { source: SOURCE });
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.files, 0);
});

test("missing design source is a configuration error", (t) => {
  const directory = tempDir(t);
  assert.throws(() => loadDesignSource(directory), ConfigError);
  const result = runCli([directory]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /tokens\.json/);
});

test("the CLI reports findings as file:line: rule and supports --json", (t) => {
  const directory = tempProject(t, {
    "apps/web/bad.css": ".bad { color: #ff0000; margin: 5px; z-index: 42; }\n",
  });
  const human = runCli([directory]);
  assert.equal(human.status, 1);
  const lines = human.stdout.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^apps\/web\/bad\.css:1: off-grid-spacing: /);
  assert.match(lines[1], /^apps\/web\/bad\.css:1: raw-colour: /);
  assert.match(lines[2], /^apps\/web\/bad\.css:1: z-index: /);

  const json = runCli([directory, "--json"]);
  assert.equal(json.status, 1);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.findings.length, 3);
  assert.equal(parsed.summary.findings, 3);
  assert.equal(parsed.summary.files, 1);
  assert.equal(parsed.task, null);
  assert.equal(runCli([directory]).stdout, human.stdout, "output is deterministic");
});

test("the CLI exits 0 on the repository and with JSON", () => {
  const human = runCli(["."]);
  assert.equal(human.status, 0);
  assert.equal(human.stdout, "");
  const json = runCli([".", "--json"]);
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout).findings, []);
});

test("the CLI validates its arguments and the root", () => {
  const unknown = runCli(["--wat"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage: node tools\/design-check\/index\.mjs/);
  const badTask = runCli([".", "--task", "../escape"]);
  assert.equal(badTask.status, 2);
  const missingRoot = runCli([join(FIXTURES, "does-not-exist")]);
  assert.equal(missingRoot.status, 2);
});
