/**
 * Kratos client tests against the stub server and fake fetch responses: cookie
 * forwarding, identity mapping, admin calls, conflict mapping, readiness,
 * timeouts and bad responses. No live Kratos needed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { KratosClient, KratosError } from "../src/kratos.ts";
import { STUB_IDENTITY_ID, startKratosStub } from "./helpers/kratos-stub.mjs";

const COOKIE = "ory_kratos_session=test-cookie-value";

async function withClient(run, options = {}) {
  const stub = await startKratosStub(options);
  const client = new KratosClient({
    publicUrl: stub.publicUrl,
    adminUrl: stub.adminUrl,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  try {
    await run({ stub, client });
  } finally {
    await stub.close();
  }
}

test("whoami returns the mapped identity and forwards the cookie", async () => {
  await withClient(async ({ stub, client }) => {
    const identity = await client.whoami(COOKIE);
    assert.equal(identity.id, STUB_IDENTITY_ID);
    assert.deepEqual(identity.traits, { email: "alice@example.test", displayName: "Alice", locale: "de" });
    const request = stub.requests.find((entry) => entry.url === "/sessions/whoami");
    assert.ok(request !== undefined);
    assert.equal(request.headers.cookie, COOKIE);
  });
});

test("whoami returns null for a missing or expired session", async () => {
  await withClient(
    async ({ client }) => {
      assert.equal(await client.whoami(COOKIE), null);
    },
    { whoami: "unauthorized" },
  );
});

test("whoami rejects an unexpected Kratos status", async () => {
  await withClient(
    async ({ client }) => {
      await assert.rejects(client.whoami(COOKIE), (error) => {
        assert.ok(error instanceof KratosError);
        assert.equal(error.code, "error");
        assert.equal(error.status, 500);
        return true;
      });
    },
    { whoami: "unavailable" },
  );
});

test("createIdentity sends the traits and returns the identity", async () => {
  await withClient(async ({ stub, client }) => {
    const identity = await client.createIdentity({
      email: "bob@example.test",
      displayName: "Bob",
      locale: "en",
    });
    assert.equal(identity.id, STUB_IDENTITY_ID);
    const request = stub.requests.find((entry) => entry.url === "/admin/identities" && entry.method === "POST");
    assert.ok(request !== undefined);
    const body = JSON.parse(request.body);
    assert.equal(body.schema_id, "default");
    assert.deepEqual(body.traits, { email: "bob@example.test", display_name: "Bob", locale: "en" });
  });
});

test("createIdentity maps a duplicate e-mail to conflict", async () => {
  await withClient(
    async ({ client }) => {
      await assert.rejects(client.createIdentity({ email: "alice@example.test", displayName: "Alice" }), (error) => {
        assert.ok(error instanceof KratosError);
        assert.equal(error.code, "conflict");
        return true;
      });
    },
    { createIdentity: "conflict" },
  );
});

test("createRecoveryLink and listIdentities call the admin API", async () => {
  await withClient(async ({ stub, client }) => {
    const link = await client.createRecoveryLink(STUB_IDENTITY_ID);
    assert.match(link.link, /self-service\/recovery/);
    assert.match(link.expiresAt, /^2026-/);

    const identities = await client.listIdentities();
    assert.equal(identities.length, 1);
    assert.equal(identities[0].id, STUB_IDENTITY_ID);
    assert.ok(stub.requests.some((entry) => entry.url === "/admin/recovery/link" && entry.method === "POST"));
  });
});

test("the public flow clients return id and action", async () => {
  await withClient(async ({ client }) => {
    for (const flow of [await client.loginFlow(), await client.registrationFlow(), await client.recoveryFlow()]) {
      assert.equal(flow.id, "flow-1");
      assert.match(flow.action, /^http:\/\/stub\/self-service\//);
    }
  });
});

test("ready is true for a healthy Kratos and false for 503 or a closed port", async () => {
  await withClient(async ({ client }) => {
    assert.equal(await client.ready(), true);
  });

  await withClient(
    async ({ client }) => {
      assert.equal(await client.ready(), false);
      await assert.rejects(client.requireReady(), (error) => {
        assert.ok(error instanceof KratosError);
        assert.equal(error.code, "unavailable");
        return true;
      });
    },
    { ready: false },
  );

  const unreachable = new KratosClient({
    publicUrl: "http://127.0.0.1:1",
    adminUrl: "http://127.0.0.1:1",
    timeoutMs: 500,
  });
  assert.equal(await unreachable.ready(), false);
  await assert.rejects(unreachable.whoami(COOKIE), (error) => {
    assert.ok(error instanceof KratosError);
    assert.equal(error.code, "unavailable");
    return true;
  });
});

test("a slow Kratos times out as unavailable", async () => {
  await withClient(
    async ({ client }) => {
      await assert.rejects(client.whoami(COOKIE), (error) => {
        assert.ok(error instanceof KratosError);
        assert.equal(error.code, "unavailable");
        return true;
      });
    },
    { delayMs: 300, timeoutMs: 50 },
  );
});

test("an invalid JSON body is a bad_response error", async () => {
  const client = new KratosClient({
    publicUrl: "http://127.0.0.1:9",
    adminUrl: "http://127.0.0.1:9",
    fetchImpl: async () => new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(client.whoami(COOKIE), (error) => {
    assert.ok(error instanceof KratosError);
    assert.equal(error.code, "bad_response");
    return true;
  });
});
