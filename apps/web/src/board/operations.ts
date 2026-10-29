// P6-05: contract operation builders for board interactions. Every builder
// produces exactly one operation with its inverse (AD-1); the duplicated note is
// contract-valid: UUIDv7 id, the board's workspaceId, no extra fields, no ownerId.
import { createRequestId } from "../../../../packages/sdk/src/index.ts";
import type { Board } from "../../../../packages/sdk/src/types.ts";
import {
  assertBodyWithinLimits,
  deserialiseBody,
  notePlainText,
  serialiseBody,
  type NoteBody,
} from "../../../../packages/editor/src/index.ts";
import { fractionalZ } from "./interactions.ts";

export interface BoardObjectLike { readonly id: string; readonly boardId: string; readonly x?: number; readonly y?: number; readonly z?: string; readonly noteId?: string }
export interface CardLike extends BoardObjectLike { readonly noteId: string }
type Operation = Record<string, unknown>;
const now = (): string => new Date().toISOString();

/** Contract minimum card size, also the size used for a freshly created note card. */
export const NOTE_CARD_WIDTH = 176;
export const NOTE_CARD_HEIGHT = 80;

/**
 * One `group(createNote, createCard)` operation with its `group(deleteCard,
 * deleteNote)` inverse (AD-1). Children are full contract operations with their
 * own inverses; the group inverse lists the child inverses in reverse order.
 */
function noteCardGroup(input: { readonly boardId: string; readonly actorId: string; readonly note: Record<string, unknown>; readonly card: Record<string, unknown> }): Operation {
  const noteCreate: Operation = {
    id: createRequestId(), boardId: input.boardId, actorId: input.actorId, createdAt: now(), type: "createNote",
    payload: { note: input.note },
    inverse: { boardId: input.boardId, type: "deleteNote", payload: { note: input.note, cards: [] } },
  };
  const cardCreate: Operation = {
    id: createRequestId(), boardId: input.boardId, actorId: input.actorId, createdAt: now(), type: "createCard",
    payload: { card: input.card },
    inverse: { boardId: input.boardId, type: "deleteCard", payload: { card: input.card } },
  };
  return {
    id: createRequestId(), boardId: input.boardId, actorId: input.actorId, createdAt: now(), type: "group",
    payload: { children: [noteCreate, cardCreate] },
    inverse: { boardId: input.boardId, type: "group", payload: { children: [cardCreate.inverse, noteCreate.inverse] } },
  };
}

export function buildDuplicateCardOperation(input: { readonly board: Board; readonly card: CardLike; readonly sourceNoteTitle: string; readonly actorId: string }): { operation: Operation; noteId: string; cardId: string } {
  const noteId = createRequestId(); const cardId = createRequestId();
  const note = { id: noteId, workspaceId: input.board.workspaceId, title: input.sourceNoteTitle, createdAt: now(), updatedAt: now() };
  const card = { id: cardId, boardId: input.board.id, noteId, x: (input.card.x ?? 0) + 16, y: (input.card.y ?? 0) + 16, width: NOTE_CARD_WIDTH, height: NOTE_CARD_HEIGHT, z: input.card.z ?? "a", createdAt: now(), updatedAt: now() };
  return { operation: noteCardGroup({ boardId: input.board.id, actorId: input.actorId, note, card }), noteId, cardId };
}

/**
 * Next card z above every current card. The stored values are the contract's
 * alphanumeric fractional-index strings; the reorder helper parses them as
 * numbers, so a new card continues that numeric order.
 */
export function nextCardZ(cards: readonly { readonly z?: string }[]): string {
  let maximum = Number.NEGATIVE_INFINITY;
  for (const card of cards) {
    const value = card.z === undefined ? Number.NaN : Number.parseFloat(card.z);
    if (Number.isFinite(value) && value > maximum) maximum = value;
  }
  return Number.isFinite(maximum) ? String(maximum + 1) : "m";
}

/**
 * L00 note creation (P6-10 in-scope fix): one `group(createNote, createCard)`
 * operation with its inverse, so "Add note" -> canvas click is one authored
 * gesture = one operation (AD-1) and the panel can open on the new card.
 */
export interface CreateNoteCardInput {
  readonly board: Board;
  readonly actorId: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly z: string;
}

