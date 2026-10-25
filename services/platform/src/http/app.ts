/**
 * Builds the HTTP application: health routes plus the contract API routes when
 * the API dependencies (app_user pool and auth session client) are supplied.
 *
 * The dependencies are injected so the health/config tests stay free of the
 * database and the api-tests boot the real stack.
 */

import type { Server } from "node:http";

import { registerApiRoutes } from "../api/index.ts";
import type { ApiDependencies } from "../api/context.ts";
import type { Logger } from "../log.ts";
import { registerHealthRoutes } from "./health.ts";
import { Router } from "./router.ts";

export interface AppOptions {
  readonly serviceName: string;
  readonly checkDatabase: () => Promise<void>;
  readonly logger: Logger;
  readonly generateRequestId?: () => string;
  readonly api?: ApiDependencies;
}

export function createApp(options: AppOptions): Server {
  const router = new Router({
    logger: options.logger,
    ...(options.generateRequestId === undefined ? {} : { generateRequestId: options.generateRequestId }),
  });
  registerHealthRoutes(router, { serviceName: options.serviceName, checkDatabase: options.checkDatabase });
  if (options.api !== undefined) {
    registerApiRoutes(router, options.api);
  }
  return router.createServer();
}
