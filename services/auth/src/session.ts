/**
 * `GET /session`: the single session check of the platform (AD-5).
 *
 * The browser session cookie is forwarded unchanged to Kratos
 * `/sessions/whoami`; the identity is mapped to `{accountId, email,
 * displayName}`. There is no session without a cookie or with an expired one:
 * that is a 401 `AUTH_REQUIRED`. An unreachable Kratos is a 503 `INTERNAL`.
 *
 * In test mode (`AUTH_TEST_MODE=1` outside production) a valid
 * `x-test-session` header replaces the Kratos round trip so integration tests
 * need no live identity server.
 */

import { authRequired, serviceUnavailable } from "./http/errors.ts";
import type { Router } from "./http/router.ts";
import { KratosError, type KratosClient, type KratosIdentity } from "./kratos.ts";
import { TEST_SESSION_HEADER, testSessionProfile, verifyTestSession } from "./test-session.ts";

export interface SessionOptions {
  readonly kratos: KratosClient;
  readonly testMode: boolean;
  readonly testSessionSecret: string;
}

export interface SessionUser {
  readonly accountId: string;
  readonly email: string;
  readonly displayName: string;
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function sessionUser(identity: KratosIdentity): SessionUser {
  const email = identity.traits.email;
  const displayName = identity.traits.displayName;
  if (email === undefined || displayName === undefined) {
    // Kratos answered, but the identity lacks the traits the contract needs.
    throw serviceUnavailable("the identity server returned an incomplete identity");
  }
  return { accountId: identity.id, email, displayName };
}

export function registerSessionRoutes(router: Router, options: SessionOptions): void {
  router.get("/session", async (context) => {
    if (options.testMode) {
      const testSession = headerValue(context.headers, TEST_SESSION_HEADER);
      if (typeof testSession === "string" && testSession !== "") {
        const claims = verifyTestSession(testSession, options.testSessionSecret);
        if (claims === null) {
          throw authRequired("the test session is invalid or expired");
        }
        return { data: testSessionProfile(claims.accountId) };
      }
    }

    const cookie = context.headers.cookie;
    const cookieHeader = typeof cookie === "string" ? cookie.trim() : "";
    if (cookieHeader === "") {
      throw authRequired();
    }

    let identity: KratosIdentity | null;
    try {
      identity = await options.kratos.whoami(cookieHeader);
    } catch (error) {
      if (error instanceof KratosError) {
        throw serviceUnavailable("the identity server is not reachable");
      }
      throw error;
    }
    if (identity === null) {
      throw authRequired("the session is missing or expired");
    }
    return { data: sessionUser(identity) };
  });
}
