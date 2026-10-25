/**
 * Shared helpers for the migration and policy tests (P3-02).
 *
 * The schema is applied through the real migration runner; fixtures run as the
 * slot owner (the migration role) and the policy checks run as the restricted
 * `app_user` role, because row-level security is invisible to a superuser.
 * Connections come from the slot helper, never from a hard-coded string.
 */

import { randomUUID } from "node:crypto";

import pg from "pg";

import { migrate } from "../../src/db/migrate.ts";
import { appDatabaseUrl, databaseUrl } from "../helpers/slot.mjs";

const { Client } = pg;

export const APPLICATION_TABLES = Object.freeze([
  "profiles",
  "workspaces",
  "workspace_members",
  "boards",
  "notes",
  "cards",
]);

export async function connect(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 15_000 });
  await client.connect();
  return client;
}

export function connectAsOwner() {
  return connect(databaseUrl());
}

export function connectAsAppUser() {
  return connect(appDatabaseUrl());
}

/** Applies every migration; a no-op when the slot database is already current. */
export function applyMigrations() {
  return migrate({ connectionString: databaseUrl() });
}

export async function closeClient(client) {
  if (client !== undefined) {
    await client.end().catch(() => undefined);
  }
}

/**
 * Runs `work` as one account inside a transaction whose `app.account_id` is set
 * with `set_config(..., true)` (the equivalent of `SET LOCAL`), then rolls the
 * transaction back. Rollback keeps the slot database clean and proves that the
 * setting never survives its transaction.
 */
export async function asAccount(client, accountId, work) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.account_id', $1, true)", [accountId]);
    const result = await work();
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** Runs `work` inside a transaction and always rolls it back. */
export async function inRollback(client, work) {
  await client.query("BEGIN");
  try {
    return await work();
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
  }
}

export function newId() {
  return randomUUID();
}

/** Deletes test workspaces and profiles as the owner, ignoring missing rows. */
export async function removeFixtures(client, workspaceIds, accountIds) {
  if (workspaceIds.length > 0) {
    await client.query("DELETE FROM app.workspaces WHERE id = ANY($1::uuid[])", [workspaceIds]);
  }
  if (accountIds.length > 0) {
    await client.query("DELETE FROM app.profiles WHERE account_id = ANY($1::uuid[])", [accountIds]);
  }
}
