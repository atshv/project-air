// P6-07 (L06/L09, AD-4): resolve the note a card references, its contract body
// and the title rules. The note exists once; the panel never duplicates it.

import type { BoardContent, Card, Note } from "../../../../packages/contracts/generated/types.ts";
import {
  deserialiseBody,
  emptyBody,
  isEmptyBody,
  NOTE_TITLE_MAX,
  serialiseBody,
  type NoteBody,
} from "../../../../packages/editor/src/index.ts";

export { NOTE_TITLE_MAX };

/** Rendered title is trimmed; the contract stores 0..300 characters. */
export function normalizeNoteTitle(value: string): string {
  return value.trim();
}

/** Validation mirrors the library/platform rule: trimmed, non-empty, at most 300 characters. */
export function validateNoteTitle(value: string): string | null {
  const title = normalizeNoteTitle(value);
  if (title.length === 0) return "note.validation.titleEmpty";
  if (title.length > NOTE_TITLE_MAX) return "note.validation.titleTooLong";
  return null;
}

export function cardForId(content: BoardContent | null, cardId: string | null): Card | null {
  if (content === null || cardId === null) return null;
  return content.cards.find((card) => card.id === cardId) ?? null;
}

/** The single note behind a card (AD-4); `null` means the note is gone. */
export function noteForCard(content: BoardContent | null, cardId: string | null): Note | null {
  const card = cardForId(content, cardId);
  if (card === null || content === null) return null;
  return content.notes.find((note) => note.id === card.noteId) ?? null;
}

export interface CardNote {
  readonly card: Card;
  readonly note: Note | null;
  readonly missing: boolean;
}

/**
 * Resolve the panel target: `null` closes the panel (the card is gone), while a
 * card whose note disappeared yields the missing state.
 */
export function resolveCardNote(content: BoardContent | null, cardId: string | null): CardNote | null {
  const card = cardForId(content, cardId);
  if (card === null) return null;
  const note = noteForCard(content, card.id);
  return { card, note, missing: note === null };
}

/** A missing or invalid body falls back to the contract's empty body. */
export function noteBodyOrEmpty(note: Note | null): NoteBody {
  if (note === null || note.body === undefined) return emptyBody();
  return serialiseBody(deserialiseBody(note.body));
}

/** L06: focus the editor on open only for an empty note. */
export function shouldFocusNoteEditor(note: Note | null): boolean {
  return isEmptyBody(noteBodyOrEmpty(note));
}

export function notePlainTextOrEmpty(note: Note | null): string {
  return isEmptyBody(noteBodyOrEmpty(note)) ? "" : (note?.plainText ?? "");
}
