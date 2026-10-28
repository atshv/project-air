// P5-05: live presence test over real sockets: validation/identity, throttling,
// newcomer list, per-board isolation, leave/disconnect removal and the proof
// that presence traffic never delays an operation ack. No persistence: the store
// is the in-memory fake, no DB is touched.

import assert from "node:assert/strict";
import test from "node:test";

import { validate } from "../../../packages/contracts/test/support.mjs";
import { createSyncService } from "../src/service.ts";
import { readFileSync } from "node:fs";

const SCHEMA = JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/sync/sync.schema.json", import.meta.url), "utf8"));
const UUID = (tail) => `0192f0f5-7000-7000-8000-0000000000${tail}`;
const BOARD_A = UUID("a1");
const BOARD_B = UUID("b1");
const CLIENT_A = UUID("c1");
const CLIENT_B = UUID("c2");
const CLIENT_C = UUID("c3");
const CLIENT_D = UUID("c4");

function fakeStore() {
  let seq = 1;
  let updates = [];
  return {
    async serverSeq() { return seq; },
    async loadBoard() { return null; },
    async appendUpdate(input) { seq += 1; updates.push({ serverSeq: seq, update: input.update }); return seq; },
    async updatesAfter(_board, from) { return updates.filter((entry) => entry.serverSeq > from); },
  };
}
function fakeDoc() {
  return {
    apply() {}, encodeUpdate() { return "dXBkYXRl"; }, applyUpdate() {}, stateVector() { return "v"; },
    snapshot() { return { contractVersion: "0.3.0", board: { id: BOARD_A, workspaceId: UUID("e1"), ownerId: UUID("e2"), title: "Board", visibility: "private", archived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" }, zones: [], blocks: [], cards: [], notes: [], edges: [] }; },
  };
}

function connect(url) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve({
      ws, messages,
      send(message) { ws.send(JSON.stringify(message)); },
      async waitFor(predicate, timeoutMs = 4000) {
        const start = Date.now();
        for (;;) {
          const found = messages.find(predicate);
          if (found !== undefined) return found;
          if (Date.now() - start > timeoutMs) throw new Error(`timeout; messages=${JSON.stringify(messages).slice(0, 500)}`);
          await new Promise((done) => setTimeout(done, 10));
        }
      },
    }), { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

const hello = (clientId) => ({ id: UUID("10" + clientId.slice(-1)), type: "hello", clientId, payload: { tokenRef: "test-token-ref", contractVersion: "0.3.0" } });
const join = (clientId, boardId = BOARD_A) => ({ id: UUID("20" + clientId.slice(-1)), type: "joinBoard", clientId, boardId, seq: 2, payload: {} });
const presence = (clientId, boardId, cursor, selection = []) => ({ id: UUID("30" + clientId.slice(-1)), type: "presence", clientId, boardId, seq: 3, sentAt: new Date().toISOString(), payload: { nameRef: "user:client-supplied", colorRef: "tone-e", cursor, selection } });

test("live presence: throttled, identity-derived, isolated, cleaned up and never blocking operations", { timeout: 20_000 }, async () => {
  const service = await createSyncService({
    host: "127.0.0.1", port: 0,
    authenticator: { authenticate: async (tokenRef) => (tokenRef === "test-token-ref" ? { userId: "0192f0f6-7000-7000-8000-000000000001" } : null) },
    authorizer: { canJoin: async (_userId, boardId) => boardId === BOARD_A || boardId === BOARD_B },
    store: fakeStore(), documents: { fromContent: () => fakeDoc(), fromEmpty: () => fakeDoc() },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const a = await connect(service.url);
  const b = await connect(service.url);
  const otherBoard = await connect(service.url);
  try {
    for (const [socket, clientId] of [[a, CLIENT_A], [b, CLIENT_B], [otherBoard, CLIENT_D]]) {
      socket.send(hello(clientId)); socket.send(join(clientId, clientId === CLIENT_D ? BOARD_B : BOARD_A));
      await socket.waitFor((message) => message.type === "welcome" || (message.type === "presence"));
    }
    // Flood presence updates; only the first is immediate, the rest coalesce.
    for (let index = 0; index < 200; index += 1) {
      a.send(presence(CLIENT_A, BOARD_A, { x: index, y: index }));
    }
    // An operation batch sent during the flood must still be acked promptly.
    const operation = { id: UUID("a2"), boardId: BOARD_A, actorId: UUID("a3"), createdAt: new Date().toISOString(), type: "reorder", payload: { itemId: UUID("a4"), z: "a" }, inverse: { boardId: BOARD_A, type: "reorder", payload: { itemId: UUID("a4"), z: "b" } } };
    a.send({ id: UUID("b2"), type: "operationBatch", clientId: CLIENT_A, boardId: BOARD_A, seq: 4, payload: { batchId: UUID("b3"), operations: [operation] } });
    const ack = await a.waitFor((message) => message.type === "ack");
    assert.ok(validates(ack), "the ack is contract-valid");
    // B (same board) sees presence, isolated board D does not.
    await b.waitFor((message) => message.type === "presence" && message.clientId === CLIENT_A);
    await new Promise((done) => setTimeout(done, 200));
    const received = b.messages.filter((message) => message.type === "presence");
    assert.ok(received.length >= 1 && received.length < 20, `presence is throttled/coalesced (received ${received.length})`);
    const presenceMessage = received.find((message) => message.clientId === CLIENT_A);
    assert.equal(presenceMessage.payload.nameRef, "user:0192f0f6-7000-7000-8000-000000000001", "the client-sent name is overwritten with the session user");
    assert.match(presenceMessage.payload.colorRef, /^tone-[a-e]$/, "the colour is server-derived");
    assert.equal(presenceMessage.payload.colorRef === "tone-e", false, "the client-sent colour is ignored");
    assert.equal(validates(presenceMessage), true, "the presence message is contract-valid");
    assert.equal(otherBoard.messages.some((message) => message.type === "presence" && message.clientId === CLIENT_A), false, "presence never leaks to another board");

    // Newcomer gets the current participant list.
    const c = await connect(service.url);
    try {
      c.send(hello(CLIENT_C)); c.send(join(CLIENT_C));
      await c.waitFor((message) => message.type === "welcome");
      const list = c.messages.filter((message) => message.type === "presence");
      assert.ok(list.some((message) => message.clientId === CLIENT_A) && list.some((message) => message.clientId === CLIENT_B), "the newcomer receives the current participant list");
    } finally { c.ws.close(); }

    // LeaveBoard removes and notifies the others.
    a.send({ id: UUID("c5"), type: "leaveBoard", clientId: CLIENT_A, boardId: BOARD_A, seq: 5, payload: {} });
    const removal = await b.waitFor((message) => message.type === "presence" && message.clientId === CLIENT_A && Array.isArray(message.payload.selection) && message.payload.selection.length === 0 && message.payload.cursor.x === 0 && message.payload.cursor.y === 0);
    assert.ok(validates(removal), "the removal sentinel is contract-valid");
    // Disconnect removes B from the participant list as well (C was closed; use a fresh newcomer).
    b.ws.close();
    await new Promise((done) => setTimeout(done, 150));
    const d = await connect(service.url);
    try {
      d.send(hello(CLIENT_C)); d.send(join(CLIENT_C));
      await d.waitFor((message) => message.type === "welcome");
      await new Promise((done) => setTimeout(done, 100));
      assert.equal(d.messages.some((message) => message.type === "presence" && message.clientId === CLIENT_B), false, "a disconnected participant is removed from the list");
    } finally { d.ws.close(); }
  } finally {
    a.ws.close(); b.ws.close(); otherBoard.ws.close();
    await service.close();
  }
});

function validates(message) {
  return validate(message, SCHEMA, SCHEMA);
}
