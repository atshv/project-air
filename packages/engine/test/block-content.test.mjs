// P6-14: contract 0.5.0 in the logic layer — a block-content gesture and a zone
// rename are exactly one operation with its inverse; the working copy applies
// both, rejects a content of another kind and canonicalises an empty content.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyInverse,
  applyOperation,
  blockContentPreview,
  buildOperation,
  emptyBlockContent,
} from "../src/logic/operations.ts";
import { BLOCK_ID, ZONE_ID, assertValidPair, createContext, createDocument, uuidv7, zoneEntity } from "./support.mjs";

const point = (n, text, done = false) => ({ id: uuidv7(0xa000 + n), text, done });
const CHECKLIST = { kind: "checklist", items: [point(1, "Draft"), point(2, "Review", true)] };

test("a block-content gesture is one updateBlockContent whose inverse restores the empty block", () => {
  const port = createDocument();
  const before = port.snapshot();
  const pair = buildOperation(port, createContext(), { kind: "block-content", blockId: BLOCK_ID, content: CHECKLIST });
  assertValidPair(pair);
  assert.equal(pair.operation.type, "updateBlockContent");
  assert.deepEqual(pair.inverse.payload.content, emptyBlockContent("checklist"), "the inverse of a first content is the empty content");
  applyOperation(port, pair.operation);
  assert.deepEqual(port.read("block", BLOCK_ID).content, CHECKLIST);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "the inverse removes the content field again");
});

test("an unchanged content writes nothing and a content of another kind is rejected", () => {
  const port = createDocument();
  const context = createContext();
  applyOperation(port, buildOperation(port, context, { kind: "block-content", blockId: BLOCK_ID, content: CHECKLIST }).operation);
  assert.equal(buildOperation(port, context, { kind: "block-content", blockId: BLOCK_ID, content: structuredClone(CHECKLIST) }), null);
  assert.throws(
    () => buildOperation(port, context, { kind: "block-content", blockId: BLOCK_ID, content: { kind: "table", columns: [], rows: [] } }),
    /does not fit/,
  );
  const foreign = buildOperation(createDocument(), context, { kind: "block-content", blockId: BLOCK_ID, content: CHECKLIST }).operation;
  assert.throws(
    () => applyOperation(port, { ...foreign, payload: { blockId: BLOCK_ID, content: { kind: "columns", columns: [] } } }),
    /does not fit/,
    "applying a mismatched kind fails closed",
  );
});

test("the working copy never shares the content with the operation payload", () => {
  const port = createDocument();
  const content = structuredClone(CHECKLIST);
  const pair = buildOperation(port, createContext(), { kind: "block-content", blockId: BLOCK_ID, content });
  applyOperation(port, pair.operation);
  content.items[0].text = "changed afterwards";
  pair.operation.payload.content.items[0].text = "changed in the payload";
  assert.equal(port.read("block", BLOCK_ID).content.items[0].text, "Draft");
  const read = port.read("block", BLOCK_ID);
  read.content.items[0].text = "changed on a read copy";
  assert.equal(port.read("block", BLOCK_ID).content.items[0].text, "Draft");
});

test("a zone rename is one updateZone with the previous title as inverse", () => {
  const port = createDocument();
  const before = port.snapshot();
  const pair = buildOperation(port, createContext(), { kind: "zone-rename", zoneId: ZONE_ID, title: "Field research" });
  assertValidPair(pair);
  assert.deepEqual(pair.operation.payload, { zoneId: ZONE_ID, title: "Field research" });
  assert.deepEqual(pair.inverse.payload, { zoneId: ZONE_ID, title: zoneEntity().title });
  applyOperation(port, pair.operation);
  assert.equal(port.read("zone", ZONE_ID).title, "Field research");
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before);
});

test("the content preview lists points, lanes and table rows as plain lines", () => {
  assert.equal(blockContentPreview(CHECKLIST), "Draft\nReview");
  const lane = (n, title, items) => ({ id: uuidv7(0xb000 + n), title, items });
  assert.equal(
    blockContentPreview({ kind: "columns", columns: [lane(1, "To do", [{ id: uuidv7(0xb100), text: "One" }]), lane(2, "Done", [])] }),
    "To do\n  One\nDone",
  );
  const source = { id: uuidv7(0xc001), title: "Source" };
  const year = { id: uuidv7(0xc002), title: "Year" };
  assert.equal(
    blockContentPreview({ kind: "table", columns: [source, year], rows: [{ id: uuidv7(0xc100), cells: [{ columnId: year.id, text: "2026" }] }] }),
    "Source  Year\n  2026",
  );
  assert.equal(blockContentPreview(undefined), "");
});
