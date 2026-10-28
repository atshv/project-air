// P5-03 live integration: a real Node WebSocket client over the HTTP upgrade, the
// slot PostgreSQL update log, two clients on one board, ack-after-commit and the
// broadcast/reconnect catch-up. Only this test's service process is started and
// stopped; the injectable adapters are fakes, the production adapters stay in
// services/sync/src/index.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import pg from "pg";

import { validate } from "../../../packages/contracts/test/support.mjs";
import { createSyncService } from "../src/service.ts";
import { PgSyncStore } from "../src/store.ts";

const { Client } = pg;
const BOARD_ID = "0192f0e1-7000-7000-8000-0000000000e1";
const CLIENT_A = "0192f0e0-7000-7000-8000-0000000000a1";
const CLIENT_B = "0192f0e0-7000-7000-8000-0000000000a2";
const CLIENT_C = "0192f0e0-7000-7000-8000-0000000000a3";
const SYNC_SCHEMA = JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/sync/sync.schema.json", import.meta.url), "utf8"));
const VALIDATED_TYPES = new Set(["welcome", "snapshot", "ack", "operationBatch", "reject"]);

function slotConfig() {
  const slot = JSON.parse(readFileSync(join(new URL("../../..", import.meta.url).pathname, ".polier-slot"), "utf8"));
  const host = process.env.PGHOST ?? "127.0.0.1";
  const port = process.env.PGPORT ?? "5433";
  const user = process.env.PGUSER ?? "projectair";
  const password = process.env.PGPASSWORD ?? "projectair_local_only";
  return { syncPort: slot.ports.sync, databaseUrl: `postgresql://${user}:${password}@${host}:${port}/${slot.db_name}` };
}

function fakeDocument() {
  const operations = [];
  const updates = [];
  return {
    operations, updates,
    apply(op) { operations.push(op); },
    encodeUpdate() { return Buffer.from(JSON.stringify({ ops: operations })).toString("base64"); },
    applyUpdate(update) { updates.push(update); },
    stateVector() { return "state"; },
    snapshot() {
      return {
        contractVersion: "0.3.0",
        board: { id: BOARD_ID, workspaceId: "0192f0e3-7000-7000-8000-0000000000f1", ownerId: "0192f0e3-7000-7000-8000-0000000000f2", title: "Integration board", visibility: "private", archived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
        zones: [], blocks: [], cards: [], notes: [], edges: [],
      };
    },
  };
}

let uidCounter = 0;
const uid = (prefix) => { uidCounter += 1; return `0192f0e2-7000-7000-8000-${String(prefix * 0x1000 + uidCounter).padStart(12, "0")}`; };
function message(type, payload = {}, extra = {}) {
  return JSON.stringify({ id: uid(1), type, clientId: CLIENT_A, boardId: BOARD_ID, payload, ...extra });
}

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

test("live socket integration: join, ack-after-commit, broadcast and reconnect catch-up", { timeout: 30_000 }, async () => {
  const { syncPort, databaseUrl } = slotConfig();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const store = new PgSyncStore({ connectionString: databaseUrl });
  let service = null;
  const sockets = [];
  try {
    await client.query("DELETE FROM sync_updates");
    await client.query("DELETE FROM sync_snapshots");
    service = await createSyncService({
      host: "127.0.0.1",
      port: syncPort,
      authenticator: { authenticate: async (tokenRef) => (tokenRef === "test-token" ? { userId: "user-1" } : null) },
      authorizer: { canJoin: async (userId, boardId) => userId === "user-1" && boardId === BOARD_ID },
      store,
      documents: { fromContent: () => fakeDocument(), fromEmpty: () => fakeDocument() },
      logger: { debug() {}, info() {}, warn() {}, error() {}, },
    });
    const hello = (clientId) => JSON.stringify({ id: uid(2), type: "hello", clientId, payload: { tokenRef: "test-token", contractVersion: "0.3.0" } });
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
          id: uid(7), boardId: BOARD_ID, actorId: "0192f0e3-7000-7000-8000-0000000000f3", createdAt: "2027-01-10T09:30:00.000Z",
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

    // A third client joins after the batch: it catches up to serverSeq 1.
    const c = await connect(service.url); sockets.push(c);
    c.send(hello(CLIENT_C)); c.send(join(CLIENT_C));
    const cWelcome = await c.next((m) => m.type === "welcome");
    const cSnapshot = await c.next((m) => m.type === "snapshot");
    assert.equal(cWelcome.serverSeq, 2, "the join returns the current document at the current serverSeq");
    assert.equal(cWelcome.payload.snapshotRef, `${BOARD_ID}:2`);
    assert.equal(cSnapshot.serverSeq, 2);
    assert.equal(validate(cSnapshot.payload.boardContent, JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/board-content.schema.json", import.meta.url), "utf8")), JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/board-content.schema.json", import.meta.url), "utf8"))), true);
    c.send(JSON.stringify({ id: uid(6), type: "resyncRequest", clientId: CLIENT_C, boardId: BOARD_ID, seq: 2, payload: { fromServerSeq: 1 } }));
    const resyncWelcome = await c.next((m) => m.type === "welcome");
    const resyncSnapshot = await c.next((m) => m.type === "snapshot");
    assert.equal(resyncWelcome.serverSeq, 2, "the reconnect catches up to the missed serverSeq");
    assert.equal(resyncSnapshot.serverSeq, 2);
    const rows = await client.query("SELECT count(*)::int AS count FROM sync_updates WHERE board_id = $1", [BOARD_ID]);
    assert.equal(rows.rows[0].count, 1, "exactly one durable update is missed and caught up");
    for (const socket of [a, b, c]) {
      for (const emitted of socket.messages.filter((entry) => VALIDATED_TYPES.has(entry.type))) {
        assert.equal(validate(emitted, SYNC_SCHEMA, SYNC_SCHEMA), true, `${emitted.type} must validate against sync.schema.json: ${JSON.stringify(emitted).slice(0, 500)}`);
      }
    }
    const snapshots = await client.query("SELECT server_seq FROM sync_snapshots WHERE board_id = $1", [BOARD_ID]);
    assert.equal(snapshots.rowCount, 1, "the fresh board has exactly the baseline snapshot row (no stale snapshot written on join)");
    assert.equal(Number(snapshots.rows[0].server_seq), 1);
  } finally {
    for (const socket of sockets) { try { socket.close(); } catch { /* closed */ } }
    if (service !== null) await service.close().catch(() => undefined);
    await store.close().catch(() => undefined);
    await client.end().catch(() => undefined);
  }
});
