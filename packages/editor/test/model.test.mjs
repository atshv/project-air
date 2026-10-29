// P6-07: contract 0.4.0 note body <-> editor model.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { derivePlainText, plainTextMatches } from "../../contracts/plaintext.mjs";
import {
  assertBodyWithinLimits,
  MAX_BLOCK_TEXT,
  MAX_BLOCKS,
  NoteValidationError,
  notePlainText,
  plainTextConsistent,
  validateBody,
  validateHref,
} from "../src/model/limits.ts";
import {
  bodiesEqual,
  createBlock,
  deserialiseBody,
  editableBody,
  emptyBody,
  isEmptyBody,
  normalizeMarks,
  serialiseBody,
} from "../src/model/document.ts";
import { applyLink } from "../src/model/marks.ts";

const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/note-body/valid.json", import.meta.url), "utf8"));
const validBody = fixture.data;

test("a contract body round-trips through the editor model without losing blocks or marks", () => {
  const blocks = deserialiseBody(validBody);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "list", "heading"]);
  assert.deepEqual(blocks[0].marks, ["bold", "italic"]);
  assert.deepEqual(blocks[1].marks, ["link"]);
  assert.equal(blocks[1].href, "https://example.test/source");
  assert.equal(blocks[1].ordered, false);
  assert.equal(blocks[2].level, 2);

  const serialised = serialiseBody(blocks);
  assert.deepEqual(serialised, validBody);
  assert.deepEqual(deserialiseBody(serialised), blocks);
});

test("plainText is derived only by the contract helper and matches the serialised body", () => {
  const body = serialiseBody(deserialiseBody(validBody));
  const plainText = notePlainText(body);
  assert.equal(plainText, "Hello world.\n- Source\nNotes");
  assert.equal(plainText, derivePlainText(validBody));
  assert.equal(plainTextConsistent(body, plainText), true);
  assert.equal(plainTextMatches(body, "different"), false);
  assert.equal(plainTextConsistent(body, "different"), false);
  assert.equal(notePlainText(emptyBody()), "");
  assert.equal(isEmptyBody(emptyBody()), true);
  assert.equal(isEmptyBody(validBody), false);
});

test("an invalid body derives empty plain text and never reports a match for a missing body", () => {
  assert.equal(derivePlainText(null), "");
  assert.equal(plainTextMatches(null, ""), false);
  assert.equal(derivePlainText({ version: "1", blocks: [{ type: "unknown", text: "x" }] }), "x");
  assert.equal(plainTextMatches({ version: "1", blocks: [{ type: "unknown", text: "x" }] }, "x"), true);
  assert.equal(derivePlainText({ version: "2" }), "");
  assert.equal(derivePlainText({ blocks: "nope" }), "");
  assert.deepEqual(deserialiseBody(null), []);
  assert.deepEqual(deserialiseBody({ version: "2", blocks: [] }), []);
  assert.deepEqual(deserialiseBody({ version: "1", blocks: "nope" }), []);
  assert.deepEqual(deserialiseBody({ version: "1", blocks: [{ type: "paragraph", text: 7 }, { type: "paragraph", text: "ok" }] }), [
    { ...createBlock("paragraph", "ok") },
  ]);
  assert.equal(bodiesEqual(emptyBody(), { version: "1", blocks: [] }), true);
  assert.equal(bodiesEqual(validBody, serialiseBody(deserialiseBody(validBody))), true);
});

test("empty surface blocks persist as the contract empty body", () => {
  assert.deepEqual(editableBody([]), emptyBody());
  assert.deepEqual(editableBody([createBlock("paragraph", "   "), createBlock("list", "")]), emptyBody());
  assert.deepEqual(editableBody([createBlock("paragraph", "x")]).blocks.length, 1);
});

test("marks are normalised to the contract order and de-duplicated", () => {
  assert.deepEqual(normalizeMarks(["link", "bold", "bold", "nope"]), ["bold", "link"]);
  assert.deepEqual(normalizeMarks(undefined), []);
  assert.deepEqual(normalizeMarks("bold"), []);
});

test("link hrefs follow the contract allow-list", () => {
  assert.equal(validateHref("https://example.test/a"), true);
  assert.equal(validateHref("http://example.test"), true);
  assert.equal(validateHref("mailto:person@example.test"), true);
  assert.equal(validateHref("javascript:alert(1)"), false);
  assert.equal(validateHref("ftp://example.test"), false);
  assert.equal(validateHref("https://example.test/a b"), false);
  assert.equal(validateHref(""), false);
  assert.equal(validateHref(`https://example.test/${"a".repeat(2100)}`), false);

  const linked = applyLink(createBlock("paragraph", "x"), "javascript:alert(1)");
  assert.deepEqual(linked.marks, []);
  const safe = applyLink(createBlock("paragraph", "x"), "https://example.test");
  assert.deepEqual(safe.marks, ["link"]);
  assert.equal(serialiseBody([safe]).blocks[0].href, "https://example.test");
});

test("bodies with disallowed links degrade to plain text instead of a broken operation", () => {
  const blocks = deserialiseBody({
    version: "1",
    blocks: [{ type: "paragraph", text: "x", marks: ["link"], href: "javascript:alert(1)" }],
  });
  assert.deepEqual(blocks[0].marks, []);
  assert.deepEqual(serialiseBody(blocks), { version: "1", blocks: [{ type: "paragraph", text: "x" }] });
});

test("contract size limits surface as typed errors", () => {
  const tooMany = { version: "1", blocks: Array.from({ length: MAX_BLOCKS + 1 }, () => ({ type: "paragraph", text: "x" })) };
  assert.equal(validateBody(tooMany)?.code, "too-many-blocks");
  const tooLong = { version: "1", blocks: [{ type: "paragraph", text: "x".repeat(MAX_BLOCK_TEXT + 1) }] };
  assert.equal(validateBody(tooLong)?.code, "block-too-long");
  const longPlain = { version: "1", blocks: Array.from({ length: 6 }, () => ({ type: "paragraph", text: "x".repeat(10000) })) };
  assert.equal(validateBody(longPlain)?.code, "plaintext-too-long");
  assert.equal(validateBody(null)?.code, "invalid-body");
  assert.equal(validateBody({ version: "1", blocks: [{ type: "paragraph", text: "x", marks: ["link"] }] })?.code, "empty-link");
  assert.equal(validateBody({ version: "1", blocks: [{ type: "paragraph", text: "x", marks: ["link"], href: "javascript:1" }] })?.code, "invalid-href");
  assert.equal(validateBody(validBody), null);
  assert.deepEqual(assertBodyWithinLimits(validBody), validBody);
  assert.throws(
    () => assertBodyWithinLimits(tooLong),
    (error) => error instanceof NoteValidationError && error.code === "block-too-long",
  );
});
