/**
 * Lifecycle of the platform HTTP process: pool, application and graceful
 * shutdown. The entry point (`index.ts`) parses the configuration and wires
 * the signal handlers to `close()`.
 */

import type { Server } from "node:http";

import { AuthSessionClient } from "./auth/session.ts";
import type { PlatformConfig } from "./config.ts";
import { closePool, createPool, ping } from "./db/pool.ts";
import { createApp } from "./http/app.ts";
import type { Logger } from "./log.ts";

export interface RunningService {
  readonly server: Server;
  /** Stops accepting requests and closes the pool; idempotent. */
  readonly close: () => Promise<void>;
}

export async function startService(config: PlatformConfig, logger: Logger): Promise<RunningService> {
  // The API runs as the restricted app_user role; the owner connection is only
  // used by migrations and operations (db-migrate, reset-db).
  const pool = createPool(config.appDatabaseUrl, {
    application_name: config.serviceName,
    connectionTimeoutMillis: 3_000,
  });

  // AD-5 defence in depth: the API pool must be the restricted application
  // role. A superuser or BYPASSRLS role would silently bypass row-level
  // security, so the service refuses to start (clear message, no secret).
  try {
    const role = await pool.query<{ rolsuper: boolean; bypassrls: boolean }>(
      `SELECT r.rolsuper AS rolsuper, r.rolbypassrls AS bypassrls
       FROM pg_roles AS r
       WHERE r.rolname = current_user`,
    );
    const row = role.rows[0];
    if (row === undefined || row.rolsuper || row.bypassrls) {
      throw new Error(
        "APP_DATABASE_URL must use a restricted role without SUPERUSER or BYPASSRLS (the app_user role); refusing to start",
      );
    }
  } catch (error) {
    await closePool(pool).catch(() => undefined);
    throw error;
  }

  const auth = new AuthSessionClient({ baseUrl: config.authServiceUrl });
  const server = createApp({
    serviceName: config.serviceName,
    checkDatabase: () => ping(pool),
    logger,
    api: { pool, auth },
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(config.port, config.host, () => {
      server.off("error", onError);
      logger.info("http server listening", { host: config.host, port: config.port });
      resolve();
    });
  });

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
        server.closeIdleConnections();
      });
      await closePool(pool);
      logger.info("http server closed", { port: config.port });
    })();
    return closing;
  };

  return { server, close };
}
