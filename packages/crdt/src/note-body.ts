// P6-08: contract 0.4.0 note-body semantics for the document core.
//
// The operation payload is `{ noteId, body }`; the body is the structured JSON
// editor document of `packages/contracts/schemas/note-body-payload.schema.json`.
// The derived `plainText` is not on the wire (the editor derives it before the
// send): the document core derives it exactly like
// `packages/contracts/plaintext.mjs`, the semantic source of truth. The two
// implementations are cross-checked against the contract module and the body
// fixtures by the conformance suite, so they cannot drift silently.
//
// Shape validation mirrors the schema (unknown fields/block types/marks, the
// href scheme allow-list, the documented limits) so a malformed body is a
// rejected operation, not a stored value. Unknown operation types stay fail
// closed in the adapters; this module only handles `updateNoteBody`.

import type { NoteBodyBlock, NoteBodyPayload } from "../../contracts/generated/types.d.ts";

const BLOCK_TYPES: readonly NoteBodyBlock["type"][] = ["paragraph", "heading", "list"];
const MARKS: ReadonlySet<string> = new Set(["bold", "italic", "code", "link"]);
const BODY_FIELDS: ReadonlySet<string> = new Set(["version", "blocks"]);
const BLOCK_FIELDS: ReadonlySet<string> = new Set(["type", "text", "marks", "level", "ordered", "href"]);
const HREF = /^(https?|mailto):[^\s]+$/;
const MAX_BLOCKS = 1000;
const MAX_BLOCK_TEXT = 10_000;
const MAX_HREF = 2048;
const MAX_PLAIN_TEXT = 50_000;

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function reject(reason: string): never {
  throw new Error(`invalid note body: ${reason}`);
}

function checkBlock(block: unknown, index: number): NoteBodyBlock {
  if (!isRecord(block)) reject(`block ${index} must be an object`);
  for (const field of Object.keys(block)) {
    if (!BLOCK_FIELDS.has(field)) reject(`block ${index} has unknown field ${JSON.stringify(field)}`);
  }
  const type = block["type"];
  if (typeof type !== "string" || !BLOCK_TYPES.includes(type as NoteBodyBlock["type"])) {
    reject(`block ${index} has unknown type ${JSON.stringify(type)}`);
  }
  const text = block["text"];
  if (typeof text !== "string") reject(`block ${index} needs a string text`);
  if (text.length > MAX_BLOCK_TEXT) reject(`block ${index} text exceeds ${MAX_BLOCK_TEXT} characters`);

  const marks = block["marks"];
  if (marks !== undefined) {
    if (!Array.isArray(marks)) reject(`block ${index} marks must be an array`);
    const seen = new Set<unknown>();
    for (const mark of marks) {
      if (typeof mark !== "string" || !MARKS.has(mark)) reject(`block ${index} has unknown mark ${JSON.stringify(mark)}`);
      if (seen.has(mark)) reject(`block ${index} repeats mark ${JSON.stringify(mark)}`);
      seen.add(mark);
    }
    if (marks.includes("link") && block["href"] === undefined) reject(`block ${index} marks link without href`);
  }
  const level = block["level"];
  if (level !== undefined && (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 6)) {
    reject(`block ${index} level must be an integer between 1 and 6`);
  }
  const ordered = block["ordered"];
  if (ordered !== undefined && typeof ordered !== "boolean") reject(`block ${index} ordered must be a boolean`);
  const href = block["href"];
  if (href !== undefined) {
    if (typeof href !== "string") reject(`block ${index} href must be a string`);
    if (href.length > MAX_HREF) reject(`block ${index} href exceeds ${MAX_HREF} characters`);
    if (!HREF.test(href)) reject(`block ${index} href uses a disallowed scheme`);
  }
  return block as unknown as NoteBodyBlock;
}

/** Validates one 0.4.0 body document; throws on any contract violation. */
export function validateNoteBody(value: unknown): NoteBodyPayload {
  if (!isRecord(value)) reject("the body must be an object");
  for (const field of Object.keys(value)) {
    if (!BODY_FIELDS.has(field)) reject(`unknown body field ${JSON.stringify(field)}`);
  }
  if (value["version"] !== "1") reject(`unsupported body version ${JSON.stringify(value["version"])}`);
  const blocks = value["blocks"];
  if (!Array.isArray(blocks)) reject("blocks must be an array");
  if (blocks.length > MAX_BLOCKS) reject(`body exceeds ${MAX_BLOCKS} blocks`);
  for (const [index, block] of blocks.entries()) checkBlock(block, index);
  return value as unknown as NoteBodyPayload;
}

/**
 * Deterministic plain text of a body: paragraphs/headings as their normalised
 * text, list blocks prefixed `- ` (unordered) or `1. ` (ordered), empty lines
 * dropped, blocks joined with one newline. Mirrors contracts/plaintext.mjs.
 */
export function derivePlainText(body: NoteBodyPayload): string {
  const lines: string[] = [];
  for (const block of body.blocks) {
    const text = block.text.replace(/\s+/g, " ").trim();
    if (block.type === "list") lines.push(`${block.ordered === true ? "1." : "-"} ${text}`.trim());
    else lines.push(text);
  }
  return lines.filter((line) => line.length > 0).join("\n");
}

export interface NoteBodyUpdate {
  readonly noteId: string;
  /** Null is the contract-empty body: the note carries no body/plainText fields. */
  readonly body: NoteBodyPayload | null;
  readonly plainText: string;
}

/**
 * Reads and validates an `updateNoteBody` payload. The contract treats an absent
 * body as the empty body, so an empty body canonicalises to "no body fields":
 * applying a body plus its empty-body inverse restores a note that never had a
 * body byte-identically.
 */
export function readUpdateNoteBody(payload: RecordValue): NoteBodyUpdate {
  const noteId = payload["noteId"];
  if (typeof noteId !== "string" || noteId.length === 0) throw new Error("updateNoteBody needs a noteId");
  if (!("body" in payload)) throw new Error("updateNoteBody needs a body");
  const body = validateNoteBody(payload["body"]);
  if (body.blocks.length === 0) return { noteId, body: null, plainText: "" };
  const plainText = derivePlainText(body);
  if (plainText.length > MAX_PLAIN_TEXT) throw new Error(`derived plainText exceeds ${MAX_PLAIN_TEXT} characters`);
  return { noteId, body, plainText };
}
