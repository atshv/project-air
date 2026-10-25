/**
 * HMAC-signed test sessions for integration tests (AUTH_TEST_MODE only).
 *
 * Format: `base64url(accountId).base64url(expiry).signature`, where the
 * signature is HMAC-SHA256 over `base64url(accountId).base64url(expiry)` with
 * `AUTH_SESSION_SECRET`. TTL is short (at most one hour) and the whole mode is
 * impossible with `NODE_ENV=production` (the configuration refuses to start).
 *
 * The token carries only the account id and the expiry; the e-mail and display
 * name of a test session are deterministic placeholders because integration
 * tests only need the account id (P3-04 maps it to a workspace member).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { isRecord, integerValue, stringValue } from "./http/body.ts";
import { validationFailed } from "./http/errors.ts";
import type { Router } from "./http/router.ts";

export const TEST_SESSION_HEADER = "x-test-session";
export const MIN_TEST_SESSION_TTL_SECONDS = 1;
export const MAX_TEST_SESSION_TTL_SECONDS = 3_600;
const DEFAULT_TEST_SESSION_TTL_SECONDS = 900;
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TestSessionClaims {
  readonly accountId: string;
  readonly expiresAt: number;
}

export interface MintedTestSession {
  readonly token: string;
  readonly expiresAt: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function mintTestSession(
  accountId: string,
  secret: string,
  ttlSeconds: number = DEFAULT_TEST_SESSION_TTL_SECONDS,
  nowMs: number = Date.now(),
): MintedTestSession {
  const normalizedAccountId = accountId.trim().toLowerCase();
  if (!ACCOUNT_ID_PATTERN.test(normalizedAccountId)) {
    throw new Error("accountId must be a UUID");
  }
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < MIN_TEST_SESSION_TTL_SECONDS ||
    ttlSeconds > MAX_TEST_SESSION_TTL_SECONDS
  ) {
    throw new Error("ttlSeconds must be an integer between 1 and 3600");
  }
  const expiresAt = Math.floor((nowMs + ttlSeconds * 1_000) / 1_000);
  const accountPart = Buffer.from(normalizedAccountId, "utf8").toString("base64url");
  const expiryPart = Buffer.from(String(expiresAt), "utf8").toString("base64url");
  const signature = sign(`${accountPart}.${expiryPart}`, secret);
  return { token: `${accountPart}.${expiryPart}.${signature}`, expiresAt: expiresAt * 1_000 };
}

/** Returns the claims for a valid, unexpired token and null for everything else. */
export function verifyTestSession(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): TestSessionClaims | null {
  if (typeof token !== "string") {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [accountPart, expiryPart, signaturePart] = parts as [string, string, string];
  if (accountPart === "" || expiryPart === "" || signaturePart === "") {
    return null;
  }
  const expected = Buffer.from(sign(`${accountPart}.${expiryPart}`, secret), "utf8");
  const provided = Buffer.from(signaturePart, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }
  let accountId: string;
  let expiresAt: number;
  try {
    accountId = Buffer.from(accountPart, "base64url").toString("utf8");
    expiresAt = Number.parseInt(Buffer.from(expiryPart, "base64url").toString("utf8"), 10);
  } catch {
    return null;
  }
  if (!Number.isInteger(expiresAt) || expiresAt * 1_000 <= nowMs) {
    return null;
  }
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    return null;
  }
  return { accountId: accountId.toLowerCase(), expiresAt: expiresAt * 1_000 };
}

/** Deterministic profile of a test session (integration tests only need the id). */
export function testSessionProfile(accountId: string): {
  accountId: string;
  email: string;
  displayName: string;
} {
  return {
    accountId,
    email: `${accountId}@test-session.project-air.invalid`,
    displayName: `Test session ${accountId.slice(0, 8)}`,
  };
}

export interface TestSessionRouteOptions {
  readonly secret: string;
}

function parseTestSessionBody(body: unknown): { accountId: string; ttlSeconds: number } | { fields: readonly string[] } {
  if (!isRecord(body)) {
    return { fields: ["accountId"] };
  }
  const accountId = stringValue(body, "accountId")?.trim();
  const ttlSeconds = integerValue(body, "ttlSeconds");
  const fields: string[] = [];
  if (accountId === undefined || !ACCOUNT_ID_PATTERN.test(accountId)) {
    fields.push("accountId");
  }
  if (
    ttlSeconds !== undefined &&
    (ttlSeconds < MIN_TEST_SESSION_TTL_SECONDS || ttlSeconds > MAX_TEST_SESSION_TTL_SECONDS)
  ) {
    fields.push("ttlSeconds");
  }
  if (fields.length > 0 || accountId === undefined) {
    return { fields };
  }
  return { accountId, ttlSeconds: ttlSeconds ?? DEFAULT_TEST_SESSION_TTL_SECONDS };
}

/** Registers `POST /test/session`; only called when the test mode is enabled. */
export function registerTestSessionRoutes(router: Router, options: TestSessionRouteOptions): void {
  router.post("/test/session", async (context) => {
    const parsed = parseTestSessionBody(await context.readJson<unknown>());
    if ("fields" in parsed) {
      throw validationFailed(parsed.fields);
    }
    const minted = mintTestSession(parsed.accountId, options.secret, parsed.ttlSeconds);
    return {
      status: 201,
      data: {
        session: minted.token,
        header: TEST_SESSION_HEADER,
        expiresAt: new Date(minted.expiresAt).toISOString(),
      },
    };
  });
}
