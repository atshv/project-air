// P6-07: contract 0.4.0 limits and validation, surfaced as typed errors.
//
// The JSON Schema validates the shape; these checks add the semantic size limits
// (1000 blocks, 10000 characters per block, 50000 characters of derived
// plainText) plus the link scheme allow-list, before any operation is built.

import { derivePlainText, plainTextMatches } from "../../../contracts/plaintext.mjs";
import { NOTE_BLOCK_TYPES, NOTE_MARKS, type NoteBlockType, type NoteBody, type NoteMark } from "./types.ts";

/** Documented block limit of the note body contract. */
export const MAX_BLOCKS = 1000;
/** Documented character limit of one block text. */
export const MAX_BLOCK_TEXT = 10000;
/** Documented character limit of the derived plain text. */
export const MAX_PLAINTEXT = 50000;
/** Documented href length limit of the note body contract. */
export const MAX_HREF = 2048;
/** Note title limits shared by the app and the platform API (`stringField(..., 0, 300)`). */
export const NOTE_TITLE_MAX = 300;
/** Lowest and highest heading level of the contract. */
export const MIN_HEADING_LEVEL = 1;
export const MAX_HEADING_LEVEL = 6;
/** Explicit scheme allow-list of contract links; other schemes are rejected. */
export const HREF_PATTERN = /^(https?|mailto):[^\s]+$/;

/** Stable error codes; the host app maps them to user-visible message keys. */
export type NoteValidationCode =
  | "invalid-body"
  | "too-many-blocks"
  | "block-too-long"
  | "plaintext-too-long"
  | "invalid-href"
  | "empty-link"
  | "invalid-title";

/** A typed contract violation raised before an operation is built or sent. */
export class NoteValidationError extends Error {
  readonly code: NoteValidationCode;

  constructor(code: NoteValidationCode, message: string) {
    super(message);
    this.name = "NoteValidationError";
    this.code = code;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isNoteMark(value: unknown): value is NoteMark {
  return NOTE_MARKS.some((mark) => mark === value);
}

export function isNoteBlockType(value: unknown): value is NoteBlockType {
  return NOTE_BLOCK_TYPES.some((type) => type === value);
}

/** The contract allow-list: http(s) or mailto, non-empty, no whitespace, <= 2048 chars. */
export function validateHref(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_HREF && HREF_PATTERN.test(value);
}

/** Deterministic plain text of a body, produced only by packages/contracts. */
export function notePlainText(body: unknown): string {
  return derivePlainText(body);
}

/** Consistency check of a stored body/plainText pair (contract rule). */
export function plainTextConsistent(body: unknown, plainText: unknown): boolean {
  return plainTextMatches(body, plainText);
}

function validateBlock(block: unknown): NoteValidationError | null {
  if (!isRecord(block)) return new NoteValidationError("invalid-body", "every block is an object");
  const type = block["type"];
  const text = block["text"];
  if (!isNoteBlockType(type) || typeof text !== "string") {
    return new NoteValidationError("invalid-body", "every block needs a known type and a text string");
  }
  if (text.length > MAX_BLOCK_TEXT) {
    return new NoteValidationError("block-too-long", `a block carries at most ${MAX_BLOCK_TEXT} characters`);
  }
  const marks = block["marks"];
  if (marks !== undefined) {
    if (!Array.isArray(marks) || !marks.every(isNoteMark) || new Set(marks).size !== marks.length) {
      return new NoteValidationError("invalid-body", "block marks are a unique subset of bold/italic/code/link");
    }
    if (marks.includes("link")) {
      const href = block["href"];
      if (href === undefined) return new NoteValidationError("empty-link", "a link mark needs an href");
      if (!validateHref(href)) return new NoteValidationError("invalid-href", "a link href uses http, https or mailto only");
    }
  }
  const level = block["level"];
  if (level !== undefined && (typeof level !== "number" || !Number.isInteger(level) || level < MIN_HEADING_LEVEL || level > MAX_HEADING_LEVEL)) {
    return new NoteValidationError("invalid-body", `a heading level is between ${MIN_HEADING_LEVEL} and ${MAX_HEADING_LEVEL}`);
  }
  const ordered = block["ordered"];
  if (ordered !== undefined && typeof ordered !== "boolean") {
    return new NoteValidationError("invalid-body", "the list ordered flag is a boolean");
  }
  return null;
}

/**
 * Validate one untrusted note body against the contract limits.
 * Returns the first typed error or `null` when the body is valid.
 */
export function validateBody(value: unknown): NoteValidationError | null {
  if (!isRecord(value) || value["version"] !== "1") {
    return new NoteValidationError("invalid-body", "a note body is { version: \"1\", blocks: [] }");
  }
  const blocks = value["blocks"];
  if (!Array.isArray(blocks)) {
    return new NoteValidationError("invalid-body", "a note body carries a blocks array");
  }
  if (blocks.length > MAX_BLOCKS) {
    return new NoteValidationError("too-many-blocks", `a note body has at most ${MAX_BLOCKS} blocks`);
  }
  for (const block of blocks) {
    const error = validateBlock(block);
    if (error !== null) return error;
  }
  if (notePlainText(value).length > MAX_PLAINTEXT) {
    return new NoteValidationError("plaintext-too-long", `a note body derives at most ${MAX_PLAINTEXT} characters of plain text`);
  }
  return null;
}

/** Validate and narrow to the contract body type; throws the typed error otherwise. */
export function assertBodyWithinLimits(value: unknown): NoteBody {
  const error = validateBody(value);
  if (error !== null) throw error;
  return value as NoteBody;
}
