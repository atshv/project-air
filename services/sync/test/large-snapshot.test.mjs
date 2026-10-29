// P5-08: a board snapshot larger than the 1 MiB inbound bound must still be
// delivered (outbound frames use MAX_OUTBOUND_BYTES, 64 MiB).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createSyncService } from "../src/service.ts";

const ROOT = join(new URL("../../..", import.meta.url).pathname);
const SLOT = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
const UUID = (tail) => `0192f0fc-7000-7000-8000-${String(tail).padStart(12, "0")}`;
const BOARD = UUID(0xb1);
const CARD = (index) => ({ id: UUID(0x10000 + index), boardId: BOARD, noteId: UUID(0xd1), x: index, y: index, width: 176, height: 80, z: String(index).padStart(3, "0"), createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" });
const CONTENT = { contractVersion: "0.4.0", board: { id: BOARD, workspaceId: UUID(0xb2), ownerId: UUID(0xb3), title: "Large", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" }, zones: [], blocks: [], notes: [], edges: [], cards: Array.from({ length: 7000 }, (_, index) => CARD(index)) };
const store = { async loadBoard() { return { serverSeq: 1, snapshotSeq: 1, boardContent: CONTENT }; }, async appendUpdate() { return 2; }, async updatesAfter() { return []; } };
const documents = { fromContent: (content) => ({ apply() {}, applyUpdate() {}, encodeUpdate() { return "eA=="; }, stateVector() { return "v"; }, snapshot() { return content; } }), fromEmpty: () => documents.fromContent(CONTENT) };
void SLOT;

test("a >1 MiB snapshot is delivered to a joining client", { timeout: 20_000 }, async () => {
  const service = await createSyncService({
    host: "127.0.0.1", port: 0,
    authenticator: { authenticate: async (token) => (token === "test-token-ref" ? { userId: UUID(0xb3) } : null) },
    authorizer: { canJoin: async () => true }, store, documents,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const ws = new WebSocket(service.url);
  const messages = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
  try {
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    const waitFor = async (predicate) => { const start = Date.now(); for (;;) { const found = messages.find(predicate); if (found) return found; if (Date.now() - start > 5000) throw new Error(`timeout waiting for snapshot; messages=${JSON.stringify(messages).slice(0, 300)}`); await new Promise((done) => setTimeout(done, 20)); } };
    ws.send(JSON.stringify({ id: UUID(0x9000), type: "hello", clientId: UUID(0xa1), payload: { tokenRef: "test-token-ref", contractVersion: "0.4.0" } }));
    ws.send(JSON.stringify({ id: UUID(0x9001), type: "joinBoard", clientId: UUID(0xa1), boardId: BOARD, seq: 2, payload: {} }));
    const snapshot = await waitFor((message) => message.type === "snapshot");
    const bytes = JSON.stringify(snapshot.payload.boardContent).length;
    assert.ok(bytes > 1_048_576, `snapshot is larger than the inbound bound (${bytes} bytes)`);
    assert.equal(snapshot.payload.boardContent.cards.length, 7000, "the full large snapshot is delivered");
  } finally {
    ws.close();
    await service.close();
  }
});
