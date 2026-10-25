/**
 * Entry point of the platform service.
 *
 * Configuration errors exit with code 2 and a message that names the variable
 * without its value. Runtime errors exit with code 1. SIGINT and SIGTERM close
 * the server and the pool before the process ends.
 */

import { ConfigError, parseConfig, type PlatformConfig } from "./config.ts";
import { createLogger } from "./log.ts";
import { startService } from "./server.ts";

async function main(): Promise<void> {
  let config: PlatformConfig;
  try {
    config = parseConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`platform: configuration error: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }

  const logger = createLogger(config.logLevel);
  const service = await startService(config, logger);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });
    service.close().then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        logger.error("shutdown failed", { error: error instanceof Error ? error.message : String(error) });
        process.exit(1);
      },
    );
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`platform: fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
