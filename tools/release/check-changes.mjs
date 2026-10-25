#!/usr/bin/env node
/**
 * `changelog-entry` gate: a code change needs exactly one `.changes/<task-id>-*.md` entry.
 *
 * Usage:
 *   node tools/release/check-changes.mjs [--base main] [--task <ID>] [--no-changelog "<reason>"]
 *
 * Inspected changes: committed changes since `--base` (`<base>...HEAD`) plus the working tree
 * (staged, unstaged and untracked files). Docs, board, STATUS, reviews, tasks and release notes
 * are not code and need no entry.
 *
 * Exit codes: 0 clean (no code change or a matching entry), 1 missing or invalid entry,
 * 2 usage or configuration error. Output is deterministic.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  entryFilesForTask,
  isTaskId,
  normalizeTaskId,
  parseEntry,
} from "./lib/entries.mjs";
import { currentBranch, git, repoRoot, taskFromBranch } from "./lib/git.mjs";
import { isCodePath } from "./lib/policy.mjs";

const USAGE = `Usage:
  node tools/release/check-changes.mjs [--base main] [--task <ID>] [--no-changelog "<reason>"]

Checks the committed changes against --base plus the working tree. Code under
apps/, packages/, services/, tools/, infra/ and the root manifests needs exactly one
.changes/<task-id>-<short-name>.md entry. Docs, board, STATUS, reviews, tasks and release notes
do not count as code. Exit 0 clean, 1 missing/invalid entry, 2 usage or configuration error.
--no-changelog "<reason>" is the owner-only exception and needs a non-empty reason.`;

const MAX_LISTED = 20;

class UsageError extends Error {}

function parseArgs(argv) {
  const parsed = { base: "main", task: null, noChangelog: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base" || arg === "--task") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${arg} needs a value`);
      }
      parsed[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--no-changelog") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--") || value.trim() === "") {
        throw new UsageError("--no-changelog needs a non-empty reason");
      }
      parsed.noChangelog = value.trim();
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option: ${arg}`);
    } else {
      throw new UsageError(`unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

function resolveTask(parsed, root) {
  if (parsed.task !== null) {
    const task = normalizeTaskId(parsed.task);
    if (!isTaskId(task)) {
      throw new UsageError(`invalid task id '${parsed.task}'`);
    }
    return task;
  }
  const branch = currentBranch(root);
  const fromBranch = taskFromBranch(branch);
  if (fromBranch === null) {
    throw new UsageError(
      `cannot determine task id: pass --task <ID> or use a task/<ID> branch (current branch: ${branch})`,
    );
  }
  const task = normalizeTaskId(fromBranch);
  if (!isTaskId(task)) {
    throw new UsageError(`invalid task id '${task}' from branch '${branch}'`);
  }
  return task;
}

/** Union of committed changes since the base, staged/unstaged changes and untracked files. */
function changedFiles(root, base) {
  const sources = [
    git(["diff", "--name-only", "--no-renames", `${base}...HEAD`], root),
    git(["diff", "--name-only", "--no-renames", "HEAD"], root),
    git(["ls-files", "--others", "--exclude-standard"], root),
  ];
  const paths = new Set();
  for (const source of sources) {
    if (source.status !== 0) {
      throw new UsageError(
        `cannot inspect changes against ${base}: ${source.stderr || source.stdout || "git failed"}`,
      );
    }
    for (const line of source.stdout.split("\n")) {
      const path = line.trim();
      if (path !== "") {
        paths.add(path);
      }
    }
  }
  return [...paths].sort();
}

function reportMissing(task, codeFiles) {
  console.log(`changelog-entry: FAIL (missing entry for ${task})`);
  console.log(
    `create .changes/${task}-<short-name>.md, for example: pnpm run change -- <area> <kind> "<summary>"`,
  );
  console.log("code files without a change entry:");
  for (const path of codeFiles.slice(0, MAX_LISTED)) {
    console.log(`  - ${path}`);
  }
  if (codeFiles.length > MAX_LISTED) {
    console.log(`  ... and ${codeFiles.length - MAX_LISTED} more`);
  }
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  const root = repoRoot(process.cwd());
  if (root === null) {
    throw new UsageError("not inside a git repository");
  }
  const task = resolveTask(parsed, root);
  const baseCheck = git(["rev-parse", "--verify", "--quiet", `${parsed.base}^{commit}`], root);
  if (baseCheck.status !== 0) {
    throw new UsageError(`base branch not found: ${parsed.base}`);
  }

  const changed = changedFiles(root, parsed.base);
  const codeFiles = changed.filter(isCodePath);
  console.log(
    `check-changes: task ${task}, base ${parsed.base}, ${changed.length} changed path(s), ${codeFiles.length} code path(s)`,
  );

  if (codeFiles.length === 0) {
    console.log("changelog-entry: OK (no code changes)");
    return 0;
  }
  if (parsed.noChangelog !== null) {
    console.log(`changelog-entry: OK (owner exception no-changelog: ${parsed.noChangelog})`);
    return 0;
  }

  const changesDir = join(root, ".changes");
  const entries = entryFilesForTask(changesDir, task).map((name) => {
    const path = join(changesDir, name);
    const parsedEntry = parseEntry(readFileSync(path, "utf8"));
    return { name, ...parsedEntry };
  });
  if (entries.length === 0) {
    reportMissing(task, codeFiles);
    return 1;
  }
  const invalid = entries.filter((entry) => entry.errors.length > 0);
  if (invalid.length > 0) {
    console.log(`changelog-entry: FAIL (invalid entry for ${task})`);
    for (const entry of invalid) {
      for (const error of entry.errors) {
        console.log(`  .changes/${entry.name}: ${error}`);
      }
    }
    return 1;
  }
  if (entries.length > 1) {
    console.log(`changelog-entry: FAIL (${entries.length} entries for ${task}; exactly one is allowed)`);
    for (const entry of entries) {
      console.log(`  - .changes/${entry.name}`);
    }
    return 1;
  }
  console.log(`changelog-entry: OK (.changes/${entries[0].name})`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  console.error(`check-changes: ${error.message}`);
  process.exit(2);
}
