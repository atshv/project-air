import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CHECK_CLI,
  commitAll,
  createRepo,
  entryBody,
  runCli,
  writeFile,
} from "./helpers.mjs";

test("fails on a committed code change without an entry", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  writeFile(join(repo, "tools/example/index.mjs"), "export const value = 1;\n");
  commitAll(repo, "add example tool");
  const result = runCli(CHECK_CLI, ["--base", "main"], repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing entry for P0-14/);
  assert.match(result.stdout, /\.changes\/P0-14-/);
  assert.match(result.stdout, /tools\/example\/index\.mjs/);
});

test("passes with a matching entry", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  writeFile(join(repo, "tools/example/index.mjs"), "export const value = 1;\n");
  writeFile(join(repo, ".changes", "P0-14-example-tool.md"), entryBody({ summary: "Add an example tool" }));
  commitAll(repo, "add example tool with entry");
  const result = runCli(CHECK_CLI, ["--base", "main"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /changelog-entry: OK \(\.changes\/P0-14-example-tool\.md\)/);
});

test("passes for docs-only changes", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  writeFile(join(repo, "docs", "notes.md"), "# Notes\n");
  writeFile(join(repo, "AGENTS.md"), "# Agents\n");
  commitAll(repo, "documentation only");
  const result = runCli(CHECK_CLI, ["--base", "main"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no code changes/);
});

test("passes with the owner exception and the reason", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  writeFile(join(repo, "packages/contracts/index.ts"), "export const contract = {};\n");
  commitAll(repo, "code without entry");
  const result = runCli(
    CHECK_CLI,
    ["--base", "main", "--no-changelog", "owner approved: build-only change"],
    repo,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-changelog: owner approved: build-only change/);
});

test("rejects --no-changelog without a reason", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  writeFile(join(repo, "packages/contracts/index.ts"), "export const contract = {};\n");
  commitAll(repo, "code without entry");
  const missing = runCli(CHECK_CLI, ["--base", "main", "--no-changelog"], repo);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /non-empty reason/);
  const empty = runCli(CHECK_CLI, ["--base", "main", "--no-changelog", ""], repo);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /non-empty reason/);
});

test("detects uncommitted working-tree code changes", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  writeFile(join(repo, "services/platform/src/index.ts"), "export const server = true;\n");
  const result = runCli(CHECK_CLI, ["--base", "main"], repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /services\/platform\/src\/index\.ts/);
});

test("requires an entry for a changed root manifest", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  writeFile(join(repo, "package.json"), '{\n  "name": "fixture",\n  "version": "0.0.2"\n}\n');
  commitAll(repo, "bump root manifest");
  const withoutEntry = runCli(CHECK_CLI, ["--base", "main"], repo);
  assert.equal(withoutEntry.status, 1);
  assert.match(withoutEntry.stdout, /package\.json/);
  writeFile(join(repo, ".changes", "P0-14-root-manifest.md"), entryBody({ summary: "Bump the root manifest" }));
  commitAll(repo, "add entry");
  const withEntry = runCli(CHECK_CLI, ["--base", "main"], repo);
  assert.equal(withEntry.status, 0, withEntry.stderr);
});

test("fails on an invalid entry", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  writeFile(join(repo, "tools/example/index.mjs"), "export const value = 1;\n");
  writeFile(join(repo, ".changes", "P0-14-invalid.md"), entryBody({ area: "design" }));
  commitAll(repo, "code with invalid entry");
  const result = runCli(CHECK_CLI, ["--base", "main"], repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /invalid entry for P0-14/);
  assert.match(result.stdout, /unknown area 'design'/);
});

test("fails when a task has more than one entry", (t) => {
  const repo = createRepo(t, { branch: "task/P0-14" });
  writeFile(join(repo, "tools/example/index.mjs"), "export const value = 1;\n");
  writeFile(join(repo, ".changes", "P0-14-first.md"), entryBody({ summary: "First entry" }));
  writeFile(join(repo, ".changes", "P0-14-second.md"), entryBody({ summary: "Second entry" }));
  commitAll(repo, "code with two entries");
  const result = runCli(CHECK_CLI, ["--base", "main"], repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /exactly one is allowed/);
});

test("exits 2 for usage and configuration errors", (t) => {
  const repo = createRepo(t);
  const missingBase = runCli(CHECK_CLI, ["--task", "P0-14", "--base", "does-not-exist"], repo);
  assert.equal(missingBase.status, 2);
  assert.match(missingBase.stderr, /base branch not found/);
  const noTaskId = runCli(CHECK_CLI, ["--base", "main"], repo);
  assert.equal(noTaskId.status, 2);
  assert.match(noTaskId.stderr, /cannot determine task id/);
  const unknownOption = runCli(CHECK_CLI, ["--wat"], repo);
  assert.equal(unknownOption.status, 2);
  assert.match(unknownOption.stderr, /unknown option/);

  const notARepo = mkdtempSync(join(tmpdir(), "project-air-not-a-repo-"));
  t.after(() => rmSync(notARepo, { recursive: true, force: true }));
  const outsideGit = runCli(CHECK_CLI, ["--task", "P0-14", "--base", "main"], notARepo);
  assert.equal(outsideGit.status, 2);
  assert.match(outsideGit.stderr, /not inside a git repository/);
});

test("accepts an explicit --task on a branch that is not task/<ID>", (t) => {
  const repo = createRepo(t, { branch: "feature/shared-contracts" });
  writeFile(join(repo, "infra", "compose", "compose.yaml"), "services: {}\n");
  commitAll(repo, "change infra");
  const result = runCli(CHECK_CLI, ["--base", "main", "--task", "P0-14"], repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing entry for P0-14/);
});
