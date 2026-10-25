#!/usr/bin/env node
/**
 * Write one `.changes/` entry for the current task.
 *
 * Usage:
 *   node tools/release/change.mjs --task <ID> --area <area> --kind <kind> "<summary>"
 *   node tools/release/change.mjs <area> <kind> "<summary>"   (task id from branch task/<ID>)
 *
 * Exit codes: 0 written, 2 invalid input or an existing file without --force.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
  AREAS,
  DEFAULT_KIND,
  KINDS,
  entryFileName,
  isArea,
  isKind,
  isTaskId,
  normalizeArea,
  normalizeKind,
  normalizeTaskId,
  renderEntry,
  slugify,
} from "./lib/entries.mjs";
import { currentBranch, repoRoot, taskFromBranch } from "./lib/git.mjs";

const USAGE = `Usage:
  node tools/release/change.mjs --task <ID> --area <area> --kind <kind> "<summary>"
  node tools/release/change.mjs <area> <kind> "<summary>"

Task id: --task, or the current branch task/<ID>.
Areas: ${AREAS.join(", ")}. Kinds: ${KINDS.join(", ")} (default ${DEFAULT_KIND}).
The file is .changes/<task-id>-<short-name>.md; an existing file is only replaced with --force.`;

class UsageError extends Error {}

function parseArgs(argv) {
  const parsed = { task: null, area: null, kind: null, force: false, help: false, positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--task" || arg === "--area" || arg === "--kind") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${arg} needs a value`);
      }
      parsed[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--") {
      // pnpm 12 forwards this separator to the script; ignore it.
      continue;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option: ${arg}`);
    } else {
      parsed.positional.push(arg);
    }
  }
  return parsed;
}

function resolveEntry(parsed) {
  const cwd = process.cwd();
  const root = repoRoot(cwd) ?? cwd;

  let task = parsed.task;
  if (task === null) {
    task = taskFromBranch(currentBranch(root));
    if (task === null) {
      throw new UsageError(
        "cannot determine task id: pass --task <ID> or run on a task/<ID> branch",
      );
    }
  }
  task = normalizeTaskId(task);
  if (!isTaskId(task)) {
    throw new UsageError(`invalid task id '${task}'`);
  }

  const positional = [...parsed.positional];
  let area = parsed.area;
  let kind = parsed.kind;
  if (area === null && positional.length > 0 && isArea(positional[0])) {
    area = positional.shift();
  }
  if (kind === null && positional.length > 0 && isKind(positional[0])) {
    kind = positional.shift();
  }
  const summary = positional.join(" ").trim();

  if (area === null) {
    throw new UsageError(`missing area (allowed: ${AREAS.join(", ")})`);
  }
  if (!isArea(area)) {
    throw new UsageError(`unknown area '${area}' (allowed: ${AREAS.join(", ")})`);
  }
  if (kind === null) {
    kind = DEFAULT_KIND;
  }
  if (!isKind(kind)) {
    throw new UsageError(`unknown kind '${kind}' (allowed: ${KINDS.join(", ")})`);
  }
  if (summary === "") {
    throw new UsageError('missing summary: add one English line, e.g. "Panel overlays the canvas"');
  }
  if (/[\r\n]/.test(summary)) {
    throw new UsageError("summary must be one line");
  }
  if (summary.startsWith("#")) {
    throw new UsageError("summary must not be a release header");
  }
  if (slugify(summary) === "") {
    throw new UsageError("summary must contain letters or digits");
  }

  return {
    root,
    task,
    area: normalizeArea(area),
    kind: normalizeKind(kind),
    summary,
    force: parsed.force,
  };
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  const entry = resolveEntry(parsed);
  const target = resolve(entry.root, ".changes", entryFileName(entry.task, entry.summary));
  const label = relative(entry.root, target) || target;
  if (existsSync(target) && !entry.force) {
    throw new UsageError(`${label} already exists; pass --force to overwrite`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    renderEntry({ area: entry.area, kind: entry.kind, summary: entry.summary }),
    "utf8",
  );
  console.log(`wrote ${label}`);
  console.log(`area: ${entry.area}, kind: ${entry.kind}`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`change: ${error.message}`);
    process.exit(2);
  }
  console.error(`change: ${error.message}`);
  process.exit(2);
}
