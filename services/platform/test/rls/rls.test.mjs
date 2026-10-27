/**
 * rls-tests (P3-05): workspace isolation at the database level for the
 * restricted `app_user` role. No API code is involved: the tests connect with
 * the app_user connection string, use `SET LOCAL app.account_id` inside
 * transactions and assert with counts and direct SELECTs.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import pg from "pg";

import { resetSlotDatabase } from "../api/helpers.mjs";
import { appDatabaseUrl, databaseUrl } from "../helpers/slot.mjs";

const { Client } = pg;

const ALICE = "0192f0a1-7000-7000-8000-0000000000a1";
const BOB = "0192f0a1-7000-7000-8000-0000000000b1";
const ALICE_WORKSPACE = "0192f0a2-7000-7000-8000-0000000000a1";
const BOB_WORKSPACE = "0192f0a2-7000-7000-8000-0000000000b1";
const ALICE_BOARD = "0192f0a3-7000-7000-8000-0000000000a1";
const BOB_BOARD = "0192f0a3-7000-7000-8000-0000000000b1";
const ALICE_NOTE = "0192f0a4-7000-7000-8000-0000000000a1";
const BOB_NOTE = "0192f0a4-7000-7000-8000-0000000000b1";

let owner;
let appUser;

async function connect(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 15_000 });
  await client.connect();
  return client;
}

/** Runs `work` as one account inside a transaction and rolls it back. */
async function asAccount(client, accountId, work) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.account_id', $1, true)", [accountId]);
    return await work();
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
  }
}

async function idsOf(client, sql, parameters = []) {
  const rows = (await client.query(sql, parameters)).rows;
  return rows.map((row) => row.id).sort();
}

/** Asserts that a statement is rejected and keeps the transaction usable. */
async function expectStatementRejected(client, sql, parameters, pattern) {
  await client.query("SAVEPOINT rls_probe");
  try {
    await client.query(sql, parameters);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT rls_probe");
    await client.query("RELEASE SAVEPOINT rls_probe");
    assert.match(String(error instanceof Error ? error.message : error), pattern);
    return;
  }
  await client.query("ROLLBACK TO SAVEPOINT rls_probe");
  await client.query("RELEASE SAVEPOINT rls_probe");
  assert.fail(`expected a rejection matching ${String(pattern)}`);
}

before(async () => {
  await resetSlotDatabase();
  owner = await connect(databaseUrl());
  appUser = await connect(appDatabaseUrl());

  await owner.query(
    `INSERT INTO app.profiles (account_id, display_name, locale)
     VALUES ($1, 'Alice', 'de'), ($2, 'Bob', 'en')`,
    [ALICE, BOB],
  );
  await owner.query(
    `INSERT INTO app.workspaces (id, name, owner_account_id)
     VALUES ($1, 'Alice workspace', $3), ($2, 'Bob workspace', $4)`,
    [ALICE_WORKSPACE, BOB_WORKSPACE, ALICE, BOB],
  );
  await owner.query(
    `INSERT INTO app.boards (id, workspace_id, owner_account_id, title)
     VALUES ($1, $3, $5, 'Alice board'), ($2, $4, $6, 'Bob board')`,
    [ALICE_BOARD, BOB_BOARD, ALICE_WORKSPACE, BOB_WORKSPACE, ALICE, BOB],
  );
  await owner.query(
    "INSERT INTO app.notes (id, workspace_id, title) VALUES ($1, $2, 'Alice note'), ($3, $4, 'Bob note')",
    [ALICE_NOTE, ALICE_WORKSPACE, BOB_NOTE, BOB_WORKSPACE],
  );
  await owner.query(
    `INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z)
     VALUES (gen_random_uuid(), $1, $2, 0, 0, 240, 120, 'a0'),
            (gen_random_uuid(), $3, $4, 0, 0, 240, 120, 'a0')`,
    [ALICE_BOARD, ALICE_NOTE, BOB_BOARD, BOB_NOTE],
  );
});

after(async () => {
  if (owner !== undefined) {
    await owner
      .query("DELETE FROM app.workspaces WHERE id = ANY($1::uuid[])", [[ALICE_WORKSPACE, BOB_WORKSPACE]])
      .catch(() => undefined);
    await owner
      .query("DELETE FROM app.profiles WHERE account_id = ANY($1::uuid[])", [[ALICE, BOB]])
      .catch(() => undefined);
  }
  if (appUser !== undefined) {
    await appUser.end().catch(() => undefined);
  }
  if (owner !== undefined) {
    await owner.end().catch(() => undefined);
  }
  // Leave the slot database migrated and empty for the next gate.
  await resetSlotDatabase();
});

