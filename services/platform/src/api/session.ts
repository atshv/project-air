/**
 * Session route (P3-06): the one public surface that tells a client its
 * contract account id.
 *
 * The auth service exposes the Ory Kratos identity id, which can be a UUIDv4
 * and is never a contract id. Clients need the resolved UUIDv7 account id to
 * put a valid `ownerId` into create bodies (for example
 * `POST /v1/workspaces`), so this route returns exactly `{requestId, accountId}`
 * for the authenticated session. The Kratos identity id never appears here.
 */

import type { Router } from "../http/router.ts";
import { type ApiDependencies, withAuthenticatedRequest } from "./context.ts";
import { requestIdFromQuery } from "./pagination.ts";

export function registerSessionRoutes(router: Router, dependencies: ApiDependencies): void {
  router.get("/v1/session", (context) =>
    withAuthenticatedRequest(dependencies, context, ({ user }) => {
      const requestId = requestIdFromQuery(context.query, context.requestId);
      context.useRequestId(requestId);
      return Promise.resolve({ body: { requestId, accountId: user.accountId } });
    }),
  );
}
