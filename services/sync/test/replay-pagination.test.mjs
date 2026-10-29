// P5-08 regression: replay must paginate the durable log (updatesAfter() has a
// 500-row page size). Real PgSyncStore + real Yjs docs, >500 committed batches;
// fresh join, resync and compaction must see every update.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";


import { createYjsBoardDoc } from "../../../packages/crdt/dist/packages/crdt/src/index.js";
import { compactBoard } from "../src/compaction.ts";
import { createSyncService } from "../src/service.ts";
import { PgSyncStore } from "../src/store.ts";

const ROOT = join(fileURLToPath(new URL("../../..", import.meta.url)));
const SLOT = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
const UUID = (tail) => `0192f0fb-7000-7000-8000-${String(tail).padStart(12, "0")}`;
const BOARD = UUID(0xb1);
const EMPTY = { contractVersion: "0.5.0", board: { id: BOARD, workspaceId: UUID(0xb2), ownerId: UUID(0xb3), title: "Pagination", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" }, zones: [], blocks: [], cards: [], notes: [], edges: [] };
const CARD = UUID(0xc1);
const card = (x) => ({ id: CARD, boardId: BOARD, noteId: UUID(0xd1), x, y: 0, width: 176, height: 80, z: "a", createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" });
const UPDATES = 1200;

async function connect(url) {
  const ws = new WebSocket(url); const messages = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  return { ws, messages, send(m) { ws.send(JSON.stringify(m)); }, async waitFor(predicate, timeout = 8000) { const start = Date.now(); for (;;) { const found = messages.find(predicate); if (found) return found; if (Date.now() - start > timeout) throw new Error("timeout"); await new Promise((done) => setTimeout(done, 10)); } } };
}
async function joinBoard(port, clientId, seq = 2) {
  const socket = await connect(`ws://127.0.0.1:${port}`);
  socket.send({ id: UUID(0x9000), type: "hello", clientId, payload: { tokenRef: "test-token-ref", contractVersion: "0.5.0" } });
  socket.send({ id: UUID(0x9001), type: "joinBoard", clientId, boardId: BOARD, seq, payload: {} });
  const welcome = await socket.waitFor((message) => message.type === "welcome");
  const snapshot = await socket.waitFor((message) => message.type === "snapshot");
  return { socket, welcome, snapshot };
}

test("join/resync/compaction replay more than the 500-row page", { timeout: 60_000 }, async () => {
  const databaseUrl = `postgresql://${process.env.PGUSER ?? "projectair"}:${process.env.PGPASSWORD ?? "projectair_local_only"}@${process.env.PGHOST ?? "127.0.0.1"}:${process.env.PGPORT ?? "5433"}/${SLOT.db_name}`;
  const cleanup = new pg.Client({ connectionString: databaseUrl });
  await cleanup.connect();
  await cleanup.query("DELETE FROM sync_updates WHERE board_id = $1", [BOARD]).catch(() => undefined);
  await cleanup.query("DELETE FROM sync_snapshots WHERE board_id = $1", [BOARD]).catch(() => undefined);
  await cleanup.end();
  const store = new PgSyncStore({ connectionString: databaseUrl });
  const service = await createSyncService({
    host: "127.0.0.1", port: 0,
    authenticator: { authenticate: async (token) => (token === "test-token-ref" ? { userId: UUID(0xb3) } : null) },
    authorizer: { canJoin: async () => true }, store,
    documents: { fromContent: (content) => createYjsBoardDoc({ content }), fromEmpty: () => createYjsBoardDoc({ content: EMPTY }) },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  try {
    const b = await joinBoard(service.port, UUID(0xa1));
    b.socket.send({ id: UUID(0x9100), type: "operationBatch", clientId: UUID(0xa1), boardId: BOARD, seq: 3, payload: { batchId: UUID(0x9200), operations: [{ id: UUID(0x9300), boardId: BOARD, actorId: UUID(0xb3), createdAt: new Date().toISOString(), type: "createCard", payload: { card: card(0) }, inverse: { boardId: BOARD, type: "deleteCard", payload: { card: card(0) } } }] } });
    await b.socket.waitFor((message) => message.type === "ack");
    let seq = 4;
    for (let index = 1; index <= UPDATES; index += 1) {
      const operation = { id: UUID(0x10000 + index), boardId: BOARD, actorId: UUID(0xb3), createdAt: new Date().toISOString(), type: "moveCard", payload: { cardId: CARD, x: index, y: 0 }, inverse: { boardId: BOARD, type: "moveCard", payload: { cardId: CARD, x: 0, y: 0 } } };
      const batchId = UUID(0x20000 + index);
      b.socket.send({ id: UUID(0x30000 + index), type: "operationBatch", clientId: UUID(0xa1), boardId: BOARD, seq, payload: { batchId, operations: [operation] } });
      if (index % 200 === 0) { await b.socket.waitFor((message) => message.type === "ack" && message.payload?.batchId === batchId); }
      seq += 1;
    }
    await b.socket.waitFor((message) => message.type === "ack" && message.payload?.batchId === UUID(0x20000 + UPDATES));
    // Page contract: strictly increasing, non-overlapping, complete; numeric order
    // across the 999->1000 boundary (the old ::text alias ordered lexicographically).
    const pageSeqs = [];
    let pageFrom = 1;
    for (;;) {
      const page = await store.updatesAfter(BOARD, pageFrom);
      for (const entry of page) { assert.ok(entry.serverSeq > pageFrom, "page entries are strictly after the cursor"); pageSeqs.push(entry.serverSeq); }
      if (page.length < 500) break;
      pageFrom = page[page.length - 1].serverSeq;
    }
    assert.deepEqual(pageSeqs, Array.from({ length: UPDATES + 1 }, (_, index) => 2 + index), "pages are complete and numerically ordered (2..1202)");
    // Fresh join must replay all 1,201 updates (over several 500-row pages).
    const fresh = await joinBoard(service.port, UUID(0xa2));
    assert.ok(fresh.welcome.serverSeq >= UPDATES + 1, "welcome is at the current durable sequence");
    assert.equal(fresh.snapshot.payload.boardContent.cards.find((entry) => entry.id === CARD).x, UPDATES, "fresh join sees the last committed update (pagination)");
    // Resync from an earlier sequence must paginate too.
    const resync = await joinBoard(service.port, UUID(0xa3));
    resync.socket.send({ id: UUID(0x9400), type: "resyncRequest", clientId: UUID(0xa3), boardId: BOARD, seq: 5, payload: { fromServerSeq: 1 } });
    const resynced = await resync.socket.waitFor((message) => message.type === "snapshot" && message.id === UUID(0x9400));
    assert.equal(resynced.payload.boardContent.cards.find((entry) => entry.id === CARD).x, UPDATES, "resync replays all pages");
    // Compaction must replay all pages and keep the state.
    const compacted = await compactBoard({ boardId: BOARD, store, documents: { fromContent: (content) => createYjsBoardDoc({ content }), fromEmpty: () => createYjsBoardDoc({ content: EMPTY }) }, minUpdates: 1 });
    assert.equal(compacted.skipped, false);
    assert.equal(compacted.updatesBefore, UPDATES + 1, "compaction replays every stored update");
    const after = await joinBoard(service.port, UUID(0xa4));
    assert.equal(after.snapshot.payload.boardContent.cards.find((entry) => entry.id === CARD).x, UPDATES, "compacted state equals the live document");
    b.socket.ws.close(); fresh.socket.ws.close(); resync.socket.ws.close(); after.socket.ws.close();
  } finally {
    await service.close(); await store.close();
  }
});
