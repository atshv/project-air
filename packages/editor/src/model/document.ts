// P6-07: contract 0.4.0 note body <-> editor block model.
//
// Serialisation is lossless for the contract fields the editor supports:
// paragraph/heading/list blocks with bold/italic/code/link marks, heading level
// and list ordering. Invalid persisted content degrades to the contract's empty
// body instead of throwing; size limits are enforced by `assertBodyWithinLimits`
// before an operation is built (the editor must never lose text mid-typing).

import type { NoteBodyBlock } from "../../../contracts/generated/types.ts";
import {
  MAX_BLOCKS,
  MAX_HEADING_LEVEL,
  MIN_HEADING_LEVEL,
  isNoteBlockType,
  isRecord,
  notePlainText,
  validateHref,
} from "./limits.ts";
import { NOTE_MARKS, type EditorBlock, type NoteBlockType, type NoteBody, type NoteMark } from "./types.ts";

/** Heading level of a new heading block. */
export const DEFAULT_HEADING_LEVEL = 2;

/** The contract empty body: valid, no blocks, empty plainText. */
export function emptyBody(): NoteBody {
  return { version: "1", blocks: [] };
}

/** One normalised block with explicit defaults. */
export function createBlock(type: NoteBlockType = "paragraph", text = ""): EditorBlock {
  return { type, text, marks: [], level: DEFAULT_HEADING_LEVEL, ordered: false, href: "" };
}

/** Canonical mark list: known marks only, de-duplicated, contract order. */
export function normalizeMarks(value: unknown): NoteMark[] {
  const entries = Array.isArray(value) ? value : [];
  return NOTE_MARKS.filter((mark) => entries.some((entry) => entry === mark));
}

/** Clamp an untrusted heading level into 1..6. */
export function clampHeadingLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_HEADING_LEVEL;
  return Math.min(MAX_HEADING_LEVEL, Math.max(MIN_HEADING_LEVEL, Math.round(value)));
}

/** Parse one untrusted contract block into the normalised editor model. */
export function parseBlock(value: unknown): EditorBlock | null {
  if (!isRecord(value)) return null;
  const type = value["type"];
  const text = value["text"];
  if (!isNoteBlockType(type) || typeof text !== "string") return null;
  const href = validateHref(value["href"]) ? value["href"] : "";
  const marks = normalizeMarks(value["marks"]).filter((mark) => mark !== "link" || href.length > 0);
  return {
    type,
    text,
    marks,
    level: clampHeadingLevel(value["level"]),
    ordered: value["ordered"] === true,
    href,
  };
}

/** Contract body -> editor blocks; malformed content becomes the empty body. */
export function deserialiseBody(body: unknown): EditorBlock[] {
  if (!isRecord(body) || body["version"] !== "1" || !Array.isArray(body["blocks"])) return [];
  const blocks: EditorBlock[] = [];
  for (const entry of body["blocks"].slice(0, MAX_BLOCKS)) {
    const block = parseBlock(entry);
    if (block !== null) blocks.push(block);
  }
  return blocks;
}

/** Editor block -> one contract block; a link without a valid href degrades to plain text. */
export function serialiseBlock(block: EditorBlock): NoteBodyBlock {
  const marks = normalizeMarks(block.marks).filter((mark) => mark !== "link" || validateHref(block.href));
  const result: NoteBodyBlock = { type: block.type, text: block.text };
  if (marks.length > 0) result.marks = marks;
  if (block.type === "heading") result.level = clampHeadingLevel(block.level);
  if (block.type === "list") result.ordered = block.ordered === true;
  if (marks.includes("link")) result.href = block.href;
  return result;
}

/** Editor blocks -> the contract body document (shape only; limits are checked on save). */
export function serialiseBody(blocks: readonly EditorBlock[]): NoteBody {
  const result: NoteBody = { version: "1", blocks: [] };
  for (const block of blocks) result.blocks.push(serialiseBlock(block));
  return result;
}

/** The body that is actually persisted: an all-empty surface stays the contract empty body. */
export function editableBody(blocks: readonly EditorBlock[]): NoteBody {
  return blocks.every((block) => block.text.trim().length === 0) ? emptyBody() : serialiseBody(blocks);
}

/** Plain text of the editor blocks, derived only by packages/contracts. */
export function blocksPlainText(blocks: readonly EditorBlock[]): string {
  return notePlainText(serialiseBody(blocks));
}

/** Structural body comparison on the normalised model (ignores key order). */
export function bodiesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(deserialiseBody(left)) === JSON.stringify(deserialiseBody(right));
}

/** An empty note body (no visible characters) shows the placeholder and may get focus. */
export function isEmptyBody(body: unknown): boolean {
  return notePlainText(body).length === 0;
}

/** Untyped convenience re-export for hosts that only need the plain text. */
export function bodyPlainText(body: NoteBody): string {
  return notePlainText(body);
}
