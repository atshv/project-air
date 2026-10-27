// Gesture-to-operation tests of the engine logic layer (P4-05).
//
// Every test drives the seam through the pure in-memory document port: one
// gesture result in, exactly one contract operation with its inverse out. The
// operation is validated against operation.schema.json and the AD-1 relations
// (one inverse, same board, same target, reversed group) with the contract's own
// read-only test helpers. Applying the operation and then its inverse must
// restore a byte-identical working-copy snapshot.

import assert from "node:assert/strict";
import test from "node:test";

import {
  OperationError,
  applyInverse,
  applyOperation,
  buildOperation,
} from "../src/logic/operations.ts";
import {
  BLOCK_ID,
  CARD_ID,
  NOTE_ID,
  TIMESTAMP,
  ZONE_ID,
  assertValidOperation,
  assertValidPair,
  createContext,
  createDocument,
  uuidv7,
} from "./support.mjs";

function dragSingle(objectKind, objectId, position) {
  return { kind: "drag-single", objectKind, objectId, position };
}

function buildRoundTrip(port, context, gesture) {
  const before = port.snapshot();
  const pair = buildOperation(port, context, gesture);
  assert.ok(pair, "the gesture produced an operation");
  assertValidPair(pair);
  applyOperation(port, pair.operation);
  assert.notEqual(port.snapshot(), before, "applying the operation changes the working copy");
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "the inverse restores a byte-identical working copy");
  return pair;
}

test("a single drag yields exactly one moveCard operation and its inverse restores the card", () => {
  const port = createDocument();
  const context = createContext();
  const pair = buildRoundTrip(port, context, dragSingle("card", CARD_ID, { x: 528, y: 272 }));

  assert.equal(pair.operation.type, "moveCard");
  assert.deepEqual(pair.operation.payload, { cardId: CARD_ID, x: 528, y: 272, zoneId: ZONE_ID });
  assert.equal(pair.operation.id, uuidv7(0x100), "the operation uses the injected id factory");
  assert.equal(pair.operation.boardId, context.boardId);
  assert.equal(pair.operation.actorId, context.actorId);
  assert.equal(pair.operation.createdAt, TIMESTAMP);
  assert.deepEqual(pair.inverse.payload, { cardId: CARD_ID, x: 512, y: 256, zoneId: ZONE_ID });
  // The generated contract types are the compile-time shape; this pins the keys.
  assert.deepEqual(Object.keys(pair.operation).sort(), [
    "actorId",
    "boardId",
    "createdAt",
    "id",
    "inverse",
    "payload",
    "type",
  ]);
  assert.deepEqual(Object.keys(pair.inverse).sort(), ["boardId", "payload", "type"]);
});

test("a move onto the current position is a no-op without an operation", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  assert.equal(buildOperation(port, context, dragSingle("card", CARD_ID, { x: 512, y: 256 })), null);
  assert.equal(port.snapshot(), before);
});

test("a keyboard nudge series is batched into one move operation", () => {
  const port = createDocument();
  const context = createContext();
  const pair = buildRoundTrip(port, context, {
    kind: "keyboard-nudge",
    objectKind: "card",
    objectId: CARD_ID,
    delta: { x: 32, y: 16 },
  });
  assert.equal(pair.operation.type, "moveCard");
  assert.deepEqual(pair.operation.payload, { cardId: CARD_ID, x: 544, y: 272, zoneId: ZONE_ID });
  assert.deepEqual(pair.inverse.payload, { cardId: CARD_ID, x: 512, y: 256, zoneId: ZONE_ID });
  assert.equal(
    buildOperation(port, createContext(), {
      kind: "keyboard-nudge",
      objectKind: "card",
      objectId: CARD_ID,
      delta: { x: 0, y: 0 },
    }),
    null,
  );
});

test("a group drag is exactly one group operation, not one per object", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "drag-group",
    members: [
      { objectKind: "card", objectId: CARD_ID, position: { x: 544, y: 288 } },
      { objectKind: "zone", objectId: ZONE_ID, position: { x: 144, y: 80 } },
      { objectKind: "block", objectId: BLOCK_ID, position: { x: 176, y: 112 } },
    ],
  });

  assert.ok(pair);
  assert.equal(pair.operation.type, "group", "the gesture is one group operation");
  assert.deepEqual(
    pair.operation.payload.children.map((child) => child.type),
    ["moveCard", "moveZone", "moveBlock"],
  );
  assert.deepEqual(
    pair.inverse.payload.children.map((child) => child.type),
    ["moveBlock", "moveZone", "moveCard"],
  );
  assert.deepEqual(pair.operation.inverse, pair.inverse);
  assertValidPair(pair);

  applyOperation(port, pair.operation);
  assert.equal(port.read("card", CARD_ID)?.x, 544);
  assert.equal(port.read("zone", ZONE_ID)?.x, 144);
  assert.equal(port.read("block", BLOCK_ID)?.x, 176);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before);
});

