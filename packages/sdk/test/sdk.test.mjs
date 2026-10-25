/**
 * SDK tests against the in-process stub platform API: envelopes, request ids,
 * session headers, pagination, CRUD for all four resources and typed errors.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ApiError } from "../src/errors.ts";
import { createClient } from "../src/index.ts";
import { startStubServer } from "./stub-server.mjs";

const SESSION = { testSession: "test-session" };
const OWNER = "0192f0a1-7000-7000-8000-000000000001";

let stub;

before(async () => {
  stub = await startStubServer();
});

after(async () => {
  await stub?.close();
});

function client(options = {}) {
  return createClient({ baseUrl: stub.baseUrl, session: SESSION, ...options });
}

async function expectApiError(promise, status, code, messageKey) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(error.messageKey, messageKey);
    assert.match(error.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    return true;
  });
}

test("workspaces.list sends the session and requestId and parses the list envelope", async () => {
  const api = client();
  const created = await api.workspaces.create({ name: "Listed", ownerId: OWNER });
  const result = await api.workspaces.list({ limit: 10 });
  assert.equal(typeof result.requestId, "string");
  assert.ok(Array.isArray(result.items));
  assert.ok(result.items.some((workspace) => workspace.id === created.id));
  assert.equal(result.nextCursor, null);
  const request = stub.requests.at(-1);
  assert.match(request.url, /^\/v1\/workspaces\?requestId=/);
  assert.match(request.url, /limit=10/);
  assert.equal(request.headers["x-test-session"], "test-session");
  assert.equal(request.headers.accept, "application/json");
});

test("a cookie session is sent as the cookie header", async () => {
  const api = client({ session: { cookie: "ory_kratos_session=cookie-value" } });
  await api.workspaces.list();
  const request = stub.requests.at(-1);
  assert.equal(request.headers.cookie, "ory_kratos_session=cookie-value");
  assert.equal(request.headers["x-test-session"], undefined);
});

test("a string session is shorthand for the test session header", async () => {
  const api = client({ session: "test-session" });
  await api.workspaces.list();
  assert.equal(stub.requests.at(-1).headers["x-test-session"], "test-session");
});

test("workspace create/get/update/delete use the contract envelopes", async () => {
  const api = client();
  const created = await api.workspaces.create({ name: "Lab", ownerId: OWNER });
  assert.equal(created.name, "Lab");
  const createRequest = stub.requests.at(-1);
  assert.deepEqual(Object.keys(createRequest.body).sort(), ["requestId", "workspace"]);

  const fetched = await api.workspaces.get(created.id);
  assert.deepEqual(fetched, created);

  const updated = await api.workspaces.update(created.id, { name: "Lab 2" });
  assert.equal(updated.name, "Lab 2");
  assert.deepEqual(Object.keys(stub.requests.at(-1).body).sort(), ["changes", "requestId", "workspaceId"]);

  const deleted = await api.workspaces.delete(created.id);
  assert.equal(deleted.deletedId, created.id);
  await expectApiError(api.workspaces.get(created.id), 404, "NOT_FOUND", "errors.notFound");
});

test("boards list/create/get/update/delete", async () => {
  const api = client();
  const workspace = await api.workspaces.create({ name: "Boards", ownerId: OWNER });
  const board = await api.boards.create(workspace.id, { ownerId: OWNER, title: "Plan", visibility: "workspace" });
  assert.equal(board.workspaceId, workspace.id);
  const list = await api.boards.list(workspace.id);
  assert.ok(list.items.some((candidate) => candidate.id === board.id));
  assert.equal((await api.boards.get(board.id)).title, "Plan");
  assert.equal((await api.boards.update(board.id, { title: "Plan 2", archived: true })).archived, true);
  assert.equal((await api.boards.delete(board.id)).deletedId, board.id);
});

test("notes list/create/get/update/delete", async () => {
  const api = client();
  const workspace = await api.workspaces.create({ name: "Notes", ownerId: OWNER });
  const note = await api.notes.create(workspace.id, { title: "Kickoff" });
  assert.equal(note.workspaceId, workspace.id);
  assert.ok((await api.notes.list(workspace.id)).items.some((candidate) => candidate.id === note.id));
  assert.equal((await api.notes.get(note.id)).title, "Kickoff");
  assert.equal((await api.notes.update(note.id, { title: "Kickoff 2" })).title, "Kickoff 2");
  assert.equal((await api.notes.delete(note.id)).deletedId, note.id);
});

test("cards list/create/get/update/delete", async () => {
  const api = client();
  const workspace = await api.workspaces.create({ name: "Cards", ownerId: OWNER });
  const board = await api.boards.create(workspace.id, { ownerId: OWNER, title: "Board", visibility: "private" });
  const note = await api.notes.create(workspace.id, { title: "Note" });
  const card = await api.cards.create(board.id, {
    noteId: note.id,
    zoneId: null,
    x: 10,
    y: 20,
    width: 240,
    height: 120,
    z: "a0",
  });
  assert.equal(card.boardId, board.id);
  assert.ok((await api.cards.list(board.id)).items.some((candidate) => candidate.id === card.id));
  assert.equal((await api.cards.get(card.id)).z, "a0");
  assert.equal((await api.cards.update(card.id, { x: 640, z: "a1" })).x, 640);
  assert.equal((await api.cards.delete(card.id)).deletedId, card.id);
});

test("pagination nextCursor is passed back as the cursor query", async () => {
  const api = client();
  for (const name of ["One", "Two", "Three"]) {
    await api.workspaces.create({ name, ownerId: OWNER });
  }
  const first = await api.workspaces.list({ limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(typeof first.nextCursor, "string");
  const second = await api.workspaces.list({ limit: 1, cursor: first.nextCursor });
  assert.notEqual(second.items[0]?.id, first.items[0]?.id);
  assert.match(stub.requests.at(-1).url, new RegExp(`cursor=${first.nextCursor}`));
});

test("no session maps to a typed AUTH_REQUIRED ApiError", async () => {
  const api = createClient({ baseUrl: stub.baseUrl });
  await expectApiError(api.workspaces.list(), 401, "AUTH_REQUIRED", "errors.authRequired");
});

test("a validation error exposes the field paths", async () => {
  const api = client();
  await assert.rejects(api.workspaces.create({ name: "", ownerId: OWNER }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "VALIDATION");
    assert.equal(error.messageKey, "errors.validation");
    assert.deepEqual(error.details.fields, ["workspace.name"]);
    return true;
  });
});

test("a conflict maps to CONFLICT and unknown ids to NOT_FOUND", async () => {
  const api = client();
  await expectApiError(api.workspaces.create({ name: "conflict", ownerId: OWNER }), 409, "CONFLICT", "errors.conflict");
  await expectApiError(api.boards.get("0192f0a1-7000-7000-8000-0000000000ff"), 404, "NOT_FOUND", "errors.notFound");
});

test("an unexpected success envelope becomes an INTERNAL ApiError", async () => {
  const api = client();
  stub.state.malformedList = true;
  try {
    await expectApiError(api.workspaces.list(), 0, "INTERNAL", "errors.internal");
  } finally {
    stub.state.malformedList = false;
  }
});

test("an invalid baseUrl is rejected by the client", () => {
  assert.throws(() => createClient({ baseUrl: "not-a-url", session: SESSION }), /baseUrl/);
});
