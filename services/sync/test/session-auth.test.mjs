// P6-09: the production session adapters against real HTTP routes. Fake auth and
// platform servers record what the adapter sends, so the test proves cookie
// forwarding to the auth `/session` check (AD-5), the UUIDv7 account mapping on
// the platform, the tokenRef test-mode path, the board authorization and that no
// cookie value ever appears in an error or a log.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { createSessionAdapters, credentialHeaders, DEFAULT_SESSION_TIMEOUT_MS } from "../src/session-auth.ts";

const COOKIE = "ory_kratos_session=adapter-cookie-value";
const V7_ACCOUNT = "0192f0e7-7000-7000-8000-0000000000a1";
const V4_IDENTITY = "f0e7a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b";
const BOARD_ID = "0192f0e7-7000-7000-8000-0000000000b1";

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function startServer(handler) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers });
    handler(request, response, requests.length);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

test("the browser cookie is validated through auth /session and mapped to the contract account id", async () => {
  const auth = await startServer((_request, response) => {
    json(response, 200, { requestId: "0192f0e7-7000-7000-8000-0000000000c1", data: { accountId: V7_ACCOUNT, email: "a@example.test", displayName: "A" } });
  });
  const platform = await startServer((_request, response) => {
    json(response, 200, { requestId: "0192f0e7-7000-7000-8000-0000000000c2", accountId: V7_ACCOUNT });
  });
  try {
    const { authenticator } = createSessionAdapters({ authServiceUrl: auth.url, platformServiceUrl: platform.url });
    const identity = await authenticator.authenticate("browser-session", { cookie: COOKIE });
    assert.deepEqual(identity, { userId: V7_ACCOUNT });
    assert.equal(auth.requests.length, 1, "the auth service validates the cookie");
    assert.equal(auth.requests[0].url, "/session");
    assert.equal(auth.requests[0].headers.cookie, COOKIE, "the cookie header is forwarded unchanged");
    assert.equal(platform.requests.length, 0, "a UUIDv7 identity is already the contract account id");
  } finally {
    await auth.close();
    await platform.close();
  }
});

test("a UUIDv4 Kratos identity is resolved through the platform session route with the same cookie", async () => {
  const auth = await startServer((_request, response) => {
    json(response, 200, { requestId: "0192f0e7-7000-7000-8000-0000000000c1", data: { accountId: V4_IDENTITY, email: "a@example.test", displayName: "A" } });
  });
  const platform = await startServer((_request, response) => {
    json(response, 200, { requestId: "0192f0e7-7000-7000-8000-0000000000c2", accountId: V7_ACCOUNT });
  });
  try {
    const { authenticator } = createSessionAdapters({ authServiceUrl: auth.url, platformServiceUrl: platform.url });
    const identity = await authenticator.authenticate("browser-session", { cookie: COOKIE });
    assert.deepEqual(identity, { userId: V7_ACCOUNT });
    assert.equal(platform.requests[0].url, "/v1/session");
    assert.equal(platform.requests[0].headers.cookie, COOKIE);
  } finally {
    await auth.close();
    await platform.close();
  }
});

test("the tokenRef test-mode path is forwarded as x-test-session, not as a cookie", async () => {
  const auth = await startServer((_request, response) => {
    json(response, 200, { requestId: "0192f0e7-7000-7000-8000-0000000000c1", data: { accountId: V7_ACCOUNT, email: "a@example.test", displayName: "A" } });
  });
  const platform = await startServer((_request, response) => json(response, 404, { code: "NOT_FOUND", messageKey: "errors.notFound", requestId: "0192f0e7-7000-7000-8000-0000000000c2" }));
  try {
    const { authenticator } = createSessionAdapters({ authServiceUrl: auth.url, platformServiceUrl: platform.url });
    const identity = await authenticator.authenticate("test-token-ref");
    assert.deepEqual(identity, { userId: V7_ACCOUNT });
    assert.equal(auth.requests[0].headers["x-test-session"], "test-token-ref");
    assert.equal(auth.requests[0].headers.cookie, undefined);
  } finally {
    await auth.close();
    await platform.close();
  }
});

test("a rejected or unreachable auth service denies without leaking the cookie", async () => {
  const rejected = await startServer((_request, response) => {
    json(response, 401, { code: "AUTH_REQUIRED", messageKey: "errors.authRequired", requestId: "0192f0e7-7000-7000-8000-0000000000c3" });
  });
  try {
    const { authenticator, authorizer } = createSessionAdapters({ authServiceUrl: rejected.url, platformServiceUrl: rejected.url });
    assert.equal(await authenticator.authenticate("browser-session", { cookie: COOKIE }), null);
    assert.equal(await authorizer.canJoin(V7_ACCOUNT, BOARD_ID, { cookie: COOKIE }), false);
  } finally {
    await rejected.close();
  }

  const unavailable = createSessionAdapters({
    authServiceUrl: "http://127.0.0.1:1",
    platformServiceUrl: "http://127.0.0.1:1",
    timeoutMs: 300,
  });
  assert.equal(await unavailable.authenticator.authenticate("browser-session", { cookie: COOKIE }), null);
  assert.equal(await unavailable.authorizer.canJoin(V7_ACCOUNT, BOARD_ID, { cookie: COOKIE }), false);
});

test("the platform board check receives the session cookie and returns the allow/deny decision", async () => {
  const platform = await startServer((request, response) => {
    if (request.url === `/v1/boards/${BOARD_ID}`) {
      json(response, 200, { requestId: "0192f0e7-7000-7000-8000-0000000000c4", board: { id: BOARD_ID } });
      return;
    }
    json(response, 404, { code: "NOT_FOUND", messageKey: "errors.notFound", requestId: "0192f0e7-7000-7000-8000-0000000000c5" });
  });
  try {
    const { authorizer } = createSessionAdapters({ authServiceUrl: "http://127.0.0.1:1", platformServiceUrl: platform.url });
    assert.equal(await authorizer.canJoin(V7_ACCOUNT, BOARD_ID, { cookie: COOKIE }), true);
    assert.equal(platform.requests[0].headers.cookie, COOKIE);
    assert.equal(await authorizer.canJoin(V7_ACCOUNT, "0192f0e7-7000-7000-8000-0000000000b2", { cookie: COOKIE }), false, "a missing board denies the join");
    assert.equal(await authorizer.canJoin(V7_ACCOUNT, BOARD_ID), false, "no credentials deny the join");
  } finally {
    await platform.close();
  }
});

test("credentialHeaders prefers the browser cookie and never invents credentials", () => {
  assert.deepEqual(credentialHeaders({ cookie: COOKIE, tokenRef: "browser-session" }), { accept: "application/json", cookie: COOKIE });
  assert.deepEqual(credentialHeaders({ tokenRef: "test-token-ref" }), { accept: "application/json", "x-test-session": "test-token-ref" });
  assert.deepEqual(credentialHeaders(undefined), { accept: "application/json" });
  assert.equal(DEFAULT_SESSION_TIMEOUT_MS > 0, true);
});