test("an empty or unchanged group drag yields no operation", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  assert.equal(buildOperation(port, context, { kind: "drag-group", members: [] }), null);
  assert.equal(
    buildOperation(port, context, {
      kind: "drag-group",
      members: [{ objectKind: "card", objectId: CARD_ID, position: { x: 512, y: 256 } }],
    }),
    null,
  );
  assert.equal(port.snapshot(), before);
});

test("a group drag rejects the same object twice", () => {
  const port = createDocument();
  const context = createContext();
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "drag-group",
        members: [
          { objectKind: "card", objectId: CARD_ID, position: { x: 528, y: 272 } },
          { objectKind: "card", objectId: CARD_ID, position: { x: 544, y: 288 } },
        ],
      }),
    OperationError,
  );
});

test("a resize builds resizeCard and restores the previous card size", () => {
  const port = createDocument();
  const context = createContext();
  const pair = buildRoundTrip(port, context, {
    kind: "resize",
    objectKind: "card",
    objectId: CARD_ID,
    size: { width: 192, height: 96 },
  });
  assert.equal(pair.operation.type, "resizeCard");
  assert.deepEqual(pair.operation.payload, { cardId: CARD_ID, width: 192, height: 96 });
  assert.deepEqual(pair.inverse.payload, { cardId: CARD_ID, width: 176, height: 80 });
  assert.equal(
    buildOperation(port, createContext(), {
      kind: "resize",
      objectKind: "card",
      objectId: CARD_ID,
      size: { width: 176, height: 80 },
    }),
    null,
    "resizing to the current size is a no-op",
  );
});

test("resize rejects sizes below the contract minimum before writing", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "resize",
        objectKind: "card",
        objectId: CARD_ID,
        size: { width: 175, height: 80 },
      }),
    OperationError,
  );
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "resize",
        objectKind: "block",
        objectId: BLOCK_ID,
        size: { width: 200, height: 100 },
      }),
    OperationError,
  );
  assert.equal(port.snapshot(), before);
});

test("a create builds one createCard operation with a deleteCard inverse", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const draft = {
    kind: "card",
    id: uuidv7(0x900),
    noteId: NOTE_ID,
    zoneId: ZONE_ID,
    x: 256,
    y: 128,
    width: 256,
    height: 128,
    z: "a2",
  };
  const pair = buildOperation(port, context, { kind: "create", draft });
  assert.ok(pair);
  assert.equal(pair.operation.type, "createCard");
  assert.equal(pair.inverse.type, "deleteCard");
  assertValidPair(pair);
  const created = pair.operation.payload.card;
  assert.equal(created.boardId, context.boardId);
  assert.equal(created.createdAt, TIMESTAMP);
  assert.equal(created.updatedAt, TIMESTAMP);

  applyOperation(port, pair.operation);
  assert.deepEqual(port.read("card", draft.id), created);
  applyInverse(port, pair.inverse);
  assert.equal(port.read("card", draft.id), undefined);
  assert.equal(port.snapshot(), before);
});

test("create rejects a card or zone below its minimum size and an empty zone title", () => {
  const port = createDocument();
  const context = createContext();
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "create",
        draft: {
          kind: "card",
          id: uuidv7(0x901),
          noteId: NOTE_ID,
          x: 0,
          y: 0,
          width: 160,
          height: 80,
          z: "a2",
        },
      }),
    OperationError,
  );
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "create",
        draft: {
          kind: "zone",
          id: uuidv7(0x902),
          title: "",
          x: 0,
          y: 0,
          width: 256,
          height: 192,
          z: "a2",
        },
      }),
    OperationError,
  );
});

test("create rejects a non-finite draft position for every object kind", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const drafts = [
    {
      kind: "card",
      id: uuidv7(0x905),
      noteId: NOTE_ID,
      x: Number.NaN,
      y: 128,
      width: 256,
      height: 128,
      z: "a2",
    },
    {
      kind: "zone",
      id: uuidv7(0x906),
      title: "P4-05 zone",
      x: 64,
      y: Number.POSITIVE_INFINITY,
      width: 256,
      height: 192,
      z: "a2",
    },
    {
      kind: "block",
      id: uuidv7(0x907),
      type: "table",
      x: 128,
      y: Number.NEGATIVE_INFINITY,
      width: 288,
      height: 160,
      z: "a3",
    },
  ];
  for (const draft of drafts) {
    assert.throws(
      () => buildOperation(port, context, { kind: "create", draft }),
      OperationError,
      `a non-finite ${draft.kind} position must be rejected`,
    );
  }
  assert.equal(port.snapshot(), before, "rejected drafts leave the copy untouched");
});