test("connects as the restricted app_user role with no bypass and no ownership", async () => {
  const role = (await appUser.query("SELECT current_user AS role")).rows[0];
  assert.equal(role.role, "app_user");

  const attributes = (
    await appUser.query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
       FROM pg_roles WHERE rolname = current_user`,
    )
  ).rows[0];
  assert.equal(attributes.rolsuper, false);
  assert.equal(attributes.rolbypassrls, false);
  assert.equal(attributes.rolcreatedb, false);
  assert.equal(attributes.rolcreaterole, false);
  assert.equal(attributes.rolreplication, false);

  const owned = await appUser.query(
    `SELECT c.relname FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'app' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user`,
  );
  assert.deepEqual(owned.rows, []);
});

test("row-level security is enabled and forced on every application table", async () => {
  const tables = await appUser.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'app' AND c.relkind = 'r'
     ORDER BY c.relname`,
  );
  assert.deepEqual(
    tables.rows.map((row) => row.relname),
    ["boards", "cards", "notes", "profiles", "workspace_members", "workspaces", "zones"],
  );
  for (const row of tables.rows) {
    assert.equal(row.relrowsecurity, true, `${row.relname} has RLS enabled`);
    assert.equal(row.relforcerowsecurity, true, `${row.relname} has RLS forced`);
  }
});

test("account A sees only its rows; account B sees only its rows", async () => {
  await asAccount(appUser, ALICE, async () => {
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.workspaces"), [ALICE_WORKSPACE]);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.boards"), [ALICE_BOARD]);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.notes"), [ALICE_NOTE]);
    const cards = await idsOf(appUser, "SELECT id FROM app.cards");
    assert.equal(cards.length, 1);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.workspaces WHERE id = $1", [BOB_WORKSPACE]), []);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.boards WHERE id = $1", [BOB_BOARD]), []);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.notes WHERE id = $1", [BOB_NOTE]), []);
  });

  await asAccount(appUser, BOB, async () => {
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.workspaces"), [BOB_WORKSPACE]);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.boards"), [BOB_BOARD]);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.notes"), [BOB_NOTE]);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.workspaces WHERE id = $1", [ALICE_WORKSPACE]), []);
  });
});

test("joins and pagination on a foreign table do not leak rows", async () => {
  await asAccount(appUser, ALICE, async () => {
    const joined = await appUser.query(
      `SELECT c.id FROM app.cards c
       JOIN app.boards b ON b.id = c.board_id
       JOIN app.notes n ON n.id = c.note_id
       JOIN app.workspaces w ON w.id = b.workspace_id`,
    );
    assert.equal(joined.rowCount, 1);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.boards ORDER BY created_at, id LIMIT 10"), [ALICE_BOARD]);
    assert.equal(
      (await appUser.query("SELECT count(*) AS count FROM app.notes WHERE workspace_id IN (SELECT id FROM app.workspaces)"))
        .rows[0].count,
      "1",
    );
    const foreignAsSubquery = await appUser.query(
      "SELECT count(*) AS count FROM app.boards WHERE workspace_id IN (SELECT id FROM app.workspaces WHERE id = $1)",
      [BOB_WORKSPACE],
    );
    assert.equal(foreignAsSubquery.rows[0].count, "0");
  });
});

test("cross-workspace writes fail for the app role", async () => {
  await asAccount(appUser, ALICE, async () => {
    assert.equal(
      (await appUser.query("UPDATE app.boards SET title = 'Hijacked' WHERE id = $1", [BOB_BOARD])).rowCount,
      0,
    );
    assert.equal(
      (await appUser.query("UPDATE app.notes SET title = 'Hijacked' WHERE id = $1", [BOB_NOTE])).rowCount,
      0,
    );
    assert.equal(
      (await appUser.query("DELETE FROM app.notes WHERE id = $1", [BOB_NOTE])).rowCount,
      0,
    );
    assert.equal(
      (await appUser.query("UPDATE app.workspaces SET name = 'Hijacked' WHERE id = $1", [BOB_WORKSPACE])).rowCount,
      0,
    );
    await expectStatementRejected(
      appUser,
      "INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES (gen_random_uuid(), $1, $2, 'Foreign')",
      [BOB_WORKSPACE, ALICE],
      /row-level security/,
    );
    await expectStatementRejected(
      appUser,
      "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES (gen_random_uuid(), $1, $2, 0, 0, 240, 120, 'a0')",
      [BOB_BOARD, BOB_NOTE],
      /row-level security/,
    );
    await expectStatementRejected(
      appUser,
      "INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES ($1, $2, 'reader')",
      [BOB_WORKSPACE, ALICE],
      /row-level security/,
    );
    await expectStatementRejected(
      appUser,
      "UPDATE app.notes SET workspace_id = $1 WHERE id = $2",
      [BOB_WORKSPACE, ALICE_NOTE],
      /moving a note|row-level security/,
    );
  });
});

test("no app.account_id means zero rows, not all rows", async () => {
  const connection = await connect(appDatabaseUrl());
  try {
    for (const table of ["profiles", "workspaces", "workspace_members", "boards", "notes", "cards"]) {
      assert.equal((await connection.query(`SELECT count(*) AS count FROM app.${table}`)).rows[0].count, "0");
    }
    assert.equal((await connection.query("SELECT app.current_account_id() AS account")).rows[0].account, null);
  } finally {
    await connection.end();
  }
});

