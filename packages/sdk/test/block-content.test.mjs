// P6-13: contract 0.5.0 operations through the board-sync client on the real
// CRDT document: updateBlockContent and updateZone apply locally, travel as
// schema-valid batches and undo/redo restore them through the own-op history.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createBoardSyncClient } from "../src/index.ts";
import { validate } from "../../contracts/test/support.mjs";

const SYNC_SCHEMA = JSON.parse(readFileSync(new URL("../../contracts/schemas/sync/sync.schema.json", import.meta.url), "utf8"));
const UUID = (n) => `0192f0b7-7000-7000-8000-${String(n).padStart(12, "0")}`;
const TIMESTAMP = "2027-01-10T09:30:00.000Z";
const BOARD_ID = UUID(1);
const ZONE = { id: UUID(2), boardId: BOARD_ID, title: "Research", x: 0, y: 0, width: 256, height: 192, z: "a", createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
const FIRST = { id: UUID(3), text: "First point", done: false };
const BLOCK = {
  id: UUID(4), boardId: BOARD_ID, type: "checklist", x: 0, y: 240, width: 224, height: 128, z: "a", createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
  content: { kind: "checklist", items: [FIRST] },
};
const content = {
  contractVersion: "0.5.0",
  board: { id: BOARD_ID, workspaceId: UUID(5), ownerId: UUID(6), title: "Board", visibility: "private", archived: false, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
  zones: [ZONE], blocks: [BLOCK], cards: [], notes: [], edges: [],
};

function socketAndClient() {
  const listeners = new Map();
  const socket = {
    sent: [],
    send(data) { this.sent.push(JSON.parse(data)); },
    close() { listeners.get("close")?.(); },
    addEventListener(type, listener) { listeners.set(type, listener); },
    receive(message) { listeners.get("message")?.({ data: JSON.stringify(message) }); },
  };
  const client = createBoardSyncClient({ createSocket: () => socket, boardId: BOARD_ID, tokenRef: "t", clientId: UUID(7), initialContent: content });
  client.start();
  socket.receive({ id: UUID(8), type: "welcome", serverSeq: 1, payload: { contractVersion: "0.5.0", snapshotRef: `${BOARD_ID}:1` } });
  socket.receive({ id: UUID(9), type: "snapshot", serverSeq: 1, payload: { snapshotRef: `${BOARD_ID}:1`, boardContent: content } });
  return { socket, client };
}

const blockContent = (client) => client.document().snapshot().blocks.find((block) => block.id === BLOCK.id).content;
const zoneTitle = (client) => client.document().snapshot().zones.find((zone) => zone.id === ZONE.id).title;

test("updateBlockContent and updateZone apply locally, send valid batches and undo/redo through the own history", () => {
  const { socket, client } = socketAndClient();
  const next = { kind: "checklist", items: [FIRST, { id: UUID(10), text: "Second point", done: true }] };
  const contentOperation = {
    id: UUID(11), boardId: BOARD_ID, actorId: UUID(7), createdAt: TIMESTAMP, type: "updateBlockContent",
    payload: { blockId: BLOCK.id, content: next },
    inverse: { boardId: BOARD_ID, type: "updateBlockContent", payload: { blockId: BLOCK.id, content: BLOCK.content } },
  };
  const renameOperation = {
    id: UUID(12), boardId: BOARD_ID, actorId: UUID(7), createdAt: TIMESTAMP, type: "updateZone",
    payload: { zoneId: ZONE.id, title: "Field research" },
    inverse: { boardId: BOARD_ID, type: "updateZone", payload: { zoneId: ZONE.id, title: ZONE.title } },
  };
  // The SDK records an undo as an own operation too, so each undo is checked
  // right after its edit (a second undo would undo the first undo).
  client.sendOperations([contentOperation]);
  assert.deepEqual(blockContent(client), next, "the content edit is applied locally first");
  assert.equal(client.undoOwn(), true);
  assert.deepEqual(blockContent(client), BLOCK.content, "undo restores the previous content");
  assert.equal(client.redoOwn(), true);
  assert.deepEqual(blockContent(client), next, "redo applies the content edit again");

  client.sendOperations([renameOperation]);
  assert.equal(zoneTitle(client), "Field research");
  assert.equal(client.undoOwn(), true);
  assert.equal(zoneTitle(client), ZONE.title, "undo restores the previous zone title");
  assert.deepEqual(blockContent(client), next, "undoing the rename leaves the content alone");

  const batches = socket.sent.filter((message) => message.type === "operationBatch");
  assert.equal(batches.length, 5, "two edits, two undos and one redo are five local batches");
  for (const batch of batches) {
    assert.equal(validate(batch, SYNC_SCHEMA, SYNC_SCHEMA), true, `the ${batch.payload.operations[0].type} batch validates against sync.schema.json`);
  }
  client.close();
});
