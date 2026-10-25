/**
 * P3-02 row-level-security tests.
 *
 * Fixtures are created as the slot owner; every policy check runs as the
 * restricted `app_user` role inside a transaction whose `app.account_id` is set
 * with `set_config(..., true)` (the equivalent of `SET LOCAL`). Mutations are
 * rolled back, so the slot database only keeps the fixtures during the run and
 * loses them again in `after()`.
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
  boardA: newId(),
  boardB: newId(),
  noteA: newId(),
  noteB: newId(),
  cardA: newId(),
};

async function idsOf(client, sql, parameters = []) {
  const rows = (await client.query(sql, parameters)).rows;
  return rows.map((row) => row.id).sort();
}

/** Runs one statement as `accountId` in its own transaction and expects a rejection. */
async function expectRejectedAs(accountId, statement, parameters, pattern) {
  await assert.rejects(asAccount(appUser, accountId, () => appUser.query(statement, parameters)), pattern);
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
  await owner.query(
    "INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, 'Workspace A', $2), ($3, 'Workspace B', $4)",
    [fixtures.workspaceA, fixtures.alice, fixtures.workspaceB, fixtures.bob],
  );
  await owner.query(
    `INSERT INTO app.workspace_members (workspace_id, account_id, role)
     VALUES ($1, $2, 'editor'), ($1, $3, 'reader')`,
    [fixtures.workspaceA, fixtures.bob, fixtures.carol],
  );
  await owner.query(
    `INSERT INTO app.boards (id, workspace_id, owner_account_id, title)
     VALUES ($1, $2, $3, 'Board A'), ($4, $5, $6, 'Board B')`,
    [fixtures.boardA, fixtures.workspaceA, fixtures.alice, fixtures.boardB, fixtures.workspaceB, fixtures.bob],
  );
  await owner.query(
    "INSERT INTO app.notes (id, workspace_id, title) VALUES ($1, $2, 'Note A'), ($3, $4, 'Note B')",
    [fixtures.noteA, fixtures.workspaceA, fixtures.noteB, fixtures.workspaceB],
  );
  await owner.query(
    "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 240, 120, 'a0')",
    [fixtures.cardA, fixtures.boardA, fixtures.noteA],
  );
});

after(async () => {
  if (owner !== undefined) {
    await removeFixtures(owner, [fixtures.workspaceA, fixtures.workspaceB], [
      fixtures.alice,
      fixtures.bob,
      fixtures.carol,
    ]).catch(() => undefined);
  }
  await closeClient(appUser);
  await closeClient(owner);
});

test("returns null and no rows when app.account_id is unset", async () => {
  const client = await connectAsAppUser();
  try {
    const helper = await client.query("SELECT app.current_account_id() AS account_id");
    assert.equal(helper.rows[0].account_id, null);
    for (const table of APPLICATION_TABLES) {
      const result = await client.query(`SELECT count(*) AS count FROM app.${table}`);
      assert.equal(Number(result.rows[0].count), 0, `${table} must be empty without an account`);
    }
  } finally {
    await closeClient(client);
  }
});

test("does not leak app.account_id into the next transaction", async () => {
  await asAccount(appUser, fixtures.alice, async () => {
    const visible = await appUser.query("SELECT count(*) AS count FROM app.workspaces");
    assert.equal(Number(visible.rows[0].count), 1);
  });
  const afterTransaction = await appUser.query("SELECT count(*) AS count FROM app.workspaces");
  assert.equal(Number(afterTransaction.rows[0].count), 0, "the SET LOCAL value must be gone after rollback");
});

test("a member sees only rows of their own workspaces", async () => {
  await asAccount(appUser, fixtures.alice, async () => {
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.workspaces"), [fixtures.workspaceA]);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.boards"), [fixtures.boardA]);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.notes"), [fixtures.noteA]);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.cards"), [fixtures.cardA]);

    const foreign = await idsOf(appUser, "SELECT id FROM app.workspaces WHERE id = $1", [fixtures.workspaceB]);
    assert.deepEqual(foreign, []);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.boards WHERE id = $1", [fixtures.boardB]), []);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.notes WHERE id = $1", [fixtures.noteB]), []);

    const profiles = await idsOf(appUser, "SELECT account_id AS id FROM app.profiles");
    assert.deepEqual(profiles, [fixtures.alice]);
  });
});

