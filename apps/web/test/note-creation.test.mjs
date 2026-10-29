// P6-10 in-scope fix (L00, AD-1, AD-4): "Add note" -> canvas click is one
// `group(createNote, createCard)` operation with its inverse, contract-valid,
// and a new card continues the numeric card order.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validate } from "../../../packages/contracts/test/support.mjs";
import { buildCreateNoteCardOperation, nextCardZ } from "../src/board/operations.ts";

const operationSchema = JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/operation.schema.json", import.meta.url), "utf8"));
const uuid = "0192f0a3-7000-7000-8000-000000000003";
const actorId = "0192f0a1-7000-7000-8000-000000000001";
const board = {
  id: uuid,
  workspaceId: "0192f0a2-7000-7000-8000-000000000002",
  ownerId: actorId,
  title: "E2E board",
  visibility: "private",
  archived: false,
  createdAt: "2026-10-29T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
};

test("add note is one group operation with createNote and createCard and the deletion inverse", () => {
  const built = buildCreateNoteCardOperation({ board, actorId, title: "New note", x: 100, y: 120, z: "m" });
  const operation = built.operation;
  assert.equal(validate(operation, operationSchema, operationSchema), true, JSON.stringify(operation));
  assert.equal(operation.type, "group");
  assert.equal(operation.boardId, board.id);
  assert.equal(operation.actorId, actorId);
  assert.deepEqual(operation.payload.children.map((child) => child.type), ["createNote", "createCard"]);
  assert.deepEqual(operation.inverse.payload.children.map((child) => child.type), ["deleteCard", "deleteNote"]);

  const note = operation.payload.children[0].payload.note;
  const card = operation.payload.children[1].payload.card;
  assert.equal(note.id, built.noteId);
  assert.equal(note.workspaceId, board.workspaceId);
  assert.equal(note.title, "New note");
  assert.equal(card.id, built.cardId);
  assert.equal(card.boardId, board.id);
  assert.equal(card.noteId, built.noteId);
  assert.deepEqual({ x: card.x, y: card.y, width: card.width, height: card.height, z: card.z }, { x: 100, y: 120, width: 176, height: 80, z: "m" });
});

test("the inverse deletes exactly the created card and note", () => {
  const built = buildCreateNoteCardOperation({ board, actorId, title: "Undoable", x: 0, y: 0, z: "2" });
  const note = built.operation.payload.children[0].payload.note;
  const card = built.operation.payload.children[1].payload.card;
  assert.deepEqual(built.operation.inverse.payload.children[0].payload.card, card);
  assert.deepEqual(built.operation.inverse.payload.children[1].payload.note, note);
});

test("a new card is placed above every existing card", () => {
  assert.equal(nextCardZ([]), "m");
  assert.equal(nextCardZ([{ z: "1" }, { z: "3" }]), "4");
  assert.equal(nextCardZ([{ z: "m" }]), "m");
  assert.equal(nextCardZ([{ z: "2" }, { z: undefined }]), "3");
});
