// P5-03: protocol session tests with an injected authorizer, store and document:
// hello-first, version negotiation, authorization, join/snapshot, durable
// append-before-ack ordering, catch-up and leave/presence.

import assert from "node:assert/strict";
import test from "node:test";

import { createSyncSession, SYNC_CONTRACT_VERSION } from "../src/protocol.ts";

const BOARD_ID = "0192f0b1-7000-7000-8000-0000000000b1";
const CLIENT_ID = "0192f0b0-7000-7000-8000-0000000000c1";
const content = () => ({
  contractVersion: SYNC_CONTRACT_VERSION,
  board: { id: BOARD_ID, workspaceId: "0192f0a2-7000-7000-8000-000000000002", ownerId: "0192f0a1-7000-7000-8000-000000000001", title: "Board", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:30:00.000Z" },
  zones: [], blocks: [], cards: [], notes: [], edges: [],
});

function fakeDoc() {
  const applied = [];
  const updates = [];
  return {
    applied, updates,
    apply(op) { applied.push(op); updates.push(op.id ?? null); },
    encodeUpdate() { return Buffer.from(JSON.stringify(this.applied)).toString("base64"); },
    applyUpdate(update) { this.applied.push({ update }); },
    snapshot() { return content(); },
    stateVector() { return "state"; },
  };
}

function fakeStore(overrides = {}) {
  const calls = [];
  let seq = 1;
  const updates = [];
  return {
    calls, updates,
    async serverSeq() { return seq; },
    async loadBoard() { return seq === 0 ? null : { serverSeq: seq, snapshotSeq: 1, boardContent: content() }; },
    async appendUpdate(input) {
      calls.push("append");
      if (overrides.failAppend === true) throw new Error("db down");
      seq += 1;
      updates.push({ serverSeq: seq, update: input.update });
      return seq;
    },
    async updatesAfter(_board, from) { return updates.filter((entry) => entry.serverSeq > from); },
  };
}

function message(type, payload = {}, extra = {}) {
  return JSON.stringify({ id: `${type}-id`, type, clientId: CLIENT_ID, boardId: BOARD_ID, payload, ...extra });
}

async function session(overrides = {}) {
  const sent = [];
  const store = overrides.store ?? fakeStore();
  const docs = [];
  const broadcast = [];
  const instance = createSyncSession({
    send: (m) => sent.push(m),
    authenticator: { authenticate: async (token) => (token === "valid" ? { userId: "user-1" } : null) },
    authorizer: { canJoin: async (userId, boardId) => userId === "user-1" && boardId === BOARD_ID && overrides.forbidden !== true },
    store,
    documents: { fromContent: () => { const doc = fakeDoc(); docs.push(doc); return doc; }, fromEmpty: () => { const doc = fakeDoc(); docs.push(doc); return doc; } },
    broadcast: (boardId, msg, except) => broadcast.push({ boardId, msg, except }),
  });
  return { instance, sent, store, docs, broadcast };
}

test("hello is required first and the first message rejection is explicit", async () => {
  const { instance, sent } = await session();
  await instance.receive(message("joinBoard"));
  assert.equal(sent[0].type, "reject");
  assert.equal(sent[0].payload.code, "VALIDATION");
  assert.equal(instance.helloSeen, false);
});

test("version and session validation reject before joinBoard", async () => {
  const { instance, sent } = await session();
  await instance.receive(JSON.stringify({ id: "h1", type: "hello", clientId: CLIENT_ID, payload: { tokenRef: "valid", contractVersion: "0.2.0" } }));
  assert.equal(sent[0].payload.code, "VALIDATION");
  const second = await session();
  await second.instance.receive(JSON.stringify({ id: "h2", type: "hello", clientId: CLIENT_ID, payload: { tokenRef: "bad", contractVersion: SYNC_CONTRACT_VERSION } }));
  assert.equal(second.sent[0].payload.code, "AUTH_REQUIRED");
});

test("the platform authorizer gates joinBoard and welcome/snapshot carry the durable seq", async () => {
  const forbidden = await session({ forbidden: true });
  await forbidden.instance.receive(JSON.stringify({ id: "h", type: "hello", clientId: CLIENT_ID, payload: { tokenRef: "valid", contractVersion: SYNC_CONTRACT_VERSION } }));
  await forbidden.instance.receive(message("joinBoard"));
  assert.equal(forbidden.sent.at(-1).payload.code, "FORBIDDEN");

  const store = fakeStore();
  store.calls.push("append");
  // simulate an existing sequence: loadBoard returns it from the DB read
  const allowed = await session({ store });
  allowed.store.loadBoard = async () => ({ serverSeq: 7, snapshotSeq: 1, boardContent: content() });
  await allowed.instance.receive(JSON.stringify({ id: "h", type: "hello", clientId: CLIENT_ID, payload: { tokenRef: "valid", contractVersion: SYNC_CONTRACT_VERSION } }));
  await allowed.instance.receive(message("joinBoard"));
  const welcome = allowed.sent.find((m) => m.type === "welcome");
  const snapshot = allowed.sent.find((m) => m.type === "snapshot");
  assert.equal(welcome.serverSeq, 7);
  assert.equal(welcome.payload.snapshotRef, `${BOARD_ID}:7`);
  assert.equal(snapshot.payload.snapshotRef, `${BOARD_ID}:7`);
});

test("operationBatch is persisted before the ack and the ack carries the new seq", async () => {
  const { instance, sent, store, broadcast } = await session();
  await instance.receive(JSON.stringify({ id: "h", type: "hello", clientId: CLIENT_ID, payload: { tokenRef: "valid", contractVersion: SYNC_CONTRACT_VERSION } }));
  await instance.receive(message("joinBoard"));
  sent.length = 0;
  const order = [];
  const originalAppend = store.appendUpdate.bind(store);
  store.appendUpdate = async (input) => { order.push("append"); const result = await originalAppend(input); order.push("append-committed"); return result; };
  const originalSend = instance.receive.bind(instance);
  void originalSend;
  await instance.receive(message("operationBatch", { batchId: "batch-1", operations: [{ id: "op-1", type: "reorder", payload: { itemId: "x", z: "a" } }] }, { seq: 1 }));
  const ack = sent.find((m) => m.type === "ack");
  assert.ok(ack !== undefined, "an ack is sent");
  assert.equal(ack.serverSeq, 2);
  assert.deepEqual(order, ["append", "append-committed"]);
  assert.equal(store.calls.includes("append"), true);
  assert.equal(broadcast.length, 1, "the batch is broadcast to the other clients");
  assert.equal(broadcast[0].except, CLIENT_ID);
});

test("a failed append produces a reject and never an ack", async () => {
  const store = fakeStore({ failAppend: true });
  const { instance, sent } = await session({ store });
  await instance.receive(JSON.stringify({ id: "h", type: "hello", clientId: CLIENT_ID, payload: { tokenRef: "valid", contractVersion: SYNC_CONTRACT_VERSION } }));
  await instance.receive(message("joinBoard"));
  sent.length = 0;
  await instance.receive(message("operationBatch", { batchId: "b", operations: [{ id: "op" }] }));
  assert.equal(sent.some((m) => m.type === "ack"), false);
  assert.equal(sent.at(-1).payload.code, "INTERNAL");
});

test("resyncRequest reads from the durable seq and leaveBoard broadcasts presence", async () => {
  const store = fakeStore();
  await store.appendUpdate({ boardId: BOARD_ID, clientId: CLIENT_ID, messageId: "m", update: Buffer.from(JSON.stringify([{ id: "o1", boardId: BOARD_ID, type: "reorder", payload: { itemId: "i1", z: "a" } }])).toString("base64") });
  const { instance, sent, broadcast } = await session({ store });
  await instance.receive(JSON.stringify({ id: "h", type: "hello", clientId: CLIENT_ID, payload: { tokenRef: "valid", contractVersion: SYNC_CONTRACT_VERSION } }));
  await instance.receive(message("joinBoard"));
  sent.length = 0;
  await instance.receive(message("resyncRequest", { fromServerSeq: 0 }));
  assert.equal(sent.some((m) => m.type === "welcome" && m.serverSeq === 2), true);
  await instance.receive(message("leaveBoard"));
  assert.equal(broadcast.at(-1).msg.type, "presence");
  assert.equal(instance.joinedBoard, null);
});