test("the owner sees the membership list of their workspace only", async () => {
  await asAccount(appUser, fixtures.alice, async () => {
    const members = (
      await appUser.query("SELECT account_id, role FROM app.workspace_members ORDER BY role")
    ).rows;
    assert.deepEqual(members, [
      { account_id: fixtures.alice, role: "owner" },
      { account_id: fixtures.bob, role: "editor" },
      { account_id: fixtures.carol, role: "reader" },
    ]);
  });
  await asAccount(appUser, fixtures.carol, async () => {
    const members = await appUser.query("SELECT count(*) AS count FROM app.workspace_members");
    assert.equal(Number(members.rows[0].count), 3, "a reader sees the members of their workspace");
  });
});

test("an account cannot insert rows into a foreign workspace", async () => {
  await expectRejectedAs(
    fixtures.alice,
    "INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Sneaky')",
    [newId(), fixtures.workspaceB, fixtures.alice],
    /row-level security/,
  );
  await expectRejectedAs(
    fixtures.alice,
    "INSERT INTO app.notes (id, workspace_id, title) VALUES ($1, $2, 'Sneaky')",
    [newId(), fixtures.workspaceB],
    /row-level security/,
  );
  await expectRejectedAs(
    fixtures.alice,
    "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 240, 120, 'a0')",
    [newId(), fixtures.boardB, fixtures.noteB],
    /row-level security/,
  );
});

test("an account cannot create a workspace for somebody else", async () => {
  await asAccount(appUser, fixtures.alice, async () => {
    await assert.rejects(
      appUser.query("INSERT INTO app.workspaces (id, name, owner_account_id) VALUES ($1, 'Spoofed', $2)", [
        newId(),
        fixtures.bob,
      ]),
      /row-level security/,
    );
  });
});

test("an owner can write, delete and manage membership", async () => {
  await asAccount(appUser, fixtures.alice, async () => {
    const renamed = await appUser.query("UPDATE app.workspaces SET name = 'Workspace A (renamed)' WHERE id = $1", [
      fixtures.workspaceA,
    ]);
    assert.equal(renamed.rowCount, 1);

    const board = newId();
    const insertedBoard = await appUser.query(
      "INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Owner board')",
      [board, fixtures.workspaceA, fixtures.alice],
    );
    assert.equal(insertedBoard.rowCount, 1);

    const removed = await appUser.query(
      "DELETE FROM app.workspace_members WHERE workspace_id = $1 AND account_id = $2",
      [fixtures.workspaceA, fixtures.carol],
    );
    assert.equal(removed.rowCount, 1, "the owner may remove a member");
    const member = await appUser.query(
      "INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES ($1, $2, 'editor')",
      [fixtures.workspaceA, fixtures.carol],
    );
    assert.equal(member.rowCount, 1, "the owner may add a member");

    const deletedBoard = await appUser.query("DELETE FROM app.boards WHERE id = $1", [fixtures.boardA]);
    assert.equal(deletedBoard.rowCount, 1);

    const deletedWorkspace = await appUser.query("DELETE FROM app.workspaces WHERE id = $1", [fixtures.workspaceA]);
    assert.equal(deletedWorkspace.rowCount, 1);
  });
});

