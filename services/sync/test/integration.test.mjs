// P5-03 live integration, extended by P6-08: a real Node WebSocket client over
// the HTTP upgrade, the slot PostgreSQL update log, two clients on one board,
// ack-after-commit and the broadcast/reconnect catch-up. The document factory is
// the real packages/crdt Yjs adapter (the same one services/sync/src/index.ts
// injects), so a body operation is applied by the production document core.
// Only this test's service process is started and stopped.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { createYjsBoardDoc } from "../../../packages/crdt/src/index.ts";
import { validate } from "../../../packages/contracts/test/support.mjs";
import { createSyncService } from "../src/service.ts";
import { PgSyncStore } from "../src/store.ts";

const { Client } = pg;
const BOARD_ID = "0192f0e1-7000-7000-8000-0000000000e1";
const WORKSPACE_ID = "0192f0e3-7000-7000-8000-0000000000f1";
const OWNER_ID = "0192f0e3-7000-7000-8000-0000000000f2";
const ACTOR_ID = "0192f0e3-7000-7000-8000-0000000000f3";
const NOTE_ID = "0192f0e4-7000-7000-8000-0000000000d1";
const CLIENT_A = "0192f0e0-7000-7000-8000-0000000000a1";
const CLIENT_B = "0192f0e0-7000-7000-8000-0000000000a2";
const CLIENT_C = "0192f0e0-7000-7000-8000-0000000000a3";
const CLIENT_D = "0192f0e0-7000-7000-8000-0000000000a4";
const TIMESTAMP = "2027-01-10T09:30:00.000Z";
const SYNC_SCHEMA = JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/sync/sync.schema.json", import.meta.url), "utf8"));
const BOARD_CONTENT_SCHEMA = JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/board-content.schema.json", import.meta.url), "utf8"));
const VALIDATED_TYPES = new Set(["welcome", "snapshot", "ack", "operationBatch", "reject"]);

// Contract 0.4.0 note body: paragraph, unordered list with an https link mark
// and a heading (the shape P6-07's editor emits on save).
const BODY = {
  version: "1",
  blocks: [
    { type: "paragraph", text: "Hello world.", marks: ["bold"] },
    { type: "list", text: "Source", ordered: false, marks: ["link"], href: "https://example.test/source" },
    { type: "heading", text: "Notes", level: 2 },
  ],
};
const BODY_PLAIN_TEXT = "Hello world.\n- Source\nNotes";

function slotConfig() {
  const slot = JSON.parse(readFileSync(join(fileURLToPath(new URL("../../..", import.meta.url)), ".polier-slot"), "utf8"));
  const host = process.env.PGHOST ?? "127.0.0.1";
  const port = process.env.PGPORT ?? "5433";
  const user = process.env.PGUSER ?? "projectair";
  const password = process.env.PGPASSWORD ?? "projectair_local_only";
  return { syncPort: slot.ports.sync, databaseUrl: `postgresql://${user}:${password}@${host}:${port}/${slot.db_name}` };
}

/** The platform-bootstrap board content a fresh board starts from (contract 0.5.0). */
function emptyBoardContent() {
  return {
    contractVersion: "0.5.0",
    board: {
      id: BOARD_ID, workspaceId: WORKSPACE_ID, ownerId: OWNER_ID, title: "Integration board",
      visibility: "private", archived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
    },
    zones: [], blocks: [], cards: [], notes: [], edges: [],
  };
}

const NOTE = {
  id: NOTE_ID, workspaceId: WORKSPACE_ID, title: "Body note",
  createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
};

let uidCounter = 0;
const uid = (prefix) => { uidCounter += 1; return `0192f0e2-7000-7000-8000-${String(prefix * 0x1000 + uidCounter).padStart(12, "0")}`; };

