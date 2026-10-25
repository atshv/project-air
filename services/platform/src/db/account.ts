/**
 * Per-request database context (AD-5, second line).
 *
 * Every API request runs as the restricted `app_user` in one transaction with
 * `app.account_id` set through `SET LOCAL` (via `set_config(..., true)`), so the
 * row-level-security policies scope every query to the session account and the
 * setting never leaks to the next request.
 */

import type { Pool, PoolClient } from "pg";

import type { AuthSessionUser } from "../auth/session.ts";

/** Inserts the caller's profile row on the first authenticated request. */
export async function ensureProfile(client: PoolClient, user: AuthSessionUser): Promise<void> {
  await client.query(
    `INSERT INTO app.profiles (account_id, display_name, locale)
     VALUES ($1, $2, 'de')
     ON CONFLICT (account_id) DO NOTHING`,
    [user.accountId, user.displayName],
  );
}

/**
 * Opens one transaction as `app_user`, sets `app.account_id` locally, runs
 * `work` and commits. Errors roll back and are rethrown unchanged.
 */
export async function withAccountTransaction<T>(
  pool: Pool,
  accountId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.account_id', $1, true)", [accountId]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
