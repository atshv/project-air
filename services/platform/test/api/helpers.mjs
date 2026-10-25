/**
 * api-tests helpers: reset the slot database, spawn the auth service (test
 * mode) on an ephemeral port, build the platform app with the real app_user
 * pool and auth client, and provide small request/mint helpers.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

import pg from "pg";

import { AuthSessionClient } from "../../src/auth/session.ts";
import { migrate } from "../../src/db/migrate.ts";
import { createPool } from "../../src/db/pool.ts";
import { createApp } from "../../src/http/app.ts";
import { silentLogger } from "../../src/log.ts";
import { appDatabaseUrl, databaseUrl, repositoryRoot } from "../helpers/slot.mjs";

const { Client } = pg;

/** Drops the application schema and the migration bookkeeping, then migrates. */
export async function resetSlotDatabase() {
  const client = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS app CASCADE");
    await client.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await client.end();
  }
  await migrate({ connectionString: databaseUrl() });
}

export async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  await once(server, "close");
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return address.port;
}

async function waitForHealth(url, attempts = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
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
  throw new Error(`service did not become healthy: ${url}`);
}

export async function startAuthService(options) {
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    AUTH_PORT: String(options.port),
    DATABASE_URL: databaseUrl(),
    AUTH_SESSION_SECRET: "s".repeat(32),
    // Test mode accepts x-test-session and never calls Kratos; the URLs and
    // admin token only satisfy the fail-fast configuration.
    KRATOS_PUBLIC_URL: "http://127.0.0.1:1",
    KRATOS_ADMIN_URL: "http://127.0.0.1:1",
    KRATOS_ADMIN_TOKEN: "t".repeat(16),
    AUTH_TEST_MODE: "1",
  };
  const child = spawn(process.execPath, ["services/auth/src/index.ts"], {
    cwd: repositoryRoot(),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const baseUrl = `http://127.0.0.1:${options.port}`;
  try {
    await waitForHealth(`${baseUrl}/health`);
  } catch (error) {
    child.kill();
    throw new Error(`auth service did not start: ${String(error)} ${stderr}`);
  }
  return {
    baseUrl,
    async stop() {
      child.kill();
      await once(child, "exit").catch(() => undefined);
    },
    stderr() {
      return stderr;
    },
  };
}

export async function startPlatform(options) {
  const pool = createPool(options.appDatabaseUrl ?? appDatabaseUrl(), {
    application_name: "project-air-api-tests",
    connectionTimeoutMillis: 3_000,
  });
  const auth = new AuthSessionClient({ baseUrl: options.authServiceUrl });
  const server = createApp({
    serviceName: "platform",
    checkDatabase: async () => {
      await pool.query("SELECT 1");
    },
    logger: silentLogger(),
    api: { pool, auth },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    pool,
    async close() {
      server.close();
      await once(server, "close");
      await pool.end();
    },
  };
}

/** Mints a test session through the auth service (AUTH_TEST_MODE=1). */
export async function mintSession(authServiceUrl, accountId) {
  const response = await fetch(`${authServiceUrl}/test/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  if (response.status !== 201) {
    throw new Error(`could not mint a test session: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  return body.data.session;
}

export async function apiRequest(baseUrl, request) {
  const headers = { ...(request.headers ?? {}) };
  if (request.session !== undefined) {
    headers["x-test-session"] = request.session;
  }
  if (request.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${request.path}`, {
    method: request.method,
    headers,
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
  const text = await response.text();
  let body;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/**
 * Test fixture only: the API has no member routes yet (P3-04), so memberships
 * are inserted directly as the owner. The profile row is created here because
 * membership rows reference it and the invitee has not called the API yet.
 */
export async function grantMembership(workspaceId, accountId, role, displayName) {
  const client = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.profiles (account_id, display_name, locale) VALUES ($1, $2, 'de')
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId, displayName],
    );
    await client.query(
      "INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES ($1, $2, $3)",
      [workspaceId, accountId, role],
    );
  } finally {
    await client.end();
  }
}
