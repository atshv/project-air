#!/usr/bin/env node
/**
 * P6-10: the one-command e2e environment on the slot ports.
 *
 * Playwright starts this file as its `webServer` (see
 * `apps/web/playwright.config.mjs`). It:
 *
 *  1. reads `.polier-slot` (ports, database; slot 0 and foreign worktrees are
 *     refused) and the gitignored `infra/compose/.env` credentials,
 *  2. resets and migrates only this slot's database (`tools/dev/reset-db`) so a
 *     second run passes without manual steps,
 *  3. starts `services/auth` (gated test-session mode, `NODE_ENV=test`),
 *     `services/platform` and `services/sync` on the slot ports,
 *  4. mints two HMAC test sessions and seeds one deterministic account pair, a
 *     workspace (account B as editor) and a board with fixed UUIDv7 ids,
 *  5. serves the built app with the same-origin `/v1` HTTP + WebSocket proxies
 *     on the slot's `web-e2e` port (`tools/dev/e2e-server.mjs`) and writes the
 *     gitignored state file the specs read,
 *  6. on SIGTERM/SIGINT closes the server, stops only the processes it started
 *     and deletes the seeded rows (including the run's boards and sync log).
 *
 * It needs Docker/Compose (PostgreSQL from the shared stack) and the built
 * artifacts: `pnpm install`, `bash packages/engine/tools/build-wasm.sh`,
 * `pnpm build`. Prints one `e2e-env: ready ...` line when the gate may start.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createE2eServer } from "./e2e-server.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SLOT_FILE = path.join(REPOSITORY_ROOT, ".polier-slot");
const ENV_FILE = path.join(REPOSITORY_ROOT, "infra", "compose", ".env");
const COMPOSE_FILE = path.join(REPOSITORY_ROOT, "infra", "compose", "compose.yaml");
const DIST_DIR = path.join(REPOSITORY_ROOT, "apps", "web", "dist");
const WASM_DIR = path.join(REPOSITORY_ROOT, "packages", "engine", "build-wasm");
const STATE_FILE = path.join(REPOSITORY_ROOT, "apps", "web", "e2e", ".state", "env.json");

/** Fixed UUIDv7 seeds: the specs and the assertions use these constants. */
const ACCOUNTS = [
  {
    accountId: "0192f0a1-7000-7000-8000-000000000001",
    email: "alpha@e2e.project-air.invalid",
    displayName: "E2E Alpha",
    password: "e2e-password-alpha",
  },
  {
    accountId: "0192f0a1-7000-7000-8000-000000000002",
    email: "beta@e2e.project-air.invalid",
    displayName: "E2E Beta",
    password: "e2e-password-beta",
  },
];
const WORKSPACE_ID = "0192f0a2-7000-7000-8000-000000000010";
const WORKSPACE_NAME = "E2E workspace";
const SEEDED_BOARD_ID = "0192f0a3-7000-7000-8000-000000000020";
const SEEDED_BOARD_TITLE = "E2E seeded board";
const TEST_SESSION_TTL_SECONDS = 3_600;

class EnvironmentError extends Error {}

function log(message) {
  process.stdout.write(`e2e-env: ${message}\n`);
}

function fail(message) {
  process.stderr.write(`e2e-env: ${message}\n`);
  process.exit(2);
}

function parseEnvironmentFile(file) {
  const values = {};
  if (!existsSync(file)) {
    return values;
  }
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
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
      if (value.endsWith(value[0])) {
        value = value.slice(1, -1);
      }
    }
    values[key] = value;
  }
  return values;
}

