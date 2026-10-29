// P6-07 (L06/L09, AD-1): one autosave value -> the note's content operations.
//
// The panel keeps one autosave value (title + body) and one SDK autosave path.
// One save produces at most two contract operations in one send: exactly one
// `updateNoteBody` with the previous body as inverse and exactly one
// `updateNote` with the previous title as inverse. Validation and the derived
// plain text happen here, before anything is sent.

import {
  NoteValidationError,
  bodiesEqual,
  notePlainText,
  type NoteBody,
} from "../../../../packages/editor/src/index.ts";
import { normalizeNoteTitle, validateNoteTitle } from "./note.ts";
import { buildUpdateNoteBodyOperation, buildUpdateNoteOperation } from "./operations.ts";

export interface NoteSaveState {
  readonly title: string;
  readonly body: NoteBody;
}

export interface NoteSaveInput {
  readonly boardId: string;
  readonly actorId: string;
  readonly noteId: string;
  readonly previous: NoteSaveState;
  readonly next: NoteSaveState;
}

export interface NoteSaveResult {
  /** The operations of this save, sent as one batch through the SDK client. */
  readonly operations: Record<string, unknown>[];
  /** Deterministic plain text of the saved body (derived before the send). */
  readonly plainText: string;
}

/** The autosave value of one panel session. */
export function serialiseSavePayload(state: NoteSaveState): string {
  return JSON.stringify({ title: state.title, body: state.body });
}

export function parseSavePayload(value: string): NoteSaveState | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as { title?: unknown; body?: unknown };
    if (typeof record.title !== "string" || record.body === undefined || record.body === null) return null;
    if (typeof record.body !== "object" || Array.isArray(record.body)) return null;
    return { title: record.title, body: record.body as NoteBody };
  } catch {
    return null;
  }
}

/** Build the operations of one save; throws a typed error and sends nothing when invalid. */
export function buildNoteSaveOperations(input: NoteSaveInput): NoteSaveResult {
  const title = normalizeNoteTitle(input.next.title);
  const previousTitle = normalizeNoteTitle(input.previous.title);
  // An unchanged stored title is never re-validated (older notes may legitimately
  // have an empty title); a changed title must pass the library rule.
  if (title !== previousTitle) {
    const titleError = validateNoteTitle(title);
    if (titleError !== null) throw new NoteValidationError("invalid-title", titleError);
  }

  const operations: Record<string, unknown>[] = [];
  if (title !== previousTitle) {
    operations.push(buildUpdateNoteOperation({
      boardId: input.boardId,
      actorId: input.actorId,
      noteId: input.noteId,
      title,
      previousTitle,
    }));
  }

  let plainText = notePlainText(input.previous.body);
  if (!bodiesEqual(input.next.body, input.previous.body)) {
    const body = buildUpdateNoteBodyOperation({
      boardId: input.boardId,
      actorId: input.actorId,
      noteId: input.noteId,
      body: input.next.body,
      previousBody: input.previous.body,
    });
    operations.push(body.operation);
    plainText = body.plainText;
  }
  return { operations, plainText };
}

/** Map a typed save error to the message key the panel shows (text stays in messages). */
export function describeSaveError(error: unknown): string {
  if (error instanceof NoteValidationError) {
    switch (error.code) {
      case "invalid-href":
      case "empty-link":
        return "note.errors.invalidLink";
      case "too-many-blocks":
      case "block-too-long":
      case "plaintext-too-long":
        return "note.errors.tooLong";
      case "invalid-title":
        return "errors.validation";
      default:
        return "errors.saveFailed";
    }
  }
  return "errors.saveFailed";
}
