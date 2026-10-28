// Typed gesture results of the engine logic layer (P4-05).
//
// Input code (pointer, keyboard) normalises one user gesture into exactly one of
// these values and hands it to the operation builders in `operations.ts`; it
// never writes the document itself (AD-1, docs/engine.md). A gesture result
// carries only targets: the current position, size and identity of the touched
// objects are read from the `DocumentPort` when the operation and its inverse
// are built, so the inverse always restores what the working copy really had.

import type { BlockType } from "../../../contracts/generated/types.ts";
import type { BoardObjectKind } from "./document-port.ts";

/** World-space point in the contract's pixels. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** World-space size in the contract's pixels. */
export interface WorldSize {
  readonly width: number;
  readonly height: number;
}

/** Drag of one object to a new world position. */
export interface DragSingleGesture {
  readonly kind: "drag-single";
  readonly objectKind: BoardObjectKind;
  readonly objectId: string;
  readonly position: WorldPoint;
}

/** One object inside a multiple-selection drag. */
export interface DragGroupMember {
  readonly objectKind: BoardObjectKind;
  readonly objectId: string;
  readonly position: WorldPoint;
}

/** Drag of a multiple selection; converted into one `group` operation. */
export interface DragGroupGesture {
  readonly kind: "drag-group";
  readonly members: readonly DragGroupMember[];
}

/** Resize of one object to a new size. */
export interface ResizeGesture {
  readonly kind: "resize";
  readonly objectKind: BoardObjectKind;
  readonly objectId: string;
  readonly size: WorldSize;
}

/** Draft of a new card placement; the builder fills board id and timestamps. */
export interface CreateCardDraft {
  readonly kind: "card";
  readonly id: string;
  readonly noteId: string;
  readonly zoneId?: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: string;
}

/** Draft of a new zone; the builder fills board id and timestamps. */
export interface CreateZoneDraft {
  readonly kind: "zone";
  readonly id: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: string;
}

/** Draft of a new block; the builder fills board id and timestamps. */
export interface CreateBlockDraft {
  readonly kind: "block";
  readonly id: string;
  readonly type: BlockType;
  readonly zoneId?: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: string;
}

/** Draft union for a create gesture. */
export type CreateObjectDraft = CreateCardDraft | CreateZoneDraft | CreateBlockDraft;

/** Creation of one board object. */
export interface CreateGesture {
  readonly kind: "create";
  readonly draft: CreateObjectDraft;
}

/** Deletion of one single-object placement; zone deletion is a content policy (L08). */
export interface DeleteGesture {
  readonly kind: "delete";
  readonly objectKind: "card" | "block";
  readonly objectId: string;
}

/** One member of a multi-selection delete; only objects the document owns are deletable. */
export interface DeleteSelectionMember {
  readonly objectKind: "card" | "block";
  readonly objectId: string;
}

/**
 * L10 (P4-16) deletion of a whole selection: converted into exactly one `group`
 * operation whose children are the single deletes, with the reversed creates as
 * its inverse (AD-1: one gesture = one operation, never one write per object).
 */
export interface DeleteSelectionGesture {
  readonly kind: "delete-selection";
  readonly members: readonly DeleteSelectionMember[];
}

/** One arrow-key series; the accumulated delta is converted into one operation. */
export interface KeyboardNudgeGesture {
  readonly kind: "keyboard-nudge";
  readonly objectKind: BoardObjectKind;
  readonly objectId: string;
  readonly delta: WorldPoint;
}

/**
 * Brings one object to the front of its design layer (L13): the last moved or
 * selected object draws above its layer neighbours. Converted into exactly one
 * contract `reorder` operation; the layer itself never changes (design rule §8).
 */
export interface BringToFrontGesture {
  readonly kind: "bring-to-front";
  readonly objectKind: BoardObjectKind;
  readonly objectId: string;
}

/** Every content gesture the logic layer converts into a contract operation. */
export type GestureResult =
  | DragSingleGesture
  | DragGroupGesture
  | ResizeGesture
  | CreateGesture
  | DeleteGesture
  | DeleteSelectionGesture
  | KeyboardNudgeGesture
  | BringToFrontGesture;