test("a reused connection does not inherit the previous account", async () => {
  const connection = await connect(appDatabaseUrl());
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT set_config('app.account_id', $1, true)", [ALICE]);
    assert.equal((await connection.query("SELECT count(*) AS count FROM app.workspaces")).rows[0].count, "1");
    await connection.query("ROLLBACK");

    // Same connection, next transaction, no account: still zero rows.
    await connection.query("BEGIN");
    assert.equal((await connection.query("SELECT count(*) AS count FROM app.workspaces")).rows[0].count, "0");
    await connection.query("ROLLBACK");

    // A committed transaction must not leak its SET LOCAL either.
    await connection.query("BEGIN");
    await connection.query("SELECT set_config('app.account_id', $1, true)", [ALICE]);
    await connection.query("COMMIT");
    assert.equal((await connection.query("SELECT count(*) AS count FROM app.workspaces")).rows[0].count, "0");

    await connection.query("BEGIN");
    await connection.query("SELECT set_config('app.account_id', $1, true)", [BOB]);
    assert.deepEqual(await idsOf(connection, "SELECT id FROM app.workspaces"), [BOB_WORKSPACE]);
    await connection.query("ROLLBACK");
  } finally {
    await connection.end();
  }
});

test("P4-26: zones follow the board's isolation and a card cannot join a foreign zone", async () => {
  const ALICE_ZONE = "0192f0a5-7000-7000-8000-0000000000a1";
  const BOB_ZONE = "0192f0a5-7000-7000-8000-0000000000b1";
  const zoneInsert =
    "INSERT INTO app.zones (id, board_id, title, x, y, width, height, z) VALUES ($1, $2, 'Zone', 0, 0, 480, 320, 'a0')";
  await owner.query(zoneInsert, [ALICE_ZONE, ALICE_BOARD]);
  await owner.query(zoneInsert, [BOB_ZONE, BOB_BOARD]);
  try {
    await asAccount(appUser, ALICE, async () => {
      assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.zones"), [ALICE_ZONE]);
      assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.zones WHERE id = $1", [BOB_ZONE]), []);
      await expectStatementRejected(appUser, zoneInsert, ["0192f0a5-7000-7000-8000-0000000000a2", BOB_BOARD], /row-level security/);
      assert.equal((await appUser.query("UPDATE app.zones SET title = 'Taken' WHERE id = $1", [BOB_ZONE])).rowCount, 0);
      assert.equal((await appUser.query("DELETE FROM app.zones WHERE id = $1", [BOB_ZONE])).rowCount, 0);
      await expectStatementRejected(
        appUser,
        `INSERT INTO app.cards (id, board_id, note_id, zone_id, x, y, width, height, z)
         VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, 240, 120, 'a1')`,
        [ALICE_BOARD, ALICE_NOTE, BOB_ZONE],
        /cards_zone_fkey/,
      );

      // Own zone: write, place a card, delete the zone; the card stays on the board.
      const ownZone = "0192f0a5-7000-7000-8000-0000000000a3";
      await appUser.query(zoneInsert, [ownZone, ALICE_BOARD]);
      const card = (
        await appUser.query(
          `INSERT INTO app.cards (id, board_id, note_id, zone_id, x, y, width, height, z)
           VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, 240, 120, 'a1') RETURNING id`,
          [ALICE_BOARD, ALICE_NOTE, ownZone],
        )
      ).rows[0].id;
      assert.equal((await appUser.query("DELETE FROM app.zones WHERE id = $1", [ownZone])).rowCount, 1);
      const kept = (await appUser.query("SELECT zone_id FROM app.cards WHERE id = $1", [card])).rows[0];
      assert.equal(kept.zone_id, null);
    });

    await asAccount(appUser, BOB, async () => {
      assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.zones"), [BOB_ZONE]);
    });

    // A reader of Alice's workspace sees her zone but cannot write it.
    await owner.query("INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES ($1, $2, 'reader')", [
      ALICE_WORKSPACE,
      BOB,
    ]);
    await asAccount(appUser, BOB, async () => {
      assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.zones"), [ALICE_ZONE, BOB_ZONE].sort());
      await expectStatementRejected(appUser, zoneInsert, ["0192f0a5-7000-7000-8000-0000000000a4", ALICE_BOARD], /row-level security/);
      assert.equal((await appUser.query("UPDATE app.zones SET title = 'Read only' WHERE id = $1", [ALICE_ZONE])).rowCount, 0);
      assert.equal((await appUser.query("DELETE FROM app.zones WHERE id = $1", [ALICE_ZONE])).rowCount, 0);
    });
  } finally {
    await owner.query("DELETE FROM app.workspace_members WHERE workspace_id = $1 AND account_id = $2", [ALICE_WORKSPACE, BOB]);
    await owner.query("DELETE FROM app.zones WHERE id = ANY($1::uuid[])", [[ALICE_ZONE, BOB_ZONE]]);
  }
});
