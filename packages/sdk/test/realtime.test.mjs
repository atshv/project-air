// P5-04: deterministic SDK board-sync and autosave tests. Fake paired sockets,
// injected timers, a fake BoardDoc; no network, no wall clock.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTOSAVE_DEBOUNCE_MS, createAutosave, createBoardSyncClient, installFlushTriggers,
} from "../src/realtime/index.ts";

const content = { contractVersion: "0.3.0", board: { id: "b" }, zones: [], blocks: [], cards: [], notes: [], edges: [] };

function fakeDocument() {
  const applied = [];
  return { applied, apply(operation) { applied.push(operation); }, encodeUpdate() { return "u"; }, applyUpdate() {}, snapshot() { return content; }, stateVector() { return "s"; } };
}

function fakeSocket() {
  const sent = [];
  const messages = [];
  const listeners = new Map();
  const socket = {
    sent,
    send(data) { sent.push(JSON.parse(data)); },
    close() { listeners.get("close")?.(); },
    addEventListener(type, listener) { listeners.set(type, listener); },
    receive(message) {
      messages.push(message);
      listeners.get("message")?.({ data: JSON.stringify(message) });
    },
    lastByType(type) { return [...sent].reverse().find((message) => message.type === type); },
  };
  return socket;
}

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    timers: {
      setTimeout(callback, delay) { const id = nextId++; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      now: () => now,
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, entry]) => entry.at <= target).sort(([, left], [, right]) => left.at - right.at)[0];
        if (due === undefined) break;
        const [id, entry] = due;
        timers.delete(id);
        now = entry.at;
        entry.callback();
      }
      now = target;
    },
    get pending() { return timers.size; },
  };
}

function clientSetup(extra = {}) {
  const docs = [];
  const sockets = [];
  const timers = fakeTimers();
  const events = [];
  const client = createBoardSyncClient({
    createSocket: () => { const socket = fakeSocket(); sockets.push(socket); return socket; },
    boardId: "board-1",
    tokenRef: "test-token-ref",
    createDocument: () => { const doc = fakeDocument(); docs.push(doc); return doc; },
    initialContent: content,
    timers: timers.timers,
    onChange: (event) => events.push(event),
    ...extra,
  });
  return { client, sockets, docs, timers, events };
}

