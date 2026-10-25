#!/usr/bin/env node
// CLI for the design rules gate.
//
//   node tools/design-check/index.mjs [root] [--task ID] [--json]
//
// Exit codes: 0 clean, 1 findings, 2 usage or configuration error.
// Deterministic output: one `file:line: rule: message` line per finding, sorted.

import { checkProject, ConfigError, formatFinding } from "./check.mjs";

const USAGE = "usage: node tools/design-check/index.mjs [root] [--task ID] [--json]";

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

function parseArguments(argv) {
  let root = ".";
  let rootSeen = false;
  let task = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--task") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new UsageError("--task needs an ID");
      }
      task = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) throw new UsageError(`unknown option ${argument}`);
    if (rootSeen) throw new UsageError(`unexpected argument ${argument}`);
    root = argument;
    rootSeen = true;
  }
  if (task !== null && !/^[A-Za-z0-9._-]+$/.test(task)) {
    throw new UsageError("--task ID may contain letters, digits, '.', '_' and '-' only");
  }
  return { root, task, json };
}

function main(argv) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`design-check: ${error.message}\n${USAGE}\n`);
    return 2;
  }
  let result;
  try {
    result = checkProject(options.root, { task: options.task });
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`design-check: ${error.message}\n`);
      return 2;
    }
    process.stderr.write(`design-check: unexpected error: ${error.message}\n`);
    return 2;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const finding of result.findings) process.stdout.write(`${formatFinding(finding)}\n`);
  }
  return result.findings.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
