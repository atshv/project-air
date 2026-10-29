// P6-10 regression: a sync session must see another client's later operations in
// its own server-side document. Before the fix, a client that joined before
// another client created a note applied its `updateNoteBody` to a stale document
// and got a VALIDATION reject ("updateNoteBody targets the missing note").

import assert from "node:assert/strict";
import test from "node:test";

import { createYjsBoardDoc } from "../../../packages/crdt/src/index.ts";
import { createSyncService } from "../src/service.ts";

const BOARD_ID = "0192f0e9-7000-7000-8000-0000000000b1";
const WORKSPACE_ID = "0192f0e9-7000-7000-8000-0000000000b2";
const USER_ID = "0192f0e9-7000-7000-8000-0000000000a1";
const CLIENT_A = "0192f0e9-7000-7000-8000-0000000000c1";
const CLIENT_B = "0192f0e9-7000-7000-8000-0000000000c2";
const NOTE_ID = "0192f0e9-7000-7000-8000-0000000000d1";
const CARD_ID = "0192f0e9-7000-7000-8000-0000000000d2";
const TIMESTAMP = "2027-01-10T09:30:00.000Z";

let counter = 0;
function uid(prefix) {
  counter += 1;
  return `0192f0e9-7000-7000-8000-${String(prefix * 0x1000 + counter).padStart(12, "0")}`;
}

function emptyBoardContent() {
  return {
    contractVersion: "0.4.0",
    board: {
      id: BOARD_ID, workspaceId: WORKSPACE_ID, ownerId: USER_ID, title: "Remote apply board",
      visibility: "private", archived: false, createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    },
    zones: [], blocks: [], cards: [], notes: [], edges: [],
  };
}

function memoryStore() {
  let seq = 1;
  const updates = [];
  return {
    async serverSeq() { return seq; },
    async loadBoard() { return { serverSeq: seq, snapshotSeq: 1, boardContent: emptyBoardContent(), docState: null }; },
    async appendUpdate(input) { seq += 1; updates.push({ serverSeq: seq, update: input.update }); return seq; },
    async updatesAfter(_boardId, from) { return updates.filter((entry) => entry.serverSeq > from); },
  };
}

async function client(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index !== -1) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    messages.push(message);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    send(message) { socket.send(JSON.stringify(message)); },
    next(predicate, timeoutMs = 5_000) {
      const found = messages.findIndex(predicate);
      if (found !== -1) return Promise.resolve(messages.splice(found, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for a sync message")), timeoutMs);
        waiters.push({ predicate, resolve, timer });
      });
    },
    close() { socket.close(); },
  };
}

const envelope = (type, clientId, payload) => ({ id: uid(9), type, clientId, boardId: BOARD_ID, sentAt: new Date().toISOString(), seq: 1, payload });

test("a session accepts an updateNoteBody for a note another client created after it joined", { timeout: 30_000 }, async () => {
  const service = await createSyncService({
    host: "127.0.0.1",
    port: 0,
    store: memoryStore(),
    documents: {
      fromContent: (content) => createYjsBoardDoc({ content }),
      fromEmpty: () => createYjsBoardDoc({ content: emptyBoardContent() }),
    },
    authenticator: { authenticate: async (tokenRef) => (tokenRef === "valid-test-session" ? { userId: USER_ID } : null) },
    authorizer: { canJoin: async (userId, boardId) => userId === USER_ID && boardId === BOARD_ID },
  });
  const a = await client(service.url);
  const b = await client(service.url);
  try {
    for (const [connection, clientId] of [[a, CLIENT_A], [b, CLIENT_B]]) {
      connection.send(envelope("hello", clientId, { tokenRef: "valid-test-session", contractVersion: "0.4.0" }));
      connection.send(envelope("joinBoard", clientId, {}));
      const joined = await connection.next((message) => message.type === "welcome" || message.type === "reject");
      assert.equal(joined.type, "welcome", `joinBoard must be accepted, got ${JSON.stringify(joined.payload)}`);
      await connection.next((message) => message.type === "snapshot");
    }

    // A creates the note after B already joined: B only gets the broadcast, not a
    // snapshot, so B's session document must be brought up to date by the service.
    const note = { id: NOTE_ID, workspaceId: WORKSPACE_ID, title: "New note", createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
    const card = {
      id: CARD_ID, boardId: BOARD_ID, noteId: NOTE_ID, x: 100, y: 100, width: 176, height: 80, z: "m",
      createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    };
    const group = {
      id: uid(1), boardId: BOARD_ID, actorId: CLIENT_A, createdAt: TIMESTAMP, type: "group",
      payload: { children: [
        { id: uid(2), boardId: BOARD_ID, actorId: CLIENT_A, createdAt: TIMESTAMP, type: "createNote", payload: { note }, inverse: { boardId: BOARD_ID, type: "deleteNote", payload: { note, cards: [] } } },
        { id: uid(3), boardId: BOARD_ID, actorId: CLIENT_A, createdAt: TIMESTAMP, type: "createCard", payload: { card }, inverse: { boardId: BOARD_ID, type: "deleteCard", payload: { card } } },
      ] },
      inverse: { boardId: BOARD_ID, type: "group", payload: { children: [
        { boardId: BOARD_ID, type: "deleteCard", payload: { card } },
        { boardId: BOARD_ID, type: "deleteNote", payload: { note, cards: [] } },
      ] } },
    };
    a.send(envelope("operationBatch", CLIENT_A, { batchId: uid(4), operations: [group] }));
    await a.next((message) => message.type === "ack");
    await b.next((message) => message.type === "operationBatch");

    const body = { version: "1", blocks: [{ type: "paragraph", text: "Hello from B", marks: [] }] };
    const updateNoteBody = {
      id: uid(5), boardId: BOARD_ID, actorId: CLIENT_B, createdAt: TIMESTAMP, type: "updateNoteBody",
      payload: { noteId: NOTE_ID, body },
      inverse: { boardId: BOARD_ID, type: "updateNoteBody", payload: { noteId: NOTE_ID, body: { version: "1", blocks: [] } } },
    };
    b.send(envelope("operationBatch", CLIENT_B, { batchId: uid(6), operations: [updateNoteBody] }));
    const answer = await b.next((message) => message.type === "ack" || message.type === "reject");
    assert.equal(answer.type, "ack", `B's body operation must be accepted, got ${JSON.stringify(answer.payload)}`);
    await a.next((message) => message.type === "operationBatch" && message.payload.operations.some((operation) => operation.type === "updateNoteBody"));
  } finally {
    a.close();
    b.close();
    await service.close();
  }
});
