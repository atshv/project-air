/**
 * `GET /session` and the test-session mode against a stub Kratos server:
 * cookie forwarding, AUTH_REQUIRED, 503 when Kratos is unreachable, signed test
 * sessions only outside production and only when enabled.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { mintTestSession } from "../src/test-session.ts";
import { startAuthApp } from "./helpers/auth-app.mjs";
import { STUB_IDENTITY_ID, startKratosStub } from "./helpers/kratos-stub.mjs";

const TEST_SESSION_SECRET = "s".repeat(32);
const ACCOUNT = "0192f0d0-7000-7000-8000-00000000aa01";
const COOKIE = "ory_kratos_session=test-cookie-value";

let stub;
let app;
let testModeApp;

before(async () => {
  stub = await startKratosStub();
  app = await startAuthApp({ publicUrl: stub.publicUrl, adminUrl: stub.adminUrl });
  testModeApp = await startAuthApp({
    publicUrl: stub.publicUrl,
    adminUrl: stub.adminUrl,
    testMode: true,
    testSessionSecret: TEST_SESSION_SECRET,
  });
});

after(async () => {
  await app.close();
  await testModeApp.close();
  await stub.close();
});

test("a valid Kratos session returns the account id, e-mail and display name", async () => {
  const response = await fetch(`${app.baseUrl}/session`, { headers: { cookie: COOKIE } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, {
    accountId: STUB_IDENTITY_ID,
    email: "alice@example.test",
    displayName: "Alice",
  });
  assert.equal(typeof body.requestId, "string");
  const whoami = stub.requests.filter((entry) => entry.url === "/sessions/whoami").at(-1);
  assert.ok(whoami !== undefined);
  assert.equal(whoami.headers.cookie, COOKIE, "the session cookie is forwarded unchanged");
});

test("no session cookie is 401 AUTH_REQUIRED", async () => {
  const response = await fetch(`${app.baseUrl}/session`);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, "AUTH_REQUIRED");
  assert.equal(body.messageKey, "errors.authRequired");
});

test("an invalid or expired Kratos session is 401 AUTH_REQUIRED", async () => {
  stub.state.whoami = "unauthorized";
  try {
    const response = await fetch(`${app.baseUrl}/session`, { headers: { cookie: COOKIE } });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
  } finally {
    stub.state.whoami = "identity";
  }
});

test("an error response from Kratos is a 503 INTERNAL", async () => {
  stub.state.whoami = "unavailable";
  try {
    const response = await fetch(`${app.baseUrl}/session`, { headers: { cookie: COOKIE } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "INTERNAL");
  } finally {
    stub.state.whoami = "identity";
  }
});

test("an unreachable Kratos is a 503 INTERNAL", async () => {
  const isolated = await startAuthApp({
    publicUrl: "http://127.0.0.1:1",
    adminUrl: "http://127.0.0.1:1",
    timeoutMs: 500,
  });
  try {
    const response = await fetch(`${isolated.baseUrl}/session`, { headers: { cookie: COOKIE } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "INTERNAL");
  } finally {
    await isolated.close();
  }
});

test("POST /test/session mints a session that GET /session accepts", async () => {
  const minted = await fetch(`${testModeApp.baseUrl}/test/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: ACCOUNT }),
  });
  assert.equal(minted.status, 201);
  const mintedBody = await minted.json();
  assert.equal(mintedBody.data.header, "x-test-session");
  assert.equal(typeof mintedBody.data.session, "string");
  assert.match(mintedBody.data.expiresAt, /^\d{4}-\d{2}-\d{2}T/);

  const session = await fetch(`${testModeApp.baseUrl}/session`, {
    headers: { "x-test-session": mintedBody.data.session },
  });
  assert.equal(session.status, 200);
  const body = await session.json();
  assert.equal(body.data.accountId, ACCOUNT);
  assert.match(body.data.email, /@test-session\.project-air\.invalid$/);
});

test("a tampered or expired test session is 401, never 500", async () => {
  const minted = await fetch(`${testModeApp.baseUrl}/test/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: ACCOUNT }),
  });
  const token = (await minted.json()).data.session;
  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -1)}x`;

  for (const header of [tampered, "not-a-token", mintTestSession(ACCOUNT, TEST_SESSION_SECRET, 1, Date.now() - 5_000).token]) {
    const response = await fetch(`${testModeApp.baseUrl}/session`, { headers: { "x-test-session": header } });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
  }
});

test("POST /test/session validates its body", async () => {
  for (const body of [{}, { accountId: "not-a-uuid" }, { accountId: ACCOUNT, ttlSeconds: 3_601 }]) {
    const response = await fetch(`${testModeApp.baseUrl}/test/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    const parsed = await response.json();
    assert.equal(parsed.code, "VALIDATION");
    assert.ok(Array.isArray(parsed.details.fields));
  }
});

test("without test mode the test-session route does not exist and the header is ignored", async () => {
  const minted = mintTestSession(ACCOUNT, TEST_SESSION_SECRET);
  const route = await fetch(`${app.baseUrl}/test/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: ACCOUNT }),
  });
  assert.equal(route.status, 404);
  assert.equal((await route.json()).code, "NOT_FOUND");

  const session = await fetch(`${app.baseUrl}/session`, { headers: { "x-test-session": minted.token } });
  assert.equal(session.status, 401);
  assert.equal((await session.json()).code, "AUTH_REQUIRED");
});
