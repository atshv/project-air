/**
 * P3-02 review regressions (F1, F2, F3, F4, F5, F6).
 *
 * These tests cover the invariants that the first review found bypassable:
 * notes/boards cannot be moved between workspaces, exactly one owner membership
 * exists per workspace and cannot be forged, the owner of a workspace cannot be
 * deleted, a malformed `app.account_id` yields no rows instead of an error, the
 * contract minimum lengths are enforced, the SECURITY DEFINER helpers are not
 * executable by PUBLIC and do not answer for foreign workspaces.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  APPLICATION_TABLES,
  applyMigrations,
  asAccount,
  closeClient,
  connectAsAppUser,
  connectAsOwner,
  inRollback,
  newId,
  removeFixtures,
} from "./support.mjs";

let owner;
let appUser;

const fixtures = {
  alice: newId(),
  bob: newId(),
  carol: newId(),
  workspaceA: newId(),
  workspaceB: newId(),
  foreignWorkspace: newId(),
  boardA: newId(),
  boardB: newId(),
  foreignBoard: newId(),
  noteA: newId(),
  noteB: newId(),
  foreignNote: newId(),
  cardA: newId(),
};

async function expectRejectedAs(accountId, statement, parameters, pattern) {
  await assert.rejects(asAccount(appUser, accountId, () => appUser.query(statement, parameters)), pattern);
}

async function expectSqlState(statement, sqlState) {
  await assert.rejects(statement, (error) => {
    assert.equal(error.code, sqlState, `expected SQLSTATE ${sqlState}, got ${error.code}: ${error.message}`);
    return true;
  });
}

before(async () => {
  await applyMigrations();
  owner = await connectAsOwner();
  appUser = await connectAsAppUser();

  await owner.query(
    `INSERT INTO app.profiles (account_id, display_name, locale)
     VALUES ($1, 'Alice', 'de'), ($2, 'Bob', 'en'), ($3, 'Carol', 'de')`,
    [fixtures.alice, fixtures.bob, fixtures.carol],
  );
  // Alice owns workspace A and workspace B on purpose: she is a writer of both,
  // which is exactly the situation in which the review moved a note/board.
  await owner.query(
    `INSERT INTO app.workspaces (id, name, owner_account_id)
     VALUES ($1, 'Workspace A', $4), ($2, 'Workspace B', $4), ($3, 'Foreign workspace', $5)`,
    [fixtures.workspaceA, fixtures.workspaceB, fixtures.foreignWorkspace, fixtures.alice, fixtures.bob],
  );
  await owner.query(
    `INSERT INTO app.workspace_members (workspace_id, account_id, role)
     VALUES ($1, $2, 'editor'), ($1, $3, 'reader')`,
    [fixtures.workspaceA, fixtures.bob, fixtures.carol],
  );
  await owner.query(
    `INSERT INTO app.boards (id, workspace_id, owner_account_id, title)
     VALUES ($1, $2, $5, 'Board A'), ($3, $4, $5, 'Board B'), ($6, $7, $8, 'Foreign board')`,
    [
      fixtures.boardA,
      fixtures.workspaceA,
      fixtures.boardB,
      fixtures.workspaceB,
      fixtures.alice,
      fixtures.foreignBoard,
      fixtures.foreignWorkspace,
      fixtures.bob,
    ],
  );
  await owner.query(
    `INSERT INTO app.notes (id, workspace_id, title)
     VALUES ($1, $2, 'Note A'), ($3, $4, 'Note B'), ($5, $6, 'Foreign note')`,
    [
      fixtures.noteA,
      fixtures.workspaceA,
      fixtures.noteB,
      fixtures.workspaceB,
      fixtures.foreignNote,
      fixtures.foreignWorkspace,
    ],
  );
  await owner.query(
    "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 240, 120, 'a0')",
    [fixtures.cardA, fixtures.boardA, fixtures.noteA],
  );
});

after(async () => {
  if (owner !== undefined) {
    await removeFixtures(
      owner,
      [fixtures.workspaceA, fixtures.workspaceB, fixtures.foreignWorkspace],
      [fixtures.alice, fixtures.bob, fixtures.carol],
    ).catch(() => undefined);
  }
  await closeClient(appUser);
  await closeClient(owner);
});

test("F1: a note cannot be moved to another workspace, even by a writer of both", async () => {
  await expectRejectedAs(
    fixtures.alice,
    "UPDATE app.notes SET workspace_id = $1 WHERE id = $2",
    [fixtures.workspaceB, fixtures.noteA],
    /moving a note to another workspace/,
  );
  const inconsistent = await owner.query(`
    SELECT count(*) AS count
    FROM app.cards AS card
    JOIN app.boards AS board ON board.id = card.board_id
    JOIN app.notes AS note ON note.id = card.note_id
    WHERE board.workspace_id <> note.workspace_id
  `);
  assert.equal(Number(inconsistent.rows[0].count), 0, "the card/note workspace invariant must hold");
});

test("F1: a board cannot be moved to another workspace, even by a writer of both", async () => {
  await expectRejectedAs(
    fixtures.alice,
    "UPDATE app.boards SET workspace_id = $1 WHERE id = $2",
    [fixtures.workspaceB, fixtures.boardA],
    /moving a board to another workspace/,
  );
  const inconsistent = await owner.query(`
    SELECT count(*) AS count
    FROM app.cards AS card
    JOIN app.boards AS board ON board.id = card.board_id
    JOIN app.notes AS note ON note.id = card.note_id
    WHERE board.workspace_id <> note.workspace_id
  `);
  assert.equal(Number(inconsistent.rows[0].count), 0, "the card/note workspace invariant must hold");
});

test("F2: a member cannot be promoted to the owner role", async () => {
  await expectRejectedAs(
    fixtures.alice,
    "UPDATE app.workspace_members SET role = 'owner' WHERE workspace_id = $1 AND account_id = $2",
    [fixtures.workspaceA, fixtures.bob],
    /only the workspace owner may hold the owner role/,
  );
  const owners = await owner.query(
    "SELECT workspace_id, count(*) AS count FROM app.workspace_members WHERE role = 'owner' GROUP BY workspace_id",
  );
  for (const row of owners.rows) {
    assert.equal(Number(row.count), 1, `workspace ${row.workspace_id} must have exactly one owner`);
  }
});

test("F2: an owner membership row cannot be inserted directly", async () => {
  await expectRejectedAs(
    fixtures.alice,
    "INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES ($1, $2, 'owner')",
    [fixtures.workspaceA, fixtures.alice],
    /cannot be inserted directly|duplicate key/,
  );
  await expectRejectedAs(
    fixtures.alice,
    "INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES ($1, $2, 'owner')",
    [fixtures.workspaceA, fixtures.bob],
    /only the workspace owner may hold the owner role/,
  );
});

test("F5: as app_user, creating a workspace creates exactly one owner row", async () => {
  const workspace = newId();
  await asAccount(appUser, fixtures.alice, async () => {
    const inserted = await appUser.query(
      "INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, 'Created by app_user', $2)",
      [workspace, fixtures.alice],
    );
    assert.equal(inserted.rowCount, 1);

    const owners = (
      await appUser.query(
        "SELECT account_id, role FROM app.workspace_members WHERE workspace_id = $1 AND role = 'owner'",
        [workspace],
      )
    ).rows;
    assert.deepEqual(owners, [{ account_id: fixtures.alice, role: "owner" }]);
  });
  assert.equal(
    Number((await owner.query("SELECT count(*) AS count FROM app.workspaces WHERE id = $1", [workspace])).rows[0].count),
    0,
    "the transaction was rolled back",
  );
});

test("F2: the owner of a workspace cannot be deleted, a member can", async () => {
  await inRollback(owner, async () => {
    await assert.rejects(
      owner.query("DELETE FROM app.profiles WHERE account_id = $1", [fixtures.alice]),
      /the owner of a workspace cannot be deleted while the workspace exists/,
    );
  });
  await inRollback(owner, async () => {
    const deleted = await owner.query("DELETE FROM app.profiles WHERE account_id = $1", [fixtures.carol]);
    assert.equal(deleted.rowCount, 1, "a plain member profile can be deleted, cascading its memberships");
  });
});

test("F4: a malformed app.account_id yields no rows instead of an error", async () => {
  for (const malformed of ["not-a-uuid", "", "123e4567-e89b-12d3-a456-426614174000x"]) {
    await asAccount(appUser, malformed, async () => {
      const helper = await appUser.query("SELECT app.current_account_id() AS account_id");
      assert.equal(helper.rows[0].account_id, null, `setting ${JSON.stringify(malformed)} must parse to null`);
      for (const table of APPLICATION_TABLES) {
        const result = await appUser.query(`SELECT count(*) AS count FROM app.${table}`);
        assert.equal(Number(result.rows[0].count), 0, `${table} must be empty for ${JSON.stringify(malformed)}`);
      }
    });
  }
});

test("F6: the contract minimum lengths are enforced", async () => {
  await expectSqlState(
    owner.query("INSERT INTO app.profiles (account_id, display_name) VALUES ($1, '')", [newId()]),
    "23514",
  );
  await expectSqlState(
    owner.query("INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, '', $2)", [newId(), fixtures.alice]),
    "23514",
  );
  await expectSqlState(
    owner.query("INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, '')", [
      newId(),
      fixtures.workspaceA,
      fixtures.alice,
    ]),
    "23514",
  );
  // Note.title has minLength 0 in the contract, so an empty title stays valid.
  await inRollback(owner, async () => {
    const inserted = await owner.query("INSERT INTO app.notes (id, workspace_id, title) VALUES ($1, $2, '')", [
      newId(),
      fixtures.workspaceA,
    ]);
    assert.equal(inserted.rowCount, 1);
  });
});

test("F3: the helpers are executable by app_user only", async () => {
  const publicExecute = (
    await owner.query(`
      SELECT p.proname AS name
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app'
        AND EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        )
      ORDER BY p.proname
    `)
  ).rows.map((row) => row.name);
  assert.deepEqual(publicExecute, [], "no app function may be executable by PUBLIC");

  const appUserAccess = await owner.query("SELECT has_function_privilege('app_user', 'app.current_account_id()', 'EXECUTE') AS granted");
  assert.equal(appUserAccess.rows[0].granted, true, "app_user may call the policy helpers");
  const mappingAccess = await owner.query(
    "SELECT has_function_privilege('app_user', 'app.account_for_kratos_identity(uuid)', 'EXECUTE') AS granted",
  );
  assert.equal(mappingAccess.rows[0].granted, true, "app_user may resolve the identity mapping");
});

test("P3-06: the identity mapping helper returns one account id and the index is unique", async () => {
  const kratosIdentity = "5f0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
  await owner.query("UPDATE app.profiles SET kratos_identity_id = $1 WHERE account_id = $2", [
    kratosIdentity,
    fixtures.alice,
  ]);

  const mapped = await appUser.query("SELECT app.account_for_kratos_identity($1::uuid) AS account_id", [kratosIdentity]);
  assert.equal(mapped.rows[0].account_id, fixtures.alice);

  const unknown = await appUser.query("SELECT app.account_for_kratos_identity($1::uuid) AS account_id", [newId()]);
  assert.equal(unknown.rows[0].account_id, null);

  await inRollback(owner, async () => {
    await assert.rejects(
      owner.query("UPDATE app.profiles SET kratos_identity_id = $1 WHERE account_id = $2", [
        kratosIdentity,
        fixtures.bob,
      ]),
      (error) => error.code === "23505",
      "one profile per Kratos identity",
    );
  });
});

test("F3: the note/board helper does not answer for a foreign workspace", async () => {
  await asAccount(appUser, fixtures.alice, async () => {
    const own = await appUser.query("SELECT app.note_in_board_workspace($1, $2) AS allowed", [
      fixtures.noteA,
      fixtures.boardA,
    ]);
    assert.equal(own.rows[0].allowed, true);

    const foreign = await appUser.query("SELECT app.note_in_board_workspace($1, $2) AS allowed", [
      fixtures.foreignNote,
      fixtures.foreignBoard,
    ]);
    assert.equal(foreign.rows[0].allowed, false, "a foreign pair must not be distinguishable from a missing pair");
  });
});