test("handshake sends hello first, then joinBoard; welcome/snapshot install the document", () => {
  const { client, sockets, docs } = clientSetup();
  client.start();
  const socket = sockets[0];
  assert.equal(socket.sent[0].type, "hello");
  assert.equal(socket.sent[0].payload.contractVersion, "0.3.0");
  assert.equal(socket.sent[1].type, "joinBoard");
  assert.equal(client.status(), "connecting");
  socket.receive({ id: "w", type: "welcome", serverSeq: 1, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:1" } });
  socket.receive({ id: "s", type: "snapshot", serverSeq: 1, payload: { snapshotRef: "board-1:1", boardContent: content } });
  assert.equal(client.status(), "joined");
  assert.equal(client.serverSeq(), 1);
  assert.equal(docs.length, 2, "the initial document + the document created from the snapshot content");
});

test("operation batches are sent with a per-connection seq; acks advance only forward", () => {
  const { client, sockets } = clientSetup();
  client.start();
  const socket = sockets[0];
  socket.receive({ id: "w", type: "welcome", serverSeq: 1, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:1" } });
  socket.receive({ id: "s", type: "snapshot", serverSeq: 1, payload: { snapshotRef: "board-1:1", boardContent: content } });
  const batchId = client.sendOperations([{ id: "op-1", type: "reorder", payload: { itemId: "x", z: "a" } }]);
  assert.ok(batchId !== null);
  const batch = socket.lastByType("operationBatch");
  assert.equal(batch.type, "operationBatch");
  assert.equal(batch.payload.batchId, batchId);
  assert.ok(batch.seq >= 3, "joinBoard used seq 2, the batch continues the connection seq");
  socket.receive({ id: "a", type: "ack", serverSeq: 2, payload: { batchId, opIds: ["op-1"] } });
  assert.equal(client.serverSeq(), 2);
  assert.equal(client.pendingCount(), 0);
  client.sendOperations([{ id: "op-2", type: "reorder", payload: { itemId: "x", z: "b" } }]);
  socket.receive({ id: "a2", type: "ack", serverSeq: 2, payload: { batchId: socket.lastByType("operationBatch").payload.batchId, opIds: [] } });
  assert.equal(client.serverSeq(), 2, "a stale ack does not move the durable sequence backwards");
});

test("offline operations queue in order and flush on join; duplicate remote batches apply once", () => {
  const { client, sockets, docs } = clientSetup();
  client.sendOperations([{ id: "off-1", type: "reorder", payload: { itemId: "x", z: "a" } }]);
  client.sendOperations([{ id: "off-2", type: "reorder", payload: { itemId: "x", z: "b" } }]);
  assert.equal(client.offlineCount(), 2);
  client.start();
  const socket = sockets[0];
  socket.receive({ id: "w", type: "welcome", serverSeq: 1, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:1" } });
  socket.receive({ id: "s", type: "snapshot", serverSeq: 1, payload: { snapshotRef: "board-1:1", boardContent: content } });
  assert.equal(client.offlineCount(), 0);
  const batch = socket.lastByType("operationBatch");
  assert.deepEqual(batch.payload.operations.map((operation) => operation.id), ["off-1", "off-2"], "the offline queue keeps its order");
  socket.receive({ id: "b1", type: "operationBatch", serverSeq: 2, payload: { batchId: "remote-1", operations: [{ id: "r1", type: "reorder" }] } });
  socket.receive({ id: "b2", type: "operationBatch", serverSeq: 2, payload: { batchId: "remote-1", operations: [{ id: "r1", type: "reorder" }] } });
  const doc = docs.at(-1);
  assert.equal(doc.applied.filter((operation) => operation.id === "r1").length, 1, "a duplicate batch applies once");
});

test("a dropped socket reconnects with backoff and resyncs from the last serverSeq", () => {
  const { client, sockets, timers } = clientSetup();
  client.start();
  sockets[0].receive({ id: "w", type: "welcome", serverSeq: 1, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:1" } });
  sockets[0].receive({ id: "s", type: "snapshot", serverSeq: 1, payload: { snapshotRef: "board-1:1", boardContent: content } });
  sockets[0].receive({ id: "a", type: "ack", serverSeq: 2, payload: { batchId: "none", opIds: [] } });
  sockets[0].close();
  assert.equal(client.status(), "offline");
  timers.advance(100);
  assert.equal(sockets.length, 2, "the reconnect used the first backoff step");
  const reconnect = sockets[1];
  assert.equal(reconnect.sent[0].type, "hello");
  reconnect.receive({ id: "w2", type: "welcome", serverSeq: 2, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:2" } });
  const resync = reconnect.lastByType("resyncRequest");
  assert.ok(resync !== undefined, "the reconnect asks for catch-up");
  assert.equal(resync.payload.fromServerSeq, 2, "catch-up starts at the last known durable serverSeq");
  reconnect.receive({ id: "s2", type: "snapshot", serverSeq: 2, payload: { snapshotRef: "board-1:2", boardContent: content } });
  assert.equal(client.status(), "joined");
});

test("close is idempotent and leaves the board once", () => {
  const { client, sockets } = clientSetup();
  client.start();
  sockets[0].receive({ id: "w", type: "welcome", serverSeq: 1, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:1" } });
  sockets[0].receive({ id: "s", type: "snapshot", serverSeq: 1, payload: { snapshotRef: "board-1:1", boardContent: content } });
  client.close();
  client.close();
  assert.equal(client.status(), "closed");
  assert.equal(sockets[0].sent.filter((message) => message.type === "leaveBoard").length, 1);
});

test("autosave debounces 400 ms after the last keystroke, saves once and reports saving -> saved", async () => {
  const timers = fakeTimers();
  const saves = [];
  const events = [];
  const autosave = createAutosave({ save: async (value, sequence) => saves.push({ value, sequence }), timers: timers.timers, onChange: (event) => events.push(event) });
  autosave.update("a");
  autosave.update("ab");
  timers.advance(AUTOSAVE_DEBOUNCE_MS - 1);
  assert.equal(saves.length, 0);
  timers.advance(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(saves, [{ value: "ab", sequence: 1 }]);
  assert.ok(events.some((event) => event.type === "status" && event.status === "saving"));
  assert.ok(events.some((event) => event.type === "saved" && event.value === "ab"));
});

test("the five flush triggers save immediately and visibility only flushes when hidden", async () => {
  const timers = fakeTimers();
  const saves = [];
  const autosave = createAutosave({ save: async (value, sequence) => saves.push({ value, sequence }), timers: timers.timers });
  const listeners = new Map();
  const target = (name) => ({ addEventListener(type, listener) { listeners.set(`${name}:${type}`, listener); }, removeEventListener(type) { listeners.delete(`${name}:${type}`); } });
  const windowTarget = target("window");
  const documentTarget = target("document");
  let panelClose = null;
  const detach = installFlushTriggers({ autosave, windowTarget, documentTarget, isHidden: () => hidden, onPanelClose: (register) => { panelClose = register; } });
  let hidden = true;
  autosave.update("x");
  listeners.get("window:blur")();
  assert.equal(saves.at(-1).value, "x", "blur flushes immediately");
  autosave.update("y");
  listeners.get("window:beforeunload")();
  assert.equal(saves.at(-1).value, "y", "navigation flushes immediately");
  autosave.update("z");
  listeners.get("window:pagehide")();
  assert.equal(saves.at(-1).value, "z", "pagehide flushes immediately");
  autosave.update("p");
  panelClose();
  assert.equal(saves.at(-1).value, "p", "panel close flushes immediately");
  autosave.update("v");
  hidden = false;
  listeners.get("document:visibilitychange")();
  assert.equal(saves.at(-1).value, "p", "a visible document does not flush");
  hidden = true;
  listeners.get("document:visibilitychange")();
  assert.equal(saves.at(-1).value, "v", "hidden visibility flushes immediately");
  detach();
});

test("stale autosave responses never overwrite newer values; error -> retry", async () => {
  const timers = fakeTimers();
  const calls = [];
  let failNext = false;
  const autosave = createAutosave({
    save: (value, sequence) => new Promise((resolve, reject) => {
      calls.push({ value, sequence, resolve, reject });
      failNext = false;
    }),
    timers: timers.timers,
  });
  autosave.update("old");
  const first = autosave.flush();
  autosave.update("new");
  const second = autosave.flush();
  assert.deepEqual(calls.map((call) => call.value), ["old", "new"]);
  calls[1].resolve();
  await second;
  calls[0].resolve();
  await first;
  assert.equal(autosave.status(), "saved");
  assert.equal(autosave.sequence(), 2, "the newer sequence stays applied");
  // error -> retry
  const failing = createAutosave({ save: async () => { if (failNext) { failNext = false; throw new Error("offline"); } return true; }, timers: timers.timers });
  autosave.detach(); void first; void second;
  failing.update("value");
  await failing.flush();
  assert.equal(failing.status(), "saved");
  failNext = true;
  failing.update("value2");
  await failing.flush();
  assert.equal(failing.status(), "error");
  await failing.retry();
  assert.equal(failing.status(), "saved");
});

// P5-04 round 2: every outgoing SDK message is contract-valid (UUIDv7 clientId,
// unique message ids); two clients get different clientIds.
import { readFileSync as readSchemaFile } from "node:fs";
import { validate as validateContract } from "../../contracts/test/support.mjs";

const SYNC_SCHEMA = JSON.parse(readSchemaFile(new URL("../../contracts/schemas/sync/sync.schema.json", import.meta.url), "utf8"));
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const contractUuid = (tail) => `0192f0f1-7000-7000-8000-0000000000${tail}`;

test("outgoing messages validate against sync.schema.json and ids are unique UUIDv7", () => {
  const operation = {
    id: contractUuid("a1"), boardId: contractUuid("b1"), actorId: contractUuid("c1"),
    createdAt: "2027-01-10T09:30:00.000Z", type: "reorder",
    payload: { itemId: contractUuid("d1"), z: "a" },
    inverse: { boardId: contractUuid("b1"), type: "reorder", payload: { itemId: contractUuid("d1"), z: "b" } },
  };
  const first = clientSetup({ boardId: contractUuid('b2') });
  first.client.start();
  first.sockets[0].receive({ id: "w", type: "welcome", serverSeq: 1, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:1" } });
  first.sockets[0].receive({ id: "s", type: "snapshot", serverSeq: 1, payload: { snapshotRef: "board-1:1", boardContent: content } });
  first.client.sendOperations([operation]);
  first.client.close();

  const second = clientSetup({ boardId: contractUuid('b2') });
  second.client.start();
  second.sockets[0].receive({ id: "w", type: "welcome", serverSeq: 1, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:1" } });
  second.sockets[0].receive({ id: "s", type: "snapshot", serverSeq: 1, payload: { snapshotRef: "board-1:1", boardContent: content } });
  second.sockets[0].close();
  second.timers.advance(100);
  second.sockets[1].receive({ id: "w2", type: "welcome", serverSeq: 2, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:2" } });
  second.sockets[1].receive({ id: "s2", type: "snapshot", serverSeq: 2, payload: { snapshotRef: "board-1:2", boardContent: content } });
  second.client.close();

  const firstMessages = first.sockets.flatMap((socket) => socket.sent);
  const secondMessages = second.sockets.flatMap((socket) => socket.sent);
  const all = [...firstMessages, ...secondMessages];
  for (const message of all) {
    assert.equal(validateContract(message, SYNC_SCHEMA, SYNC_SCHEMA), true, `${message.type} must validate against sync.schema.json: ${JSON.stringify(message).slice(0, 400)}`);
    assert.match(String(message.id), UUID_V7, "every message id is a UUIDv7");
    assert.match(String(message.clientId), UUID_V7, "every clientId is a UUIDv7");
  }
  const clientIds = new Set(all.map((message) => message.clientId));
  assert.equal(clientIds.size, 2, "two clients have different clientIds");
  const messageIds = new Set(all.map((message) => message.id));
  assert.equal(messageIds.size, all.length, "message ids are unique across clients");
  for (const type of ["hello", "joinBoard", "operationBatch", "resyncRequest", "leaveBoard"]) {
    assert.ok(all.some((message) => message.type === type), `the outgoing set contains ${type}`);
  }
  assert.deepEqual(secondMessages.filter((message) => message.type === "resyncRequest").map((message) => message.payload.fromServerSeq), [1]);
});

test("an injected authenticated clientId is used unchanged and must be a UUIDv7", () => {
  const fixed = contractUuid("e1");
  const { client, sockets } = clientSetup({ clientId: fixed });
  client.start();
  assert.equal(sockets[0].sent[0].clientId, fixed);
  assert.throws(() => clientSetup({ clientId: "sdk-client" }), RangeError);
});

// P5-05: presence client — throttled outbound cursor/selection, remote
// participant subscription and clearing on leave/close.
test("presence updates are throttled/coalesced and remote participants subscribe and clear", () => {
  const { client, sockets, timers } = clientSetup();
  client.start();
  const socket = sockets[0];
  socket.receive({ id: "w", type: "welcome", serverSeq: 1, payload: { contractVersion: "0.3.0", snapshotRef: "board-1:1" } });
  socket.receive({ id: "s", type: "snapshot", serverSeq: 1, payload: { snapshotRef: "board-1:1", boardContent: content } });
  const seen = [];
  const unsubscribe = client.onPresence((participants) => seen.push(participants.map((participant) => participant.clientId)));
  socket.receive({ id: "p1", type: "presence", clientId: "0192f0f1-7000-7000-8000-0000000000a1", payload: { nameRef: "user:other", colorRef: "tone-b", cursor: { x: 10, y: 20 }, selection: [] } });
  assert.equal(client.participants().length, 1, "a remote participant is tracked");
  assert.equal(seen.length, 1);
  client.updatePresence({ cursor: { x: 1, y: 2 }, selection: [] });
  client.updatePresence({ cursor: { x: 3, y: 4 }, selection: [] });
  assert.equal(socket.sent.filter((message) => message.type === "presence").length, 0, "presence is throttled");
  timers.advance(50);
  const presence = socket.sent.filter((message) => message.type === "presence");
  assert.equal(presence.length, 1, "two rapid updates coalesce into one presence message");
  assert.deepEqual(presence[0].payload.cursor, { x: 3, y: 4 }, "the newest cursor wins");
  socket.receive({ id: "p2", type: "presence", clientId: "0192f0f1-7000-7000-8000-0000000000a1", payload: { nameRef: "user:other", colorRef: "tone-b", cursor: { x: 0, y: 0 }, selection: [] } });
  assert.equal(client.participants().length, 0, "the removal sentinel clears the participant");
  unsubscribe();
  client.close();
});