export function buildCreateNoteCardOperation(input: CreateNoteCardInput): { operation: Operation; noteId: string; cardId: string } {
  const noteId = createRequestId(); const cardId = createRequestId();
  const note = { id: noteId, workspaceId: input.board.workspaceId, title: input.title, createdAt: now(), updatedAt: now() };
  const card = { id: cardId, boardId: input.board.id, noteId, x: input.x, y: input.y, width: NOTE_CARD_WIDTH, height: NOTE_CARD_HEIGHT, z: input.z, createdAt: now(), updatedAt: now() };
  return { operation: noteCardGroup({ boardId: input.board.id, actorId: input.actorId, note, card }), noteId, cardId };
}

export function buildDeleteOperation(kind: "card" | "zone" | "block", object: BoardObjectLike, actorId: string): Operation {
  if (kind === "card") return { id: createRequestId(), boardId: object.boardId, actorId, createdAt: now(), type: "deleteCard", payload: { card: object }, inverse: { boardId: object.boardId, type: "createCard", payload: { card: object } } };
  if (kind === "zone") return { id: createRequestId(), boardId: object.boardId, actorId, createdAt: now(), type: "deleteZone", payload: { zone: object, policy: "keep", cards: [], blocks: [] }, inverse: { boardId: object.boardId, type: "createZone", payload: { zone: object } } };
  return { id: createRequestId(), boardId: object.boardId, actorId, createdAt: now(), type: "deleteBlock", payload: { block: object }, inverse: { boardId: object.boardId, type: "createBlock", payload: { block: object } } };
}

export function buildReorderOperation(object: BoardObjectLike, direction: "forward" | "backward", actorId: string): Operation {
  const currentZ = typeof object.z === "string" ? object.z : "0";
  const next = direction === "forward" ? String(Number.parseFloat(currentZ) + 1) : null;
  const { z, previousZ } = fractionalZ(direction === "forward" ? currentZ : null, next);
  return { id: createRequestId(), boardId: object.boardId, actorId, createdAt: now(), type: "reorder", payload: { itemId: object.id, z }, inverse: { boardId: object.boardId, type: "reorder", payload: { itemId: object.id, z: previousZ ?? currentZ } } };
}

// P6-07 (L06/L09, AD-1): note content operations. One save sends exactly one
// `updateNoteBody` whose inverse carries the previous body, and a title change
// sends exactly one `updateNote` whose inverse carries the previous title.

export interface UpdateNoteBodyInput {
  readonly boardId: string;
  readonly actorId: string;
  readonly noteId: string;
  readonly body: NoteBody;
  readonly previousBody: NoteBody;
}

export interface UpdateNoteBodyResult {
  readonly operation: Operation;
  /** Deterministic contract plain text, derived and checked before the send. */
  readonly plainText: string;
}

export function buildUpdateNoteBodyOperation(input: UpdateNoteBodyInput): UpdateNoteBodyResult {
  const body = assertBodyWithinLimits(input.body);
  // The inverse must also be a contract-valid body: normalise the previous body
  // (a missing/invalid stored body degrades to the contract empty body).
  const previousBody = serialiseBody(deserialiseBody(input.previousBody));
  const plainText = notePlainText(body);
  const operation: Operation = {
    id: createRequestId(),
    boardId: input.boardId,
    actorId: input.actorId,
    createdAt: now(),
    type: "updateNoteBody",
    payload: { noteId: input.noteId, body },
    inverse: { boardId: input.boardId, type: "updateNoteBody", payload: { noteId: input.noteId, body: previousBody } },
  };
  return { operation, plainText };
}

export interface UpdateNoteInput {
  readonly boardId: string;
  readonly actorId: string;
  readonly noteId: string;
  readonly title: string;
  readonly previousTitle: string;
}

export function buildUpdateNoteOperation(input: UpdateNoteInput): Operation {
  return {
    id: createRequestId(),
    boardId: input.boardId,
    actorId: input.actorId,
    createdAt: now(),
    type: "updateNote",
    payload: { noteId: input.noteId, changes: { title: input.title } },
    inverse: { boardId: input.boardId, type: "updateNote", payload: { noteId: input.noteId, changes: { title: input.previousTitle } } },
  };
}
