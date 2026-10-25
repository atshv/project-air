/**
 * Health endpoints.
 *
 * `GET /health` is liveness: the process answers, independent of dependencies.
 * `GET /health/ready` is readiness: it pings the database (as `app_user`) and
 * answers 503 `INTERNAL` when it is not reachable, never a 200.
 */

import { serviceUnavailable } from "./errors.ts";
import type { Router } from "./router.ts";

export interface HealthOptions {
  readonly serviceName: string;
  readonly checkDatabase: () => Promise<void>;
}

export function registerHealthRoutes(router: Router, options: HealthOptions): void {
  router.get("/health", () => ({ data: { status: "ok", service: options.serviceName } }));

  router.get("/health/ready", async () => {
    try {
      await options.checkDatabase();
    } catch {
      // The reason stays in the server-side log; the client gets the envelope.
      throw serviceUnavailable("database is not reachable");
    }
    return { data: { status: "ready", service: options.serviceName } };
  });
}
