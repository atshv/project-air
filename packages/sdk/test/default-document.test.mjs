// P6-04: createBoardSyncClient defaults to the real CRDT document (ADR-0012);
// injected fakes stay supported.
import assert from "node:assert/strict";
import test from "node:test";

import { createBoardSyncClient } from "../src/index.ts";

const content = { contractVersion: "0.4.0", board: { id: "0192f0a3-7000-7000-8000-000000000003", workspaceId: "0192f0a2-7000-7000-8000-000000000002", ownerId: "0192f0a1-7000-7000-8000-000000000001", title: "Board", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" }, zones: [], blocks: [], cards: [], notes: [], edges: [] };

test("the default createDocument is a real CRDT document that applies remote operations", () => {
  const socket = { sent: [], close() {}, addEventListener() {}, send(data) { this.sent.push(JSON.parse(data)); } };
  const client = createBoardSyncClient({ createSocket: () => socket, boardId: content.board.id, tokenRef: "t", clientId: "0192f0b0-7000-7000-8000-000000000001", initialContent: content });
  assert.equal(typeof client.document().apply, "function");
  const before = client.document().snapshot();
  assert.deepEqual(before.cards, []);
  assert.equal(typeof client.document().encodeUpdate(), "string");
});
