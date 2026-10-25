/**
 * Builds the HTTP application: router, health routes and nothing else yet.
 *
 * `checkDatabase` is injected so the readiness endpoint can be tested with a
 * fake dependency (up and down) and wired to the real pool in `server.ts`.
 */

import type { Server } from "node:http";

import type { Logger } from "../log.ts";
import { registerHealthRoutes } from "./health.ts";
import { Router } from "./router.ts";

export interface AppOptions {
  readonly serviceName: string;
  readonly checkDatabase: () => Promise<void>;
  readonly logger: Logger;
  readonly generateRequestId?: () => string;
}

export function createApp(options: AppOptions): Server {
  const router = new Router({
    logger: options.logger,
    ...(options.generateRequestId === undefined ? {} : { generateRequestId: options.generateRequestId }),
  });
  registerHealthRoutes(router, { serviceName: options.serviceName, checkDatabase: options.checkDatabase });
  return router.createServer();
}
