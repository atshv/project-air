// P6-02: auth route mapping over the existing fake-Kratos pattern. No live
// Kratos or database required.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startAuthApp } from "./helpers/auth-app.mjs";
import { startKratosStub } from "./helpers/kratos-stub.mjs";

let kratos;
let app;

before(async () => {
  kratos = await startKratosStub();
  app = await startAuthApp({ publicUrl: kratos.baseUrl, adminUrl: kratos.baseUrl });
});

after(async () => {
  await app.close();
  await kratos.close();
});

async function post(path, body, headers = {}) {
  const response = await fetch(`${app.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await response.text();
  return { response, body: text === "" ? null : JSON.parse(text) };
}

test("login creates+submits the flow, forwards the session cookie and keeps credentials out of the response", async () => {
  const { response, body } = await post("/v1/auth/login", { email: "alice@example.test", password: "correct-horse" });
  assert.equal(response.status, 200);
  assert.equal(body.data.signedIn, true);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie !== null && cookie.includes("ory_kratos_session"));
  assert.equal(JSON.stringify(body).includes("correct-horse"), false, "no credentials echoed");
  assert.ok(kratos.requests.some((request) => request.url.includes("/self-service/login") && request.method === "POST"), "flow submitted");
});

test("invalid credentials and provider failure are typed errors", async () => {
  const kratos2 = await startKratosStub({ login: "invalid" });
  const app2 = await startAuthApp({ publicUrl: kratos2.baseUrl, adminUrl: kratos2.baseUrl });
  try {
    const invalid = await fetch(`${app2.baseUrl}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "alice@example.test", password: "wrong-password" }) });
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).code, "AUTH_REQUIRED");
  } finally { await app2.close(); await kratos2.close(); }
  const offline = await fetch(`${app.baseUrl}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "bad", password: "x" }) });
  assert.equal(offline.status, 400);
  assert.equal((await offline.json()).code, "VALIDATION");
});

test("registration, recovery and logout map success/conflict/cookie clear", async () => {
  const registered = await post("/v1/auth/registration", { email: "bob@example.test", password: "correct-horse", displayName: "Bob" });
  assert.equal(registered.response.status, 201);
  assert.ok((registered.response.headers.get("set-cookie") ?? "").includes("ory_kratos_session"));
  const recovery = await post("/v1/auth/recovery", { email: "bob@example.test" });
  assert.equal(recovery.response.status, 200);
  assert.equal(recovery.body.data.sent, true);
  const logout = await post("/v1/auth/logout", {}, { cookie: "ory_kratos_session=stub-session" });
  assert.equal(logout.response.status, 200);
  const cleared = logout.response.headers.get("set-cookie") ?? "";
  assert.ok(cleared.includes("ory_kratos_session=;") && cleared.includes("Max-Age=0"));
});

test("test-mode session path is untouched and still gated by the flag", async () => {
  const testApp = await startAuthApp({ publicUrl: kratos.baseUrl, adminUrl: kratos.baseUrl, testMode: true, testSessionSecret: "s".repeat(32) });
  try {
    const noHeader = await fetch(`${testApp.baseUrl}/session`);
    assert.equal(noHeader.status, 401);
  } finally { await testApp.close(); }
});
