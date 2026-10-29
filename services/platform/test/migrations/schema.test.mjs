/**
 * P3-02 schema tests: migrations and their bookkeeping, the six application
 * tables with their constraints, foreign keys and indexes, row-level security
 * enabled and forced, grants of the restricted `app_user` role, and rejected
 * invalid rows. Everything runs against the slot database; fixtures are
 * created as the slot owner and removed again.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";

import { loadMigrations } from "../../src/db/migrate.ts";
import { repositoryRoot } from "../helpers/slot.mjs";
import {
  APPLICATION_TABLES,
  applyMigrations,
  closeClient,
  connectAsOwner,
  inRollback,
  newId,
  removeFixtures,
} from "./support.mjs";

const migrationsDir = path.join(repositoryRoot(), "infra", "migrations");

const EXPECTED_COLUMNS = {
  profiles: ["account_id", "display_name", "locale", "created_at", "updated_at", "kratos_identity_id"],
  workspaces: ["id", "name", "owner_account_id", "created_at", "updated_at"],
  workspace_members: ["workspace_id", "account_id", "role", "created_at", "updated_at"],
  boards: ["id", "workspace_id", "owner_account_id", "title", "visibility", "archived", "created_at", "updated_at"],
  notes: ["id", "workspace_id", "title", "created_at", "updated_at"],
  cards: ["id", "board_id", "note_id", "zone_id", "x", "y", "width", "height", "z", "created_at", "updated_at"],
  zones: ["id", "board_id", "title", "x", "y", "width", "height", "z", "created_at", "updated_at"],
};

const EXPECTED_TYPES = {
  "profiles.account_id": "uuid",
  "profiles.display_name": "text",
  "profiles.locale": "text",
  "profiles.created_at": "timestamp with time zone",
  "profiles.updated_at": "timestamp with time zone",
  "profiles.kratos_identity_id": "uuid",
  "workspaces.id": "uuid",
  "workspaces.name": "text",
  "workspaces.owner_account_id": "uuid",
  "workspace_members.workspace_id": "uuid",
  "workspace_members.account_id": "uuid",
  "workspace_members.role": "app.workspace_role",
  "boards.id": "uuid",
  "boards.workspace_id": "uuid",
  "boards.owner_account_id": "uuid",
  "boards.title": "text",
  "boards.visibility": "app.board_visibility",
  "boards.archived": "boolean",
  "notes.id": "uuid",
  "notes.workspace_id": "uuid",
  "notes.title": "text",
  "cards.id": "uuid",
  "cards.board_id": "uuid",
  "cards.note_id": "uuid",
  "cards.zone_id": "uuid",
  "cards.x": "double precision",
  "cards.y": "double precision",
  "cards.width": "double precision",
  "cards.height": "double precision",
  "cards.z": "text",
  "cards.created_at": "timestamp with time zone",
  "cards.updated_at": "timestamp with time zone",
  "zones.id": "uuid",
  "zones.board_id": "uuid",
  "zones.title": "text",
  "zones.x": "double precision",
  "zones.y": "double precision",
  "zones.width": "double precision",
  "zones.height": "double precision",
  "zones.z": "text",
  "zones.created_at": "timestamp with time zone",
  "zones.updated_at": "timestamp with time zone",
};

const EXPECTED_POLICY_COMMANDS = {
  profiles_select_self: "SELECT",
  profiles_insert_self: "INSERT",
  profiles_update_self: "UPDATE",
  workspaces_select_member: "SELECT",
  workspaces_insert_owner: "INSERT",
  workspaces_update_writer: "UPDATE",
  workspaces_delete_owner: "DELETE",
  workspace_members_select_member: "SELECT",
  workspace_members_insert_owner: "INSERT",
  workspace_members_update_owner: "UPDATE",
  workspace_members_delete_owner: "DELETE",
  boards_select_member: "SELECT",
  boards_insert_writer: "INSERT",
  boards_update_writer: "UPDATE",
  boards_delete_writer: "DELETE",
  notes_select_member: "SELECT",
  notes_insert_writer: "INSERT",
  notes_update_writer: "UPDATE",
  notes_delete_writer: "DELETE",
  cards_select_member: "SELECT",
  cards_insert_writer: "INSERT",
  cards_update_writer: "UPDATE",
  cards_delete_writer: "DELETE",
  zones_select_member: "SELECT",
  zones_insert_writer: "INSERT",
  zones_update_writer: "UPDATE",
  zones_delete_writer: "DELETE",
};

const EXPECTED_FOREIGN_KEYS = [
  ["workspaces_owner_account_id_fkey", "workspaces", "profiles", "r"],
  ["workspace_members_workspace_id_fkey", "workspace_members", "workspaces", "c"],
  ["workspace_members_account_id_fkey", "workspace_members", "profiles", "c"],
  ["boards_workspace_id_fkey", "boards", "workspaces", "c"],
  ["boards_owner_account_id_fkey", "boards", "profiles", "r"],
  ["notes_workspace_id_fkey", "notes", "workspaces", "c"],
  ["cards_board_id_fkey", "cards", "boards", "c"],
  ["cards_note_id_fkey", "cards", "notes", "r"],
  ["cards_zone_fkey", "cards", "zones", "n"],
  ["zones_board_id_fkey", "zones", "boards", "c"],
];

const EXPECTED_INDEXES = [
  "workspaces_owner_account_id_idx",
  "workspace_members_account_id_idx",
  "boards_workspace_id_updated_at_idx",
  "boards_owner_account_id_idx",
  "notes_workspace_id_updated_at_idx",
  "cards_board_id_z_idx",
  "cards_note_id_idx",
  "cards_zone_id_idx",
  "profiles_kratos_identity_id_key",
  "zones_board_id_z_idx",
  "zones_board_id_id_key",
];

let owner;
const fixtures = {
  alice: newId(),
  bob: newId(),
  workspace: newId(),
  board: newId(),
  note: newId(),
  card: newId(),
};

async function expectSqlState(statement, sqlState) {
  await assert.rejects(statement, (error) => {
    assert.equal(error.code, sqlState, `expected SQLSTATE ${sqlState}, got ${error.code}: ${error.message}`);
    return true;
  });
}

before(async () => {
  await applyMigrations();
  owner = await connectAsOwner();
  await owner.query(
    "INSERT INTO app.profiles (account_id, display_name, locale) VALUES ($1, 'Alice', 'de'), ($2, 'Bob', 'en')",
    [fixtures.alice, fixtures.bob],
  );
  await owner.query(
    "INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, 'Schema workspace', $2)",
    [fixtures.workspace, fixtures.alice],
  );
  await owner.query(
    "INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES ($1, $2, 'reader')",
    [fixtures.workspace, fixtures.bob],
  );
  await owner.query(
    "INSERT INTO app.boards (id, workspace_id, owner_account_id, title, visibility) VALUES ($1, $2, $3, 'Board one', 'workspace')",
    [fixtures.board, fixtures.workspace, fixtures.alice],
  );
  await owner.query("INSERT INTO app.notes (id, workspace_id, title) VALUES ($1, $2, 'Note one')", [
    fixtures.note,
    fixtures.workspace,
  ]);
  await owner.query(
    "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 10, 20, 240, 120, 'a0')",
    [fixtures.card, fixtures.board, fixtures.note],
  );
});

after(async () => {
  if (owner !== undefined) {
    await removeFixtures(owner, [fixtures.workspace], [fixtures.alice, fixtures.bob]).catch(() => undefined);
  }
  await closeClient(owner);
});

test("applies the migrations once and records every version with its checksum", async () => {
  const files = await loadMigrations(migrationsDir);
  assert.deepEqual(
    files.map((file) => file.version),
    [
      "0001_app_schema",
      "0002_workspace_schema",
      "0003_rls_policies",
      "0004_account_mapping",
      "0005_zone_containers",
      "0006_sync_log",
    ],
  );

  const rows = (await owner.query("SELECT version, name, checksum FROM schema_migrations ORDER BY version")).rows;
  for (const file of files) {
    const row = rows.find((candidate) => candidate.version === file.version);
    assert.ok(row !== undefined, `schema_migrations is missing ${file.version}`);
    assert.equal(row.name, file.name);
    assert.equal(row.checksum, file.checksum);
  }

  const rerun = await applyMigrations();
  assert.deepEqual(rerun.applied, [], "a second migration run must be a no-op");
});

test("creates the six application tables with the expected columns and types", async () => {
  const tables = (
    await owner.query("SELECT tablename FROM pg_tables WHERE schemaname = 'app' ORDER BY tablename")
  ).rows.map((row) => row.tablename);
  assert.deepEqual(tables, [...APPLICATION_TABLES].sort());

  const columns = (
    await owner.query(`
      SELECT c.relname AS table_name, a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS data_type,
             a.attnotnull, a.atthasdef
      FROM pg_attribute AS a
      JOIN pg_class AS c ON c.oid = a.attrelid
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `)
  ).rows;

  for (const table of APPLICATION_TABLES) {
    const found = columns.filter((column) => column.table_name === table);
    assert.deepEqual(
      found.map((column) => column.column_name),
      EXPECTED_COLUMNS[table],
      `${table} columns`,
    );
    for (const column of found) {
      const expectedType = EXPECTED_TYPES[`${table}.${column.column_name}`];
      if (expectedType !== undefined) {
        assert.equal(column.data_type, expectedType, `${table}.${column.column_name} type`);
      }
      if (column.column_name === "created_at" || column.column_name === "updated_at") {
        assert.equal(column.attnotnull, true, `${table}.${column.column_name} is not null`);
        assert.equal(column.atthasdef, true, `${table}.${column.column_name} has a default`);
      }
      if (column.column_name === "zone_id") {
        assert.equal(column.attnotnull, false, "cards.zone_id is nullable");
      }
    }
  }
});

test("uses the contract enums for roles and board visibility", async () => {
  const rows = (
    await owner.query(`
      SELECT t.typname AS type_name, e.enumlabel AS label
      FROM pg_type AS t
      JOIN pg_enum AS e ON e.enumtypid = t.oid
      JOIN pg_namespace AS n ON n.oid = t.typnamespace
      WHERE n.nspname = 'app'
      ORDER BY t.typname, e.enumsortorder
    `)
  ).rows;
  const labelsOf = (typeName) => rows.filter((row) => row.type_name === typeName).map((row) => row.label);
  assert.deepEqual(labelsOf("workspace_role"), ["owner", "editor", "reader"]);
  assert.deepEqual(labelsOf("board_visibility"), ["private", "workspace", "link"]);
});

test("has the primary keys, check constraints, foreign-key delete rules and indexes", async () => {
  const constraints = (
    await owner.query(`
      SELECT con.conname, con.contype, rel.relname AS table_name,
             frel.relname AS referenced_table, con.confdeltype,
             pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint AS con
      JOIN pg_class AS rel ON rel.oid = con.conrelid
      JOIN pg_namespace AS n ON n.oid = rel.relnamespace
      LEFT JOIN pg_class AS frel ON frel.oid = con.confrelid
      WHERE n.nspname = 'app'
    `)
  ).rows;

  const primaryKeys = constraints.filter((constraint) => constraint.contype === "p").map((row) => row.conname);
  assert.deepEqual(
    primaryKeys.sort(),
    [
      "boards_pkey",
      "cards_pkey",
      "notes_pkey",
      "profiles_pkey",
      "workspace_members_pkey",
      "workspaces_pkey",
      "zones_pkey",
    ],
  );

  const checks = constraints.filter((constraint) => constraint.contype === "c").map((row) => row.conname);
  for (const expected of [
    "profiles_display_name_length",
    "profiles_locale_values",
    "workspaces_name_length",
    "boards_title_length",
    "notes_title_length",
    "cards_minimum_size",
    "cards_z_format",
    "zones_title_length",
    "zones_minimum_size",
    "zones_z_format",
  ]) {
    assert.ok(checks.includes(expected), `missing check constraint ${expected}`);
  }
  const minimumSize = constraints.find((row) => row.conname === "cards_minimum_size");
  assert.match(minimumSize.definition, /width >= \(?176/);
  assert.match(minimumSize.definition, /height >= \(?80/);

  const foreignKeys = constraints
    .filter((constraint) => constraint.contype === "f")
    .map((row) => [row.conname, row.table_name, row.referenced_table, row.confdeltype]);
  assert.deepEqual(foreignKeys.sort(), [...EXPECTED_FOREIGN_KEYS].sort());

  const indexes = (
    await owner.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'app'")
  ).rows.map((row) => row.indexname);
  for (const expected of EXPECTED_INDEXES) {
    assert.ok(indexes.includes(expected), `missing index ${expected}`);
  }
});

test("enables and forces row-level security on every table", async () => {
  const rows = (
    await owner.query(`
      SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind = 'r'
      ORDER BY c.relname
    `)
  ).rows;
  assert.deepEqual(
    rows.map((row) => row.table_name),
    [...APPLICATION_TABLES].sort(),
  );
  for (const row of rows) {
    assert.equal(row.relrowsecurity, true, `${row.table_name} has RLS enabled`);
    assert.equal(row.relforcerowsecurity, true, `${row.table_name} has RLS forced`);
  }
});

test("has a policy for every operation of the permission matrix, bound to app_user", async () => {
  const rows = (
    await owner.query(
      "SELECT tablename, policyname, cmd, array_to_string(roles, ',') AS roles FROM pg_policies WHERE schemaname = 'app' ORDER BY tablename, policyname",
    )
  ).rows;
  assert.deepEqual(
    rows.map((row) => row.policyname).sort(),
    Object.keys(EXPECTED_POLICY_COMMANDS).sort(),
  );
  for (const row of rows) {
    assert.equal(row.cmd, EXPECTED_POLICY_COMMANDS[row.policyname], `${row.policyname} command`);
    assert.equal(row.roles, "app_user", `${row.policyname} applies to app_user only`);
  }
});

test("gives app_user CRUD grants but no superuser, bypass or table ownership", async () => {
  const role = (
    await owner.query(
      "SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname = 'app_user'",
    )
  ).rows[0];
  assert.ok(role !== undefined, "app_user role exists (run bash tools/dev/setup)");
  assert.equal(role.rolcanlogin, true);
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  assert.equal(role.rolcreatedb, false);
  assert.equal(role.rolcreaterole, false);
  assert.equal(role.rolreplication, false);

  const owned = (
    await owner.query(`
      SELECT c.relname
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      JOIN pg_roles AS r ON r.oid = c.relowner
      WHERE n.nspname = 'app' AND c.relkind = 'r' AND r.rolname = 'app_user'
    `)
  ).rows;
  assert.deepEqual(owned, []);

  for (const table of APPLICATION_TABLES) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const result = await owner.query("SELECT has_table_privilege('app_user', $1, $2) AS granted", [
        `app.${table}`,
        privilege,
      ]);
      assert.equal(result.rows[0].granted, true, `app_user must have ${privilege} on app.${table}`);
    }
  }
});

test("creating a workspace creates the owner membership atomically", async () => {
  const workspace = newId();
  await inRollback(owner, async () => {
    await owner.query("INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, 'Atomic', $2)", [
      workspace,
      fixtures.alice,
    ]);
    const members = (
      await owner.query("SELECT account_id, role FROM app.workspace_members WHERE workspace_id = $1", [workspace])
    ).rows;
    assert.deepEqual(members, [{ account_id: fixtures.alice, role: "owner" }]);
  });
});

test("rejects invalid rows", async (t) => {
  const query = owner.query.bind(owner);

  await t.test("an orphan board", async () => {
    await expectSqlState(
      query("INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Orphan')", [
        newId(),
        newId(),
        fixtures.alice,
      ]),
      "23503",
    );
  });

  await t.test("a workspace with a missing owner profile", async () => {
    await expectSqlState(
      query("INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, 'No profile', $2)", [
        newId(),
        newId(),
      ]),
      "23503",
    );
  });

  await t.test("a card without a note", async () => {
    await expectSqlState(
      query(
        "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 240, 120, 'a0')",
        [newId(), fixtures.board, newId()],
      ),
      "23503",
    );
  });

  await t.test("a card with a note from another workspace", async () => {
    await inRollback(owner, async () => {
      const otherWorkspace = newId();
      const otherNote = newId();
      await query("INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, 'Other', $2)", [
        otherWorkspace,
        fixtures.alice,
      ]);
      await query("INSERT INTO app.notes (id, workspace_id, title) VALUES ($1, $2, 'Foreign note')", [
        otherNote,
        otherWorkspace,
      ]);
      await assert.rejects(
        query(
          "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 240, 120, 'a0')",
          [newId(), fixtures.board, otherNote],
        ),
        /a card must place a note of the board workspace/,
      );
    });
  });

  await t.test("a card below the minimum size", async () => {
    await expectSqlState(
      query(
        "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 100, 100, 'a0')",
        [newId(), fixtures.board, fixtures.note],
      ),
      "23514",
    );
  });

  await t.test("a card with an invalid fractional z", async () => {
    await expectSqlState(
      query(
        "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 240, 120, 'not a fraction')",
        [newId(), fixtures.board, fixtures.note],
      ),
      "23514",
    );
  });

  await t.test("a note title above the contract limit", async () => {
    await expectSqlState(
      query("INSERT INTO app.notes (id, workspace_id, title) VALUES ($1, $2, $3)", [
        newId(),
        fixtures.workspace,
        "n".repeat(301),
      ]),
      "23514",
    );
  });

  await t.test("a workspace name above the contract limit", async () => {
    await expectSqlState(
      query("INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, $2, $3)", [
        newId(),
        "w".repeat(121),
        fixtures.alice,
      ]),
      "23514",
    );
  });

  await t.test("a display name above the contract limit", async () => {
    await expectSqlState(
      query("INSERT INTO app.profiles (account_id, display_name) VALUES ($1, $2)", [newId(), "d".repeat(81)]),
      "23514",
    );
  });

  await t.test("an unknown locale", async () => {
    await expectSqlState(
      query("INSERT INTO app.profiles (account_id, display_name, locale) VALUES ($1, 'Franz', 'fr')", [newId()]),
      "23514",
    );
  });

  await t.test("a duplicate membership", async () => {
    await expectSqlState(
      query("INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES ($1, $2, 'editor')", [
        fixtures.workspace,
        fixtures.bob,
      ]),
      "23505",
    );
  });

  await t.test("removing or demoting the owner membership", async () => {
    await assert.rejects(
      query("DELETE FROM app.workspace_members WHERE workspace_id = $1 AND account_id = $2", [
        fixtures.workspace,
        fixtures.alice,
      ]),
      /owner membership/,
    );
    await assert.rejects(
      query("UPDATE app.workspace_members SET role = 'editor' WHERE workspace_id = $1 AND account_id = $2", [
        fixtures.workspace,
        fixtures.alice,
      ]),
      /owner membership/,
    );
  });

  await t.test("transferring workspace ownership", async () => {
    await assert.rejects(
      query("UPDATE app.workspaces SET owner_account_id = $1 WHERE id = $2", [fixtures.bob, fixtures.workspace]),
      /ownership transfer/,
    );
  });

  await t.test("deleting a note that still has cards", async () => {
    await expectSqlState(query("DELETE FROM app.notes WHERE id = $1", [fixtures.note]), "23503");
  });

  await t.test("deleting a board cascades its cards and keeps the note", async () => {
    await inRollback(owner, async () => {
      const board = newId();
      const note = newId();
      const card = newId();
      await query("INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Doomed')", [
        board,
        fixtures.workspace,
        fixtures.alice,
      ]);
      await query("INSERT INTO app.notes (id, workspace_id, title) VALUES ($1, $2, 'Kept')", [note, fixtures.workspace]);
      await query(
        "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 240, 120, 'a0')",
        [card, board, note],
      );
      await query("DELETE FROM app.boards WHERE id = $1", [board]);
      assert.equal(Number((await query("SELECT count(*) FROM app.cards WHERE id = $1", [card])).rows[0].count), 0);
      assert.equal(Number((await query("SELECT count(*) FROM app.notes WHERE id = $1", [note])).rows[0].count), 1);
    });
  });

  await t.test("deleting a workspace cascades every child row", async () => {
    await inRollback(owner, async () => {
      const workspace = newId();
      const board = newId();
      const note = newId();
      const card = newId();
      await query("INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, 'Cascade', $2)", [
        workspace,
        fixtures.alice,
      ]);
      await query("INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'B')", [
        board,
        workspace,
        fixtures.alice,
      ]);
      await query("INSERT INTO app.notes (id, workspace_id, title) VALUES ($1, $2, 'N')", [note, workspace]);
      await query(
        "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 240, 120, 'a0')",
        [card, board, note],
      );
      await query("DELETE FROM app.workspaces WHERE id = $1", [workspace]);
      for (const [table, condition] of [
        ["workspace_members", "workspace_id"],
        ["boards", "id"],
        ["notes", "id"],
        ["cards", "id"],
      ]) {
        const value = table === "workspace_members" ? workspace : { boards: board, notes: note, cards: card }[table];
        const result = await query(`SELECT count(*) FROM app.${table} WHERE ${condition} = $1`, [value]);
        assert.equal(Number(result.rows[0].count), 0, `${table} must be gone`);
      }
    });
  });
});

test("P3-06: migration 0004 backfills the mapping only for legacy non-v7 account ids", async () => {
  const legacyV4 = "5f0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
  const modernV7 = "0192f0a1-7000-7000-8000-0000000000e1";
  await owner.query(
    "INSERT INTO app.profiles (account_id, display_name, locale) VALUES ($1, 'Legacy', 'de'), ($2, 'Modern', 'en')",
    [legacyV4, modernV7],
  );
  try {
    // Rewind only 0004: 0001-0003 stay applied, then let the runner apply 0004.
    await owner.query("DELETE FROM schema_migrations WHERE version = '0004_account_mapping'");
    await owner.query("DROP FUNCTION app.account_for_kratos_identity(uuid)");
    await owner.query("DROP INDEX app.profiles_kratos_identity_id_key");
    await owner.query("ALTER TABLE app.profiles DROP COLUMN kratos_identity_id");

    const rerun = await applyMigrations();
    assert.deepEqual(rerun.applied, ["0004_account_mapping"]);

    const rows = (
      await owner.query(
        `SELECT account_id::text AS account_id, kratos_identity_id::text AS kratos_identity_id
         FROM app.profiles WHERE account_id = ANY($1::uuid[])`,
        [[legacyV4, modernV7]],
      )
    ).rows;
    const legacy = rows.find((row) => row.account_id === legacyV4);
    const modern = rows.find((row) => row.account_id === modernV7);
    assert.equal(legacy.kratos_identity_id, legacyV4, "a legacy v4 account id records its identity");
    assert.equal(modern.kratos_identity_id, null, "a v7 account id stays unmapped");
  } finally {
    await owner.query("DELETE FROM app.profiles WHERE account_id = ANY($1::uuid[])", [[legacyV4, modernV7]]);
  }
});

test("P4-26: a card parent is a zone of the same board, and zones are not nested", async (t) => {
  const query = owner.query.bind(owner);
  const insertZone = (id, boardId) =>
    query(
      "INSERT INTO app.zones (id, board_id, title, x, y, width, height, z) VALUES ($1, $2, 'Zone', 0, 0, 480, 320, 'a0')",
      [id, boardId],
    );
  const insertCard = (id, boardId, zoneId) =>
    query(
      "INSERT INTO app.cards (id, board_id, note_id, zone_id, x, y, width, height, z) VALUES ($1, $2, $3, $4, 0, 0, 240, 120, 'a1')",
      [id, boardId, fixtures.note, zoneId],
    );

  await t.test("zones carry no parent column and the card key is composite with SET NULL (zone_id)", async () => {
    const columns = (
      await query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'zones'",
      )
    ).rows.map((row) => row.column_name);
    assert.equal(columns.includes("zone_id"), false, "a zone cannot live in a zone");
    const key = (
      await query(
        "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'cards_zone_fkey'",
      )
    ).rows[0];
    assert.match(key.definition, /FOREIGN KEY \(board_id, zone_id\) REFERENCES app\.zones\(board_id, id\)/);
    assert.match(key.definition, /ON DELETE SET NULL \(zone_id\)/);
  });

  await t.test("a card in a zone of its own board is accepted", async () => {
    await inRollback(owner, async () => {
      const zone = newId();
      const card = newId();
      await insertZone(zone, fixtures.board);
      await insertCard(card, fixtures.board, zone);
      const row = (await query("SELECT zone_id FROM app.cards WHERE id = $1", [card])).rows[0];
      assert.equal(row.zone_id, zone);
    });
  });

  await t.test("a zone of another board, an unknown id and a card id are rejected", async () => {
    await inRollback(owner, async () => {
      const otherBoard = newId();
      const otherZone = newId();
      await query("INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Other')", [
        otherBoard,
        fixtures.workspace,
        fixtures.alice,
      ]);
      await insertZone(otherZone, otherBoard);
      await query("SAVEPOINT probe");
      for (const parent of [otherZone, newId(), fixtures.card]) {
        await expectSqlState(insertCard(newId(), fixtures.board, parent), "23503");
        await query("ROLLBACK TO SAVEPOINT probe");
      }
      await expectSqlState(
        query("UPDATE app.cards SET zone_id = $1 WHERE id = $2", [otherZone, fixtures.card]),
        "23503",
      );
    });
  });

  await t.test("deleting a zone keeps its cards on the board", async () => {
    await inRollback(owner, async () => {
      const zone = newId();
      const card = newId();
      await insertZone(zone, fixtures.board);
      await insertCard(card, fixtures.board, zone);
      await query("DELETE FROM app.zones WHERE id = $1", [zone]);
      const row = (await query("SELECT board_id, zone_id FROM app.cards WHERE id = $1", [card])).rows[0];
      assert.deepEqual(row, { board_id: fixtures.board, zone_id: null });
    });
  });

  await t.test("deleting a board cascades its zones and zoned cards", async () => {
    await inRollback(owner, async () => {
      const board = newId();
      const zone = newId();
      const card = newId();
      await query("INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Doomed')", [
        board,
        fixtures.workspace,
        fixtures.alice,
      ]);
      await insertZone(zone, board);
      await insertCard(card, board, zone);
      await query("DELETE FROM app.boards WHERE id = $1", [board]);
      assert.equal(Number((await query("SELECT count(*) FROM app.zones WHERE id = $1", [zone])).rows[0].count), 0);
      assert.equal(Number((await query("SELECT count(*) FROM app.cards WHERE id = $1", [card])).rows[0].count), 0);
    });
  });

  await t.test("a zone cannot move to another board", async () => {
    await inRollback(owner, async () => {
      const otherBoard = newId();
      const zone = newId();
      await query("INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Other')", [
        otherBoard,
        fixtures.workspace,
        fixtures.alice,
      ]);
      await insertZone(zone, fixtures.board);
      await assert.rejects(
        query("UPDATE app.zones SET board_id = $1 WHERE id = $2", [otherBoard, zone]),
        /moving a zone to another board/,
      );
    });
  });

  await t.test("the contract zone limits are enforced", async () => {
    await expectSqlState(
      query(
        "INSERT INTO app.zones (id, board_id, title, x, y, width, height, z) VALUES ($1, $2, 'Small', 0, 0, 255, 192, 'a0')",
        [newId(), fixtures.board],
      ),
      "23514",
    );
    await expectSqlState(
      query(
        "INSERT INTO app.zones (id, board_id, title, x, y, width, height, z) VALUES ($1, $2, '', 0, 0, 480, 320, 'a0')",
        [newId(), fixtures.board],
      ),
      "23514",
    );
    await expectSqlState(
      query(
        "INSERT INTO app.zones (id, board_id, title, x, y, width, height, z) VALUES ($1, $2, 'Bad z', 0, 0, 480, 320, 'a-0')",
        [newId(), fixtures.board],
      ),
      "23514",
    );
  });
});

test("P4-26: migration 0005 upgrades a 0004 database and drops unresolvable parents", async () => {
  const legacyCard = newId();
  const legacyZone = newId();
  try {
    // Rewind only 0005, keep a 0004-era card whose zone_id names no zone, then
    // let the runner apply 0005 again.
    await owner.query("DELETE FROM schema_migrations WHERE version = '0005_zone_containers'");
    await owner.query("DROP TABLE app.zones CASCADE");
    await owner.query("DROP FUNCTION app.protect_zone_board()");
    await owner.query(
      "INSERT INTO app.cards (id, board_id, note_id, zone_id, x, y, width, height, z) VALUES ($1, $2, $3, $4, 0, 0, 240, 120, 'a2')",
      [legacyCard, fixtures.board, fixtures.note, legacyZone],
    );

    const rerun = await applyMigrations();
    assert.deepEqual(rerun.applied, ["0005_zone_containers"]);
    const row = (await owner.query("SELECT zone_id FROM app.cards WHERE id = $1", [legacyCard])).rows[0];
    assert.equal(row.zone_id, null, "a legacy parent that cannot resolve becomes board level");
    const again = await applyMigrations();
    assert.deepEqual(again.applied, []);
  } finally {
    await owner.query("DELETE FROM app.cards WHERE id = $1", [legacyCard]);
  }
});
