// P6-07 (L06/L09): the editor view model of the contract 0.4.0 note body.
//
// The contract stores one JSON document (`{ version: "1", blocks: [...] }`); the
// editor keeps a normalised, framework-free block list with explicit defaults so
// the DOM controller and the pure helpers never depend on optional fields.

import type {
  NoteBodyBlock,
  NoteBodyBlockMarksItem,
  NoteBodyBlockType,
  NoteBodyPayload,
} from "../../../contracts/generated/types.ts";

/** The contract note body document. */
export type NoteBody = NoteBodyPayload;

/** One contract note body block. */
export type ContractBlock = NoteBodyBlock;

/** Inline mark of one block; the contract applies marks to the whole block text. */
export type NoteMark = NoteBodyBlockMarksItem;

/** Block kinds of the contract body document. */
export type NoteBlockType = NoteBodyBlockType;

/** Canonical mark order, used for deterministic serialisation. */
export const NOTE_MARKS: readonly NoteMark[] = Object.freeze(["bold", "italic", "code", "link"]);

/** Canonical block order of the editor surface: paragraph, heading, list. */
export const NOTE_BLOCK_TYPES: readonly NoteBlockType[] = Object.freeze(["paragraph", "heading", "list"]);

/** Normalised block of the editor view model; every field is explicit. */
export interface EditorBlock {
  readonly type: NoteBlockType;
  readonly text: string;
  readonly marks: readonly NoteMark[];
  /** Heading level 1..6; ignored by paragraphs and lists. */
  readonly level: number;
  /** List ordering; ignored by paragraphs and headings. */
  readonly ordered: boolean;
  /** Link target; empty when the block carries no link mark. */
  readonly href: string;
}

/** A caret inside the editor surface: block index plus character offset. */
export interface EditorCaret {
  readonly blockIndex: number;
  readonly offset: number;
}

/** One observed editor change, already serialised to the contract body. */
export interface EditorChange {
  readonly body: NoteBody;
  readonly plainText: string;
  readonly blocks: readonly EditorBlock[];
}
