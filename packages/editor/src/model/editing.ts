// P6-07: pure list/Enter/Tab editing of the contract block list.
//
// The contract has flat blocks (no nested lists), so Enter splits a block and
// Tab converts a paragraph to a list item (Shift+Tab converts a list item back
// to a paragraph). Every function returns new blocks plus the caret to restore.

import { createBlock, DEFAULT_HEADING_LEVEL } from "./document.ts";
import { toggleMark as toggleBlockMark } from "./marks.ts";
import type { EditorBlock, EditorCaret, NoteMark } from "./types.ts";

export interface EditResult {
  readonly blocks: readonly EditorBlock[];
  readonly caret: EditorCaret;
  readonly changed: boolean;
}

export function clampOffset(value: number, text: string): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(text.length, Math.max(0, Math.trunc(value)));
}

/** Split one block at the caret; a heading continues as a paragraph, a list stays a list. */
export function splitBlock(block: EditorBlock, rawOffset: number): { before: EditorBlock; after: EditorBlock } {
  const offset = clampOffset(rawOffset, block.text);
  const before: EditorBlock = { ...block, text: block.text.slice(0, offset) };
  const after: EditorBlock = block.type === "heading"
    ? createBlock("paragraph", block.text.slice(offset))
    : { ...block, text: block.text.slice(offset), level: DEFAULT_HEADING_LEVEL };
  return { before, after };
}

/** Enter: split the current block; an empty list item becomes a paragraph again. */
export function applyEnter(blocks: readonly EditorBlock[], caret: EditorCaret): EditResult {
  const index = Math.min(blocks.length - 1, Math.max(0, caret.blockIndex));
  const current = blocks[index];
  if (current === undefined) {
    const created = createBlock("paragraph");
    return { blocks: [created], caret: { blockIndex: 0, offset: 0 }, changed: true };
  }
  if (current.type === "list" && current.text.trim().length === 0) {
    const outdented: EditorBlock = { ...createBlock("paragraph"), marks: [] };
    const next = blocks.map((block, position) => (position === index ? outdented : block));
    return { blocks: next, caret: { blockIndex: index, offset: 0 }, changed: true };
  }
  const { before, after } = splitBlock(current, caret.offset);
  const next = [...blocks.slice(0, index), before, after, ...blocks.slice(index + 1)];
  return { blocks: next, caret: { blockIndex: index + 1, offset: 0 }, changed: true };
}

/** Indent: paragraph -> unordered list; heading -> paragraph (no nested lists in 0.4.0). */
export function indentBlock(block: EditorBlock): EditorBlock {
  if (block.type === "paragraph") return { ...block, type: "list", ordered: false };
  if (block.type === "heading") return { ...createBlock("paragraph", block.text), marks: block.marks, href: block.href };
  return block;
}

/** Outdent: list item -> paragraph (cancels list ordering). */
export function outdentBlock(block: EditorBlock): EditorBlock {
  if (block.type === "list") return { ...createBlock("paragraph", block.text), marks: block.marks, href: block.href };
  return block;
}

/** Tab / Shift+Tab on the block under the caret; the caret stays at the same offset. */
export function applyTab(blocks: readonly EditorBlock[], caret: EditorCaret, shift: boolean): EditResult {
  const index = Math.min(blocks.length - 1, Math.max(0, caret.blockIndex));
  const current = blocks[index];
  if (current === undefined) return { blocks, caret, changed: false };
  const nextBlock = shift ? outdentBlock(current) : indentBlock(current);
  if (nextBlock.type === current.type && nextBlock.text === current.text && nextBlock.ordered === current.ordered) {
    return { blocks, caret, changed: false };
  }
  const next = blocks.map((block, position) => (position === index ? nextBlock : block));
  return { blocks: next, caret: { blockIndex: index, offset: clampOffset(caret.offset, nextBlock.text) }, changed: true };
}

/** Toggle a mark on the block under the caret. */
export function applyMark(blocks: readonly EditorBlock[], caret: EditorCaret, mark: NoteMark): EditResult {
  const index = Math.min(blocks.length - 1, Math.max(0, caret.blockIndex));
  const current = blocks[index];
  if (current === undefined) return { blocks, caret, changed: false };
  const next = blocks.map((block, position) => (position === index ? toggleBlockMark(block, mark) : block));
  return { blocks: next, caret, changed: true };
}

/**
 * Insert pasted blocks at the caret (plain text only). The first pasted block
 * merges into the current block head, the last one absorbs its tail, middle
 * blocks stand alone; the caret ends after the first inserted line.
 */
export function insertBlocks(blocks: readonly EditorBlock[], caret: EditorCaret, inserted: readonly EditorBlock[]): EditResult {
  const firstBlock = inserted[0];
  const lastBlock = inserted[inserted.length - 1];
  if (firstBlock === undefined || lastBlock === undefined) return { blocks, caret, changed: false };
  const index = Math.min(blocks.length - 1, Math.max(0, caret.blockIndex));
  const current = blocks[index];
  if (current === undefined) {
    return { blocks: [...inserted], caret: { blockIndex: 0, offset: firstBlock.text.length }, changed: true };
  }
  const offset = clampOffset(caret.offset, current.text);
  const head = current.text.slice(0, offset);
  const tail = current.text.slice(offset);
  const mergedFirst: EditorBlock = { ...current, text: head + firstBlock.text };
  if (inserted.length === 1) {
    const merged: EditorBlock = { ...current, text: head + firstBlock.text + tail };
    const next = blocks.map((block, position) => (position === index ? merged : block));
    return { blocks: next, caret: { blockIndex: index, offset: head.length + firstBlock.text.length }, changed: true };
  }
  const mergedLast: EditorBlock = {
    ...createBlock("paragraph"),
    text: lastBlock.text + tail,
    marks: lastBlock.marks,
    href: lastBlock.href,
  };
  const middle = inserted.slice(1, -1);
  const next = [...blocks.slice(0, index), mergedFirst, ...middle, mergedLast, ...blocks.slice(index + 1)];
  return {
    blocks: next,
    caret: { blockIndex: index, offset: head.length + firstBlock.text.length },
    changed: true,
  };
}
