/**
 * Health endpoints.
 *
 * `GET /health` is liveness: the process answers, independent of dependencies.
 * `GET /health/ready` is readiness: it pings the database and, when wired, the
 * Kratos identity service; it answers 503 when either dependency is unavailable
 * (never a 200).
 */

import { serviceUnavailable } from "./errors.ts";
import type { Router } from "./router.ts";

export interface HealthOptions {
  readonly serviceName: string;
  readonly checkDatabase: () => Promise<void>;
  /** Optional dependency check (Kratos); wired by `server.ts`. */
  readonly checkKratos?: () => Promise<void>;
}

export function registerHealthRoutes(router: Router, options: HealthOptions): void {
  router.get("/health", () => ({ data: { status: "ok", service: options.serviceName } }));

  router.get("/health/ready", async () => {
    try {
      await options.checkDatabase();
      if (options.checkKratos !== undefined) {
        await options.checkKratos();
      }
    } catch {
      // The reason stays in the server-side log; the client gets the envelope.
      throw serviceUnavailable("a dependency is not reachable");
    }
    return { data: { status: "ready", service: options.serviceName } };
  });
}
