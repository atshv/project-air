// P6-07 (L06, L09, AD-4): note resolution, contract body fallback and title rules.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NOTE_TITLE_MAX,
  cardForId,
  normalizeNoteTitle,
  noteBodyOrEmpty,
  noteForCard,
  resolveCardNote,
  shouldFocusNoteEditor,
  validateNoteTitle,
} from "../src/board/note.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../packages/contracts/fixtures/note-body/valid.json", import.meta.url), "utf8"));
const note = { id: "note-1", workspaceId: "ws-1", title: "Title", body: fixture.data, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" };
const card = { id: "card-1", boardId: "board-1", noteId: "note-1", x: 0, y: 0, width: 176, height: 80, z: "a", createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" };
const content = { contractVersion: "0.4.0", board: { id: "board-1" }, zones: [], blocks: [], cards: [card], notes: [note], edges: [] };

test("a card resolves its one referenced note (AD-4, never duplicated)", () => {
  assert.equal(cardForId(content, "card-1")?.id, "card-1");
  assert.equal(noteForCard(content, "card-1")?.id, "note-1");
  assert.equal(noteForCard(content, "card-1"), content.notes[0]);
  assert.equal(resolveCardNote(content, "card-1")?.missing, false);
  assert.equal(resolveCardNote(content, "missing"), null);
  assert.equal(cardForId(content, null), null);
  assert.equal(noteForCard(null, "card-1"), null);
});

test("a card whose note is gone yields the missing state, not a new note", () => {
  const orphan = { ...content, notes: [] };
  assert.deepEqual(resolveCardNote(orphan, "card-1"), { card, note: null, missing: true });
  assert.equal(noteForCard(orphan, "card-1"), null);
});

test("a missing, absent or invalid note body falls back to the contract empty body", () => {
  const empty = { version: "1", blocks: [] };
  assert.deepEqual(noteBodyOrEmpty(null), empty);
  assert.deepEqual(noteBodyOrEmpty({ ...note, body: undefined }), empty);
  assert.deepEqual(noteBodyOrEmpty({ ...note, body: { version: "2", blocks: [] } }), empty);
  assert.deepEqual(noteBodyOrEmpty(note), fixture.data);
  assert.deepEqual(noteBodyOrEmpty({ ...note, body: { version: "1", blocks: [{ type: "paragraph", text: "x", marks: ["link"], href: "javascript:alert(1)" }] } }).blocks, [{ type: "paragraph", text: "x" }]);
});

test("only an empty note focuses its editor on open (L06)", () => {
  assert.equal(shouldFocusNoteEditor(null), true);
  assert.equal(shouldFocusNoteEditor({ ...note, body: undefined }), true);
  assert.equal(shouldFocusNoteEditor({ ...note, body: { version: "1", blocks: [] } }), true);
  assert.equal(shouldFocusNoteEditor(note), false);
});

test("note titles are trimmed, non-empty and at most 300 characters (L09)", () => {
  assert.equal(NOTE_TITLE_MAX, 300);
  assert.equal(normalizeNoteTitle("  Design law  "), "Design law");
  assert.equal(validateNoteTitle("Design law"), null);
  assert.equal(validateNoteTitle("  "), "note.validation.titleEmpty");
  assert.equal(validateNoteTitle("x".repeat(NOTE_TITLE_MAX + 1)), "note.validation.titleTooLong");
  assert.equal(validateNoteTitle("x".repeat(NOTE_TITLE_MAX)), null);
});
