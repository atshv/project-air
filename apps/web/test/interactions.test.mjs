import assert from "node:assert/strict";
import test from "node:test";

import { ARROW_STEP, arrowDelta, contextMenuModel, createArrowBurst, fractionalZ, isModifier, shortcutFor, suppressesShortcuts, undoHintKey } from "../src/board/interactions.ts";

test("keyboard map handles modifiers, delete, escape and arrows; fields suppress shortcuts", () => {
  assert.equal(shortcutFor({ key: "d", metaKey: true }), "duplicate");
  assert.equal(shortcutFor({ key: "D", ctrlKey: true }), "duplicate");
  assert.equal(shortcutFor({ key: "z", ctrlKey: true }), "undo");
  assert.equal(shortcutFor({ key: "z", ctrlKey: true, shiftKey: true }), "redo");
  assert.equal(shortcutFor({ key: "Delete" }), "delete");
  assert.equal(shortcutFor({ key: "Escape" }), "escape");
  assert.equal(shortcutFor({ key: "ArrowLeft" }), "arrowLeft");
  assert.equal(isModifier({ key: "d", metaKey: true }), true);
  assert.equal(suppressesShortcuts({ tagName: "INPUT" }), true);
  assert.equal(suppressesShortcuts({ tagName: "TEXTAREA" }), true);
  assert.equal(suppressesShortcuts({ isContentEditable: true }), true);
  assert.equal(suppressesShortcuts({ tagName: "DIV", closest: () => ({}) }), true);
  assert.equal(suppressesShortcuts({ tagName: "CANVAS", closest: () => null }), false);
});

test("arrows group into one delta after the 300 ms burst", () => {
  const flushed = [];
  const burst = createArrowBurst((delta) => flushed.push(delta));
  burst.push(ARROW_STEP, 0); burst.push(0, ARROW_STEP);
  assert.deepEqual(burst.pending(), { dx: 16, dy: 16 });
  assert.equal(flushed.length, 0);
  burst.flush();
  assert.deepEqual(flushed, [{ dx: 16, dy: 16 }]);
  assert.deepEqual(arrowDelta("arrowLeft", true), { dx: -160, dy: 0 });
});

test("context menu model has the L12 items, shortcuts and disabled states", () => {
  const items = contextMenuModel({ hasSelection: false, multiSelection: false });
  assert.deepEqual(items.map((item) => item.id), ["open", "duplicate", "bringForward", "sendBackward", "delete"]);
  assert.ok(items.every((item) => item.disabled));
  const selected = contextMenuModel({ hasSelection: true, multiSelection: false });
  assert.equal(selected.find((item) => item.id === "delete")?.disabled, false);
  assert.equal(selected.find((item) => item.id === "duplicate")?.shortcut, "Mod+D");
  const multi = contextMenuModel({ hasSelection: true, multiSelection: true });
  assert.equal(multi.find((item) => item.id === "duplicate")?.disabledKey, "board.menu.multiUnsupported");
  assert.equal(undoHintKey("undo"), "board.undo.undo");
});

test("fractional z sits between neighbours and carries the previous z as inverse", () => {
  assert.deepEqual(fractionalZ("1", "2"), { z: "1.5", previousZ: "1" });
  assert.deepEqual(fractionalZ(null, "1"), { z: "0", previousZ: null });
  assert.deepEqual(fractionalZ("3", null), { z: "4", previousZ: "3" });
});
