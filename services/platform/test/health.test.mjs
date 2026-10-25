/**
 * Health endpoints: liveness answers even while the database is down,
 * readiness answers 503 `INTERNAL` (never 200) when the database ping fails.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

import { createPool, ping, closePool } from "../src/db/pool.ts";
import { createApp } from "../src/http/app.ts";
import { silentLogger } from "../src/log.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function withApp(checkDatabase, run) {
  const server = createApp({ serviceName: "platform", checkDatabase, logger: silentLogger() });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("liveness answers 200 while the database is down", async () => {
  await withApp(
    async () => {
      throw new Error("database down");
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.data, { status: "ok", service: "platform" });
      assert.match(body.requestId, UUID_V7);
    },
  );
});

test("readiness answers 200 when the database ping succeeds", async () => {
  await withApp(
    async () => undefined,
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health/ready`);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data, { status: "ready", service: "platform" });
    },
  );
});

test("readiness answers 503 INTERNAL when the database ping fails", async () => {
  await withApp(
    async () => {
      throw new Error("connection refused");
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health/ready`);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.code, "INTERNAL");
      assert.equal(body.messageKey, "errors.internal");
      assert.match(body.requestId, UUID_V7);
    },
  );
});

test("readiness answers 503 when the database is unreachable", async () => {
  const pool = createPool("postgresql://app_user:pw@127.0.0.1:1/project-air_unreachable", {
    connectionTimeoutMillis: 500,
  });
  try {
    await withApp(
      () => ping(pool, 500),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health/ready`);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "INTERNAL");
      },
    );
  } finally {
    await closePool(pool);
  }
});
