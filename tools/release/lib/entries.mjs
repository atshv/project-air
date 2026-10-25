/**
 * Rules for `.changes/` entries: areas, kinds, file naming and parsing.
 *
 * Node built-ins only. This module is shared by the writer and the changelog gate.
 */

import { readdirSync } from "node:fs";

export const AREAS = [
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
];

export const KINDS = ["patch", "minor", "major"];

export const DEFAULT_KIND = "patch";

const TASK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:-[0-9]+)?$/;
const SLUG_LIMIT = 60;

/** Task ids are upper case in `.changes/` file names, e.g. `P0-14`. */
export function normalizeTaskId(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function isTaskId(value) {
  return TASK_ID_PATTERN.test(String(value ?? "").trim());
}

export function normalizeArea(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeKind(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isArea(value) {
  return AREAS.includes(normalizeArea(value));
}

export function isKind(value) {
  return KINDS.includes(normalizeKind(value));
}

/** Deterministic lower-case slug used in the entry file name. */
export function slugify(summary) {
  return String(summary ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/g, "");
}

export function entryFileName(taskId, summary) {
  return `${normalizeTaskId(taskId)}-${slugify(summary)}.md`;
}

/** The exact body of an entry: area, kind, one English summary line. */
export function renderEntry({ area, kind, summary }) {
  return `area: ${normalizeArea(area)}\nkind: ${normalizeKind(kind)}\n\n${String(summary).trim()}\n`;
}

/**
 * Parse and validate an entry body.
 *
 * Returns `{ area, kind, summary, errors }`; `errors` is empty for a valid entry.
 */
export function parseEntry(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  const errors = [];
  const areaIndex = lines.findIndex((line) => line !== "");
  if (areaIndex === -1) {
    return { area: null, kind: null, summary: null, errors: ["entry is empty"] };
  }
  const areaMatch = /^area:[ \t]*(\S+)$/.exec(lines[areaIndex]);
  if (!areaMatch) {
    errors.push("first line must be 'area: <area>'");
  } else if (!isArea(areaMatch[1])) {
    errors.push(`unknown area '${areaMatch[1]}' (allowed: ${AREAS.join(", ")})`);
  }
  const kindIndex = lines.findIndex((line, index) => index > areaIndex && line !== "");
  const kindMatch = kindIndex === -1 ? null : /^kind:[ \t]*(\S+)$/.exec(lines[kindIndex]);
  if (!kindMatch) {
    errors.push("second line must be 'kind: <kind>'");
  } else if (!isKind(kindMatch[1])) {
    errors.push(`unknown kind '${kindMatch[1]}' (allowed: ${KINDS.join(", ")})`);
  }
  const summaryLines = kindIndex === -1 ? [] : lines.slice(kindIndex + 1).filter((line) => line !== "");
  if (summaryLines.length === 0) {
    errors.push("summary line is missing");
  } else if (summaryLines.length > 1) {
    errors.push("summary must be one line");
  } else if (summaryLines[0].startsWith("#")) {
    errors.push("summary must not be a release header");
  }
  return {
    area: areaMatch ? areaMatch[1] : null,
    kind: kindMatch ? kindMatch[1] : null,
    summary: summaryLines.length === 1 ? summaryLines[0] : null,
    errors,
  };
}

/** Entry file names for one task, sorted; empty when the directory does not exist. */
export function entryFilesForTask(changesDir, taskId) {
  let names = [];
  try {
    names = readdirSync(changesDir);
  } catch {
    return [];
  }
  const prefix = `${normalizeTaskId(taskId)}-`;
  return names
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .filter((name) => normalizeTaskId(name).startsWith(prefix))
    .filter((name) => name.length > prefix.length + 3)
    .sort();
}
