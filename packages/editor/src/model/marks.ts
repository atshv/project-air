// P6-07: inline marks of the contract note body (block-level marks in 0.4.0).
//
// The contract applies marks to the whole block text, so toggling a mark is a
// pure block transformation; links additionally carry an allow-listed href.

import { normalizeMarks } from "./document.ts";
import { validateHref } from "./limits.ts";
import { NOTE_MARKS, type EditorBlock, type NoteMark } from "./types.ts";

/** True when the block carries the mark. */
export function hasMark(block: EditorBlock, mark: NoteMark): boolean {
  return block.marks.includes(mark);
}

/** Toggle one mark on a block; a removed link also drops its href. */
export function toggleMark(block: EditorBlock, mark: NoteMark): EditorBlock {
  const active = block.marks.includes(mark);
  const marks = active
    ? block.marks.filter((entry) => entry !== mark)
    : NOTE_MARKS.filter((entry) => entry === mark || block.marks.includes(entry));
  return { ...block, marks, href: marks.includes("link") ? block.href : "" };
}

/** Apply a link mark with a contract-valid href; invalid hrefs leave the block unchanged. */
export function applyLink(block: EditorBlock, href: string): EditorBlock {
  if (!validateHref(href)) return block;
  return { ...block, marks: normalizeMarks([...block.marks, "link"]), href };
}

/** Remove the link mark and its href. */
export function removeLink(block: EditorBlock): EditorBlock {
  return { ...block, marks: block.marks.filter((mark) => mark !== "link"), href: "" };
}

/** True when the mark list is one of the canonical combinations. */
export function marksAreValid(marks: readonly unknown[]): boolean {
  return marks.every((mark) => NOTE_MARKS.some((known) => known === mark));
}
