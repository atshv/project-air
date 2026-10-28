// P4-20 (L12) keyboard/context-menu tests: intent routing, field suppression,
// Esc priority, nudge batching, menu model and the duplicate/nudge seam path.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextMenuModel,
  CONTEXT_MENU_ITEMS,
  CONTEXT_MENU_ROW_PX,
  CONTEXT_MENU_WIDTH_PX,
  escapePriority,
  keyboardIntent,
  NudgeSeries,
  NUDGE_COMMIT_DELAY_MS,
  NUDGE_STEP_FAST_PX,
  NUDGE_STEP_PX,
} from "../src/bridge/keyboard.ts";
import { applyInverse, applyOperation, buildOperation } from "../src/logic/operations.ts";
import { createInMemoryDocument } from "../src/logic/document-port.ts";

const event = (overrides = {}) => ({ key: "x", suppressed: false, ...overrides });

test("the shortcut map routes only the L12 intents", () => {
  assert.deepEqual(keyboardIntent(event({ key: "d", metaKey: true })), { kind: "duplicate" });
  assert.deepEqual(keyboardIntent(event({ key: "D", ctrlKey: true })), { kind: "duplicate" });
  assert.deepEqual(keyboardIntent(event({ key: "Delete" })), { kind: "delete" });
  assert.deepEqual(keyboardIntent(event({ key: "Backspace" })), { kind: "delete" });
  assert.deepEqual(keyboardIntent(event({ key: "ArrowRight" })), { kind: "nudge", dx: NUDGE_STEP_PX, dy: 0 });
  assert.deepEqual(keyboardIntent(event({ key: "ArrowLeft", shiftKey: true })), { kind: "nudge", dx: -NUDGE_STEP_FAST_PX, dy: 0 });
  assert.deepEqual(keyboardIntent(event({ key: "ArrowUp", shiftKey: true })), { kind: "nudge", dx: 0, dy: -NUDGE_STEP_FAST_PX });
  assert.deepEqual(keyboardIntent(event({ key: "ArrowDown" })), { kind: "nudge", dx: 0, dy: NUDGE_STEP_PX });
  assert.deepEqual(keyboardIntent(event({ key: "Escape" })), { kind: "escape" });
  assert.deepEqual(keyboardIntent(event({ key: "F10", shiftKey: true, contextMenuKey: true })), { kind: "menu-open" });
  assert.equal(keyboardIntent(event({ key: "a" })), null);
  assert.equal(keyboardIntent(event({ key: "d", metaKey: true, altKey: true })), null);
});

test("field focus blocks every shortcut but keeps Escape", () => {
  const field = { suppressed: true };
  for (const key of ["d", "Delete", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    assert.equal(keyboardIntent(event({ key, suppressed: true, metaKey: key === "d" })), null, key);
  }
  assert.deepEqual(keyboardIntent(event({ key: "Escape", ...field })), { kind: "escape" });
});

test("Ctrl/Cmd+D, delete and Esc keep the documented precedence", () => {
  assert.equal(escapePriority({ menuOpen: true, overlayOpen: true, hasSelection: true }), "menu");
  assert.equal(escapePriority({ menuOpen: false, overlayOpen: true, hasSelection: true }), "overlay");
  assert.equal(escapePriority({ menuOpen: false, overlayOpen: false, hasSelection: true }), "selection");
  assert.equal(escapePriority({ menuOpen: false, overlayOpen: false, hasSelection: false }), null);
});

test("an arrow series accumulates 16/160 px and commits once after 300 ms", () => {
  const series = new NudgeSeries();
  series.add(NUDGE_STEP_PX, 0, 0);
  series.add(NUDGE_STEP_PX, 0, 100); // key repeat restarts the delay
  series.add(0, NUDGE_STEP_FAST_PX, 200);
  assert.equal(series.due(450), false);
  assert.equal(series.due(500), true);
  assert.deepEqual(series.flush(), { dx: 2 * NUDGE_STEP_PX, dy: NUDGE_STEP_FAST_PX });
  assert.equal(series.pending, false);
  assert.equal(series.flush(), null);
  // No mixed series: a flushed series never merges into the next one.
  series.add(NUDGE_STEP_PX, 0, 1000);
  assert.deepEqual(series.flush(), { dx: NUDGE_STEP_PX, dy: 0 });
  assert.equal(NUDGE_COMMIT_DELAY_MS, 300);
});

test("the menu model opens, wraps with arrows, activates and closes", () => {
  assert.equal(CONTEXT_MENU_WIDTH_PX, 200);
  assert.equal(CONTEXT_MENU_ROW_PX, 32);
  assert.deepEqual(CONTEXT_MENU_ITEMS.map((item) => item.intent), [
    "open",
    "duplicate",
    "bring-forward",
    "send-backward",
    "delete",
  ]);
  const menu = new ContextMenuModel();
  assert.equal(menu.selected, null);
  assert.equal(menu.openAt().intent, "open");
  assert.equal(menu.open, true);
  assert.equal(menu.move(-1).intent, "delete", "ArrowUp wraps to the last entry");
  assert.equal(menu.move(1).intent, "open", "ArrowDown wraps to the first entry");
  assert.equal(menu.activate(), "open");
  assert.equal(menu.open, false);
  assert.equal(menu.activate(), null, "an inactive menu never activates");
  menu.openAt();
  assert.equal(menu.outsideClick(), true);
  assert.equal(menu.open, false);
  assert.equal(menu.outsideClick(), false);
});

// -- duplicate and nudge through the operation seam --------------------------

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

function cardDocument() {
  const port = createInMemoryDocument();
  const id = uuidv7(0x7000);
  const noteId = uuidv7(0x9000);
  port.add("card", {
    id,
    boardId: uuidv7(0xb0a1),
    noteId,
    x: 100,
    y: 200,
    width: 224,
    height: 128,
    z: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  return { port, id, noteId };
}

test("duplicate is one create operation at +16/+16, same note (AD-4 note-once)", () => {
  const { port, id, noteId } = cardDocument();
  const operationContext = context();
  const source = port.read("card", id);
  const draft = {
    kind: "card",
    id: uuidv7(0x7100),
    noteId: source.noteId,
    x: source.x + NUDGE_STEP_PX,
    y: source.y + NUDGE_STEP_PX,
    width: source.width,
    height: source.height,
    z: "2",
  };
  const pair = buildOperation(port, operationContext, { kind: "create", draft });
  assert.equal(pair.operation.type, "createCard");
  assert.equal(pair.inverse.type, "deleteCard");
  const before = port.snapshot();
  applyOperation(port, pair.operation);
  assert.equal(port.read("card", draft.id).x, source.x + NUDGE_STEP_PX);
  assert.equal(port.read("card", draft.id).y, source.y + NUDGE_STEP_PX);
  assert.equal(port.read("card", draft.id).noteId, noteId, "a duplicate places the same note again");
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before);
});

test("an arrow series is one keyboard-nudge gesture -> one move operation with inverse", () => {
  const { port, id } = cardDocument();
  const operationContext = context();
  const pair = buildOperation(port, operationContext, {
    kind: "keyboard-nudge",
    objectKind: "card",
    objectId: id,
    delta: { x: 48, y: -16 },
  });
  assert.equal(pair.operation.type, "moveCard");
  assert.equal(pair.operation.payload.x, 148);
  assert.equal(pair.operation.payload.y, 184);
  assert.equal(pair.inverse.type, "moveCard");
  const before = port.snapshot();
  applyOperation(port, pair.operation);
  assert.equal(port.read("card", id).x, 148);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before);
});
