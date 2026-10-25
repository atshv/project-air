/**
 * Lifecycle of the platform HTTP process: pool, application and graceful
 * shutdown. The entry point (`index.ts`) parses the configuration and wires
 * the signal handlers to `close()`.
 */

import type { Server } from "node:http";

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
  const pool = createPool(config.databaseUrl, {
    application_name: config.serviceName,
    connectionTimeoutMillis: 3_000,
  });
  const server = createApp({
    serviceName: config.serviceName,
    checkDatabase: () => ping(pool),
    logger,
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
