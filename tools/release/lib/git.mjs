/**
 * Minimal git helpers for the release tools. Node built-ins only.
 */

import { spawnSync } from "node:child_process";

/** Run git and return `{ status, stdout, stderr }` with trimmed output. */
export function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: typeof result.status === "number" ? result.status : 2,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/** Absolute path of the repository root, or `null` outside a git repository. */
export function repoRoot(cwd) {
  const result = git(["rev-parse", "--show-toplevel"], cwd);
  return result.status === 0 && result.stdout !== "" ? result.stdout : null;
}

/** Current branch name, or an empty string outside a git repository. */
export function currentBranch(cwd) {
  const result = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return result.status === 0 ? result.stdout : "";
}

/** Task id from a `task/<ID>` branch name, or `null`. */
export function taskFromBranch(branch) {
  const match = /^task\/(.+)$/.exec(String(branch ?? "").trim());
  return match ? match[1] : null;
}
