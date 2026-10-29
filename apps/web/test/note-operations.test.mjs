// P6-07 (L06/L09, AD-1): note content operations — one updateNoteBody per save
// with the previous body as inverse, one updateNote per title, both contract-valid.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { derivePlainText } from "../../../packages/contracts/plaintext.mjs";
import { validate } from "../../../packages/contracts/test/support.mjs";
import { buildUpdateNoteBodyOperation, buildUpdateNoteOperation } from "../src/board/operations.ts";
import { buildNoteSaveOperations, describeSaveError, parseSavePayload, serialiseSavePayload } from "../src/board/note-save.ts";
import { NoteValidationError } from "../../../packages/editor/src/index.ts";

const operationSchema = JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/operation.schema.json", import.meta.url), "utf8"));
const noteBodySchema = JSON.parse(readFileSync(new URL("../../../packages/contracts/schemas/note-body-payload.schema.json", import.meta.url), "utf8"));
const validBody = JSON.parse(readFileSync(new URL("../../../packages/contracts/fixtures/note-body/valid.json", import.meta.url), "utf8")).data;
const emptyBody = { version: "1", blocks: [] };
const boardId = "0192f0a3-7000-7000-8000-000000000003";
const actorId = "0192f0a1-7000-7000-8000-000000000001";
const noteId = "0192f0a4-7000-7000-8000-000000000004";

function valid(operation) {
  assert.equal(validate(operation, operationSchema, operationSchema), true, JSON.stringify(operation));
}

test("one body save is exactly one updateNoteBody operation whose inverse is the previous body", () => {
  const built = buildUpdateNoteBodyOperation({ boardId, actorId, noteId, body: validBody, previousBody: emptyBody });
  valid(built.operation);
  assert.equal(built.operation.type, "updateNoteBody");
  assert.equal(built.operation.payload.noteId, noteId);
  assert.deepEqual(built.operation.payload.body, validBody);
  assert.equal(built.operation.inverse.type, "updateNoteBody");
  assert.deepEqual(built.operation.inverse.payload.body, emptyBody);
  assert.equal(validate(built.operation.payload.body, noteBodySchema, noteBodySchema), true);
  assert.equal(built.plainText, derivePlainText(validBody));
  assert.equal(built.plainText, "Hello world.\n- Source\nNotes");
});

test("a title change is exactly one updateNote whose inverse is the previous title", () => {
  const operation = buildUpdateNoteOperation({ boardId, actorId, noteId, title: "New title", previousTitle: "Old title" });
  valid(operation);
  assert.equal(operation.type, "updateNote");
  assert.deepEqual(operation.payload.changes, { title: "New title" });
  assert.deepEqual(operation.inverse.payload.changes, { title: "Old title" });
});

test("one save batches at most one body and one title operation through the one writer", () => {
  const previous = { title: "Old title", body: emptyBody };
  const next = { title: "New title", body: validBody };
  const result = buildNoteSaveOperations({ boardId, actorId, noteId, previous, next });
  assert.equal(result.operations.length, 2);
  assert.deepEqual(result.operations.map((operation) => operation.type), ["updateNote", "updateNoteBody"]);
  assert.equal(result.operations.filter((operation) => operation.type === "updateNoteBody").length, 1);
  for (const operation of result.operations) valid(operation);
  assert.equal(result.plainText, derivePlainText(validBody));
});

test("a body-only save sends exactly one updateNoteBody; a title-only save exactly one updateNote", () => {
  const bodyOnly = buildNoteSaveOperations({ boardId, actorId, noteId, previous: { title: "Title", body: emptyBody }, next: { title: "Title", body: validBody } });
  assert.deepEqual(bodyOnly.operations.map((operation) => operation.type), ["updateNoteBody"]);
  valid(bodyOnly.operations[0]);
  const titleOnly = buildNoteSaveOperations({ boardId, actorId, noteId, previous: { title: "Old", body: validBody }, next: { title: "New", body: validBody } });
  assert.deepEqual(titleOnly.operations.map((operation) => operation.type), ["updateNote"]);
  valid(titleOnly.operations[0]);
  const untouched = buildNoteSaveOperations({ boardId, actorId, noteId, previous: { title: "Title", body: validBody }, next: { title: "Title", body: validBody } });
  assert.equal(untouched.operations.length, 0);
});

test("the autosave value round-trips the title and the contract body", () => {
  const payload = serialiseSavePayload({ title: "Title", body: validBody });
  assert.deepEqual(parseSavePayload(payload), { title: "Title", body: validBody });
  assert.equal(parseSavePayload("not json"), null);
  assert.equal(parseSavePayload(JSON.stringify({ title: "x", body: [] })), null);
});

test("contract limit and rejection errors surface honestly and send nothing", () => {
  const tooLong = { version: "1", blocks: Array.from({ length: 6 }, () => ({ type: "paragraph", text: "x".repeat(10000) })) };
  assert.throws(
    () => buildNoteSaveOperations({ boardId, actorId, noteId, previous: { title: "Title", body: emptyBody }, next: { title: "Title", body: tooLong } }),
    (error) => error instanceof NoteValidationError && error.code === "plaintext-too-long",
  );
  const disallowed = { version: "1", blocks: [{ type: "paragraph", text: "x", marks: ["link"], href: "javascript:alert(1)" }] };
  let rejection = null;
  try {
    buildNoteSaveOperations({ boardId, actorId, noteId, previous: { title: "Title", body: emptyBody }, next: { title: "Title", body: disallowed } });
  } catch (error) {
    rejection = error;
  }
  assert.equal(describeSaveError(rejection), "note.errors.invalidLink");
  assert.equal(describeSaveError(new NoteValidationError("plaintext-too-long", "limit")), "note.errors.tooLong");
  assert.equal(describeSaveError(new NoteValidationError("invalid-title", "title")), "errors.validation");
  assert.equal(describeSaveError(new Error("network")), "errors.saveFailed");
});

test("a changed invalid title writes nothing while an unchanged stored title is kept", () => {
  const previous = { title: "  ", body: validBody };
  const same = buildNoteSaveOperations({ boardId, actorId, noteId, previous, next: { title: "  ", body: validBody } });
  assert.equal(same.operations.length, 0);
  assert.throws(
    () => buildNoteSaveOperations({ boardId, actorId, noteId, previous: { title: "Title", body: validBody }, next: { title: "   ", body: validBody } }),
    (error) => error instanceof NoteValidationError && error.code === "invalid-title",
  );
});