function readSlot() {
  if (!existsSync(SLOT_FILE)) {
    throw new EnvironmentError("no .polier-slot in this worktree; run: python3 $POLIER/tools/worktree.py start <ID>");
  }
  const slot = JSON.parse(readFileSync(SLOT_FILE, "utf8"));
  if (!Number.isInteger(slot.slot) || slot.slot < 1) {
    throw new EnvironmentError(".polier-slot has no positive slot; refusing slot 0");
  }
  if (typeof slot.worktree === "string" && path.resolve(slot.worktree) !== REPOSITORY_ROOT) {
    throw new EnvironmentError(`.polier-slot belongs to ${slot.worktree}, not ${REPOSITORY_ROOT}`);
  }
  for (const portName of ["web-e2e", "platform", "auth", "sync"]) {
    const port = slot.ports?.[portName];
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new EnvironmentError(`.polier-slot has no valid ports.${portName}`);
    }
  }
  if (typeof slot.db_name !== "string" || !slot.db_name.endsWith(`_slot_${slot.slot}`)) {
    throw new EnvironmentError(".polier-slot has no db_name for its slot");
  }
  return slot;
}

function databaseUrls(local) {
  const host = process.env.PGHOST ?? local.POSTGRES_HOST ?? "127.0.0.1";
  const port = process.env.PGPORT ?? local.POSTGRES_HOST_PORT ?? "5433";
  const user = process.env.PGUSER ?? local.POSTGRES_USER ?? "projectair";
  const password = process.env.PGPASSWORD ?? local.POSTGRES_PASSWORD ?? "projectair_local_only";
  const appPassword = process.env.APP_USER_PASSWORD ?? local.APP_USER_PASSWORD ?? "";
  if (appPassword === "") {
    throw new EnvironmentError("APP_USER_PASSWORD is missing; run: bash tools/dev/setup");
  }
  const encode = (value) => encodeURIComponent(value);
  return {
    owner: `postgresql://${encode(user)}:${encode(password)}@${host}:${port}`,
    appUser: `postgresql://app_user:${encode(appPassword)}@${host}:${port}`,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: REPOSITORY_ROOT, encoding: "utf8", timeout: 240_000, ...options });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-8).join("\n");
    throw new EnvironmentError(`${command} ${args.join(" ")} failed${output === "" ? "" : `:\n${output}`}`);
  }
  return result;
}

/** Runs SQL against the slot database through the compose postgres container. */
function runSql(databaseName, sql) {
  const result = spawnSync(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "exec", "-T", "-e", `E2E_DB=${databaseName}`, "postgres", "sh", "-c",
      'psql -U "$POSTGRES_USER" -d "$E2E_DB" -v ON_ERROR_STOP=1 -q -A -t'],
    { cwd: REPOSITORY_ROOT, input: sql, encoding: "utf8", timeout: 60_000 },
  );
  if (result.status !== 0) {
    const output = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim().split("\n").slice(-8).join("\n");
    throw new EnvironmentError(`seeding the slot database failed${output === "" ? "" : `:\n${output}`}`);
  }
  return result.stdout ?? "";
}

function cleanupSql(databaseName, workspaceId, accountIds) {
  const quoted = accountIds.map((id) => `'${id}'`).join(", ");
  return `BEGIN;
DELETE FROM sync_updates WHERE board_id IN (SELECT id FROM app.boards WHERE workspace_id = '${workspaceId}');
DELETE FROM sync_snapshots WHERE board_id IN (SELECT id FROM app.boards WHERE workspace_id = '${workspaceId}');
DELETE FROM app.boards WHERE workspace_id = '${workspaceId}';
DELETE FROM app.notes WHERE workspace_id = '${workspaceId}';
DELETE FROM app.workspaces WHERE id = '${workspaceId}';
DELETE FROM app.profiles WHERE account_id IN (${quoted});
COMMIT;
`;
}

