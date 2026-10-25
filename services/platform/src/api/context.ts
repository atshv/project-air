/**
 * Shared API request context: authenticate through the auth service, then run
 * the route in one `app_user` transaction with `app.account_id` set (AD-5).
 */

import type { PoolClient } from "pg";

import type { AuthSessionClient, AuthSessionUser } from "../auth/session.ts";
import { ensureProfile, withAccountTransaction } from "../db/account.ts";
import { authRequired } from "../http/errors.ts";
import type { RequestContext, RouteResponse } from "../http/router.ts";

export interface ApiDependencies {
  readonly pool: import("pg").Pool;
  readonly auth: AuthSessionClient;
}

export interface AuthenticatedRequest {
  readonly context: RequestContext;
  readonly user: AuthSessionUser;
  readonly client: PoolClient;
}

export function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/** Authenticates, opens the transaction, ensures the profile and runs `work`. */
export function withAuthenticatedRequest(
  dependencies: ApiDependencies,
  context: RequestContext,
  work: (request: AuthenticatedRequest) => Promise<RouteResponse>,
): Promise<RouteResponse> {
  const cookie = headerValue(context.headers, "cookie");
  const testSession = headerValue(context.headers, "x-test-session");
  const hasCookie = cookie !== undefined && cookie !== "";
  const hasTestSession = testSession !== undefined && testSession !== "";

  return (async () => {
    if (!hasCookie && !hasTestSession) {
      throw authRequired();
    }
    const user = await dependencies.auth.getSession({
      ...(hasCookie ? { cookie } : {}),
      ...(hasTestSession ? { testSession } : {}),
    });
    return withAccountTransaction(dependencies.pool, user.accountId, async (client) => {
      await ensureProfile(client, user);
      return work({ context, user, client });
    });
  })();
}
