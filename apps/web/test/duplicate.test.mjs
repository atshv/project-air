// P6-05: the duplicated note/card operations must be contract-valid (note schema,
// card schema, UUIDv7 ids, board workspaceId, no extra fields) and carry inverses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validate } from "../../../packages/contracts/test/support.mjs";
import { buildDeleteOperation, buildDuplicateCardOperation, buildReorderOperation } from "../src/board/operations.ts";

const UUID = "0192f0f5-7000-7000-8000-000000000001";
const UUID_2 = "0192f0f5-7000-7000-8000-000000000002";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const noteSchema = JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/note.schema.json", import.meta.url), "utf8"));
const cardSchema = JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/card.schema.json", import.meta.url), "utf8"));
const board = { id: UUID, workspaceId: UUID_2, ownerId: "0192f0f5-7000-7000-8000-000000000003", title: "Board", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" };
const card = { id: "0192f0f5-7000-7000-8000-000000000004", boardId: UUID, noteId: "0192f0f5-7000-7000-8000-000000000005", x: 10, y: 20, width: 176, height: 80, z: "a", createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" };

test("the duplicated note is contract-valid with the board workspaceId and no extra fields", () => {
  const { operation } = buildDuplicateCardOperation({ board, card, sourceNoteTitle: "Copy", actorId: UUID });
  const children = operation.payload.children;
  const note = children.find((child) => child.type === "createNote").payload.note;
  const duplicatedCard = children.find((child) => child.type === "createCard").payload.card;
  assert.equal(validate(note, noteSchema, noteSchema), true, JSON.stringify(note));
  assert.equal(validate(duplicatedCard, cardSchema, cardSchema), true, JSON.stringify(duplicatedCard));
  assert.equal(note.workspaceId, board.workspaceId);
  assert.match(note.id, UUID_V7);
  assert.match(duplicatedCard.id, UUID_V7);
  assert.match(duplicatedCard.noteId, UUID_V7);
  assert.equal("ownerId" in note, false);
  assert.equal(note.workspaceId.trim().length > 0, true);
  assert.equal(operation.inverse.type, "group");
  assert.deepEqual(operation.inverse.payload.children.map((child) => child.type), ["deleteCard", "deleteNote"]);
});

test("delete and reorder operations carry inverses and never empty metadata", () => {
  const deleted = buildDeleteOperation("card", { ...card }, UUID);
  assert.equal(deleted.type, "deleteCard");
  assert.equal(deleted.inverse.type, "createCard");
  const reordered = buildReorderOperation({ ...card }, "forward", UUID);
  assert.equal(reordered.type, "reorder");
  assert.equal(reordered.inverse.type, "reorder");
  assert.notEqual(reordered.payload.z, reordered.inverse.payload.z);
  assert.equal(JSON.stringify(reordered).includes('"workspaceId":""'), false);
});
