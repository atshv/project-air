// P6-09: the auth validation path the sync service uses for the browser session
// handshake. `GET /session` is the single session check (AD-5): sync forwards the
// upgrade cookie unchanged and maps the 200 `accountId` to the socket user; a
// missing/expired session is a 401 the sync service turns into an AUTH_REQUIRED
// reject, and the test-mode header carries the tokenRef fallback of non-browser
// clients. The cookie is never echoed in the response.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { mintTestSession } from "../src/test-session.ts";
import { startAuthApp } from "./helpers/auth-app.mjs";
import { STUB_IDENTITY_ID, startKratosStub } from "./helpers/kratos-stub.mjs";

const TEST_SESSION_SECRET = "t".repeat(32);
const ACCOUNT = "0192f0d0-7000-7000-8000-00000000aa02";
const COOKIE = "ory_kratos_session=sync-handshake-cookie";

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

test("the forwarded upgrade cookie yields the session user sync maps to the socket", async () => {
  const response = await fetch(`${app.baseUrl}/session`, { headers: { cookie: COOKIE } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.accountId, STUB_IDENTITY_ID);
  assert.equal(typeof body.data.email, "string");
  assert.equal(typeof body.data.displayName, "string");
  assert.equal(JSON.stringify(body).includes("sync-handshake-cookie"), false, "the cookie value is never echoed");
  const whoami = stub.requests.filter((entry) => entry.url === "/sessions/whoami").at(-1);
  assert.equal(whoami.headers.cookie, COOKIE, "the auth service forwards the cookie unchanged");
});

test("a missing or expired session is 401 AUTH_REQUIRED, which sync rejects without data", async () => {
  const missing = await fetch(`${app.baseUrl}/session`);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).code, "AUTH_REQUIRED");

  stub.state.whoami = "unauthorized";
  try {
    const expired = await fetch(`${app.baseUrl}/session`, { headers: { cookie: COOKIE } });
    assert.equal(expired.status, 401);
    assert.equal((await expired.json()).code, "AUTH_REQUIRED");
  } finally {
    stub.state.whoami = "identity";
  }
});

test("the tokenRef fallback validates through the test-mode header (non-browser clients)", async () => {
  const minted = mintTestSession(ACCOUNT, TEST_SESSION_SECRET);
  const response = await fetch(`${testModeApp.baseUrl}/session`, { headers: { "x-test-session": minted.token } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.accountId, ACCOUNT, "the tokenRef path returns the contract account id sync uses as the user");
});
