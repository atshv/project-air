// Undo/redo history tests of the engine logic layer (P4-05).
//
// The history is only a stack over contract operation/inverse pairs: it applies
// the stored inverse on undo and re-applies the operation on redo, both through
// the document port. The tests cover the depth of 20, the redo branch, the hint
// label and the byte-identical round trip through the in-memory document.

import assert from "node:assert/strict";
import test from "node:test";

import { createHistory } from "../src/logic/history.ts";
import {
  OperationError,
  applyOperation,
  buildOperation,
} from "../src/logic/operations.ts";
import {
  BLOCK_ID,
  CARD_ID,
  ZONE_ID,
  createContext,
  createDocument,
  uuidv7,
} from "./support.mjs";

/** Applies one drag through the port and records it as one history entry. */
function dragAndPush(port, history, context, objectKind, objectId, position) {
  const pair = buildOperation(port, context, {
    kind: "drag-single",
    objectKind,
    objectId,
    position,
  });
  assert.ok(pair, "the drag produced an operation");
  applyOperation(port, pair.operation);
  history.push(pair.operation, pair.inverse);
  return pair;
}

function cardX(port) {
  const card = port.read("card", CARD_ID);
  assert.ok(card);
  return card.x;
}

test("undo and redo on an empty history are no-ops", () => {
  const port = createDocument();
  const history = createHistory(port);
  const before = port.snapshot();
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
  assert.equal(history.describe(), null);
  assert.equal(port.snapshot(), before);
});

test("undo applies the inverse and redo re-applies the operation", () => {
  const port = createDocument();
  const history = createHistory(port);
  const context = createContext();
  const before = port.snapshot();

  dragAndPush(port, history, context, "card", CARD_ID, { x: 528, y: 272 });
  const after = port.snapshot();
  assert.equal(history.undoDepth(), 1);
  assert.equal(history.describe(), "Move card");

  const undone = history.undo();
  assert.ok(undone);
  assert.equal(undone.operation.type, "moveCard");
  assert.equal(cardX(port), 512);
  assert.equal(port.snapshot(), before, "undo restores the previous working copy");
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);
  assert.equal(history.describe(), null);

  const redone = history.redo();
  assert.ok(redone);
  assert.equal(cardX(port), 528);
  assert.equal(port.snapshot(), after, "redo re-applies the operation exactly");
  assert.equal(history.canRedo(), false);
  assert.equal(history.describe(), "Move card");
});

test("a new operation clears the redo branch", () => {
  const port = createDocument();
  const history = createHistory(port);
  const context = createContext();
  dragAndPush(port, history, context, "card", CARD_ID, { x: 528, y: 272 });
  history.undo();
  assert.equal(history.redoDepth(), 1);

  dragAndPush(port, history, context, "card", CARD_ID, { x: 560, y: 272 });
  assert.equal(history.redoDepth(), 0);
  assert.equal(history.canRedo(), false);
  assert.equal(history.redo(), null);
  assert.equal(cardX(port), 560);
});

test("the history keeps the newest 20 entries and drops the oldest", () => {
  const port = createDocument();
  const history = createHistory(port);
  const context = createContext();
  for (let step = 0; step < 21; step += 1) {
    dragAndPush(port, history, context, "card", CARD_ID, {
      x: 512 + 16 * (step + 1),
      y: 256,
    });
  }
  assert.equal(history.undoDepth(), 20);
  assert.equal(cardX(port), 512 + 16 * 21);

  for (let step = 0; step < 20; step += 1) {
    assert.ok(history.undo());
  }
  assert.equal(history.undoDepth(), 0);
  assert.equal(history.undo(), null);
  assert.equal(history.describe(), null);
  assert.equal(cardX(port), 512 + 16, "the dropped oldest entry cannot be undone");

  for (let step = 0; step < 20; step += 1) {
    assert.ok(history.redo());
  }
  assert.equal(history.canRedo(), false);
  assert.equal(cardX(port), 512 + 16 * 21);
});

test("undo reverses a group's child operations as one step", () => {
  const port = createDocument();
  const history = createHistory(port);
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "drag-group",
    members: [
      { objectKind: "card", objectId: CARD_ID, position: { x: 544, y: 288 } },
      { objectKind: "zone", objectId: ZONE_ID, position: { x: 144, y: 80 } },
      { objectKind: "block", objectId: BLOCK_ID, position: { x: 176, y: 112 } },
    ],
  });
  assert.ok(pair);
  applyOperation(port, pair.operation);
  history.push(pair.operation, pair.inverse);
  const after = port.snapshot();
  assert.equal(history.describe(), "Move 3 objects");

  history.undo();
  assert.equal(port.snapshot(), before, "one undo reverses the whole group");
  assert.equal(history.undoDepth(), 0);
  history.redo();
  assert.equal(port.snapshot(), after);
});

test("describe names the next undoable operation from its lookup", () => {
  const port = createDocument();
  const history = createHistory(port);
  const context = createContext();
  const createPair = buildOperation(port, context, {
    kind: "create",
    draft: {
      kind: "card",
      id: uuidv7(0x910),
      noteId: "0192f0a4-7000-7000-8000-000000000004",
      x: 256,
      y: 128,
      width: 256,
      height: 128,
      z: "a2",
    },
  });
  assert.ok(createPair);
  history.push(createPair.operation, createPair.inverse);
  assert.equal(history.describe(), "Create card");

  const resizePair = buildOperation(port, context, {
    kind: "resize",
    objectKind: "card",
    objectId: CARD_ID,
    size: { width: 192, height: 96 },
  });
  assert.ok(resizePair);
  history.push(resizePair.operation, resizePair.inverse);
  assert.equal(history.describe(), "Resize card");
});

test("push records without applying and leaves the copy untouched", () => {
  const port = createDocument();
  const history = createHistory(port);
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "drag-single",
    objectKind: "card",
    objectId: CARD_ID,
    position: { x: 528, y: 272 },
  });
  assert.ok(pair);
  history.push(pair.operation, pair.inverse);
  assert.equal(port.snapshot(), before);
  assert.equal(history.undoDepth(), 1);
});

test("a failing undo leaves the stacks and the copy unchanged", () => {
  const port = createDocument();
  const history = createHistory(port);
  const context = createContext();
  const pair = buildOperation(port, context, {
    kind: "create",
    draft: {
      kind: "card",
      id: uuidv7(0x911),
      noteId: "0192f0a4-7000-7000-8000-000000000004",
      x: 256,
      y: 128,
      width: 256,
      height: 128,
      z: "a2",
    },
  });
  assert.ok(pair);
  // Never applied: undoing the deleteCard inverse fails because the card is absent.
  history.push(pair.operation, pair.inverse);
  const before = port.snapshot();
  assert.throws(() => history.undo(), OperationError);
  assert.equal(history.undoDepth(), 1);
  assert.equal(history.canRedo(), false);
  assert.equal(port.snapshot(), before);
});
