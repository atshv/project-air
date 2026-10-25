import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AREAS,
  KINDS,
  entryFileName,
  entryFilesForTask,
  isArea,
  isKind,
  isTaskId,
  normalizeTaskId,
  parseEntry,
  renderEntry,
  slugify,
} from "../lib/entries.mjs";
import { isCodePath } from "../lib/policy.mjs";

test("areas and kinds are fixed", () => {
  assert.deepEqual(AREAS, [
    "web",
    "engine",
    "sync",
    "platform",
    "auth",
    "media",
    "ai",
    "contracts",
    "infra",
    "tooling",
  ]);
  assert.deepEqual(KINDS, ["patch", "minor", "major"]);
  assert.equal(isArea("web"), true);
  assert.equal(isArea("Web"), true);
  assert.equal(isArea("design"), false);
  assert.equal(isKind("major"), true);
  assert.equal(isKind("feature"), false);
});

test("task ids are normalized to upper case and validated", () => {
  assert.equal(normalizeTaskId("p0-14"), "P0-14");
  assert.equal(isTaskId("P0-14"), true);
  assert.equal(isTaskId("M03"), true);
  assert.equal(isTaskId("p0 14"), false);
  assert.equal(isTaskId("../P0-14"), false);
});

test("slug is deterministic and stays short", () => {
  assert.equal(slugify("Panel overlays the canvas!"), "panel-overlays-the-canvas");
  assert.equal(slugify("  spaced   words  "), "spaced-words");
  assert.equal(slugify("---"), "");
  const long = slugify("A".repeat(20) + " " + "B".repeat(60));
  assert.ok(long.length <= 60);
  assert.equal(long.endsWith("-"), false);
});

test("entry file name uses the task id and the slug", () => {
  assert.equal(
    entryFileName("p0-14", "Change entries and changelog gate"),
    "P0-14-change-entries-and-changelog-gate.md",
  );
});

test("entry render and parse round-trip", () => {
  const body = renderEntry({ area: "tooling", kind: "patch", summary: "Add the changelog gate" });
  assert.equal(body, "area: tooling\nkind: patch\n\nAdd the changelog gate\n");
  const parsed = parseEntry(body);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.area, "tooling");
  assert.equal(parsed.kind, "patch");
  assert.equal(parsed.summary, "Add the changelog gate");
});

test("parse rejects invalid entries", () => {
  assert.match(parseEntry("").errors[0], /empty/);
  assert.match(parseEntry("kind: patch\n\nSummary").errors[0], /first line/);
  assert.match(parseEntry("area: web\n\nSummary").errors.join(" "), /second line/);
  assert.match(parseEntry("area: design\nkind: patch\n\nSummary").errors.join(" "), /unknown area/);
  assert.match(parseEntry("area: web\nkind: feature\n\nSummary").errors.join(" "), /unknown kind/);
  assert.match(parseEntry("area: web\nkind: patch\n").errors.join(" "), /summary line is missing/);
  assert.match(
    parseEntry("area: web\nkind: patch\n\nFirst line\nSecond line").errors.join(" "),
    /one line/,
  );
  assert.match(
    parseEntry("area: web\nkind: patch\n\n## 0.0.1 release").errors.join(" "),
    /release header/,
  );
});

test("entry files for a task are listed sorted and ignore other files", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "project-air-entries-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "README.md"), "readme\n");
  writeFileSync(join(directory, "TEMPLATE.md"), "template\n");
  writeFileSync(join(directory, "P0-14-change-entries.md"), "entry\n");
  writeFileSync(join(directory, "P0-14-b-gate.md"), "entry\n");
  writeFileSync(join(directory, "P0-03-other-task.md"), "entry\n");
  assert.deepEqual(entryFilesForTask(directory, "P0-14"), [
    "P0-14-b-gate.md",
    "P0-14-change-entries.md",
  ]);
  assert.deepEqual(entryFilesForTask(join(directory, "missing"), "P0-14"), []);
});

test("code paths follow the gate policy", () => {
  for (const path of [
    "apps/web/src/main.ts",
    "packages/ui-kit/tokens.json",
    "services/platform/src/index.ts",
    "tools/release/change.mjs",
    "tools/design-check/test/fixtures/sample.json",
    "infra/compose/compose.yaml",
    "package.json",
    "pnpm-lock.yaml",
    "turbo.json",
    "tsconfig.base.json",
    "eslint.config.mjs",
  ]) {
    assert.equal(isCodePath(path), true, path);
  }
  for (const path of [
    "docs/module-map.md",
    "board.json",
    "STATUS.md",
    "tasks/P0-14.md",
    "reviews/evidence/P0-14-unit.log",
    ".changes/P0-14-change-entries.md",
    "CHANGELOG.md",
    "AGENTS.md",
    "README.md",
  ]) {
    assert.equal(isCodePath(path), false, path);
  }
});
