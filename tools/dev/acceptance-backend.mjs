#!/usr/bin/env node
/**
 * P3-05 backend-core stage acceptance.
 *
 * Self-contained and rerunnable:
 *   1. reads the slot ports/database from `.polier-slot` and the local secrets
 *      from the gitignored `infra/compose/.env`,
 *   2. resets and migrates the slot database (`tools/dev/reset-db`),
 *   3. boots `services/auth` (test-session mode) and `services/platform` as its
 *      own child processes on the slot ports,
 *   4. runs `packages/sdk/scripts/acceptance.mjs`, which drives the API only
 *      through `@project-air/sdk` (account A creates workspace/board/note/card,
 *      lists them; account B sees nothing and gets NOT_FOUND),
 *   5. stops only its own processes and leaves the database migrated and empty.
 *
 * Prints `PASS backend-core acceptance` on success (exit 0), exit 1 on a failed
 * check and exit 2 when the environment/stack is missing. No Docker-managed app
 * server is needed beyond PostgreSQL/Mailpit (the scripts start the Node
 * services themselves).
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const slotFile = path.join(repositoryRoot, ".polier-slot");
const envFile = path.join(repositoryRoot, "infra", "compose", ".env");
const resetScript = path.join(repositoryRoot, "tools", "dev", "reset-db");

class EnvironmentError extends Error {}

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
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readSlot() {
  if (!existsSync(slotFile)) {
    throw new EnvironmentError(".polier-slot is missing; run: python3 $POLIER/tools/slot.py acquire");
  }
  const slot = JSON.parse(readFileSync(slotFile, "utf8"));
  if (!Number.isInteger(slot.slot) || slot.slot < 1) {
    throw new EnvironmentError(".polier-slot has no positive slot; refusing slot 0");
  }
  if (typeof slot.worktree === "string" && path.resolve(slot.worktree) !== repositoryRoot) {
    throw new EnvironmentError(`.polier-slot belongs to ${slot.worktree}, not ${repositoryRoot}`);
  }
  if (!slot.ports || !Number.isInteger(slot.ports.platform) || !Number.isInteger(slot.ports.auth)) {
    throw new EnvironmentError(".polier-slot has no platform/auth ports");
  }
  if (typeof slot.db_name !== "string" || !slot.db_name.endsWith(`_slot_${slot.slot}`)) {
    throw new EnvironmentError(".polier-slot has no db_name for its slot");
  }
  return slot;
}

function databaseUrls(slot) {
  const local = parseEnvironmentFile(envFile);
  const host = process.env.PGHOST ?? local.POSTGRES_HOST ?? "127.0.0.1";
  const port = process.env.PGPORT ?? local.POSTGRES_HOST_PORT ?? "5433";
  const user = process.env.PGUSER ?? local.POSTGRES_USER ?? "projectair";
  const password = process.env.PGPASSWORD ?? local.POSTGRES_PASSWORD ?? "projectair_local_only";
  const appPassword = process.env.APP_USER_PASSWORD ?? local.APP_USER_PASSWORD ?? "";
  if (appPassword === "") {
    throw new EnvironmentError(
      "APP_USER_PASSWORD is missing; run: bash tools/dev/setup (it writes the gitignored infra/compose/.env)",
    );
  }
  const encode = (value) => encodeURIComponent(value);
  return {
    owner: `postgresql://${encode(user)}:${encode(password)}@${host}:${port}/${slot.db_name}`,
    appUser: `postgresql://app_user:${encode(appPassword)}@${host}:${port}/${slot.db_name}`,
  };
}

function runResetDatabase(label) {
  const result = spawnSync("bash", [resetScript], { cwd: repositoryRoot, encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-6).join("\n");
    throw new EnvironmentError(`${label}: tools/dev/reset-db failed${output === "" ? "" : `:\n${output}`}`);
  }
  console.log(`${label}: slot database reset and migrated`);
}

function startService(label, script, environment) {
  const child = spawn(process.execPath, [script], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  return { label, child, output: () => output };
}

async function waitForHealth(service, url, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null) {
      throw new EnvironmentError(`${service.label} exited before becoming healthy:\n${service.output().trim().slice(-800)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new EnvironmentError(`${service.label} did not become healthy at ${url}:\n${service.output().trim().slice(-800)}`);
}

async function stopService(service) {
  if (service.child.exitCode !== null) {
    return;
  }
  service.child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    service.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  console.log("P3-05 backend-core acceptance");
  console.log(`date: ${new Date().toISOString()}`);
  const slot = readSlot();
  const urls = databaseUrls(slot);
  const platformPort = slot.ports.platform;
  const authPort = slot.ports.auth;
  console.log(`slot: ${slot.slot} | database: ${slot.db_name} | platform: ${platformPort} | auth: ${authPort}`);
  console.log();

  const services = [];
  let sdkExitCode = 1;
  try {
    console.log("== 1. reset and migrate the slot database ==");
    runResetDatabase("reset");
    console.log();

    console.log("== 2. boot auth (test mode) and platform from source ==");
    const auth = startService("auth", path.join(repositoryRoot, "services/auth/src/index.ts"), {
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      AUTH_PORT: String(authPort),
      DATABASE_URL: urls.owner,
      AUTH_SESSION_SECRET: randomBytes(32).toString("hex"),
      // Test mode never calls Kratos; the values satisfy the fail-fast config.
      KRATOS_PUBLIC_URL: "http://127.0.0.1:1",
      KRATOS_ADMIN_URL: "http://127.0.0.1:1",
      KRATOS_ADMIN_TOKEN: randomBytes(16).toString("hex"),
      AUTH_TEST_MODE: "1",
    });
    services.push(auth);
    const authUrl = `http://127.0.0.1:${authPort}`;
    await waitForHealth(auth, `${authUrl}/health`);
    console.log(`auth healthy on ${authUrl}`);

    const platform = startService("platform", path.join(repositoryRoot, "services/platform/src/index.ts"), {
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      PORT: String(platformPort),
      DATABASE_URL: urls.owner,
      APP_DATABASE_URL: urls.appUser,
      AUTH_SERVICE_URL: authUrl,
    });
    services.push(platform);
    const platformUrl = `http://127.0.0.1:${platformPort}`;
    await waitForHealth(platform, `${platformUrl}/health/ready`);
    console.log(`platform healthy (app_user role guard passed) on ${platformUrl}`);
    console.log();

    console.log("== 3. SDK acceptance (accounts, resources, isolation) ==");
    const sdk = spawn(process.execPath, [path.join(repositoryRoot, "packages/sdk/scripts/acceptance.mjs")], {
      cwd: repositoryRoot,
      env: { ...process.env, ACCEPTANCE_PLATFORM_URL: platformUrl, ACCEPTANCE_AUTH_URL: authUrl },
      stdio: "inherit",
    });
    sdkExitCode = await new Promise((resolve) => {
      sdk.once("exit", (code) => {
        resolve(code ?? 1);
      });
    });
    console.log();
  } finally {
    for (const service of services.reverse()) {
      await stopService(service);
    }
  }

  console.log("== 4. leave the slot database migrated and empty ==");
  runResetDatabase("cleanup");

  if (sdkExitCode !== 0) {
    console.error(`backend-core acceptance FAILED (SDK exit ${sdkExitCode})`);
    process.exit(1);
  }
  console.log();
  console.log("PASS backend-core acceptance");
  process.exit(0);
}

main().catch((error) => {
  if (error instanceof EnvironmentError) {
    console.error(`acceptance-backend: ${error.message}`);
    process.exit(2);
  }
  console.error(`acceptance-backend: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
