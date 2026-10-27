/**
 * api-tests (P3-04): every contract route has an allow case and a deny case.
 *
 * Boots the auth service (AUTH_TEST_MODE=1) and the platform API in-process on
 * ephemeral ports against the slot database, resets + migrates in `before`, and
 * closes servers/pools in `after`. The API connects as the restricted app_user
 * and sets app.account_id per request (AD-5), so the allow cases prove the RLS
 * wiring, not just the handler logic.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import pg from "pg";

import { createUuid } from "../../src/http/request-id.ts";
import { silentLogger } from "../../src/log.ts";
import { startService } from "../../src/server.ts";
import { databaseUrl } from "../helpers/slot.mjs";
import {
  apiRequest,
  freePort,
  grantMembership,
  mintSession,
  resetSlotDatabase,
  startAuthService,
  startPlatform,
} from "./helpers.mjs";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const { Client } = pg;

const ALICE = "0192f0a1-7000-7000-8000-000000000001";
const BOB = "0192f0a1-7000-7000-8000-000000000002";
const CAROL = "0192f0a1-7000-7000-8000-000000000003";
const DAVE = "0192f0a1-7000-7000-8000-000000000004";

let platform;
let authService;
let sessions;
const ids = {};

function newId() {
  return createUuid();
}

function request(session, method, path, body) {
  return apiRequest(platform.baseUrl, { method, path, session, body });
}

async function ownerQuery(sql, parameters = []) {
  const client = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await client.query(sql, parameters);
  } finally {
    await client.end();
  }
}

function expectKeys(body, expected) {
  assert.deepEqual(Object.keys(body).sort(), [...expected].sort());
}

function expectError(result, status, code, messageKey) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.code, code);
  assert.equal(result.body.messageKey, messageKey);
  assert.match(result.body.requestId, UUID_V7);
}

async function createWorkspace(session, name, ownerId) {
  const requestId = newId();
  const result = await request(session, "POST", "/v1/workspaces", { requestId, workspace: { name, ownerId } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.requestId, requestId);
  return result.body.workspace;
}

async function createBoard(session, workspaceId, title, ownerId) {
  const requestId = newId();
  const result = await request(session, "POST", `/v1/workspaces/${workspaceId}/boards`, {
    requestId,
    board: { workspaceId, ownerId, title, visibility: "workspace" },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.board;
}

async function createNote(session, workspaceId, title) {
  const requestId = newId();
  const result = await request(session, "POST", `/v1/workspaces/${workspaceId}/notes`, {
    requestId,
    note: { workspaceId, title },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.note;
}

async function createCard(session, boardId, noteId, overrides = {}) {
  const requestId = newId();
  const card = {
    boardId,
    noteId,
    zoneId: null,
    x: 10,
    y: 20,
    width: 240,
    height: 120,
    z: "a0",
    ...overrides,
  };
  const result = await request(session, "POST", `/v1/boards/${boardId}/cards`, { requestId, card });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.card;
}

before(async () => {
  await resetSlotDatabase();
  const authPort = await freePort();
  authService = await startAuthService({ port: authPort });
  platform = await startPlatform({ authServiceUrl: authService.baseUrl });

  sessions = {
    alice: await mintSession(authService.baseUrl, ALICE),
    bob: await mintSession(authService.baseUrl, BOB),
    carol: await mintSession(authService.baseUrl, CAROL),
    dave: await mintSession(authService.baseUrl, DAVE),
  };

  ids.workspace = (await createWorkspace(sessions.alice, "Alpha", ALICE)).id;
  ids.secondWorkspace = (await createWorkspace(sessions.alice, "Beta", ALICE)).id;
  ids.foreignWorkspace = (await createWorkspace(sessions.bob, "Bob's space", BOB)).id;
  await grantMembership(ids.workspace, BOB, "editor", "Bob");
  await grantMembership(ids.workspace, CAROL, "reader", "Carol");

  ids.board = (await createBoard(sessions.alice, ids.workspace, "Board one", ALICE)).id;
  ids.note = (await createNote(sessions.alice, ids.workspace, "Note one")).id;
  ids.card = (await createCard(sessions.alice, ids.board, ids.note)).id;

  ids.foreignBoard = (await createBoard(sessions.bob, ids.foreignWorkspace, "Foreign board", BOB)).id;
  ids.foreignNote = (await createNote(sessions.bob, ids.foreignWorkspace, "Foreign note")).id;
  ids.foreignCard = (await createCard(sessions.bob, ids.foreignBoard, ids.foreignNote)).id;
});

after(async () => {
  if (platform !== undefined) {
    await platform.close();
  }
  if (authService !== undefined) {
    await authService.stop();
  }
  // Leave the slot database migrated and empty for the next gate.
  await resetSlotDatabase();
});

test("GET /v1/workspaces: member list with pagination envelope and no leak", async () => {
  const result = await request(sessions.alice, "GET", "/v1/workspaces");
  assert.equal(result.status, 200);
  expectKeys(result.body, ["requestId", "items", "nextCursor"]);
  assert.ok(Array.isArray(result.body.items));
  assert.ok(result.body.items.some((workspace) => workspace.id === ids.workspace));
  assert.ok(result.body.items.every((workspace) => workspace.ownerId === ALICE));

  const dave = await request(sessions.dave, "GET", "/v1/workspaces");
  assert.equal(dave.status, 200);
  assert.deepEqual(dave.body.items, []);
  assert.equal(dave.body.nextCursor, null);

  expectError(await request(undefined, "GET", "/v1/workspaces"), 401, "AUTH_REQUIRED", "errors.authRequired");
});

test("POST /v1/workspaces: create with contract envelope; invalid or spoofed bodies denied", async () => {
  const requestId = newId();
  const created = await request(sessions.alice, "POST", "/v1/workspaces", {
    requestId,
    workspace: { name: "Created", ownerId: ALICE },
  });
  assert.equal(created.status, 201);
  expectKeys(created.body, ["requestId", "workspace"]);
  assert.equal(created.body.requestId, requestId);
  assert.match(created.body.workspace.id, UUID_V7);
  assert.equal(created.body.workspace.name, "Created");
  assert.equal(created.body.workspace.ownerId, ALICE);

  const invalid = await request(sessions.alice, "POST", "/v1/workspaces", {
    requestId: newId(),
    workspace: { name: "", ownerId: ALICE },
  });
  expectError(invalid, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(invalid.body.details.fields, ["workspace.name"]);

  expectError(
    await request(sessions.alice, "POST", "/v1/workspaces", {
      requestId: newId(),
      workspace: { name: "Spoofed", ownerId: BOB },
    }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );

  const missingRequestId = await request(sessions.alice, "POST", "/v1/workspaces", {
    workspace: { name: "No request id", ownerId: ALICE },
  });
  assert.equal(missingRequestId.status, 400);
  assert.deepEqual(missingRequestId.body.details.fields, ["requestId"]);
});

test("GET /v1/workspaces/:id: member read; foreign and malformed ids are NOT_FOUND", async () => {
  const result = await request(sessions.alice, "GET", `/v1/workspaces/${ids.workspace}`);
  assert.equal(result.status, 200);
  expectKeys(result.body, ["requestId", "workspace"]);
  assert.equal(result.body.workspace.id, ids.workspace);

  const requestedId = newId();
  const echoed = await request(sessions.alice, "GET", `/v1/workspaces/${ids.workspace}?requestId=${requestedId}`);
  assert.equal(echoed.body.requestId, requestedId);

  expectError(await request(sessions.alice, "GET", `/v1/workspaces/${ids.foreignWorkspace}`), 404, "NOT_FOUND", "errors.notFound");
  expectError(await request(sessions.dave, "GET", `/v1/workspaces/${ids.workspace}`), 404, "NOT_FOUND", "errors.notFound");
  expectError(await request(sessions.alice, "GET", "/v1/workspaces/not-a-uuid"), 404, "NOT_FOUND", "errors.notFound");
});

test("PATCH /v1/workspaces/:id: owner/editor may rename; reader and non-member are denied", async () => {
  const requestId = newId();
  const updated = await request(sessions.alice, "PATCH", `/v1/workspaces/${ids.workspace}`, {
    requestId,
    workspaceId: ids.workspace,
    changes: { name: "Alpha renamed" },
  });
  assert.equal(updated.status, 200);
  expectKeys(updated.body, ["requestId", "workspace"]);
  assert.equal(updated.body.requestId, requestId);
  assert.equal(updated.body.workspace.name, "Alpha renamed");

  const editor = await request(sessions.bob, "PATCH", `/v1/workspaces/${ids.workspace}`, {
    requestId: newId(),
    workspaceId: ids.workspace,
    changes: { name: "Alpha by editor" },
  });
  assert.equal(editor.status, 200, "an editor may update the workspace");

  expectError(
    await request(sessions.carol, "PATCH", `/v1/workspaces/${ids.workspace}`, {
      requestId: newId(),
      workspaceId: ids.workspace,
      changes: { name: "Reader edit" },
    }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  expectError(
    await request(sessions.alice, "PATCH", `/v1/workspaces/${ids.foreignWorkspace}`, {
      requestId: newId(),
      workspaceId: ids.foreignWorkspace,
      changes: { name: "Foreign edit" },
    }),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
  expectError(
    await request(sessions.alice, "PATCH", `/v1/workspaces/${ids.workspace}`, {
      requestId: newId(),
      workspaceId: ids.workspace,
      changes: {},
    }),
    400,
    "VALIDATION",
    "errors.validation",
  );
});

test("DELETE /v1/workspaces/:id: owner deletes; editor and non-member are denied", async () => {
  const temporary = await createWorkspace(sessions.alice, "Temporary", ALICE);
  const requestId = newId();
  const deleted = await request(sessions.alice, "DELETE", `/v1/workspaces/${temporary.id}`, {
    requestId,
    workspaceId: temporary.id,
  });
  assert.equal(deleted.status, 200);
  expectKeys(deleted.body, ["requestId", "deletedId"]);
  assert.equal(deleted.body.requestId, requestId);
  assert.equal(deleted.body.deletedId, temporary.id);
  expectError(await request(sessions.alice, "GET", `/v1/workspaces/${temporary.id}`), 404, "NOT_FOUND", "errors.notFound");

  expectError(
    await request(sessions.bob, "DELETE", `/v1/workspaces/${ids.workspace}`, {
      requestId: newId(),
      workspaceId: ids.workspace,
    }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  expectError(
    await request(sessions.alice, "DELETE", `/v1/workspaces/${ids.foreignWorkspace}`, {
      requestId: newId(),
      workspaceId: ids.foreignWorkspace,
    }),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
});

test("GET /v1/workspaces/:id/boards: members list; non-member is NOT_FOUND", async () => {
  const result = await request(sessions.carol, "GET", `/v1/workspaces/${ids.workspace}/boards`);
  assert.equal(result.status, 200);
  expectKeys(result.body, ["requestId", "items", "nextCursor"]);
  assert.ok(result.body.items.some((board) => board.id === ids.board));
  expectError(
    await request(sessions.alice, "GET", `/v1/workspaces/${ids.foreignWorkspace}/boards`),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
});

test("POST /v1/workspaces/:id/boards: editor creates; reader, non-member and invalid bodies denied", async () => {
  const created = await createBoard(sessions.bob, ids.workspace, "Editor board", BOB);
  assert.equal(created.ownerId, BOB);
  assert.equal(created.workspaceId, ids.workspace);

  expectError(
    await request(sessions.carol, "POST", `/v1/workspaces/${ids.workspace}/boards`, {
      requestId: newId(),
      board: { workspaceId: ids.workspace, ownerId: CAROL, title: "Reader board", visibility: "private" },
    }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  expectError(
    await request(sessions.alice, "POST", `/v1/workspaces/${ids.foreignWorkspace}/boards`, {
      requestId: newId(),
      board: { workspaceId: ids.foreignWorkspace, ownerId: ALICE, title: "Foreign", visibility: "private" },
    }),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
  const invalid = await request(sessions.alice, "POST", `/v1/workspaces/${ids.workspace}/boards`, {
    requestId: newId(),
    board: { workspaceId: ids.workspace, ownerId: ALICE, title: "", visibility: "private" },
  });
  expectError(invalid, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(invalid.body.details.fields, ["board.title"]);
});

test("GET /v1/boards/:id: member read; foreign id is NOT_FOUND", async () => {
  const result = await request(sessions.carol, "GET", `/v1/boards/${ids.board}`);
  assert.equal(result.status, 200);
  expectKeys(result.body, ["requestId", "board"]);
  assert.equal(result.body.board.id, ids.board);
  expectError(await request(sessions.dave, "GET", `/v1/boards/${ids.board}`), 404, "NOT_FOUND", "errors.notFound");
  expectError(await request(sessions.alice, "GET", `/v1/boards/${ids.foreignBoard}`), 404, "NOT_FOUND", "errors.notFound");
});

test("PATCH /v1/boards/:id: editor updates; reader, non-member and invalid changes denied", async () => {
  const requestId = newId();
  const updated = await request(sessions.bob, "PATCH", `/v1/boards/${ids.board}`, {
    requestId,
    boardId: ids.board,
    changes: { title: "Board one edited", visibility: "link", archived: true },
  });
  assert.equal(updated.status, 200);
  expectKeys(updated.body, ["requestId", "board"]);
  assert.equal(updated.body.requestId, requestId);
  assert.equal(updated.body.board.title, "Board one edited");
  assert.equal(updated.body.board.visibility, "link");
  assert.equal(updated.body.board.archived, true);

  expectError(
    await request(sessions.carol, "PATCH", `/v1/boards/${ids.board}`, {
      requestId: newId(),
      boardId: ids.board,
      changes: { title: "Reader edit" },
    }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  expectError(
    await request(sessions.dave, "PATCH", `/v1/boards/${ids.board}`, {
      requestId: newId(),
      boardId: ids.board,
      changes: { title: "Foreign edit" },
    }),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
  expectError(
    await request(sessions.alice, "PATCH", `/v1/boards/${ids.board}`, {
      requestId: newId(),
      boardId: ids.board,
      changes: {},
    }),
    400,
    "VALIDATION",
    "errors.validation",
  );
});

test("DELETE /v1/boards/:id: editor deletes; reader and non-member are denied", async () => {
  const temporary = await createBoard(sessions.alice, ids.workspace, "Temporary board", ALICE);
  const requestId = newId();
  const deleted = await request(sessions.bob, "DELETE", `/v1/boards/${temporary.id}`, {
    requestId,
    boardId: temporary.id,
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deletedId, temporary.id);

  expectError(
    await request(sessions.carol, "DELETE", `/v1/boards/${ids.board}`, { requestId: newId(), boardId: ids.board }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  expectError(
    await request(sessions.dave, "DELETE", `/v1/boards/${ids.board}`, { requestId: newId(), boardId: ids.board }),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
});

test("GET /v1/workspaces/:id/notes: members list; non-member is NOT_FOUND", async () => {
  const result = await request(sessions.carol, "GET", `/v1/workspaces/${ids.workspace}/notes`);
  assert.equal(result.status, 200);
  expectKeys(result.body, ["requestId", "items", "nextCursor"]);
  assert.ok(result.body.items.some((note) => note.id === ids.note));
  expectError(
    await request(sessions.alice, "GET", `/v1/workspaces/${ids.foreignWorkspace}/notes`),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
});

test("POST /v1/workspaces/:id/notes: editor creates; reader and oversize titles denied", async () => {
  const created = await createNote(sessions.bob, ids.workspace, "Editor note");
  assert.equal(created.workspaceId, ids.workspace);

  expectError(
    await request(sessions.carol, "POST", `/v1/workspaces/${ids.workspace}/notes`, {
      requestId: newId(),
      note: { workspaceId: ids.workspace, title: "Reader note" },
    }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  const invalid = await request(sessions.alice, "POST", `/v1/workspaces/${ids.workspace}/notes`, {
    requestId: newId(),
    note: { workspaceId: ids.workspace, title: "n".repeat(301) },
  });
  expectError(invalid, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(invalid.body.details.fields, ["note.title"]);
});

test("GET /v1/notes/:id: member read; foreign id is NOT_FOUND", async () => {
  const result = await request(sessions.carol, "GET", `/v1/notes/${ids.note}`);
  assert.equal(result.status, 200);
  expectKeys(result.body, ["requestId", "note"]);
  assert.equal(result.body.note.id, ids.note);
  expectError(await request(sessions.dave, "GET", `/v1/notes/${ids.note}`), 404, "NOT_FOUND", "errors.notFound");
});

test("PATCH /v1/notes/:id: editor updates; reader and non-member are denied", async () => {
  const requestId = newId();
  const updated = await request(sessions.bob, "PATCH", `/v1/notes/${ids.note}`, {
    requestId,
    noteId: ids.note,
    changes: { title: "Note one edited" },
  });
  assert.equal(updated.status, 200);
  expectKeys(updated.body, ["requestId", "note"]);
  assert.equal(updated.body.requestId, requestId);
  assert.equal(updated.body.note.title, "Note one edited");

  expectError(
    await request(sessions.carol, "PATCH", `/v1/notes/${ids.note}`, {
      requestId: newId(),
      noteId: ids.note,
      changes: { title: "Reader edit" },
    }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  expectError(
    await request(sessions.dave, "PATCH", `/v1/notes/${ids.note}`, {
      requestId: newId(),
      noteId: ids.note,
      changes: { title: "Foreign edit" },
    }),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
});

test("DELETE /v1/notes/:id: editor deletes; note with cards is CONFLICT; reader denied", async () => {
  const temporary = await createNote(sessions.alice, ids.workspace, "Temporary note");
  const deleted = await request(sessions.bob, "DELETE", `/v1/notes/${temporary.id}`, {
    requestId: newId(),
    noteId: temporary.id,
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deletedId, temporary.id);

  const withCards = await request(sessions.bob, "DELETE", `/v1/notes/${ids.note}`, {
    requestId: newId(),
    noteId: ids.note,
  });
  expectError(withCards, 409, "CONFLICT", "errors.conflict");

  expectError(
    await request(sessions.carol, "DELETE", `/v1/notes/${ids.note}`, { requestId: newId(), noteId: ids.note }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
});

test("GET /v1/boards/:id/cards: members list; non-member is NOT_FOUND", async () => {
  const result = await request(sessions.carol, "GET", `/v1/boards/${ids.board}/cards`);
  assert.equal(result.status, 200);
  expectKeys(result.body, ["requestId", "items", "nextCursor"]);
  assert.ok(result.body.items.some((card) => card.id === ids.card));
  for (const card of result.body.items) {
    assert.equal(card.boardId, ids.board);
    assert.match(card.noteId, UUID_V7);
  }
  expectError(
    await request(sessions.alice, "GET", `/v1/boards/${ids.foreignBoard}/cards`),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
});

test("POST /v1/boards/:id/cards: editor creates; reader, foreign and invalid cards denied", async () => {
  const created = await createCard(sessions.bob, ids.board, ids.note, { z: "a1", x: 20, y: 30 });
  assert.equal(created.boardId, ids.board);
  assert.equal(created.noteId, ids.note);

  expectError(
    await request(sessions.carol, "POST", `/v1/boards/${ids.board}/cards`, {
      requestId: newId(),
      card: { boardId: ids.board, noteId: ids.note, zoneId: null, x: 0, y: 0, width: 240, height: 120, z: "a0" },
    }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  expectError(
    await request(sessions.alice, "POST", `/v1/boards/${ids.foreignBoard}/cards`, {
      requestId: newId(),
      card: {
        boardId: ids.foreignBoard,
        noteId: ids.foreignNote,
        zoneId: null,
        x: 0,
        y: 0,
        width: 240,
        height: 120,
        z: "a0",
      },
    }),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
  const foreignNote = await request(sessions.bob, "POST", `/v1/boards/${ids.board}/cards`, {
    requestId: newId(),
    card: {
      boardId: ids.board,
      noteId: ids.foreignNote,
      zoneId: null,
      x: 0,
      y: 0,
      width: 240,
      height: 120,
      z: "a0",
    },
  });
  expectError(foreignNote, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(foreignNote.body.details.fields, ["card.noteId"]);

  const tooSmall = await request(sessions.bob, "POST", `/v1/boards/${ids.board}/cards`, {
    requestId: newId(),
    card: { boardId: ids.board, noteId: ids.note, zoneId: null, x: 0, y: 0, width: 100, height: 120, z: "a0" },
  });
  expectError(tooSmall, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(tooSmall.body.details.fields, ["card.width"]);
});

test("GET /v1/cards/:id: member read; foreign id is NOT_FOUND", async () => {
  const result = await request(sessions.carol, "GET", `/v1/cards/${ids.card}`);
  assert.equal(result.status, 200);
  expectKeys(result.body, ["requestId", "card"]);
  assert.equal(result.body.card.id, ids.card);
  assert.equal(result.body.card.zoneId, null);
  expectError(await request(sessions.dave, "GET", `/v1/cards/${ids.card}`), 404, "NOT_FOUND", "errors.notFound");
  expectError(await request(sessions.alice, "GET", `/v1/cards/${ids.foreignCard}`), 404, "NOT_FOUND", "errors.notFound");
});

test("PATCH /v1/cards/:id: editor updates geometry/z; reader, foreign and invalid values denied", async () => {
  const requestId = newId();
  const updated = await request(sessions.bob, "PATCH", `/v1/cards/${ids.card}`, {
    requestId,
    cardId: ids.card,
    changes: { x: 640, y: 480, width: 300, height: 200, z: "a2", zoneId: null },
  });
  assert.equal(updated.status, 200);
  expectKeys(updated.body, ["requestId", "card"]);
  assert.equal(updated.body.requestId, requestId);
  assert.equal(updated.body.card.x, 640);
  assert.equal(updated.body.card.z, "a2");

  expectError(
    await request(sessions.carol, "PATCH", `/v1/cards/${ids.card}`, {
      requestId: newId(),
      cardId: ids.card,
      changes: { x: 1 },
    }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  expectError(
    await request(sessions.dave, "PATCH", `/v1/cards/${ids.card}`, {
      requestId: newId(),
      cardId: ids.card,
      changes: { x: 1 },
    }),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
  const invalid = await request(sessions.bob, "PATCH", `/v1/cards/${ids.card}`, {
    requestId: newId(),
    cardId: ids.card,
    changes: { z: "not a fraction" },
  });
  expectError(invalid, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(invalid.body.details.fields, ["changes.z"]);
});

test("DELETE /v1/cards/:id: editor deletes; reader and non-member are denied", async () => {
  const temporary = await createCard(sessions.alice, ids.board, ids.note, { z: "a5" });
  const requestId = newId();
  const deleted = await request(sessions.bob, "DELETE", `/v1/cards/${temporary.id}`, {
    requestId,
    cardId: temporary.id,
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deletedId, temporary.id);

  expectError(
    await request(sessions.carol, "DELETE", `/v1/cards/${ids.card}`, { requestId: newId(), cardId: ids.card }),
    403,
    "FORBIDDEN",
    "errors.forbidden",
  );
  expectError(
    await request(sessions.dave, "DELETE", `/v1/cards/${ids.card}`, { requestId: newId(), cardId: ids.card }),
    404,
    "NOT_FOUND",
    "errors.notFound",
  );
});

test("cursor pagination: stable pages, limit 1-100 and malformed cursors", async () => {
  for (const name of ["P1", "P2", "P3"]) {
    await createWorkspace(sessions.alice, name, ALICE);
  }
  const first = await request(sessions.alice, "GET", "/v1/workspaces?limit=2");
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 2);
  assert.equal(typeof first.body.nextCursor, "string");

  const second = await request(sessions.alice, "GET", `/v1/workspaces?limit=2&cursor=${first.body.nextCursor}`);
  assert.equal(second.status, 200);
  assert.ok(Array.isArray(second.body.items));
  const firstIds = new Set(first.body.items.map((workspace) => workspace.id));
  for (const workspace of second.body.items) {
    assert.equal(firstIds.has(workspace.id), false, "pages must not overlap");
  }

  for (const query of ["limit=0", "limit=101", "limit=abc"]) {
    const result = await request(sessions.alice, "GET", `/v1/workspaces?${query}`);
    expectError(result, 400, "VALIDATION", "errors.validation");
    assert.deepEqual(result.body.details.fields, ["limit"]);
  }
  const badCursor = await request(sessions.alice, "GET", "/v1/workspaces?cursor=not_a_cursor!!");
  expectError(badCursor, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(badCursor.body.details.fields, ["cursor"]);

  const empty = await request(sessions.dave, "GET", "/v1/workspaces");
  assert.deepEqual(empty.body.items, []);
  assert.equal(empty.body.nextCursor, null);
});

test("list requestId: the query envelope value is echoed in the response", async () => {
  const requestId = newId();
  const result = await request(sessions.alice, "GET", `/v1/workspaces?requestId=${requestId}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.requestId, requestId);
});

test("P3-06: GET /v1/session returns the resolved UUIDv7 account id only", async () => {
  const v7Identity = "0192f0a1-7000-7000-8000-0000000000d1";
  const v7Session = await mintSession(authService.baseUrl, v7Identity);
  const v7Result = await request(v7Session, "GET", "/v1/session");
  assert.equal(v7Result.status, 200);
  assert.deepEqual(Object.keys(v7Result.body).sort(), ["accountId", "requestId"]);
  assert.match(v7Result.body.requestId, UUID_V7);
  assert.equal(v7Result.body.accountId, v7Identity, "a v7 identity is the account id directly");

  const v4Identity = "5f0c1a2b-3c4d-4e5f-ba6b-7c8d9e0f1a2b";
  const v4Session = await mintSession(authService.baseUrl, v4Identity);
  const requestedId = newId();
  const v4Result = await request(v4Session, "GET", `/v1/session?requestId=${requestedId}`);
  assert.equal(v4Result.status, 200);
  assert.equal(v4Result.body.requestId, requestedId, "GET errors and successes echo the query requestId");
  assert.match(v4Result.body.accountId, UUID_V7);
  assert.notEqual(v4Result.body.accountId, v4Identity, "the Kratos identity id is not an account id");
  assert.equal(JSON.stringify(v4Result.body).includes(v4Identity), false, "the identity id never leaves the API");

  const anonymous = await request(undefined, "GET", "/v1/session");
  expectError(anonymous, 401, "AUTH_REQUIRED", "errors.authRequired");
});

test("P3-06/F2: a UUIDv4 identity maps to one UUIDv7 account and contract-valid resources", async () => {
  const identity = "5f0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
  const session = await mintSession(authService.baseUrl, identity);
  // A real client learns its contract id only from GET /v1/session.
  const sessionResponse = await request(session, "GET", "/v1/session");
  assert.equal(sessionResponse.status, 200);
  const accountId = sessionResponse.body.accountId;
  assert.match(accountId, UUID_V7);

  const profiles = await ownerQuery(
    `SELECT account_id::text AS account_id, kratos_identity_id::text AS kratos_identity_id
     FROM app.profiles WHERE kratos_identity_id = $1`,
    [identity],
  );
  assert.equal(profiles.rows.length, 1, "one mapped profile after the first request");
  assert.equal(profiles.rows[0].account_id, accountId, "the session route exposes the mapped account id");
  assert.equal(profiles.rows[0].kratos_identity_id, identity);
  const asAccount = await ownerQuery("SELECT count(*)::int AS count FROM app.profiles WHERE account_id::text = $1", [
    identity,
  ]);
  assert.equal(asAccount.rows[0].count, 0, "the Kratos identity id never becomes an account id");

  const workspace = await createWorkspace(session, "Mapped workspace", accountId);
  const board = await createBoard(session, workspace.id, "Mapped board", accountId);
  const note = await createNote(session, workspace.id, "Mapped note");
  const card = await createCard(session, board.id, note.id);
  for (const resource of [workspace, board, note, card]) {
    assert.match(resource.id, UUID_V7, "every created id is UUIDv7");
  }
  assert.equal(workspace.ownerId, accountId, "the workspace ownerId is the mapped UUIDv7 account id");
  assert.equal(board.ownerId, accountId, "the board ownerId is the mapped UUIDv7 account id");
  const serialized = JSON.stringify({ workspace, board, note, card });
  assert.equal(serialized.includes(identity), false, "the Kratos identity id never appears in a response");

  const second = await request(session, "GET", "/v1/workspaces");
  assert.equal(second.status, 200);
  assert.ok(second.body.items.some((item) => item.id === workspace.id), "the next request sees the resources");
  const count = await ownerQuery(
    "SELECT count(*)::int AS count FROM app.profiles WHERE kratos_identity_id = $1",
    [identity],
  );
  assert.equal(count.rows[0].count, 1, "no duplicate profile for the identity");
});

test("P3-06/F2: concurrent first requests for one v4 identity create a single profile", async () => {
  const identity = "5f0c1a2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b";
  const session = await mintSession(authService.baseUrl, identity);
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => request(session, "GET", "/v1/workspaces")),
  );
  for (const response of responses) {
    assert.equal(response.status, 200);
  }
  const rows = await ownerQuery(
    "SELECT account_id::text AS account_id FROM app.profiles WHERE kratos_identity_id = $1",
    [identity],
  );
  assert.equal(rows.rows.length, 1, "the unique index converges the concurrent first requests");
  const sessionResponse = await request(session, "GET", "/v1/session");
  assert.equal(sessionResponse.status, 200);
  const accountId = sessionResponse.body.accountId;
  assert.match(accountId, UUID_V7);
  assert.equal(accountId, rows.rows[0].account_id, "the session route exposes the converged account id");

  const workspace = await createWorkspace(session, "Concurrent workspace", accountId);
  const list = await request(session, "GET", "/v1/workspaces");
  assert.ok(list.body.items.some((item) => item.id === workspace.id), "the resolved account owns the workspace");
});

test("P3-06/F2: a UUIDv7 session id is the account id directly (no mapping row)", async () => {
  const identity = "0192f0a1-7000-7000-8000-0000000000c1";
  const session = await mintSession(authService.baseUrl, identity);
  const result = await request(session, "GET", "/v1/workspaces");
  assert.equal(result.status, 200);
  const profile = await ownerQuery(
    `SELECT account_id::text AS account_id, kratos_identity_id::text AS kratos_identity_id
     FROM app.profiles WHERE account_id::text = $1`,
    [identity],
  );
  assert.equal(profile.rows.length, 1);
  assert.equal(profile.rows[0].kratos_identity_id, null, "v7 identities need no mapping row");
});

test("session handling: missing/invalid sessions are 401 and an unreachable auth service is 503", async () => {
  const routes = [
    ["GET", "/v1/session"],
    ["GET", "/v1/workspaces"],
    ["POST", "/v1/workspaces"],
    ["GET", `/v1/workspaces/${ids.workspace}`],
    ["PATCH", `/v1/workspaces/${ids.workspace}`],
    ["DELETE", `/v1/workspaces/${ids.workspace}`],
    ["GET", `/v1/workspaces/${ids.workspace}/boards`],
    ["POST", `/v1/workspaces/${ids.workspace}/boards`],
    ["GET", `/v1/boards/${ids.board}`],
    ["PATCH", `/v1/boards/${ids.board}`],
    ["DELETE", `/v1/boards/${ids.board}`],
    ["GET", `/v1/workspaces/${ids.workspace}/notes`],
    ["POST", `/v1/workspaces/${ids.workspace}/notes`],
    ["GET", `/v1/notes/${ids.note}`],
    ["PATCH", `/v1/notes/${ids.note}`],
    ["DELETE", `/v1/notes/${ids.note}`],
    ["GET", `/v1/boards/${ids.board}/cards`],
    ["POST", `/v1/boards/${ids.board}/cards`],
    ["GET", `/v1/cards/${ids.card}`],
    ["PATCH", `/v1/cards/${ids.card}`],
    ["DELETE", `/v1/cards/${ids.card}`],
  ];
  for (const [method, path] of routes) {
    const result = await request(undefined, method, path);
    assert.equal(result.status, 401, `${method} ${path}`);
    assert.equal(result.body.code, "AUTH_REQUIRED", `${method} ${path}`);
    assert.equal(result.body.messageKey, "errors.authRequired", `${method} ${path}`);
  }

  const invalidSession = await request("not-a-valid-test-session", "GET", "/v1/workspaces");
  assert.equal(invalidSession.status, 401);
  assert.equal(invalidSession.body.code, "AUTH_REQUIRED");

  const isolated = await startPlatform({ authServiceUrl: "http://127.0.0.1:1" });
  try {
    const result = await apiRequest(isolated.baseUrl, {
      method: "GET",
      path: "/v1/workspaces",
      session: sessions.alice,
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "INTERNAL");
    assert.equal(result.body.messageKey, "errors.internal");
  } finally {
    await isolated.close();
  }
});

test("F1: the start-up guard refuses an APP_DATABASE_URL role with SUPERUSER or BYPASSRLS", async () => {
  const port = await freePort();
  const config = {
    serviceName: "platform",
    nodeEnv: "test",
    logLevel: "error",
    host: "127.0.0.1",
    port,
    databaseUrl: databaseUrl(),
    // The owner/superuser connection is deliberately used here.
    appDatabaseUrl: databaseUrl(),
    authServiceUrl: "http://127.0.0.1:1",
  };
  await assert.rejects(startService(config, silentLogger()), (error) => {
    assert.match(String(error instanceof Error ? error.message : error), /restricted role/);
    assert.doesNotMatch(String(error instanceof Error ? error.message : error), /postgresql:\/\//);
    return true;
  });
});

test("F1: a mutation error envelope echoes the body requestId", async () => {
  const requestId = newId();
  const invalid = await request(sessions.alice, "POST", "/v1/workspaces", {
    requestId,
    workspace: { name: "", ownerId: ALICE },
  });
  expectError(invalid, 400, "VALIDATION", "errors.validation");
  assert.equal(invalid.body.requestId, requestId);

  const spoofedRequestId = newId();
  const spoofed = await request(sessions.alice, "POST", "/v1/workspaces", {
    requestId: spoofedRequestId,
    workspace: { name: "Spoofed", ownerId: BOB },
  });
  expectError(spoofed, 403, "FORBIDDEN", "errors.forbidden");
  assert.equal(spoofed.body.requestId, spoofedRequestId);
});

test("F1/F7: a GET error envelope echoes the query requestId", async () => {
  const requestId = newId();
  const missing = await request(sessions.alice, "GET", `/v1/workspaces/${ids.foreignWorkspace}?requestId=${requestId}`);
  expectError(missing, 404, "NOT_FOUND", "errors.notFound");
  assert.equal(missing.body.requestId, requestId);

  const invalidLimit = newId();
  const limited = await request(sessions.alice, "GET", `/v1/workspaces?limit=0&requestId=${invalidLimit}`);
  expectError(limited, 400, "VALIDATION", "errors.validation");
  assert.equal(limited.body.requestId, invalidLimit);
});

test("F6: malformed cursors are VALIDATION with details.fields ['cursor'], never INTERNAL", async () => {
  const malformed = [
    // Pattern-valid but impossible timestamp components.
    "9999-99-99 99:99:99+99",
    // Parses in JavaScript but PostgreSQL rejects the calendar date.
    "2026-02-30T00:00:00Z",
  ];
  for (const timestamp of malformed) {
    const cursor = Buffer.from(`${timestamp}|${ids.workspace}`, "utf8").toString("base64url");
    const result = await request(sessions.alice, "GET", `/v1/workspaces?cursor=${cursor}`);
    expectError(result, 400, "VALIDATION", "errors.validation");
    assert.deepEqual(result.body.details.fields, ["cursor"], timestamp);
  }
});

test("F3: details.fields are deduplicated, capped and never echo user text", async () => {
  const unknownKey = await request(sessions.alice, "POST", "/v1/workspaces", {
    requestId: newId(),
    workspace: { name: "Unknown key", ownerId: ALICE, "Foo Bar": 1 },
  });
  expectError(unknownKey, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(unknownKey.body.details.fields, ["workspace"]);

  const manyKeys = { name: "Many keys", ownerId: ALICE };
  for (let index = 0; index < 120; index += 1) {
    manyKeys[`k${index}`] = index;
  }
  const capped = await request(sessions.alice, "POST", "/v1/workspaces", {
    requestId: newId(),
    workspace: manyKeys,
  });
  expectError(capped, 400, "VALIDATION", "errors.validation");
  const fields = capped.body.details.fields;
  assert.ok(Array.isArray(fields));
  assert.equal(fields.length, 100, "the contract caps details.fields at 100");
  assert.equal(new Set(fields).size, fields.length, "details.fields are unique");

  const emptyZ = await request(sessions.bob, "POST", `/v1/boards/${ids.board}/cards`, {
    requestId: newId(),
    card: { boardId: ids.board, noteId: ids.note, zoneId: null, x: 0, y: 0, width: 240, height: 120, z: "" },
  });
  expectError(emptyZ, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(emptyZ.body.details.fields, ["card.z"]);
});

test("P4-26: card zoneId names a zone of the card's board; other parents are denied", async () => {
  // Contract 0.2.0 has no zone REST routes yet, so zones are seeded as the slot owner.
  const insertZone = async (boardId) => {
    const id = newId();
    await ownerQuery(
      "INSERT INTO app.zones (id, board_id, title, x, y, width, height, z) VALUES ($1, $2, 'Zone', 0, 0, 480, 320, 'a0')",
      [id, boardId],
    );
    return id;
  };
  const zone = await insertZone(ids.board);
  const secondZone = await insertZone(ids.board);
  const otherBoard = (await createBoard(sessions.alice, ids.workspace, "Board two", ALICE)).id;
  const otherBoardZone = await insertZone(otherBoard);
  const foreignZone = await insertZone(ids.foreignBoard);

  const zoned = await createCard(sessions.bob, ids.board, ids.note, { zoneId: zone, z: "b0" });
  assert.equal(zoned.zoneId, zone);
  const read = await request(sessions.carol, "GET", `/v1/cards/${zoned.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.card.zoneId, zone);

  const patch = (session, changes) =>
    request(session, "PATCH", `/v1/cards/${zoned.id}`, { requestId: newId(), cardId: zoned.id, changes });
  const moved = await patch(sessions.bob, { zoneId: secondZone });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.card.zoneId, secondZone);
  const out = await patch(sessions.bob, { zoneId: null });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.card.zoneId, null);
  const back = await patch(sessions.alice, { zoneId: zone });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(back.body.card.zoneId, zone);
  const geometryOnly = await patch(sessions.alice, { x: 5 });
  assert.equal(geometryOnly.body.card.zoneId, zone, "a PATCH without zoneId keeps the parent");

  for (const parent of [otherBoardZone, foreignZone, ids.card, newId()]) {
    const created = await request(sessions.bob, "POST", `/v1/boards/${ids.board}/cards`, {
      requestId: newId(),
      card: { boardId: ids.board, noteId: ids.note, zoneId: parent, x: 0, y: 0, width: 240, height: 120, z: "b1" },
    });
    expectError(created, 400, "VALIDATION", "errors.validation");
    assert.deepEqual(created.body.details.fields, ["card.zoneId"]);

    const updated = await patch(sessions.bob, { zoneId: parent });
    expectError(updated, 400, "VALIDATION", "errors.validation");
    assert.deepEqual(updated.body.details.fields, ["changes.zoneId"]);
  }

  expectError(await patch(sessions.carol, { zoneId: null }), 403, "FORBIDDEN", "errors.forbidden");
  expectError(await patch(sessions.dave, { zoneId: zone }), 404, "NOT_FOUND", "errors.notFound");
  const unchanged = await request(sessions.alice, "GET", `/v1/cards/${zoned.id}`);
  assert.equal(unchanged.body.card.zoneId, zone, "denied writes leave the parent unchanged");

  // Deleting the zone keeps the card on the board (ADR-0010 "keep content").
  await ownerQuery("DELETE FROM app.zones WHERE id = $1", [zone]);
  const kept = await request(sessions.alice, "GET", `/v1/cards/${zoned.id}`);
  assert.equal(kept.status, 200);
  assert.equal(kept.body.card.zoneId, null);
  const deletedZone = await patch(sessions.alice, { zoneId: zone });
  expectError(deletedZone, 400, "VALIDATION", "errors.validation");
  assert.deepEqual(deletedZone.body.details.fields, ["changes.zoneId"]);
});
