// Layer and draw-order tests of the engine logic layer (P4-06, L13).
//
// "Bring to front" is exactly one contract `reorder` operation through the P4-05
// seam: the object's fractional `z` moves just above its layer neighbours, the
// inverse carries the previous key, and the design layer never changes. The
// operation is validated against operation.schema.json (contract 0.5.0); applying
// it and its inverse must restore a byte-identical working-copy snapshot.

import assert from "node:assert/strict";
import test from "node:test";

import {
  OperationError,
  applyInverse,
  applyOperation,
  buildOperation,
  compareFractionalIndex,
  keyAfter,
} from "../src/logic/operations.ts";
import { createInMemoryDocument } from "../src/logic/document-port.ts";
import {
  BOARD_ID,
  CARD_ID,
  ZONE_ID,
  assertValidOperation,
  cardEntity,
  createContext,
  uuidv7,
  zoneEntity,
} from "./support.mjs";

const SECOND_CARD_ID = uuidv7(0x901);
const THIRD_CARD_ID = uuidv7(0x902);
const SECOND_ZONE_ID = uuidv7(0x903);

function frontOf(objectKind, objectId) {
  return { kind: "bring-to-front", objectKind, objectId };
}

/** Three overlapping cards and two zones with explicit fractional keys. */
function layeredDocument() {
  const port = createInMemoryDocument();
  port.add("zone", { ...zoneEntity(), z: "a0" });
  port.add("zone", { ...zoneEntity(), id: SECOND_ZONE_ID, z: "a1" });
  port.add("card", { ...cardEntity(), z: "a0" });
  port.add("card", { ...cardEntity(), id: SECOND_CARD_ID, z: "a1" });
  port.add("card", { ...cardEntity(), id: THIRD_CARD_ID, z: "a1" });
  return port;
}

function assertReorderPair(pair, itemId, previousZ) {
  assert.ok(pair, "the gesture produced an operation");
  assertValidOperation(pair.operation);
  assert.equal(pair.operation.type, "reorder");
  assert.deepEqual(pair.operation.inverse, pair.inverse);
  assert.equal(pair.inverse.type, "reorder", "the inverse of a reorder is a reorder");
  assert.equal(pair.inverse.boardId, BOARD_ID);
  assert.equal(pair.operation.payload.itemId, itemId);
  assert.deepEqual(pair.inverse.payload, { itemId, z: previousZ }, "the inverse carries the old key");
}

test("keyAfter forms a strictly greater key in the engine's lexicographic order", () => {
  const cases = ["0", "a0", "a9", "a9z", "aZ", "az", "zz", "000000000005", "Zz"];
  for (const key of cases) {
    const next = keyAfter(key);
    assert.match(next, /^[0-9A-Za-z]{1,64}$/, `${key} -> ${next} stays a contract key`);
    assert.equal(compareFractionalIndex(next, key), 1, `${next} sorts after ${key}`);
    assert.ok(next > key, "the JavaScript string order agrees");
  }
  assert.equal(keyAfter("a9"), "aA");
  assert.equal(keyAfter("a9z"), "aA");
  assert.equal(keyAfter("zz"), "zz1");
  assert.throws(() => keyAfter("z".repeat(64)), OperationError);
  assert.throws(() => keyAfter("not-a-key"), OperationError);
});

test("keys stay ordered far beyond float precision", () => {
  // As numbers these two digit runs are the same double (beyond 2^53); as keys
  // they differ in the last character and must keep their order.
  const low = `1${"0".repeat(30)}1`;
  const high = `1${"0".repeat(30)}2`;
  assert.equal(Number(low), Number(high), "a float parse would merge the two keys");
  assert.equal(compareFractionalIndex(low, high), -1);
  assert.equal(keyAfter(low), high, "keyAfter raises the last character, never parses");
});

test("bring to front is one reorder above the layer's highest key and its inverse restores it", () => {
  const port = layeredDocument();
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, frontOf("card", CARD_ID));
  assertReorderPair(pair, CARD_ID, "a0");
  assert.equal(compareFractionalIndex(pair.operation.payload.z, "a1"), 1, "above every card");

  applyOperation(port, pair.operation);
  assert.equal(port.read("card", CARD_ID).z, pair.operation.payload.z);
  assert.equal(port.read("zone", ZONE_ID).z, "a0", "other layers are not touched");
  assert.notEqual(port.snapshot(), before);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "the inverse restores a byte-identical working copy");
});

test("the layer is the object kind: a card's front key ignores zone keys", () => {
  const port = layeredDocument();
  port.updateZ("zone", SECOND_ZONE_ID, "zzzz");
  const pair = buildOperation(port, createContext(), frontOf("card", CARD_ID));
  assert.ok(pair);
  assert.equal(pair.operation.payload.z, keyAfter("a1"), "only the note-card layer counts");
});

test("an equal key loses the insertion-order tie, so it still gets a new key", () => {
  const port = layeredDocument();
  // SECOND and THIRD share "a1"; THIRD was inserted later and draws on top.
  const pair = buildOperation(port, createContext(), frontOf("card", SECOND_CARD_ID));
  assertReorderPair(pair, SECOND_CARD_ID, "a1");
  assert.equal(pair.operation.payload.z, keyAfter("a1"));
});

test("an object already strictly on top, or alone in its layer, yields no operation", () => {
  const port = layeredDocument();
  port.updateZ("card", THIRD_CARD_ID, "b0");
  assert.equal(buildOperation(port, createContext(), frontOf("card", THIRD_CARD_ID)), null);

  const lone = createInMemoryDocument();
  lone.add("card", cardEntity());
  assert.equal(buildOperation(lone, createContext(), frontOf("card", CARD_ID)), null);
});

test("a zone comes to the front of the zone layer only", () => {
  const port = layeredDocument();
  const pair = buildOperation(port, createContext(), frontOf("zone", ZONE_ID));
  assertReorderPair(pair, ZONE_ID, "a0");
  applyOperation(port, pair.operation);
  assert.equal(compareFractionalIndex(port.read("zone", ZONE_ID).z, "a1"), 1);
  assert.equal(port.read("card", CARD_ID).z, "a0");
});

test("a reload from the stored keys reproduces the front order", () => {
  const port = layeredDocument();
  const pair = buildOperation(port, createContext(), frontOf("card", CARD_ID));
  applyOperation(port, pair.operation);
  const stored = JSON.parse(port.snapshot());

  const reloaded = createInMemoryDocument();
  for (const zone of stored.zones) reloaded.add("zone", zone);
  for (const card of stored.cards) reloaded.add("card", card);
  assert.equal(reloaded.snapshot(), port.snapshot(), "the stored state round-trips");
  assert.equal(
    buildOperation(reloaded, createContext(), frontOf("card", CARD_ID)),
    null,
    "after the reload the card is still on top: no further operation",
  );
});

test("a reorder for an unknown item is rejected without a write", () => {
  const port = layeredDocument();
  const before = port.snapshot();
  const pair = buildOperation(port, createContext(), frontOf("card", CARD_ID));
  port.remove("card", CARD_ID);
  const afterRemoval = port.snapshot();
  assert.throws(() => applyOperation(port, pair.operation), OperationError);
  assert.equal(port.snapshot(), afterRemoval);
  assert.notEqual(afterRemoval, before);
  assert.throws(
    () => buildOperation(port, createContext(), frontOf("card", CARD_ID)),
    OperationError,
  );
});