function seedSql() {
  return `BEGIN;
DELETE FROM sync_updates WHERE board_id IN (SELECT id FROM app.boards WHERE workspace_id = '${WORKSPACE_ID}');
DELETE FROM sync_snapshots WHERE board_id IN (SELECT id FROM app.boards WHERE workspace_id = '${WORKSPACE_ID}');
DELETE FROM app.boards WHERE workspace_id = '${WORKSPACE_ID}';
DELETE FROM app.notes WHERE workspace_id = '${WORKSPACE_ID}';
DELETE FROM app.workspaces WHERE id = '${WORKSPACE_ID}';
DELETE FROM app.profiles WHERE account_id IN ('${ACCOUNTS[0].accountId}', '${ACCOUNTS[1].accountId}');
INSERT INTO app.profiles (account_id, display_name) VALUES
  ('${ACCOUNTS[0].accountId}', '${ACCOUNTS[0].displayName}'),
  ('${ACCOUNTS[1].accountId}', '${ACCOUNTS[1].displayName}');
INSERT INTO app.workspaces (id, name, owner_account_id) VALUES
  ('${WORKSPACE_ID}', '${WORKSPACE_NAME}', '${ACCOUNTS[0].accountId}');
INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES
  ('${WORKSPACE_ID}', '${ACCOUNTS[1].accountId}', 'editor');
INSERT INTO app.boards (id, workspace_id, owner_account_id, title, visibility) VALUES
  ('${SEEDED_BOARD_ID}', '${WORKSPACE_ID}', '${ACCOUNTS[0].accountId}', '${SEEDED_BOARD_TITLE}', 'private');
COMMIT;
`;
}

function startService(label, entry, environment) {
  const child = spawn(process.execPath, [entry], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const service = { label, child, output: "" };
  child.stdout.on("data", (chunk) => {
    service.output = `${service.output}${chunk}`.slice(-8_000);
  });
  child.stderr.on("data", (chunk) => {
    service.output = `${service.output}${chunk}`.slice(-8_000);
  });
  return service;
}

async function waitForHealth(service, url) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null) {
      throw new EnvironmentError(`${service.label} exited before becoming healthy:\n${service.output.trim().split("\n").slice(-10).join("\n")}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new EnvironmentError(`${service.label} did not become healthy at ${url}:\n${service.output.trim().split("\n").slice(-10).join("\n")}`);
}

async function mintTestSession(authUrl, account) {
  const response = await fetch(`${authUrl}/test/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: account.accountId, ttlSeconds: TEST_SESSION_TTL_SECONDS }),
  });
  if (!response.ok) {
    throw new EnvironmentError(`the auth service refused the test session for ${account.email} (HTTP ${response.status})`);
  }
  const body = await response.json();
  const token = body?.data?.session;
  if (typeof token !== "string" || token === "") {
    throw new EnvironmentError("the auth service returned no test session token");
  }
  return token;
}

