// P6-07: caret clamping, selection preservation and the L06 placeholder/focus helper.

import assert from "node:assert/strict";
import test from "node:test";

import { createBlock, emptyBody, serialiseBody } from "../src/model/document.ts";
import {
  caretAtEnd,
  caretAtStart,
  caretsEqual,
  clampCaret,
  placeholderVisible,
  restoreCaret,
  shouldFocusOnOpen,
} from "../src/model/selection.ts";

const blocks = [createBlock("paragraph", "abc"), createBlock("list", "de")];

test("a caret is clamped into the existing blocks and offsets", () => {
  assert.deepEqual(clampCaret({ blockIndex: 0, offset: 99 }, blocks), { blockIndex: 0, offset: 3 });
  assert.deepEqual(clampCaret({ blockIndex: 9, offset: 1 }, blocks), { blockIndex: 1, offset: 1 });
  assert.deepEqual(clampCaret({ blockIndex: -4, offset: -2 }, blocks), { blockIndex: 0, offset: 0 });
  assert.deepEqual(clampCaret({ blockIndex: 3, offset: 3 }, []), { blockIndex: 0, offset: 0 });
  assert.deepEqual(caretAtStart(), { blockIndex: 0, offset: 0 });
  assert.deepEqual(caretAtEnd(blocks), { blockIndex: 1, offset: 2 });
  assert.deepEqual(caretAtEnd([]), { blockIndex: 0, offset: 0 });
});

test("an external content change restores the caret by block and offset", () => {
  assert.deepEqual(restoreCaret({ blockIndex: 1, offset: 2 }, blocks), { blockIndex: 1, offset: 2 });
  assert.deepEqual(restoreCaret({ blockIndex: 1, offset: 50 }, blocks), { blockIndex: 1, offset: 2 });
  assert.deepEqual(restoreCaret({ blockIndex: 5, offset: 0 }, blocks), { blockIndex: 1, offset: 0 });
  assert.deepEqual(restoreCaret(null, blocks), { blockIndex: 0, offset: 0 });
  assert.equal(caretsEqual({ blockIndex: 0, offset: 1 }, { blockIndex: 0, offset: 1 }), true);
  assert.equal(caretsEqual({ blockIndex: 0, offset: 1 }, { blockIndex: 0, offset: 2 }), false);
  assert.equal(caretsEqual(null, null), true);
  assert.equal(caretsEqual(null, { blockIndex: 0, offset: 0 }), false);
});

test("the placeholder is visible exactly while every block is empty", () => {
  assert.equal(placeholderVisible([]), true);
  assert.equal(placeholderVisible([createBlock("paragraph", "")]), true);
  assert.equal(placeholderVisible([createBlock("paragraph", " \n ")]), true);
  assert.equal(placeholderVisible([createBlock("paragraph", "x")]), false);
  assert.equal(placeholderVisible([createBlock("paragraph", ""), createBlock("list", "item")]), false);
});

test("L06: only an empty note focuses its editor on open and never forces focus otherwise", () => {
  assert.equal(shouldFocusOnOpen(emptyBody()), true);
  assert.equal(shouldFocusOnOpen(serialiseBody([createBlock("paragraph", " ")])), true);
  assert.equal(shouldFocusOnOpen(serialiseBody([createBlock("paragraph", "text")])), false);
  assert.equal(shouldFocusOnOpen(null), true);
  assert.equal(shouldFocusOnOpen({ version: "1", blocks: [{ type: "paragraph", text: "text" }] }), false);
});
