// P4-21 (L11) undo/redo tests: the real session history over the document port
// and seam (one inverse per undo, redo re-applies, new operation clears redo,
// depth 20, empty no-op), the keyboard routing and the hint label/timing.

import assert from "node:assert/strict";
import test from "node:test";

import { createHistory, HISTORY_DEPTH } from "../src/logic/history.ts";
import { applyOperation, buildOperation } from "../src/logic/operations.ts";
import { createInMemoryDocument } from "../src/logic/document-port.ts";
import { keyboardIntent, undoHintLabel, HISTORY_HINT_MS } from "../src/bridge/keyboard.ts";

function uuidv7(counter) {
  return `018f0d00-0000-7000-8000-${counter.toString(16).padStart(12, "0")}`;
}

function context() {
  let operations = 0;
  return {
    boardId: uuidv7(0xb0a1),
    actorId: uuidv7(0xac01),
    createOperationId: () => uuidv7(0x10000 + operations++),
    now: () => "2026-01-01T00:00:00.000Z",
  };
}

function cardDraft(counter, x) {
  return {
    kind: "card",
    id: uuidv7(0x7000 + counter),
    noteId: uuidv7(0x9000 + counter),
    x,
    y: 100,
    width: 224,
    height: 128,
    z: "1",
  };
}

function setup() {
  const port = createInMemoryDocument();
  const history = createHistory(port);
  const operationContext = context();
  let next = 0;
  const execute = (x) => {
    const draft = cardDraft(next, x);
    next += 1;
    const pair = buildOperation(port, operationContext, { kind: "create", draft });
    applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    return pair;
  };
  return { port, history, operationContext, execute, count: () => port.snapshot().match(/"id"/g)?.length ?? 0 };
}

test("one undo applies exactly one stored inverse; redo re-applies it", () => {
  const { port, history, execute, count } = setup();
  execute(100);
  execute(300);
  assert.equal(count(), 2);
  assert.equal(history.undoDepth(), 2);
  assert.equal(history.describe(), "Create card");
  const undone = history.undo();
  assert.equal(undone.operation.type, "createCard");
  assert.equal(count(), 1, "one undo removes exactly one object");
  assert.equal(history.undoDepth(), 1);
  assert.equal(history.redoDepth(), 1);
  const redone = history.redo();
  assert.equal(redone.operation.type, "createCard");
  assert.equal(count(), 2, "redo re-applies exactly one operation");
  assert.equal(history.undoDepth(), 2);
  assert.equal(history.redoDepth(), 0);
});

test("a new operation clears the redo branch", () => {
  const { history, execute } = setup();
  execute(100);
  execute(300);
  history.undo();
  assert.equal(history.canRedo(), true);
  execute(500);
  assert.equal(history.canRedo(), false);
  assert.equal(history.redoDepth(), 0);
  assert.equal(history.undoDepth(), 2);
});

test("the depth stays at 20 and the oldest entry is dropped", () => {
  const { history, execute } = setup();
  assert.equal(HISTORY_DEPTH, 20);
  for (let index = 0; index < 21; index += 1) {
    execute(index * 32);
  }
  assert.equal(history.undoDepth(), 20);
  const undone = [];
  while (history.canUndo()) {
    undone.push(history.undo().operation.type);
  }
  assert.equal(undone.length, 20);
  assert.equal(history.undoDepth(), 0);
});

test("an empty history is a no-op", () => {
  const { history } = setup();
  assert.equal(history.canUndo(), false);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
  assert.equal(history.undoDepth(), 0);
  assert.equal(history.redoDepth(), 0);
  assert.equal(history.describe(), null);
});

test("the keyboard routes Cmd/Ctrl+Z and its Shift variant only outside fields", () => {
  assert.deepEqual(keyboardIntent({ key: "z", metaKey: true, suppressed: false }), { kind: "undo" });
  assert.deepEqual(keyboardIntent({ key: "Z", ctrlKey: true, suppressed: false }), { kind: "undo" });
  assert.deepEqual(keyboardIntent({ key: "z", metaKey: true, shiftKey: true, suppressed: false }), { kind: "redo" });
  assert.deepEqual(keyboardIntent({ key: "Z", ctrlKey: true, shiftKey: true, suppressed: false }), { kind: "redo" });
  assert.equal(keyboardIntent({ key: "z", metaKey: true, suppressed: true }), null);
  assert.equal(keyboardIntent({ key: "z", ctrlKey: true, shiftKey: true, suppressed: true }), null);
  assert.equal(keyboardIntent({ key: "z", suppressed: false }), null);
  assert.equal(keyboardIntent({ key: "z", metaKey: true, altKey: true, suppressed: false }), null);
});

test("the hint label and the 3 s timing are documented", () => {
  assert.equal(HISTORY_HINT_MS, 3000);
  assert.equal(undoHintLabel("Create card"), "Undo: Create card");
  assert.equal(undoHintLabel(null), "Undo: Edit");
});