async function connect(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  const messages = [];
  ws.addEventListener("message", (event) => {
    const parsed = JSON.parse(String(event.data));
    messages.push(parsed);

    const waiter = waiters.find((entry) => entry.predicate(parsed));
    if (waiter !== undefined) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(parsed);
      return;
    }
    queue.push(parsed);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    ws,
    messages,
    send(text) { ws.send(text); },
    async next(predicate = () => true, timeoutMs = 5000) {
      const index = queue.findIndex(predicate);
      if (index !== -1) return queue.splice(index, 1)[0];
      return new Promise((resolve, reject) => {
        const entry = { predicate, resolve };
        waiters.push(entry);
        setTimeout(() => {
          const remaining = waiters.indexOf(entry);
          if (remaining !== -1) waiters.splice(remaining, 1);
          reject(new Error(`timeout waiting for a message; queue=${JSON.stringify(queue).slice(0, 400)}`));
        }, timeoutMs).unref();
      });
    },
    close() { ws.close(); },
  };
}

test("live socket integration: join, ack-after-commit, updateNoteBody log/broadcast/catch-up and reconnect", { timeout: 30_000 }, async () => {
  const { syncPort, databaseUrl } = slotConfig();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const store = new PgSyncStore({ connectionString: databaseUrl });
  let service = null;
  const sockets = [];
  try {
    await client.query("DELETE FROM sync_updates");
    await client.query("DELETE FROM sync_snapshots");
    // The platform bootstrap supplies the board content; the service's own
    // placeholder is never used for a board that has a baseline snapshot.
    await client.query("INSERT INTO sync_snapshots (board_id, server_seq, snapshot) VALUES ($1, 1, $2)", [BOARD_ID, emptyBoardContent()]);
    service = await createSyncService({
      host: "127.0.0.1",
      port: syncPort,
      authenticator: { authenticate: async (tokenRef) => (tokenRef === "test-token" ? { userId: "user-1" } : null) },
      authorizer: { canJoin: async (userId, boardId) => userId === "user-1" && boardId === BOARD_ID },
      store,
      // The real CRDT adapter: the log replays through the same BoardDoc that
      // applies broadcast batches, so state and snapshot cannot diverge.
      documents: { fromContent: (content) => createYjsBoardDoc({ content }), fromEmpty: () => createYjsBoardDoc({ content: emptyBoardContent() }) },
      logger: { debug() {}, info() {}, warn() {}, error() {}, },
    });
    const hello = (clientId) => JSON.stringify({ id: uid(2), type: "hello", clientId, payload: { tokenRef: "test-token", contractVersion: "0.5.0" } });
    const join = (clientId) => JSON.stringify({ id: uid(3), type: "joinBoard", clientId, boardId: BOARD_ID, seq: 1, payload: {} });

    const a = await connect(service.url); sockets.push(a);
    const b = await connect(service.url); sockets.push(b);
    a.send(hello(CLIENT_A)); a.send(join(CLIENT_A));
    b.send(hello(CLIENT_B)); b.send(join(CLIENT_B));
    const aWelcome = await a.next((m) => m.type === "welcome");
    const aSnapshot = await a.next((m) => m.type === "snapshot");
    const bWelcome = await b.next((m) => m.type === "welcome");
    assert.equal(aWelcome.serverSeq, 1, "a fresh board starts at serverSeq 1");
    assert.equal(aWelcome.payload.snapshotRef, `${BOARD_ID}:1`);
    assert.equal(aSnapshot.serverSeq, 1);
    assert.equal(bWelcome.serverSeq, 1);
    assert.equal(service.connectionCount() >= 2, true, "both real sockets are registered");
    const baseline = await client.query("SELECT server_seq FROM sync_snapshots WHERE board_id = $1 ORDER BY server_seq DESC LIMIT 1", [BOARD_ID]);
    assert.equal(baseline.rowCount, 1, "the fresh board has a baseline snapshot row");
    assert.equal(Number(baseline.rows[0].server_seq), 1, "the baseline snapshot is at serverSeq 1");

    // Client A sends a batch; the ack must arrive only after the DB commit.
    const batch = JSON.stringify({
      id: uid(4), type: "operationBatch", clientId: CLIENT_A, boardId: BOARD_ID, seq: 2,
      payload: {
        batchId: uid(5),
        operations: [{
          id: uid(7), boardId: BOARD_ID, actorId: ACTOR_ID, createdAt: TIMESTAMP,
          type: "reorder", payload: { itemId: uid(8), z: "a" },
          inverse: { boardId: BOARD_ID, type: "reorder", payload: { itemId: uid(9), z: "b" } },
        }],
      },
    });
    a.send(batch);
    const ack = await a.next((m) => m.type === "ack");
    assert.equal(ack.serverSeq, 2, "the first update after the baseline is serverSeq 2");
    const committed = await client.query("SELECT server_seq, message_id FROM sync_updates WHERE board_id = $1 AND server_seq = 2", [BOARD_ID]);
    assert.equal(committed.rowCount, 1, "the row is committed when/at the ack arrives");
    assert.equal(Number(committed.rows[0].server_seq), 2);
    const broadcast = await b.next((m) => m.type === "operationBatch");
    assert.equal(broadcast.serverSeq, 2, "the other client receives the broadcast over its own socket");
    assert.equal(typeof broadcast.payload.batchId, "string");

    // A third client joins after the first batch: it catches up to serverSeq 2.
    const c = await connect(service.url); sockets.push(c);
    c.send(hello(CLIENT_C)); c.send(join(CLIENT_C));
    const cWelcome = await c.next((m) => m.type === "welcome");
    const cSnapshot = await c.next((m) => m.type === "snapshot");
    assert.equal(cWelcome.serverSeq, 2, "the join returns the current document at the current serverSeq");
    assert.equal(cWelcome.payload.snapshotRef, `${BOARD_ID}:2`);
    assert.equal(cSnapshot.serverSeq, 2);
    assert.equal(validate(cSnapshot.payload.boardContent, BOARD_CONTENT_SCHEMA, BOARD_CONTENT_SCHEMA), true, "the snapshot is contract 0.5.0 board content");
    c.send(JSON.stringify({ id: uid(6), type: "resyncRequest", clientId: CLIENT_C, boardId: BOARD_ID, seq: 2, payload: { fromServerSeq: 1 } }));
    const resyncWelcome = await c.next((m) => m.type === "welcome");
    const resyncSnapshot = await c.next((m) => m.type === "snapshot");
    assert.equal(resyncWelcome.serverSeq, 2, "the reconnect catches up to the missed serverSeq");
    assert.equal(resyncSnapshot.serverSeq, 2);
    let rows = await client.query("SELECT count(*)::int AS count FROM sync_updates WHERE board_id = $1", [BOARD_ID]);
    assert.equal(rows.rows[0].count, 1, "exactly one durable update is missed and caught up");

    // P6-08: client A sends a createNote + updateNoteBody batch. It must be
    // acked with the next serverSeq, persist the operations, broadcast to the
    // other clients, replay through the BoardDoc for catch-up and appear as
    // body + plainText in a fresh join's snapshot.
    const createNote = {
      id: uid(10), boardId: BOARD_ID, actorId: ACTOR_ID, createdAt: TIMESTAMP, type: "createNote",
      payload: { note: NOTE },
      inverse: { boardId: BOARD_ID, type: "deleteNote", payload: { note: NOTE, cards: [] } },
    };
    const updateNoteBody = {
      id: uid(11), boardId: BOARD_ID, actorId: ACTOR_ID, createdAt: TIMESTAMP, type: "updateNoteBody",
      payload: { noteId: NOTE_ID, body: BODY },
      inverse: { boardId: BOARD_ID, type: "updateNoteBody", payload: { noteId: NOTE_ID, body: { version: "1", blocks: [] } } },
    };
    const bodyBatchId = uid(12);
    a.send(JSON.stringify({
      id: uid(13), type: "operationBatch", clientId: CLIENT_A, boardId: BOARD_ID, seq: 3,
      payload: { batchId: bodyBatchId, operations: [createNote, updateNoteBody] },
    }));
    const bodyAck = await a.next((m) => m.type === "ack" && m.payload?.batchId === bodyBatchId);
    assert.equal(bodyAck.serverSeq, 3, "the body batch is acked with the next serverSeq");
    const bodyRow = await client.query("SELECT encoded_update FROM sync_updates WHERE board_id = $1 AND server_seq = 3", [BOARD_ID]);
    assert.equal(bodyRow.rowCount, 1, "the body batch is durable at its acked serverSeq");
    const loggedOperations = JSON.parse(Buffer.from(bodyRow.rows[0].encoded_update).toString("utf8"));
    assert.deepEqual(loggedOperations.map((operation) => operation.type), ["createNote", "updateNoteBody"], "the log stores the batch's contract operations");
    assert.deepEqual(loggedOperations[1].payload.body, BODY, "the structured body is persisted, not a string");
    const bodyBroadcast = await b.next((m) => m.type === "operationBatch" && m.serverSeq === 3);
    assert.deepEqual(bodyBroadcast.payload.operations.map((operation) => operation.type), ["createNote", "updateNoteBody"], "the other client receives the updateNoteBody broadcast");

    // A fresh join replays the log into a snapshot that carries body + plainText.
    const d = await connect(service.url); sockets.push(d);
    d.send(hello(CLIENT_D)); d.send(join(CLIENT_D));
    const dWelcome = await d.next((m) => m.type === "welcome");
    const dSnapshot = await d.next((m) => m.type === "snapshot");
    assert.equal(dWelcome.serverSeq, 3, "a fresh join replays the body batch");
    assert.equal(dWelcome.payload.snapshotRef, `${BOARD_ID}:3`);
    assert.equal(validate(dSnapshot.payload.boardContent, BOARD_CONTENT_SCHEMA, BOARD_CONTENT_SCHEMA), true, "the fresh join snapshot is valid contract 0.5.0 board content");
    const joinedNote = dSnapshot.payload.boardContent.notes.find((note) => note.id === NOTE_ID);
    assert.deepEqual(joinedNote.body, BODY, "the fresh join snapshot contains the structured body");
    assert.equal(joinedNote.plainText, BODY_PLAIN_TEXT, "the fresh join snapshot contains the derived plainText");

    // Reconnect catch-up from before the body batch: the log replays it through
    // the same BoardDoc on a fresh session that already knows serverSeq 3.
    const resyncId = uid(14);
    d.send(JSON.stringify({ id: resyncId, type: "resyncRequest", clientId: CLIENT_D, boardId: BOARD_ID, seq: 3, payload: { fromServerSeq: 2 } }));
    const catchUpWelcome = await d.next((m) => m.type === "welcome" && m.id === resyncId);
    const catchUpSnapshot = await d.next((m) => m.type === "snapshot" && m.id === resyncId);
    assert.equal(catchUpWelcome.serverSeq, 3, "catch-up replays the durable body batch");
    const catchUpNote = catchUpSnapshot.payload.boardContent.notes.find((note) => note.id === NOTE_ID);
    assert.deepEqual(catchUpNote.body, BODY, "catch-up replay restores the body");
    assert.equal(catchUpNote.plainText, BODY_PLAIN_TEXT, "catch-up replay restores the plainText");

    rows = await client.query("SELECT count(*)::int AS count FROM sync_updates WHERE board_id = $1", [BOARD_ID]);
    assert.equal(rows.rows[0].count, 2, "two durable batches are persisted");
    for (const socket of [a, b, c, d]) {
      for (const emitted of socket.messages.filter((entry) => VALIDATED_TYPES.has(entry.type))) {
        assert.equal(validate(emitted, SYNC_SCHEMA, SYNC_SCHEMA), true, `${emitted.type} must validate against sync.schema.json: ${JSON.stringify(emitted).slice(0, 500)}`);
      }
    }
    const snapshots = await client.query("SELECT server_seq FROM sync_snapshots WHERE board_id = $1", [BOARD_ID]);
    assert.equal(snapshots.rowCount, 1, "the fresh board has exactly the baseline snapshot row (no stale snapshot written on join)");
    assert.equal(Number(snapshots.rows[0].server_seq), 1);

    // P6-13: contract 0.5.0 — a zone rename and a checklist content edit go
    // through ack, log, broadcast and a fresh join's replay on the real Yjs core.
    const zone = { id: uid(20), boardId: BOARD_ID, title: "Research", x: 0, y: 0, width: 256, height: 192, z: "a", createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
    const block = { id: uid(21), boardId: BOARD_ID, type: "checklist", x: 0, y: 240, width: 224, height: 128, z: "a", createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
    const checklist = { kind: "checklist", items: [{ id: uid(22), text: "Synced point", done: false }] };
    const contentBatchId = uid(23);
    const contentOperations = [
      { id: uid(24), boardId: BOARD_ID, actorId: ACTOR_ID, createdAt: TIMESTAMP, type: "createZone", payload: { zone }, inverse: { boardId: BOARD_ID, type: "deleteZone", payload: { zone, policy: "keep", cards: [], blocks: [] } } },
      { id: uid(25), boardId: BOARD_ID, actorId: ACTOR_ID, createdAt: TIMESTAMP, type: "updateZone", payload: { zoneId: zone.id, title: "Field research" }, inverse: { boardId: BOARD_ID, type: "updateZone", payload: { zoneId: zone.id, title: zone.title } } },
      { id: uid(26), boardId: BOARD_ID, actorId: ACTOR_ID, createdAt: TIMESTAMP, type: "createBlock", payload: { block }, inverse: { boardId: BOARD_ID, type: "deleteBlock", payload: { block } } },
      { id: uid(27), boardId: BOARD_ID, actorId: ACTOR_ID, createdAt: TIMESTAMP, type: "updateBlockContent", payload: { blockId: block.id, content: checklist }, inverse: { boardId: BOARD_ID, type: "updateBlockContent", payload: { blockId: block.id, content: { kind: "checklist", items: [] } } } },
    ];
    a.send(JSON.stringify({ id: uid(28), type: "operationBatch", clientId: CLIENT_A, boardId: BOARD_ID, seq: 4, payload: { batchId: contentBatchId, operations: contentOperations } }));
    const contentAck = await a.next((m) => m.type === "ack" && m.payload?.batchId === contentBatchId);
    assert.equal(contentAck.serverSeq, 4, "the 0.5.0 batch is acked with the next serverSeq");
    const contentBroadcast = await b.next((m) => m.type === "operationBatch" && m.serverSeq === 4);
    assert.deepEqual(contentBroadcast.payload.operations.map((operation) => operation.type), ["createZone", "updateZone", "createBlock", "updateBlockContent"]);
    const e = await connect(service.url); sockets.push(e);
    e.send(hello(CLIENT_D)); e.send(join(CLIENT_D));
    const eWelcome = await e.next((m) => m.type === "welcome");
    const eSnapshot = await e.next((m) => m.type === "snapshot");
    assert.equal(eWelcome.serverSeq, 4, "a fresh join replays the 0.5.0 batch");
    assert.equal(validate(eSnapshot.payload.boardContent, BOARD_CONTENT_SCHEMA, BOARD_CONTENT_SCHEMA), true, "the snapshot with block content is valid contract 0.5.0 board content");
    assert.equal(eSnapshot.payload.boardContent.zones.find((entry) => entry.id === zone.id).title, "Field research");
    assert.deepEqual(eSnapshot.payload.boardContent.blocks.find((entry) => entry.id === block.id).content, checklist);
    for (const emitted of [...a.messages, ...b.messages, ...e.messages].filter((entry) => VALIDATED_TYPES.has(entry.type))) {
      assert.equal(validate(emitted, SYNC_SCHEMA, SYNC_SCHEMA), true, `${emitted.type} must validate against sync.schema.json`);
    }
  } finally {
    for (const socket of sockets) { try { socket.close(); } catch { /* closed */ } }
    if (service !== null) await service.close().catch(() => undefined);
    await store.close().catch(() => undefined);
    await client.end().catch(() => undefined);
  }
});
