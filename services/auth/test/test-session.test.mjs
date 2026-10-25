/**
 * Unit tests of the HMAC test-session format: mint/verify, tampering, expiry,
 * invalid input and the deterministic test profile.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_TEST_SESSION_TTL_SECONDS,
  TEST_SESSION_HEADER,
  mintTestSession,
  testSessionProfile,
  verifyTestSession,
} from "../src/test-session.ts";

const SECRET = "s".repeat(32);
const ACCOUNT = "0192f0d0-7000-7000-8000-00000000aa01";

test("mints the documented three-part token and verifies it", () => {
  const minted = mintTestSession(ACCOUNT, SECRET);
  assert.match(minted.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const claims = verifyTestSession(minted.token, SECRET);
  assert.deepEqual(claims, { accountId: ACCOUNT, expiresAt: minted.expiresAt });
});

test("rejects a tampered signature and another secret", () => {
  const minted = mintTestSession(ACCOUNT, SECRET);
  const parts = minted.token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -1)}x`;
  assert.equal(verifyTestSession(tampered, SECRET), null);
  assert.equal(verifyTestSession(minted.token, "another-secret"), null);
});

test("rejects an expired token", () => {
  const minted = mintTestSession(ACCOUNT, SECRET, 60, Date.now() - 120_000);
  assert.equal(verifyTestSession(minted.token, SECRET), null);
});

test("rejects malformed tokens", () => {
  for (const token of ["", "a.b", "a.b.c.d", "..", "not-a-token", "a.b."]) {
    assert.equal(verifyTestSession(token, SECRET), null, `token ${JSON.stringify(token)} must be rejected`);
  }
});

test("rejects an invalid account id and an out-of-range TTL", () => {
  assert.throws(() => mintTestSession("not-a-uuid", SECRET), /UUID/);
  assert.throws(() => mintTestSession(ACCOUNT, SECRET, 0), /ttlSeconds/);
  assert.throws(() => mintTestSession(ACCOUNT, SECRET, MAX_TEST_SESSION_TTL_SECONDS + 1), /ttlSeconds/);
});

test("the header name and the deterministic test profile are stable", () => {
  assert.equal(TEST_SESSION_HEADER, "x-test-session");
  const profile = testSessionProfile(ACCOUNT);
  assert.equal(profile.accountId, ACCOUNT);
  assert.match(profile.email, /@test-session\.project-air\.invalid$/);
  assert.ok(profile.displayName.length > 0);
});
