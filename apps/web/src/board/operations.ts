// P6-05: contract operation builders for board interactions. Every builder
// produces exactly one operation with its inverse (AD-1); the duplicated note is
// contract-valid: UUIDv7 id, the board's workspaceId, no extra fields, no ownerId.
import { createRequestId } from "../../../../packages/sdk/src/index.ts";
import type { Board } from "../../../../packages/sdk/src/types.ts";
import { fractionalZ } from "./interactions.ts";

export interface BoardObjectLike { readonly id: string; readonly boardId: string; readonly x?: number; readonly y?: number; readonly z?: string; readonly noteId?: string }
export interface CardLike extends BoardObjectLike { readonly noteId: string }
type Operation = Record<string, unknown>;
const now = (): string => new Date().toISOString();

export function buildDuplicateCardOperation(input: { readonly board: Board; readonly card: CardLike; readonly sourceNoteTitle: string; readonly actorId: string }): { operation: Operation; noteId: string; cardId: string } {
  const noteId = createRequestId(); const cardId = createRequestId();
  const note = { id: noteId, workspaceId: input.board.workspaceId, title: input.sourceNoteTitle, createdAt: now(), updatedAt: now() };
  const card = { id: cardId, boardId: input.board.id, noteId, x: (input.card.x ?? 0) + 16, y: (input.card.y ?? 0) + 16, width: 176, height: 80, z: input.card.z ?? "a", createdAt: now(), updatedAt: now() };
  const operation: Operation = {
    id: createRequestId(), boardId: input.board.id, actorId: input.actorId, createdAt: now(), type: "group",
    payload: { children: [{ type: "createNote", payload: { note } }, { type: "createCard", payload: { card } }] },
    inverse: { type: "group", payload: { children: [{ type: "deleteCard", payload: { card } }, { type: "deleteNote", payload: { note } }] } },
  };
  return { operation, noteId, cardId };
}

export function buildDeleteOperation(kind: "card" | "zone" | "block", object: BoardObjectLike, actorId: string): Operation {
  if (kind === "card") return { id: createRequestId(), boardId: object.boardId, actorId, createdAt: now(), type: "deleteCard", payload: { card: object }, inverse: { type: "createCard", payload: { card: object } } };
  if (kind === "zone") return { id: createRequestId(), boardId: object.boardId, actorId, createdAt: now(), type: "deleteZone", payload: { zone: object, policy: "detach", cards: [], blocks: [] }, inverse: { type: "createZone", payload: { zone: object } } };
  return { id: createRequestId(), boardId: object.boardId, actorId, createdAt: now(), type: "deleteBlock", payload: { block: object }, inverse: { type: "createBlock", payload: { block: object } } };
}

export function buildReorderOperation(object: BoardObjectLike, direction: "forward" | "backward", actorId: string): Operation {
  const currentZ = typeof object.z === "string" ? object.z : "0";
  const next = direction === "forward" ? String(Number.parseFloat(currentZ) + 1) : null;
  const { z, previousZ } = fractionalZ(direction === "forward" ? currentZ : null, next);
  return { id: createRequestId(), boardId: object.boardId, actorId, createdAt: now(), type: "reorder", payload: { itemId: object.id, z }, inverse: { type: "reorder", payload: { itemId: object.id, z: previousZ ?? currentZ } } };
}
