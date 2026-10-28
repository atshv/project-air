// Shared fixtures and assertions for the engine logic tests (P4-05).
//
// The board objects come from the committed contract fixtures, so the tests
// build operations over exactly the entities the contract publishes. Operation
// shape is validated with the contract's own read-only schema validator from
// packages/contracts/test/support.mjs; the cross-field rules that JSON Schema
// cannot express (one inverse, same board, same target, reversed group) are
// asserted here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { schemaOf, validate } from "../../contracts/test/support.mjs";
import { createInMemoryDocument } from "../src/logic/document-port.ts";

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/fixtures/operation/${name}.json`, import.meta.url),
      "utf8",
    ),
  ).data;

const CREATE_CARD = fixture("valid-create-card");
const CREATE_ZONE = fixture("valid-create-zone");
const CREATE_BLOCK = fixture("valid-create-block");

const OPERATION_SCHEMA = schemaOf("operation");

/** Board and actor of the fixture corpus; the seam only passes them through. */
export const BOARD_ID = CREATE_CARD.boardId;
export const ACTOR_ID = CREATE_CARD.actorId;
/** Fixed session clock for deterministic operation timestamps. */
export const TIMESTAMP = CREATE_CARD.createdAt;

export const CARD_ID = CREATE_CARD.payload.card.id;
export const ZONE_ID = CREATE_ZONE.payload.zone.id;
export const BLOCK_ID = CREATE_BLOCK.payload.block.id;
export const NOTE_ID = CREATE_CARD.payload.card.noteId;

/** Fresh copy of the fixture card (sits inside the fixture zone). */
export function cardEntity() {
  return structuredClone(CREATE_CARD.payload.card);
}

/** Fresh copy of the fixture zone. */
export function zoneEntity() {
  return structuredClone(CREATE_ZONE.payload.zone);
}

/** Fresh copy of the fixture block (sits inside the fixture zone). */
export function blockEntity() {
  return structuredClone(CREATE_BLOCK.payload.block);
}

/** A valid lowercase UUIDv7 for deterministic tests. */
export function uuidv7(sequence) {
  return `0192f0c1-7000-7000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

/** Deterministic operation context: sequential ids, fixed clock. */
export function createContext(start = 0x100) {
  let next = start;
  return {
    boardId: BOARD_ID,
    actorId: ACTOR_ID,
    createOperationId: () => uuidv7(next++),
    now: () => TIMESTAMP,
  };
}

/** In-memory working copy seeded with the three fixture placements. */
export function createDocument() {
  const port = createInMemoryDocument();
  port.add("zone", zoneEntity());
  port.add("card", cardEntity());
  port.add("block", blockEntity());
  return port;
}

const INVERSE_TYPE = {
  createCard: "deleteCard",
  createZone: "deleteZone",
  createBlock: "deleteBlock",
  deleteCard: "createCard",
  deleteZone: "group",
  deleteBlock: "createBlock",
  moveCard: "moveCard",
  moveZone: "moveZone",
  moveBlock: "moveBlock",
  resizeCard: "resizeCard",
  resizeZone: "resizeZone",
  resizeBlock: "resizeBlock",
  group: "group",
};

/** The object id an operation or inverse acts on; `null` for a group. */
function targetId(change) {
  switch (change.type) {
    case "createCard":
    case "deleteCard":
      return change.payload.card.id;
    case "createZone":
    case "deleteZone":
      return change.payload.zone.id;
    case "createBlock":
    case "deleteBlock":
      return change.payload.block.id;
    case "moveCard":
    case "resizeCard":
      return change.payload.cardId;
    case "moveZone":
    case "resizeZone":
      return change.payload.zoneId;
    case "moveBlock":
    case "resizeBlock":
      return change.payload.blockId;
    case "group":
      return null;
  }
}

/** Asserts the contract shape of one operation (schema and AD-1 relations). */
export function assertValidOperation(operation) {
  assert.ok(
    validate(operation, OPERATION_SCHEMA, OPERATION_SCHEMA),
    `operation is not valid contract 0.3.0: ${JSON.stringify(operation)}`,
  );
}

/** Asserts a pair: valid operation, exactly one matching inverse, one board. */
export function assertValidPair(pair) {
  const { operation, inverse } = pair;
  assertValidOperation(operation);
  assert.deepEqual(operation.inverse, inverse, "the returned inverse is the operation's inverse");
  assert.equal(inverse.boardId, operation.boardId, "the inverse acts on the same board");
  assert.equal(inverse.type, INVERSE_TYPE[operation.type], "the inverse has the inverse type");
  assert.equal(targetId(inverse), targetId(operation), "the inverse acts on the same object");
  if (operation.type === "group") {
    const forward = operation.payload.children.map(targetId);
    const backward = inverse.payload.children.map(targetId).reverse();
    assert.deepEqual(backward, forward, "the group inverse reverses the child targets");
    assert.deepEqual(
      inverse.payload.children.map((child) => child.type),
      operation.payload.children.map((child) => child.type).reverse(),
      "the group inverse reverses the child inverse types",
    );
    for (const child of operation.payload.children) {
      assertValidOperation(child);
    }
  }
}
