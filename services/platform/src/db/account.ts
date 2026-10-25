/**
 * Per-request database context (AD-5, second line) and account resolution (P3-06).
 *
 * Every API request runs as the restricted `app_user` in one transaction with
 * `app.account_id` set through `SET LOCAL` (via `set_config(..., true)`), so the
 * row-level-security policies scope every query to the session account and the
 * setting never leaks to the next request.
 *
 * The auth service returns the Ory Kratos identity id. Contract entities carry
 * UUIDv7 account ids, so a v7 identity is used as the account id directly (test
 * sessions and future Kratos versions), while any other identity is resolved
 * through `app.profiles.kratos_identity_id`. The first sight of a v4 identity
 * inserts the profile and the mapping in this one transaction; a unique partial
 * index plus `ON CONFLICT` make concurrent first requests converge on one row.
 * The Kratos id never leaves the database in an API response.
 */

import type { Pool, PoolClient } from "pg";

import type { AuthSessionUser } from "../auth/session.ts";
import { createUuid, isAccountId } from "../http/request-id.ts";

export interface SessionAccount {
  /** Contract-valid UUIDv7 account id used for the transaction and responses. */
  readonly accountId: string;
  /** The session user with the contract account id substituted for the identity id. */
  readonly user: AuthSessionUser;
}

const LOOKUP_ACCOUNT_ID_SQL = "SELECT app.account_for_kratos_identity($1::uuid) AS account_id";

/** Inserts the caller's profile row on the first authenticated request. */
export async function ensureProfile(client: PoolClient, user: AuthSessionUser): Promise<void> {
  await client.query(
    `INSERT INTO app.profiles (account_id, display_name, locale)
     VALUES ($1, $2, 'de')
     ON CONFLICT (account_id) DO NOTHING`,
    [user.accountId, user.displayName],
  );
}

async function setAccountId(client: PoolClient, accountId: string): Promise<void> {
  await client.query("SELECT set_config('app.account_id', $1, true)", [accountId]);
}

/** The mapped contract account id for an external identity, or null. */
async function mappedAccountId(client: PoolClient, identityId: string): Promise<string | null> {
  const result = await client.query<{ account_id: string | null }>(LOOKUP_ACCOUNT_ID_SQL, [identityId]);
  return result.rows[0]?.account_id ?? null;
}

/**
 * Maps the session identity to the contract account id, creating the profile
 * and mapping on first sight. Runs inside the caller's transaction.
 */
async function resolveAccountId(client: PoolClient, user: AuthSessionUser): Promise<string> {
  if (isAccountId(user.accountId)) {
    await setAccountId(client, user.accountId);
    await ensureProfile(client, user);
    return user.accountId;
  }

  const existing = await mappedAccountId(client, user.accountId);
  if (existing !== null) {
    await setAccountId(client, existing);
    return existing;
  }

  const candidate = createUuid();
  await setAccountId(client, candidate);
  const inserted = await client.query(
    `INSERT INTO app.profiles (account_id, display_name, locale, kratos_identity_id)
     VALUES ($1, $2, 'de', $3)
     ON CONFLICT DO NOTHING`,
    [candidate, user.displayName, user.accountId],
  );
  if (inserted.rowCount === 1) {
    return candidate;
  }
  // A concurrent first request won the unique index; reuse its account id.
  const winner = await mappedAccountId(client, user.accountId);
  if (winner === null) {
    throw new Error("the account mapping could not be resolved after a conflict");
  }
  await setAccountId(client, winner);
  return winner;
}

/**
 * Opens one transaction as `app_user`, resolves the session identity to the
 * contract account id, sets `app.account_id` locally, runs `work` and commits.
 * Errors roll back and are rethrown unchanged.
 */
export async function withSessionTransaction<T>(
  pool: Pool,
  user: AuthSessionUser,
  work: (client: PoolClient, account: SessionAccount) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accountId = await resolveAccountId(client, user);
    const result = await work(client, { accountId, user: { ...user, accountId } });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