async function stopService(service) {
  if (service.child.exitCode !== null) {
    return;
  }
  service.child.kill("SIGTERM");
  await new Promise((resolveStop) => {
    const timer = setTimeout(resolveStop, 5_000);
    service.child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

let databaseName = "";
let shuttingDown = false;
let server = null;
const services = [];

async function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log("shutting down (server, services, seeded rows)");
  if (server !== null) {
    await server.close().catch(() => undefined);
  }
  for (const service of services.reverse()) {
    await stopService(service);
  }
  try {
    runSql(databaseName, cleanupSql(databaseName, WORKSPACE_ID, ACCOUNTS.map((account) => account.accountId)));
    log("seeded rows and the run's sync log removed");
  } catch (error) {
    process.stderr.write(`e2e-env: teardown cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  rmSync(STATE_FILE, { force: true });
  process.exit(code);
}

async function main() {
  const slot = readSlot();
  databaseName = slot.db_name;
  const local = parseEnvironmentFile(ENV_FILE);
  const urls = databaseUrls(local);
  const webE2ePort = slot.ports["web-e2e"];
  const platformPort = slot.ports.platform;
  const authPort = slot.ports.auth;
  const syncPort = slot.ports.sync;

  for (const [label, entry] of [
    ["auth", path.join(REPOSITORY_ROOT, "services", "auth", "dist", "index.js")],
    ["platform", path.join(REPOSITORY_ROOT, "services", "platform", "dist", "index.js")],
    ["sync", path.join(REPOSITORY_ROOT, "services", "sync", "dist", "index.js")],
  ]) {
    if (!existsSync(entry)) {
      throw new EnvironmentError(`${label} is not built (${entry}); run pnpm build`);
    }
  }
  for (const [label, entry] of [
    ["the built web app", path.join(DIST_DIR, "index.html")],
    ["the engine wasm artifacts", path.join(WASM_DIR, "engine.js")],
  ]) {
    if (!existsSync(entry)) {
      throw new EnvironmentError(`${label} is missing (${entry}); run bash packages/engine/tools/build-wasm.sh and pnpm build`);
    }
  }

  log(`slot ${slot.slot} | database ${databaseName} | web-e2e ${webE2ePort} | platform ${platformPort} | auth ${authPort} | sync ${syncPort}`);

  log("resetting and migrating the slot database (tools/dev/reset-db)");
  run("bash", [path.join(REPOSITORY_ROOT, "tools", "dev", "reset-db")]);

  const authUrl = `http://127.0.0.1:${authPort}`;
  const platformUrl = `http://127.0.0.1:${platformPort}`;
  const syncUrl = `http://127.0.0.1:${syncPort}`;

  log("starting auth (test mode), platform and sync from the built services");
  const auth = startService("auth", path.join(REPOSITORY_ROOT, "services", "auth", "dist", "index.js"), {
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    AUTH_PORT: String(authPort),
    DATABASE_URL: `${urls.owner}/${databaseName}`,
    AUTH_SESSION_SECRET: "e2e-test-session-secret-not-a-production-value",
    // Test mode never calls Kratos; the values satisfy the fail-fast config.
    KRATOS_PUBLIC_URL: "http://127.0.0.1:1",
    KRATOS_ADMIN_URL: "http://127.0.0.1:1",
    KRATOS_ADMIN_TOKEN: "e2e-kratos-admin-token-not-a-secret",
    AUTH_TEST_MODE: "1",
  });
  services.push(auth);
  await waitForHealth(auth, `${authUrl}/health`);

  const platform = startService("platform", path.join(REPOSITORY_ROOT, "services", "platform", "dist", "index.js"), {
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    PORT: String(platformPort),
    DATABASE_URL: `${urls.owner}/${databaseName}`,
    APP_DATABASE_URL: `${urls.appUser}/${databaseName}`,
    AUTH_SERVICE_URL: authUrl,
  });
  services.push(platform);
  await waitForHealth(platform, `${platformUrl}/health/ready`);

  const sync = startService("sync", path.join(REPOSITORY_ROOT, "services", "sync", "dist", "index.js"), {
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    SYNC_PORT: String(syncPort),
    DATABASE_URL: `${urls.owner}/${databaseName}`,
    AUTH_SERVICE_URL: authUrl,
    PLATFORM_SERVICE_URL: platformUrl,
  });
  services.push(sync);
  await waitForHealth(sync, `${syncUrl}/health`);

  const accounts = [];
  for (const account of ACCOUNTS) {
    accounts.push({ ...account, token: await mintTestSession(authUrl, account) });
  }
  log(`minted ${accounts.length} test-mode sessions`);

  log("seeding accounts, workspace, membership and board with fixed ids");
  runSql(databaseName, seedSql());

  server = await createE2eServer({
    distDir: DIST_DIR,
    wasmDir: WASM_DIR,
    targets: {
      auth: { host: "127.0.0.1", port: authPort },
      platform: { host: "127.0.0.1", port: platformPort },
      sync: { host: "127.0.0.1", port: syncPort },
    },
    accounts,
    port: webE2ePort,
  });

  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(
    STATE_FILE,
    `${JSON.stringify(
      {
        baseURL: server.url,
        workspaceId: WORKSPACE_ID,
        workspaceName: WORKSPACE_NAME,
        seededBoardId: SEEDED_BOARD_ID,
        seededBoardTitle: SEEDED_BOARD_TITLE,
        accounts: accounts.map((account) => ({
          accountId: account.accountId,
          email: account.email,
          displayName: account.displayName,
          password: account.password,
          token: account.token,
        })),
      },
      null,
      2,
    )}\n`,
  );

  for (const service of services) {
    service.child.once("exit", (code, signal) => {
      if (!shuttingDown) {
        process.stderr.write(`e2e-env: ${service.label} exited unexpectedly (code ${code}, signal ${signal})\n`);
        void shutdown(1);
      }
    });
  }
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));

  log(`ready at ${server.url} (stop with SIGTERM; the suite cleans up after itself)`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof EnvironmentError) {
    fail(message);
  }
  fail(`unexpected failure: ${message}`);
});
