// P6-07: caret model, selection preservation across external content changes and
// the empty-note placeholder/focus helper. Pure so `node --test` covers it.

import { isEmptyBody } from "./document.ts";
import type { EditorBlock, EditorCaret } from "./types.ts";

export function clampCaret(caret: EditorCaret, blocks: readonly EditorBlock[]): EditorCaret {
  if (blocks.length === 0) return { blockIndex: 0, offset: 0 };
  const blockIndex = Math.min(blocks.length - 1, Math.max(0, Math.trunc(caret.blockIndex)));
  const block = blocks[blockIndex];
  if (block === undefined) return { blockIndex: 0, offset: 0 };
  const offset = Math.min(block.text.length, Math.max(0, Math.trunc(caret.offset)));
  return { blockIndex, offset };
}

export function caretsEqual(left: EditorCaret | null, right: EditorCaret | null): boolean {
  if (left === null || right === null) return left === right;
  return left.blockIndex === right.blockIndex && left.offset === right.offset;
}

/** Caret at the start of the first block (L06: an empty note opens at the start). */
export function caretAtStart(): EditorCaret {
  return { blockIndex: 0, offset: 0 };
}

/** Caret at the end of the last block. */
export function caretAtEnd(blocks: readonly EditorBlock[]): EditorCaret {
  const last = blocks[blocks.length - 1];
  return { blockIndex: Math.max(0, blocks.length - 1), offset: last === undefined ? 0 : last.text.length };
}

/**
 * Restore a caret after external content replaced the block list: the same block
 * index when it exists, otherwise the nearest one, with the offset clamped.
 */
export function restoreCaret(previous: EditorCaret | null, blocks: readonly EditorBlock[]): EditorCaret {
  if (previous === null) return caretAtStart();
  return clampCaret(previous, blocks);
}

/** The placeholder is visible only while every block carries no visible text. */
export function placeholderVisible(blocks: readonly EditorBlock[]): boolean {
  return blocks.every((block) => block.text.trim().length === 0);
}

/** L06: focus the editor on open only for an empty note, never for a non-empty one. */
export function shouldFocusOnOpen(body: unknown): boolean {
  return isEmptyBody(body);
}

/** Offset of a pasted insertion: end of the first inserted line inside the merged block. */
export function insertionCaret(blockIndex: number, headLength: number, firstLineLength: number): EditorCaret {
  return { blockIndex, offset: headLength + firstLineLength };
}
