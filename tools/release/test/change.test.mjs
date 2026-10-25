import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CHANGE_CLI, createRepo, runCli, writeFile } from "./helpers.mjs";

test("writes a deterministic entry from flags", (t) => {
  const repo = createRepo(t);
  const result = runCli(
    CHANGE_CLI,
    ["--task", "P0-14", "--area", "tooling", "--kind", "patch", "Change entries and changelog gate"],
    repo,
  );
  assert.equal(result.status, 0, result.stderr);
  const file = join(repo, ".changes", "P0-14-change-entries-and-changelog-gate.md");
  assert.equal(
    readFileSync(file, "utf8"),
    "area: tooling\nkind: patch\n\nChange entries and changelog gate\n",
  );
  assert.match(result.stdout, /wrote \.changes\/P0-14-change-entries-and-changelog-gate\.md/);
});

test("derives the task id from the branch and accepts positional arguments", (t) => {
  const repo = createRepo(t, { branch: "task/P0-07" });
  const result = runCli(
    CHANGE_CLI,
    ["web", "patch", "Panel overlays the canvas instead of shrinking it"],
    repo,
  );
  assert.equal(result.status, 0, result.stderr);
  const file = join(repo, ".changes", "P0-07-panel-overlays-the-canvas-instead-of-shrinking-it.md");
  assert.equal(
    readFileSync(file, "utf8"),
    "area: web\nkind: patch\n\nPanel overlays the canvas instead of shrinking it\n",
  );
});

test("defaults the kind to patch", (t) => {
  const repo = createRepo(t);
  const result = runCli(CHANGE_CLI, ["--task", "P0-14", "--area", "web", "Panel overlays the canvas"], repo);
  assert.equal(result.status, 0, result.stderr);
  const file = join(repo, ".changes", "P0-14-panel-overlays-the-canvas.md");
  assert.match(readFileSync(file, "utf8"), /^area: web\nkind: patch\n/);
});

test("refuses unknown areas and kinds without writing a file", (t) => {
  const repo = createRepo(t);
  const badArea = runCli(CHANGE_CLI, ["--task", "P0-14", "--area", "design", "patch", "Summary text"], repo);
  assert.equal(badArea.status, 2);
  assert.match(badArea.stderr, /unknown area 'design'/);
  const badKind = runCli(CHANGE_CLI, ["--task", "P0-14", "--area", "web", "--kind", "feature", "Summary text"], repo);
  assert.equal(badKind.status, 2);
  assert.match(badKind.stderr, /unknown kind 'feature'/);
});

test("refuses invalid task ids, missing and multi-line summaries", (t) => {
  const repo = createRepo(t);
  const badTask = runCli(CHANGE_CLI, ["--task", "P0 14", "--area", "web", "Summary text"], repo);
  assert.equal(badTask.status, 2);
  const noSummary = runCli(CHANGE_CLI, ["--task", "P0-14", "--area", "web"], repo);
  assert.equal(noSummary.status, 2);
  assert.match(noSummary.stderr, /missing summary/);
  const multiLine = runCli(CHANGE_CLI, ["--task", "P0-14", "--area", "web", "First line\nSecond line"], repo);
  assert.equal(multiLine.status, 2);
  assert.match(multiLine.stderr, /one line/);
  const header = runCli(CHANGE_CLI, ["--task", "P0-14", "--area", "web", "## 0.0.1 release"], repo);
  assert.equal(header.status, 2);
  assert.match(header.stderr, /release header/);
});

test("refuses a task id when the branch is not task/<ID>", (t) => {
  const repo = createRepo(t);
  const result = runCli(CHANGE_CLI, ["web", "patch", "Summary text"], repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot determine task id/);
});

test("refuses to overwrite an entry unless --force is passed", (t) => {
  const repo = createRepo(t);
  const args = ["--task", "P0-14", "--area", "tooling", "Overwrite guard"];
  assert.equal(runCli(CHANGE_CLI, args, repo).status, 0);
  const second = runCli(CHANGE_CLI, args, repo);
  assert.equal(second.status, 2);
  assert.match(second.stderr, /already exists/);
  const forced = runCli(CHANGE_CLI, ["--force", ...args], repo);
  assert.equal(forced.status, 0, forced.stderr);
});

test("ignores a -- separator forwarded by a package manager", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  const result = runCli(CHANGE_CLI, ["--", "tooling", "patch", "Separator form"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(repo, ".changes", "P0-14-separator-form.md"), "utf8"),
    "area: tooling\nkind: patch\n\nSeparator form\n",
  );
  const forced = runCli(CHANGE_CLI, ["--", "--force", "tooling", "patch", "Separator form"], repo);
  assert.equal(forced.status, 0, forced.stderr);
});

test("never edits CHANGELOG.md", (t) => {
  const repo = createRepo(t);
  const changelog = join(repo, "CHANGELOG.md");
  writeFile(changelog, "# Changelog\n\n## 0.0.1 – unreleased\n");
  assert.equal(runCli(CHANGE_CLI, ["--task", "P0-14", "--area", "tooling", "Writer check"], repo).status, 0);
  assert.equal(readFileSync(changelog, "utf8"), "# Changelog\n\n## 0.0.1 – unreleased\n");
});
