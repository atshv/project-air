/**
 * Fixtures for the release-tool tests: temporary git repositories and CLI runners.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHANGE_CLI = fileURLToPath(new URL("../change.mjs", import.meta.url));
export const CHECK_CLI = fileURLToPath(new URL("../check-changes.mjs", import.meta.url));

/** Run a CLI with node and return `{ status, stdout, stderr }`. */
export function runCli(cli, args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: typeof result.status === "number" ? result.status : 2,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Run git in a fixture repository and fail the fixture when git fails. */
export function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return (result.stdout ?? "").trim();
}

export function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function commitAll(repo, message) {
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", message]);
}

/**
 * Create a temporary git repository with an initial commit on `main`.
 * `t.after` removes it; pass `branch` to check out a feature branch first.
 */
export function createRepo(t, { branch = null } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "project-air-release-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  runGit(repo, ["init", "-q", "-b", "main"]);
  runGit(repo, ["config", "user.email", "test@example.com"]);
  runGit(repo, ["config", "user.name", "Project air test"]);
  runGit(repo, ["config", "commit.gpgsign", "false"]);
  writeFile(join(repo, "README.md"), "# fixture repository\n");
  commitAll(repo, "initial commit");
  if (branch !== null) {
    runGit(repo, ["checkout", "-q", "-b", branch]);
  }
  return repo;
}

export function entryBody({ area = "tooling", kind = "patch", summary = "Fixture change" } = {}) {
  return `area: ${area}\nkind: ${kind}\n\n${summary}\n`;
}
