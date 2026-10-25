/**
 * `POST /internal/invitations` against the stub Kratos admin API: admin-token
 * protection, input validation, identity creation, duplicate e-mail conflict
 * and the 503 mapping when Kratos is unavailable.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startAuthApp } from "./helpers/auth-app.mjs";
import { STUB_IDENTITY_ID, startKratosStub } from "./helpers/kratos-stub.mjs";

const ADMIN_TOKEN = "t".repeat(16);
const INVITATION = { email: "invitee@example.test", displayName: "Invitee", locale: "de" };

let stub;
let app;

function postInvitation(body, authorization = `Bearer ${ADMIN_TOKEN}`) {
  return fetch(`${app.baseUrl}/internal/invitations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  stub = await startKratosStub();
  app = await startAuthApp({
    publicUrl: stub.publicUrl,
    adminUrl: stub.adminUrl,
    adminToken: ADMIN_TOKEN,
  });
});

after(async () => {
  await app.close();
  await stub.close();
});

test("creates an identity through the Kratos admin API and returns its id", async () => {
  const response = await postInvitation(INVITATION);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body.data, { identityId: STUB_IDENTITY_ID, email: INVITATION.email });

  const request = stub.requests.filter((entry) => entry.url === "/admin/identities" && entry.method === "POST").at(-1);
  assert.ok(request !== undefined);
  const traits = JSON.parse(request.body).traits;
  assert.deepEqual(traits, { email: INVITATION.email, display_name: INVITATION.displayName, locale: "de" });
});

test("a missing or wrong admin token is 401 AUTH_REQUIRED", async () => {
  const missing = await fetch(`${app.baseUrl}/internal/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(INVITATION),
  });
  assert.equal(missing.status, 401);

  for (const authorization of ["Bearer wrong-token-wrong-token", "Basic abc"]) {
    const response = await postInvitation(INVITATION, authorization);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.code, "AUTH_REQUIRED");
    assert.equal(body.messageKey, "errors.authRequired");
  }
  assert.equal((await missing.json()).code, "AUTH_REQUIRED");
});

test("an invalid invitation body is 400 VALIDATION with field details", async () => {
  const response = await postInvitation({ email: "not-an-email", displayName: "", locale: "fr" });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "VALIDATION");
  assert.equal(body.messageKey, "errors.validation");
  assert.deepEqual([...body.details.fields].sort(), ["displayName", "email", "locale"]);
});

test("a duplicate e-mail is 409 CONFLICT", async () => {
  stub.state.createIdentity = "conflict";
  try {
    const response = await postInvitation(INVITATION);
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "CONFLICT");
    assert.equal(body.messageKey, "errors.conflict");
  } finally {
    stub.state.createIdentity = "created";
  }
});

test("a Kratos failure is a 503 INTERNAL", async () => {
  for (const mode of ["error", "bad_request"]) {
    stub.state.createIdentity = mode;
    try {
      const response = await postInvitation(INVITATION);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "INTERNAL");
    } finally {
      stub.state.createIdentity = "created";
    }
  }
});
