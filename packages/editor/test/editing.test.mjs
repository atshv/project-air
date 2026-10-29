// P6-07: Enter/Tab list behaviour and paste insertion.

import assert from "node:assert/strict";
import test from "node:test";

import { createBlock } from "../src/model/document.ts";
import { applyEnter, applyMark, applyTab, indentBlock, insertBlocks, outdentBlock, splitBlock } from "../src/model/editing.ts";

test("Enter splits a paragraph at the caret and keeps the marks", () => {
  const block = { ...createBlock("paragraph", "hello world"), marks: ["bold"] };
  const { before, after } = splitBlock(block, 5);
  assert.equal(before.text, "hello");
  assert.equal(after.text, " world");
  assert.deepEqual(after.marks, ["bold"]);
  const result = applyEnter([block], { blockIndex: 0, offset: 5 });
  assert.deepEqual(result.blocks.map((entry) => entry.text), ["hello", " world"]);
  assert.deepEqual(result.caret, { blockIndex: 1, offset: 0 });
});

test("Enter in a list continues the list, Enter in a heading starts a paragraph", () => {
  const list = applyEnter([createBlock("list", "one")], { blockIndex: 0, offset: 3 });
  assert.deepEqual(list.blocks.map((entry) => entry.type), ["list", "list"]);
  const heading = applyEnter([{ ...createBlock("heading", "Title"), level: 1 }], { blockIndex: 0, offset: 5 });
  assert.deepEqual(heading.blocks.map((entry) => entry.type), ["heading", "paragraph"]);
  assert.equal(heading.blocks[1].text, "");
});

test("Enter on an empty list item turns it back into a paragraph", () => {
  const result = applyEnter([createBlock("list", "")], { blockIndex: 0, offset: 0 });
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, "paragraph");
  assert.deepEqual(result.caret, { blockIndex: 0, offset: 0 });
});

test("Tab indents a paragraph into a list and Shift+Tab outdents it again", () => {
  const indented = indentBlock(createBlock("paragraph", "item"));
  assert.equal(indented.type, "list");
  assert.equal(indented.ordered, false);
  assert.equal(outdentBlock(indented).type, "paragraph");
  const result = applyTab([createBlock("paragraph", "item")], { blockIndex: 0, offset: 2 }, false);
  assert.equal(result.changed, true);
  assert.equal(result.blocks[0].type, "list");
  assert.deepEqual(result.caret, { blockIndex: 0, offset: 2 });
  const outdented = applyTab(result.blocks, result.caret, true);
  assert.equal(outdented.blocks[0].type, "paragraph");
  const unchanged = applyTab([createBlock("paragraph", "x")], { blockIndex: 0, offset: 1 }, true);
  assert.equal(unchanged.changed, false);
});

test("marks toggle on the whole contract block and code/bold/italic stay independent", () => {
  const bold = applyMark([createBlock("paragraph", "x")], { blockIndex: 0, offset: 0 }, "bold");
  assert.deepEqual(bold.blocks[0].marks, ["bold"]);
  const both = applyMark(bold.blocks, bold.caret, "italic");
  assert.deepEqual(both.blocks[0].marks, ["bold", "italic"]);
  const removed = applyMark(both.blocks, both.caret, "bold");
  assert.deepEqual(removed.blocks[0].marks, ["italic"]);
});

test("pasted blocks merge into the block under the caret with the caret after the first line", () => {
  const blocks = [createBlock("paragraph", "ab")];
  const inserted = [createBlock("paragraph", "X"), createBlock("paragraph", "Y")];
  const result = insertBlocks(blocks, { blockIndex: 0, offset: 1 }, inserted);
  assert.deepEqual(result.blocks.map((entry) => entry.text), ["aX", "Yb"]);
  assert.deepEqual(result.caret, { blockIndex: 0, offset: 2 });
  assert.equal(result.blocks.length, 2);
});

test("single-line paste inserts inside the current block", () => {
  const result = insertBlocks([createBlock("paragraph", "ab")], { blockIndex: 0, offset: 1 }, [createBlock("paragraph", "XY")]);
  assert.deepEqual(result.blocks.map((entry) => entry.text), ["aXYb"]);
  assert.deepEqual(result.caret, { blockIndex: 0, offset: 3 });
  assert.equal(insertBlocks([], { blockIndex: 0, offset: 0 }, []).changed, false);
});
