// P5-07 regression: a joining/reconnecting client must receive the committed
// board state even when the latest snapshot was written after compaction. Uses
// the real PostgreSQL store (slot DB) and the real Yjs BoardDoc, not fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createYjsBoardDoc } from "../../../packages/crdt/dist/packages/crdt/src/index.js";
import { compactBoard } from "../src/compaction.ts";
import { createSyncService } from "../src/service.ts";
import { PgSyncStore } from "../src/store.ts";

const ROOT = join(new URL("../../..", import.meta.url).pathname);
const SLOT = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
const UUID = (tail) => `0192f0f7-7000-7000-8000-${String(tail).padStart(12, "0")}`;
const BOARD = UUID(0xa1);
const CARD_A = UUID(0xc1);
const CARD_B = UUID(0xc2);
const empty = { contractVersion: "0.4.0", board: { id: BOARD, workspaceId: UUID(0xa2), ownerId: UUID(0xa3), title: "Join replay", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" }, zones: [], blocks: [], cards: [], notes: [], edges: [] };
const card = (id) => ({ id, boardId: BOARD, noteId: UUID(0xd1), x: 0, y: 0, width: 176, height: 80, z: "a", createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" });
const createCard = (id, n) => ({ id: UUID(n), boardId: BOARD, actorId: UUID(0xa3), createdAt: new Date().toISOString(), type: "createCard", payload: { card: card(id) }, inverse: { boardId: BOARD, type: "deleteCard", payload: { card: card(id) } } });
const moveCard = (cardId, x, n) => ({ id: UUID(n), boardId: BOARD, actorId: UUID(0xa3), createdAt: new Date().toISOString(), type: "moveCard", payload: { cardId, x, y: 0 }, inverse: { boardId: BOARD, type: "moveCard", payload: { cardId, x: 0, y: 0 } } });

async function connect(url) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  return { ws, messages, send(message) { ws.send(JSON.stringify(message)); }, async waitFor(predicate, timeout = 5000) { const start = Date.now(); for (;;) { const found = messages.find(predicate); if (found) return found; if (Date.now() - start > timeout) throw new Error(`timeout ${JSON.stringify(messages).slice(0, 400)}`); await new Promise((done) => setTimeout(done, 20)); } } };
}
async function joinBoard(port, clientId) {
  const socket = await connect(`ws://127.0.0.1:${port}`);
  socket.send({ id: UUID(0x9000), type: "hello", clientId, payload: { tokenRef: "test-token-ref", contractVersion: "0.4.0" } });
  socket.send({ id: UUID(0x9001), type: "joinBoard", clientId, boardId: BOARD, seq: 2, payload: {} });
  const welcome = await socket.waitFor((message) => message.type === "welcome");
  const snapshot = await socket.waitFor((message) => message.type === "snapshot");
  return { socket, welcome, snapshot };
}

test("join replay rebuilds the committed state after compaction (real Pg store)", { timeout: 30_000 }, async () => {
  const databaseUrl = `postgresql://${process.env.PGUSER ?? "projectair"}:${process.env.PGPASSWORD ?? "projectair_local_only"}@${process.env.PGHOST ?? "127.0.0.1"}:${process.env.PGPORT ?? "5433"}/${SLOT.db_name}`;
  const store = new PgSyncStore({ connectionString: databaseUrl });
  const service = await createSyncService({
    host: "127.0.0.1", port: 0,
    authenticator: { authenticate: async (token) => (token === "test-token-ref" ? { userId: UUID(0xa3) } : null) },
    authorizer: { canJoin: async () => true },
    store,
    documents: { fromContent: (content) => createYjsBoardDoc({ content }), fromEmpty: () => createYjsBoardDoc({ content: empty }) },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  try {
    const b = await joinBoard(service.port, UUID(0xb1));
    b.socket.send({ id: UUID(0x9100), type: "operationBatch", clientId: UUID(0xb1), boardId: BOARD, seq: 3, payload: { batchId: UUID(0x9200), operations: [createCard(CARD_A, 0x2001), createCard(CARD_B, 0x2002)] } });
    await b.socket.waitFor((message) => message.type === "ack");
    b.socket.send({ id: UUID(0x9101), type: "operationBatch", clientId: UUID(0xb1), boardId: BOARD, seq: 4, payload: { batchId: UUID(0x9201), operations: [moveCard(CARD_A, 123, 0x2003)] } });
    await b.socket.waitFor((message) => message.type === "ack" && message.payload?.batchId === UUID(0x9201));
    // Before compaction: a fresh join must see both cards and the moved value.
    const before = await joinBoard(service.port, UUID(0xb2));
    const beforeCards = before.snapshot.payload.boardContent.cards;
    assert.ok(beforeCards.some((entry) => entry.id === CARD_A && entry.x === 123), "join before compaction sees the committed card update");
    // Compact at the current sequence, then commit a post-snapshot update.
    const compacted = await compactBoard({ boardId: BOARD, store, documents: { fromContent: (content) => createYjsBoardDoc({ content }), fromEmpty: () => createYjsBoardDoc({ content: empty }) }, minUpdates: 1 });
    assert.equal(compacted.skipped, false);
    b.socket.send({ id: UUID(0x9102), type: "operationBatch", clientId: UUID(0xb1), boardId: BOARD, seq: 5, payload: { batchId: UUID(0x9202), operations: [moveCard(CARD_B, 77, 0x2004)] } });
    const ack = await b.socket.waitFor((message) => message.type === "ack" && message.payload?.batchId === UUID(0x9202));
    assert.equal(ack.serverSeq, compacted.snapshotSeq + 1, "the post-compaction update continues the sequence");
    const after = await joinBoard(service.port, UUID(0xb3));
    const afterCards = after.snapshot.payload.boardContent.cards;
    assert.equal(after.welcome.serverSeq, ack.serverSeq, "the welcome carries the current durable sequence");
    assert.equal(afterCards.find((entry) => entry.id === CARD_A).x, 123, "the compacted snapshot state is replayed");
    assert.equal(afterCards.find((entry) => entry.id === CARD_B).x, 77, "post-snapshot committed updates survive the rehydrated join");
    // Offline/reconnect catch-up: a client resyncs from an earlier sequence and
    // receives the missed update in the rebuilt snapshot.
    const c = await joinBoard(service.port, UUID(0xb4));
    c.socket.send({ id: UUID(0x9300), type: "resyncRequest", clientId: UUID(0xb4), boardId: BOARD, seq: 6, payload: { fromServerSeq: compacted.snapshotSeq } });
    const resync = await c.socket.waitFor((message) => message.type === "snapshot" && message.id === UUID(0x9300));
    assert.equal(resync.payload.boardContent.cards.find((entry) => entry.id === CARD_B).x, 77, "resync from an earlier seq includes the missed committed update");
    b.socket.ws.close(); before.socket.ws.close(); after.socket.ws.close(); c.socket.ws.close();
  } finally {
    await service.close();
    await store.close();
  }
});
