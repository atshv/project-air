/**
 * Generated contract types used by the SDK (contract 0.2.0).
 *
 * The SDK may import `packages/contracts` (board.json -> may_import); only the
 * generated types are used, so the import is type-only and erased at runtime.
 */

export type { Board, BoardVisibility, Card, Note, Workspace } from "../../contracts/generated/types.ts";

/** One page of a list envelope. */
export interface ListResult<T> {
  readonly requestId: string;
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** Delete confirmation envelope. */
export interface DeleteResult {
  readonly requestId: string;
  readonly deletedId: string;
}

export interface ListQuery {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface WorkspaceCreate {
  readonly name: string;
  readonly ownerId: string;
}

export interface WorkspaceChanges {
  readonly name?: string | undefined;
}

export interface BoardInput {
  readonly ownerId: string;
  readonly title: string;
  readonly visibility: "private" | "workspace" | "link";
}

export interface BoardChanges {
  readonly title?: string | undefined;
  readonly visibility?: "private" | "workspace" | "link" | undefined;
  readonly archived?: boolean | undefined;
}

export interface NoteInput {
  readonly title: string;
}

export interface NoteChanges {
  readonly title?: string | undefined;
}

export interface CardInput {
  readonly noteId: string;
  readonly zoneId?: string | null | undefined;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: string;
}

export interface CardChanges {
  readonly zoneId?: string | null | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly z?: string | undefined;
}