test("an editor can write but cannot manage the workspace", async () => {
  await expectRejectedAs(
    fixtures.bob,
    "INSERT INTO app.workspace_members (workspace_id, account_id, role) VALUES ($1, $2, 'reader')",
    [fixtures.workspaceA, fixtures.carol],
    /row-level security/,
  );
  await asAccount(appUser, fixtures.bob, async () => {
    const renamedBoard = await appUser.query("UPDATE app.boards SET title = 'Board A (edited)' WHERE id = $1", [
      fixtures.boardA,
    ]);
    assert.equal(renamedBoard.rowCount, 1, "an editor may edit boards of the workspace");

    const renamedWorkspace = await appUser.query("UPDATE app.workspaces SET name = 'Workspace A (editor)' WHERE id = $1", [
      fixtures.workspaceA,
    ]);
    assert.equal(renamedWorkspace.rowCount, 1, "an editor may edit the workspace it belongs to");

    const board = newId();
    const insertedBoard = await appUser.query(
      "INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Editor board')",
      [board, fixtures.workspaceA, fixtures.bob],
    );
    assert.equal(insertedBoard.rowCount, 1);

    const deletedBoard = await appUser.query("DELETE FROM app.boards WHERE id = $1", [fixtures.boardA]);
    assert.equal(deletedBoard.rowCount, 1, "an editor may delete boards of the workspace");

    const deletedWorkspace = await appUser.query("DELETE FROM app.workspaces WHERE id = $1", [fixtures.workspaceA]);
    assert.equal(deletedWorkspace.rowCount, 0, "only the owner may delete the workspace");
  });
});

test("an editor cannot claim board ownership for somebody else", async () => {
  await asAccount(appUser, fixtures.bob, async () => {
    await assert.rejects(
      appUser.query("INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Spoofed')", [
        newId(),
        fixtures.workspaceA,
        fixtures.alice,
      ]),
      /row-level security/,
    );
  });
});

test("a reader can only read", async () => {
  await expectRejectedAs(
    fixtures.carol,
    "INSERT INTO app.boards (id, workspace_id, owner_account_id, title) VALUES ($1, $2, $3, 'Reader')",
    [newId(), fixtures.workspaceA, fixtures.carol],
    /row-level security/,
  );
  await asAccount(appUser, fixtures.carol, async () => {
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.workspaces"), [fixtures.workspaceA]);
    assert.deepEqual(await idsOf(appUser, "SELECT id FROM app.boards"), [fixtures.boardA]);

    const updated = await appUser.query("UPDATE app.boards SET title = 'Reader edit' WHERE id = $1", [
      fixtures.boardA,
    ]);
    assert.equal(updated.rowCount, 0);
    const deleted = await appUser.query("DELETE FROM app.cards WHERE id = $1", [fixtures.cardA]);
    assert.equal(deleted.rowCount, 0);
  });
});

test("a card cannot attach a note from a foreign workspace", async () => {
  await asAccount(appUser, fixtures.bob, async () => {
    await assert.rejects(
      appUser.query(
        "INSERT INTO app.cards (id, board_id, note_id, x, y, width, height, z) VALUES ($1, $2, $3, 0, 0, 240, 120, 'a0')",
        [newId(), fixtures.boardA, fixtures.noteB],
      ),
      /a card must place a note of the board workspace|row-level security/,
    );
  });
});

test("the owner membership row cannot be changed or removed", async () => {
  await expectRejectedAs(
    fixtures.alice,
    "UPDATE app.workspace_members SET role = 'editor' WHERE workspace_id = $1 AND account_id = $2",
    [fixtures.workspaceA, fixtures.alice],
    /owner membership/,
  );
  await expectRejectedAs(
    fixtures.alice,
    "DELETE FROM app.workspace_members WHERE workspace_id = $1 AND account_id = $2",
    [fixtures.workspaceA, fixtures.alice],
    /owner membership/,
  );
});

test("profiles are visible and writable only for the owning account", async () => {
  await asAccount(appUser, fixtures.alice, async () => {
    const updated = await appUser.query("UPDATE app.profiles SET display_name = 'Alice A.' WHERE account_id = $1", [
      fixtures.alice,
    ]);
    assert.equal(updated.rowCount, 1);

    const foreignUpdate = await appUser.query(
      "UPDATE app.profiles SET display_name = 'Hijacked' WHERE account_id = $1",
      [fixtures.bob],
    );
    assert.equal(foreignUpdate.rowCount, 0);

    await assert.rejects(
      appUser.query("INSERT INTO app.profiles (account_id, display_name) VALUES ($1, 'Fake Bob')", [fixtures.bob]),
      /row-level security|duplicate key/,
    );
  });
});
