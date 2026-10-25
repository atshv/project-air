/**
 * Builds the HTTP application.
 *
 * `checkDatabase` and `checkKratos` are injected so readiness can be tested with
 * fake dependencies (up and down); the real pool and Kratos client are wired in
 * `server.ts`. The session, invitation and test-session routes are registered
 * only when their dependencies are supplied, which keeps the health/config
 * tests free of a Kratos stub.
 */

import type { Server } from "node:http";

import type { KratosClient } from "../kratos.ts";
import type { Logger } from "../log.ts";
import { registerHealthRoutes } from "./health.ts";
import { registerInvitationRoutes } from "../invitations.ts";
import { Router } from "./router.ts";
import { registerSessionRoutes } from "../session.ts";
import { registerTestSessionRoutes } from "../test-session.ts";

export interface AppOptions {
  readonly serviceName: string;
  readonly checkDatabase: () => Promise<void>;
  readonly logger: Logger;
  readonly generateRequestId?: () => string;
  readonly checkKratos?: () => Promise<void>;
  readonly kratos?: KratosClient;
  readonly testMode?: boolean;
  readonly testSessionSecret?: string;
  readonly adminToken?: string;
}

export function createApp(options: AppOptions): Server {
  const router = new Router({
    logger: options.logger,
    ...(options.generateRequestId === undefined ? {} : { generateRequestId: options.generateRequestId }),
  });
  registerHealthRoutes(router, {
    serviceName: options.serviceName,
    checkDatabase: options.checkDatabase,
    ...(options.checkKratos === undefined ? {} : { checkKratos: options.checkKratos }),
  });

  if (options.kratos !== undefined) {
    const testMode = options.testMode ?? false;
    registerSessionRoutes(router, {
      kratos: options.kratos,
      testMode,
      testSessionSecret: options.testSessionSecret ?? "",
    });
    if (testMode && options.testSessionSecret !== undefined) {
      registerTestSessionRoutes(router, { secret: options.testSessionSecret });
    }
    if (options.adminToken !== undefined) {
      registerInvitationRoutes(router, { kratos: options.kratos, adminToken: options.adminToken });
    }
  }

  return router.createServer();
}
