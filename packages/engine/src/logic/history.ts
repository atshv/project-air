// Session undo/redo history of the engine logic layer (P4-05).
//
// The history is a stack over contract operation/inverse pairs, never a second
// write or save path (AD-1, canvas cross-section rule 2). The input layer calls
// `push(operation, inverse)` after it has applied the operation through the
// document port; `undo()` applies the stored inverse, `redo()` re-applies the
// operation, and both go through `operations.ts` — no direct document writes.
//
// `describe()` returns the English hint label of the next undoable operation.
// The labels live here as a small lookup key for the later UI hint; rendered UI
// text will come from the translation files (AD-8).

import type { Operation, OperationInverse } from "../../../contracts/generated/types.ts";
import type { DocumentPort } from "./document-port.ts";
import { applyInverse, applyOperation, type OperationPair } from "./operations.ts";

/** Undo depth of one session (L11: 20 steps). */
export const HISTORY_DEPTH = 20;

/** Per-session undo/redo stack. */
export interface SessionHistory {
  /**
   * Records one executed gesture. Clears the redo branch and drops the oldest
   * entry once the stack holds more than `HISTORY_DEPTH` entries; it does not
   * apply the operation (the caller already did that through the port).
   */
  push(operation: Operation, inverse: OperationInverse): void;
  /** Applies the inverse of the newest entry; `null` when the stack is empty. */
  undo(): OperationPair | null;
  /** Re-applies the newest undone operation; `null` when nothing was undone. */
  redo(): OperationPair | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Number of undoable operations, at most `HISTORY_DEPTH`. */
  undoDepth(): number;
  /** Number of redoable operations. */
  redoDepth(): number;
  /** Hint label of the newest undoable operation, or `null` when there is none. */
  describe(): string | null;
}

const LABELS: Readonly<Partial<Record<Operation["type"], string>>> = {
  createCard: "Create card",
  createZone: "Create zone",
  createBlock: "Create block",
  deleteCard: "Delete card",
  deleteBlock: "Delete block",
  moveCard: "Move card",
  moveZone: "Move zone",
  moveBlock: "Move block",
  resizeCard: "Resize card",
  resizeZone: "Resize zone",
  resizeBlock: "Resize block",
  reorder: "Bring to front",
};

/** English hint label of one operation; groups name their object count. */
export function describeOperation(operation: Operation): string {
  if (operation.type === "group") {
    const count = operation.payload.children.length;
    return count === 1 ? "Move 1 object" : `Move ${count} objects`;
  }
  const label = LABELS[operation.type];
  return label ?? "Edit";
}

class SessionUndoHistory implements SessionHistory {
  readonly #port: DocumentPort;
  readonly #undoStack: OperationPair[] = [];
  readonly #redoStack: OperationPair[] = [];

  constructor(port: DocumentPort) {
    this.#port = port;
  }

  push(operation: Operation, inverse: OperationInverse): void {
    this.#redoStack.length = 0;
    this.#undoStack.push({ operation, inverse });
    if (this.#undoStack.length > HISTORY_DEPTH) {
      this.#undoStack.shift();
    }
  }

  undo(): OperationPair | null {
    const entry = this.#undoStack.at(-1);
    if (entry === undefined) {
      return null;
    }
    applyInverse(this.#port, entry.inverse);
    this.#undoStack.pop();
    this.#redoStack.push(entry);
    return entry;
  }

  redo(): OperationPair | null {
    const entry = this.#redoStack.at(-1);
    if (entry === undefined) {
      return null;
    }
    applyOperation(this.#port, entry.operation);
    this.#redoStack.pop();
    this.#undoStack.push(entry);
    return entry;
  }

  canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  undoDepth(): number {
    return this.#undoStack.length;
  }

  redoDepth(): number {
    return this.#redoStack.length;
  }

  describe(): string | null {
    const entry = this.#undoStack.at(-1);
    return entry === undefined ? null : describeOperation(entry.operation);
  }
}

/** Creates the undo/redo history of one session over the given document port. */
export function createHistory(port: DocumentPort): SessionHistory {
  return new SessionUndoHistory(port);
}
