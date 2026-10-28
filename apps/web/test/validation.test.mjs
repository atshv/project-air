import assert from "node:assert/strict";
import test from "node:test";

import { errorMessageKey, validateLogin, validateRecovery, validateRegistration } from "../src/auth/validation.ts";

test("login validation mirrors the server rules", () => {
  assert.deepEqual(validateLogin({ email: "a@example.test", password: "x" }), {});
  assert.deepEqual(validateLogin({ email: "bad", password: "" }), { email: "auth.validation.email", password: "auth.validation.password" });
});

test("registration requires email, display name and at least 8 password characters", () => {
  assert.deepEqual(validateRegistration({ email: "a@example.test", password: "correct-horse", displayName: "Ada" }), {});
  assert.deepEqual(validateRegistration({ email: "a@example.test", password: "short", displayName: "Ada" }), { password: "auth.validation.passwordLength" });
  assert.deepEqual(validateRegistration({ email: "a@example.test", password: "correct-horse", displayName: " " }), { displayName: "auth.validation.displayName" });
});

test("recovery validates the email and maps typed errors to message keys", () => {
  assert.deepEqual(validateRecovery({ email: "a@example.test" }), {});
  assert.deepEqual(validateRecovery({ email: "nope" }), { email: "auth.validation.email" });
  assert.equal(errorMessageKey({ messageKey: "errors.authRequired" }), "errors.authRequired");
  assert.equal(errorMessageKey({ code: "CONFLICT" }), "errors.conflict");
  assert.equal(errorMessageKey(new Error("boom")), "errors.generic");
});
