/**
 * Test helper: finds the slot this worktree owns and builds its database URL.
 *
 * Mirrors the safety rules of `tools/dev/`: refusal of slot 0, refusal of a
 * `.polier-slot` that belongs to another worktree, and no hard-coded database
 * name. The URL is never printed, only handed to `pg`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LOCAL_DATABASE = Object.freeze({
  host: "127.0.0.1",
  port: "5433",
  user: "projectair",
  password: "projectair_local_only",
});

export function repositoryRoot(startDirectory = path.dirname(fileURLToPath(import.meta.url))) {
  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 10; depth += 1) {
    const workspace = path.join(current, "pnpm-workspace.yaml");
    const compose = path.join(current, "infra", "compose", "compose.yaml");
    if (existsSync(workspace) && existsSync(compose)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error("cannot locate the repository root (pnpm-workspace.yaml and infra/compose/compose.yaml)");
}

/** Reads `KEY=value` pairs from a gitignored local env file; comments and blanks are ignored. */
function readEnvironmentFile(file) {
  if (!existsSync(file)) {
    return {};
  }
  const values = {};
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/**
 * Reads `.polier-slot` and refuses dangerous values the same way the shell
 * scripts do: no slot 0, no foreign worktree, no mismatched database name.
 */
export function readSlot(root = repositoryRoot()) {
  const file = path.join(root, ".polier-slot");
  if (!existsSync(file)) {
    throw new Error(`no .polier-slot in ${root}; run python3 $POLIER/tools/slot.py acquire first`);
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!Number.isInteger(data.slot) || data.slot < 1) {
    throw new Error(".polier-slot has no positive slot number; tests never touch slot 0");
  }
  if (typeof data.worktree === "string" && data.worktree !== "" && path.resolve(data.worktree) !== path.resolve(root)) {
    throw new Error(`.polier-slot belongs to ${data.worktree}, not ${root}`);
  }
  if (typeof data.db_name !== "string" || !data.db_name.endsWith(`_slot_${data.slot}`)) {
    throw new Error(".polier-slot has no db_name that belongs to its slot");
  }
  return data;
}

/**
 * `DATABASE_URL` from the environment when set, otherwise the slot owner
 * connection derived from `.polier-slot` and the local Compose defaults.
 */
export function databaseUrl(root = repositoryRoot()) {
  const fromEnvironment = process.env.DATABASE_URL?.trim();
  if (fromEnvironment !== undefined && fromEnvironment !== "") {
    return fromEnvironment;
  }
  const composeEnvironment = readEnvironmentFile(path.join(root, "infra", "compose", ".env"));
  const slot = readSlot(root);
  const host = process.env.PGHOST ?? composeEnvironment.POSTGRES_HOST ?? DEFAULT_LOCAL_DATABASE.host;
  const port = process.env.PGPORT ?? composeEnvironment.POSTGRES_HOST_PORT ?? DEFAULT_LOCAL_DATABASE.port;
  const user = process.env.PGUSER ?? composeEnvironment.POSTGRES_USER ?? DEFAULT_LOCAL_DATABASE.user;
  const password = process.env.PGPASSWORD ?? composeEnvironment.POSTGRES_PASSWORD ?? DEFAULT_LOCAL_DATABASE.password;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${slot.db_name}`;
}

/**
 * Connection of the restricted `app_user` role for the policy tests: the row
 * level security of AD-5 is invisible to the superuser, so the policy smoke has
 * to run as app_user. The password comes from `APP_USER_PASSWORD` or from the
 * gitignored `infra/compose/.env` written by `tools/dev/setup`; it is never
 * printed. The database and host are the slot owner's.
 */
export function appDatabaseUrl(root = repositoryRoot()) {
  const composeEnvironment = readEnvironmentFile(path.join(root, "infra", "compose", ".env"));
  const password = process.env.APP_USER_PASSWORD?.trim() ?? composeEnvironment.APP_USER_PASSWORD ?? "";
  if (password === "") {
    throw new Error(
      "APP_USER_PASSWORD is not set; run bash tools/dev/setup in this worktree so app_user exists with a password",
    );
  }
  const slot = readSlot(root);
  const host = process.env.PGHOST ?? composeEnvironment.POSTGRES_HOST ?? DEFAULT_LOCAL_DATABASE.host;
  const port = process.env.PGPORT ?? composeEnvironment.POSTGRES_HOST_PORT ?? DEFAULT_LOCAL_DATABASE.port;
  return `postgresql://app_user:${encodeURIComponent(password)}@${host}:${port}/${slot.db_name}`;
}

