// P6-02: SDK auth/session resource with a fake fetch: methods, cookie mode,
// envelope unwrapping and typed ApiError mapping (no live auth service).
import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "../src/index.ts";

function fakeFetch(responses) {
  const calls = [];
  return {
    calls,
    async fetch(url, request) {
      calls.push({ url, ...request });
      const next = responses.shift();
      if (next === undefined) throw new Error(`unexpected request ${request.method} ${url}`);
      return next;
    },
  };
}

const envelope = (data) => ({ ok: true, status: 200, json: async () => ({ requestId: "r", data }) });

test("session.get uses GET /v1/session with credentials include", async () => {
  const fake = fakeFetch([envelope({ accountId: "a", email: "a@example.test", displayName: "A" })]);
  const client = createClient({ baseUrl: "http://platform.test", fetch: fake.fetch });
  const user = await client.auth.getSession();
  assert.equal(user.accountId, "a");
  assert.equal(fake.calls[0].method, "GET");
  assert.equal(fake.calls[0].url, "http://platform.test/v1/session");
  assert.equal(fake.calls[0].credentials, "include");
});

test("login/registration/recovery/logout hit the auth base with cookie mode and JSON bodies", async () => {
  const fake = fakeFetch([envelope({ signedIn: true }), envelope({ registered: true }), envelope({ sent: true }), envelope({ signedOut: true })]);
  const client = createClient({ baseUrl: "http://platform.test", authBaseUrl: "http://auth.test", fetch: fake.fetch });
  await client.auth.login("a@example.test", "correct-horse");
  await client.auth.registration({ email: "a@example.test", password: "correct-horse", displayName: "A" });
  await client.auth.recovery("a@example.test");
  await client.auth.logout();
  assert.deepEqual(fake.calls.map((call) => `${call.method} ${call.url}`), [
    "POST http://auth.test/v1/auth/login",
    "POST http://auth.test/v1/auth/registration",
    "POST http://auth.test/v1/auth/recovery",
    "POST http://auth.test/v1/auth/logout",
  ]);
  for (const call of fake.calls) assert.equal(call.credentials, "include");
  assert.deepEqual(JSON.parse(fake.calls[0].body), { email: "a@example.test", password: "correct-horse" });
});

test("error envelopes become typed ApiError with code/messageKey/requestId", async () => {
  const fake = fakeFetch([{ ok: false, status: 401, json: async () => ({ requestId: "req-1", code: "AUTH_REQUIRED", messageKey: "errors.authRequired" }) }]);
  const client = createClient({ baseUrl: "http://platform.test", fetch: fake.fetch });
  await assert.rejects(() => client.auth.getSession(), (error) => {
    assert.equal(error.name, "ApiError");
    assert.equal(error.status, 401);
    assert.equal(error.code, "AUTH_REQUIRED");
    assert.equal(error.messageKey, "errors.authRequired");
    assert.equal(error.requestId, "req-1");
    return true;
  });
});

test("session.get accepts the platform's flat {requestId, accountId} envelope", async () => {
  const fake = fakeFetch([{ ok: true, status: 200, json: async () => ({ requestId: "r", accountId: "0192f0a1-7000-7000-8000-000000000001" }) }]);
  const client = createClient({ baseUrl: "http://platform.test", fetch: fake.fetch });
  const user = await client.auth.getSession();
  assert.deepEqual(user, { accountId: "0192f0a1-7000-7000-8000-000000000001", email: "", displayName: "" });
});

test("session.get rejects a 200 response without an account id", async () => {
  const fake = fakeFetch([{ ok: true, status: 200, json: async () => ({ requestId: "r" }) }]);
  const client = createClient({ baseUrl: "http://platform.test", fetch: fake.fetch });
  await assert.rejects(() => client.auth.getSession(), /account id/);
});
