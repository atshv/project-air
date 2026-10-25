/**
 * PostgreSQL pool for the platform service.
 *
 * The connection string is passed in from the parsed configuration and is
 * never logged. The pool connects lazily, so the process starts and answers
 * `/health` even while the database is down; only `/health/ready` fails.
 */

import pg from "pg";
import type { Pool, PoolConfig } from "pg";

const { Pool: PgPool } = pg;

export const DEFAULT_POOL_MAX = 10;
export const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export function createPool(connectionString: string, overrides: Partial<PoolConfig> = {}): Pool {
  const config: PoolConfig = {
    application_name: "project-air-auth",
    connectionString,
    max: DEFAULT_POOL_MAX,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
    statement_timeout: DEFAULT_STATEMENT_TIMEOUT_MS,
    ...overrides,
  };
  return new PgPool(config);
}

/**
 * Readiness ping: `SELECT 1` bounded by its own timeout so a hanging
 * connection cannot stall the health endpoint.
 */
export async function ping(pool: Pool, timeoutMs: number = DEFAULT_CONNECTION_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("database health check timed out"));
    }, timeoutMs);
  });
  try {
    await Promise.race([pool.query("SELECT 1"), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function closePool(pool: Pool): Promise<void> {
  await pool.end();
}