test("create builds a zone and a block with exactly the contract minimum size", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const zonePair = buildOperation(port, context, {
    kind: "create",
    draft: {
      kind: "zone",
      id: uuidv7(0x903),
      title: "P4-05 zone",
      x: 64,
      y: 64,
      width: 256,
      height: 192,
      z: "a2",
    },
  });
  const blockPair = buildOperation(port, context, {
    kind: "create",
    draft: {
      kind: "block",
      id: uuidv7(0x904),
      type: "table",
      zoneId: ZONE_ID,
      x: 128,
      y: 128,
      width: 288,
      height: 160,
      z: "a3",
    },
  });
  assert.ok(zonePair);
  assert.ok(blockPair);
  assert.equal(zonePair.operation.type, "createZone");
  assert.equal(zonePair.inverse.type, "deleteZone");
  assert.equal(blockPair.operation.type, "createBlock");
  assert.equal(blockPair.inverse.type, "deleteBlock");
  assertValidPair(zonePair);
  assertValidPair(blockPair);

  applyOperation(port, zonePair.operation);
  assert.equal(port.read("zone", uuidv7(0x903))?.title, "P4-05 zone");
  applyInverse(port, zonePair.inverse);
  assert.equal(port.read("zone", uuidv7(0x903)), undefined, "the deleteZone inverse restores the board");

  applyOperation(port, blockPair.operation);
  assert.equal(port.read("block", uuidv7(0x904))?.type, "table");
  applyInverse(port, blockPair.inverse);
  assert.equal(port.snapshot(), before);
});

test("delete stores the whole card and its createCard inverse restores it", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "delete",
    objectKind: "card",
    objectId: CARD_ID,
  });
  assert.ok(pair);
  assert.equal(pair.operation.type, "deleteCard");
  assert.equal(pair.inverse.type, "createCard");
  assert.equal(pair.operation.payload.card.id, CARD_ID);
  assertValidPair(pair);

  applyOperation(port, pair.operation);
  assert.equal(port.read("card", CARD_ID), undefined);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before);
});

test("deleting an object that is already gone is rejected", () => {
  const port = createDocument();
  const context = createContext();
  const pair = buildOperation(port, context, {
    kind: "delete",
    objectKind: "card",
    objectId: CARD_ID,
  });
  assert.ok(pair);
  applyOperation(port, pair.operation);
  const afterDelete = port.snapshot();
  assert.throws(
    () => buildOperation(port, context, { kind: "delete", objectKind: "card", objectId: CARD_ID }),
    OperationError,
  );
  assert.equal(port.snapshot(), afterDelete, "the rejected gesture leaves the copy untouched");
});

test("unknown and malformed object ids are rejected without a write", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const unknownId = uuidv7(0x999);
  for (const gesture of [
    dragSingle("card", unknownId, { x: 0, y: 0 }),
    { kind: "delete", objectKind: "block", objectId: unknownId },
    { kind: "resize", objectKind: "zone", objectId: unknownId, size: { width: 256, height: 192 } },
    dragSingle("card", "card-0001", { x: 0, y: 0 }),
  ]) {
    assert.throws(() => buildOperation(port, context, gesture), OperationError);
  }
  assert.equal(port.snapshot(), before);
});

test("an invalid session context is rejected before any operation", () => {
  const port = createDocument();
  const context = { ...createContext(), boardId: "not-a-board" };
  assert.throws(
    () => buildOperation(port, context, dragSingle("card", CARD_ID, { x: 528, y: 272 })),
    OperationError,
  );
});

test("an operation survives a contract-native JSON round trip", () => {
  const port = createDocument();
  const context = createContext();
  const pair = buildOperation(port, context, {
    kind: "drag-group",
    members: [
      { objectKind: "card", objectId: CARD_ID, position: { x: 544, y: 288 } },
      { objectKind: "zone", objectId: ZONE_ID, position: { x: 144, y: 80 } },
    ],
  });
  assert.ok(pair);
  const before = port.snapshot();
  const roundTripped = JSON.parse(JSON.stringify(pair.operation));
  assert.deepEqual(roundTripped, pair.operation, "operations are plain contract data");
  assertValidOperation(roundTripped);
  applyOperation(port, roundTripped);
  applyInverse(port, roundTripped.inverse);
  assert.equal(port.snapshot(), before);
});
