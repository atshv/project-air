// L08 (P4-27) zone membership and zone move tests.
//
// The rules run over the real P4-05 seam and the in-memory document port:
// membership is written only through the existing moveCard/moveBlock payloads
// (one operation with inverse), a zone drag with members is exactly one group
// operation, both deleteZone content policies apply as one operation with an
// inverse that restores the byte-identical snapshot, and the minimum zone size
// is the member extent + the 16 px inset. The pure helpers are tested directly.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createInMemoryDocument } from "../src/logic/document-port.ts";
import {
  applyInverse,
  applyOperation,
  buildOperation,
  minimumZoneSize,
  pointInsideRect,
  rectCentre,
  ZONE_CONTENT_INSET,
  zoneAtPoint,
  dropZoneId,
} from "../src/logic/operations.ts";
import {
  BLOCK_ID,
  CARD_ID,
  ZONE_ID,
  blockEntity,
  cardEntity,
  createContext,
  createDocument,
  zoneEntity,
} from "./support.mjs";

const tokens = JSON.parse(
  readFileSync(new URL("../../ui-kit/tokens.json", import.meta.url), "utf8"),
);

function hydrate(snapshot) {
  const parsed = JSON.parse(snapshot);
  const port = createInMemoryDocument();
  for (const block of parsed.blocks) {
    port.add("block", block);
  }
  for (const card of parsed.cards) {
    port.add("card", card);
  }
  for (const zone of parsed.zones) {
    port.add("zone", zone);
  }
  return port;
}

/** Moves the fixture card's centre into the fixture zone. */
function cardInsideZone() {
  const zone = zoneEntity();
  const card = cardEntity();
  return {
    x: zone.x + zone.width / 2 - card.width / 2,
    y: zone.y + zone.height / 2 - card.height / 2,
  };
}

function clearMembership(port, context) {
  const card = port.read("card", CARD_ID);
  if (typeof card.zoneId === "string") {
    const pair = buildOperation(port, context, {
      kind: "drag-single",
      objectKind: "card",
      objectId: CARD_ID,
      position: { x: card.x, y: card.y },
      zoneId: null,
    });
    assert.ok(pair !== null);
    applyOperation(port, pair.operation);
    applyInverse(port, pair.inverse);
  }
}

test("the zone inset is the 16 px space-16 token", () => {
  assert.equal(ZONE_CONTENT_INSET, 16);
  assert.equal(ZONE_CONTENT_INSET, Number.parseFloat(tokens.spacing["space-16"]));
});

test("the drop helpers use the world-space centre and the topmost live zone", () => {
  const zone = { id: "zone-a", world: { x: 0, y: 0, width: 400, height: 300 } };
  const overlapping = { id: "zone-b", world: { x: 100, y: 50, width: 100, height: 100 } };
  assert.deepEqual(rectCentre(zone.world), { x: 200, y: 150 });
  assert.equal(pointInsideRect({ x: 0, y: 0 }, zone.world), true, "edges count as inside");
  assert.equal(pointInsideRect({ x: 400.1, y: 10 }, zone.world), false);
  assert.equal(zoneAtPoint({ x: 20, y: 20 }, [zone]), zone, "inside the zone");
  assert.equal(zoneAtPoint({ x: 500, y: 20 }, [zone]), null, "outside");
  assert.equal(
    zoneAtPoint({ x: 150, y: 100 }, [zone, overlapping]),
    overlapping,
    "a later (higher) zone wins an overlap",
  );
  const cardRect = { x: 120, y: 60, width: 40, height: 40 };
  assert.equal(dropZoneId("card", cardRect, [zone]), zone.id, "centre inside becomes a member");
  assert.equal(dropZoneId("card", { x: 10, y: 10, width: 10, height: 10 }, [overlapping]), null);
  assert.equal(dropZoneId("zone", cardRect, [zone]), null, "zones never get a parent");
});

test("a drop writes membership in the same single move operation", () => {
  const port = createDocument();
  const context = createContext();
  const start = cardEntity();
  port.move("card", CARD_ID, start.x, start.y, null);
  const before = port.snapshot();
  const position = cardInsideZone();
  const pair = buildOperation(port, context, {
    kind: "drag-single",
    objectKind: "card",
    objectId: CARD_ID,
    position,
    zoneId: ZONE_ID,
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "moveCard");
  assert.equal(pair.inverse.type, "moveCard");
  assert.equal(pair.operation.payload.zoneId, ZONE_ID);
  assert.equal(pair.inverse.payload.zoneId, null, "the inverse restores the board parent");
  applyOperation(port, pair.operation);
  assert.equal(port.read("card", CARD_ID).zoneId, ZONE_ID);
  assert.equal(port.read("card", CARD_ID).x, position.x);
  assert.equal(port.members(ZONE_ID).cards.length, 1);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "one inverse restores position and membership");
});

test("dragging the centre out writes zoneId null in the same move operation", () => {
  const port = createDocument();
  const context = createContext();
  const into = buildOperation(port, context, {
    kind: "drag-single",
    objectKind: "card",
    objectId: CARD_ID,
    position: cardInsideZone(),
    zoneId: ZONE_ID,
  });
  applyOperation(port, into.operation);
  const withMember = port.snapshot();
  const outside = { x: 9000, y: 9000 };
  const pair = buildOperation(port, context, {
    kind: "drag-single",
    objectKind: "card",
    objectId: CARD_ID,
    position: outside,
    zoneId: null,
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "moveCard");
  assert.equal(pair.operation.payload.zoneId, null, "the move says explicitly: board level");
  applyOperation(port, pair.operation);
  assert.equal(port.read("card", CARD_ID).zoneId, null);
  assert.equal(port.members(ZONE_ID).cards.length, 0);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), withMember, "the inverse restores membership and position");
});

test("a zone cannot be nested into another zone", () => {
  const port = createDocument();
  const context = createContext();
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "drag-single",
        objectKind: "zone",
        objectId: ZONE_ID,
        position: { x: 10, y: 10 },
        zoneId: ZONE_ID,
      }),
    /no nested zones/,
  );
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "drag-group",
        members: [
          { objectKind: "zone", objectId: ZONE_ID, position: { x: 10, y: 10 }, zoneId: ZONE_ID },
        ],
      }),
    /no nested zones/,
  );
});

test("a zone drag with members is exactly one group operation with one inverse", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const zone = zoneEntity();
  const card = cardEntity();
  const block = blockEntity();
  const delta = { x: 48, y: 32 };
  const pair = buildOperation(port, context, {
    kind: "drag-group",
    members: [
      { objectKind: "zone", objectId: ZONE_ID, position: { x: zone.x + delta.x, y: zone.y + delta.y } },
      { objectKind: "card", objectId: CARD_ID, position: { x: card.x + delta.x, y: card.y + delta.y } },
      { objectKind: "block", objectId: BLOCK_ID, position: { x: block.x + delta.x, y: block.y + delta.y } },
    ],
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "group", "one group operation, never one per member");
  assert.deepEqual(
    pair.operation.payload.children.map((child) => child.type),
    ["moveZone", "moveCard", "moveBlock"],
  );
  assert.equal(pair.inverse.type, "group");
  applyOperation(port, pair.operation);
  assert.equal(port.read("zone", ZONE_ID).x, zone.x + delta.x);
  assert.equal(port.read("card", CARD_ID).x, card.x + delta.x);
  assert.equal(port.read("block", BLOCK_ID).y, block.y + delta.y);
  assert.equal(port.read("card", CARD_ID).zoneId, card.zoneId, "membership is untouched");
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "one inverse restores every member position");
});

test("deleteZone keep-content is one operation whose inverse restores the members", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "delete-zone",
    zoneId: ZONE_ID,
    policy: "keep",
  });
  assert.equal(pair.operation.type, "deleteZone");
  assert.equal(pair.operation.payload.policy, "keep");
  assert.equal(pair.operation.payload.cards.length, 1);
  assert.equal(pair.operation.payload.blocks.length, 1);
  assert.equal(pair.inverse.type, "group");
  assert.deepEqual(
    pair.inverse.payload.children.map((child) => child.type),
    ["createZone", "moveCard", "moveBlock"],
    "undo recreates the zone and reparents the kept members",
  );
  applyOperation(port, pair.operation);
  assert.equal(port.read("zone", ZONE_ID), undefined, "the zone is gone");
  assert.equal(port.read("card", CARD_ID).zoneId, null, "the card stays on the board");
  assert.equal(port.read("block", BLOCK_ID).zoneId, null, "the block stays on the board");
  assert.equal(port.read("card", CARD_ID).x, cardEntity().x, "the position is untouched");
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "the inverse restores zone and membership exactly");
});

test("deleteZone delete-content is one operation whose inverse restores the members", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "delete-zone",
    zoneId: ZONE_ID,
    policy: "delete",
  });
  assert.equal(pair.operation.type, "deleteZone");
  assert.equal(pair.operation.payload.policy, "delete");
  assert.deepEqual(
    pair.inverse.payload.children.map((child) => child.type),
    ["createZone", "createCard", "createBlock"],
    "undo recreates the zone and both members",
  );
  applyOperation(port, pair.operation);
  assert.equal(port.read("zone", ZONE_ID), undefined);
  assert.equal(port.read("card", CARD_ID), undefined, "the card is deleted with the zone");
  assert.equal(port.read("block", BLOCK_ID), undefined);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "the inverse restores the whole content");
});

test("a selection delete with a zone is one group with the keep-content default", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "delete-selection",
    members: [
      { objectKind: "zone", objectId: ZONE_ID },
      { objectKind: "card", objectId: CARD_ID },
    ],
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "group");
  assert.deepEqual(
    pair.operation.payload.children.map((child) => child.type),
    ["deleteZone", "deleteCard"],
  );
  assert.equal(pair.operation.payload.children[0].payload.policy, "keep");
  applyOperation(port, pair.operation);
  assert.equal(port.read("zone", ZONE_ID), undefined);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before);
});

test("a zone never shrinks below its content extent plus the 16 px inset", () => {
  const members = [
    { x: 20, y: 30, width: 100, height: 40 },
    { x: 160, y: 90, width: 60, height: 80 },
  ];
  assert.deepEqual(minimumZoneSize(members), { width: 216, height: 156 });
  assert.deepEqual(minimumZoneSize([]), { width: 16, height: 16 });

  const port = createDocument();
  const context = createContext();
  const zone = zoneEntity();
  const zoneMembers = port.members(ZONE_ID);
  const content = minimumZoneSize([
    ...zoneMembers.cards.map((card) => ({
      x: card.x,
      y: card.y,
      width: card.width,
      height: card.height,
    })),
    ...zoneMembers.blocks.map((block) => ({
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
    })),
  ]);
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "resize",
        objectKind: "zone",
        objectId: ZONE_ID,
        size: { width: content.width - 1, height: Math.max(192, zone.height) },
      }),
    /needs at least/,
    "one pixel below the member extent + inset is rejected",
  );
  const allowed = buildOperation(port, context, {
    kind: "resize",
    objectKind: "zone",
    objectId: ZONE_ID,
    size: { width: Math.max(256, content.width), height: Math.max(192, content.height) },
  });
  assert.ok(allowed !== null, "the minimum size itself is allowed");
});

test("membership survives a snapshot round trip", () => {
  const port = createDocument();
  const context = createContext();
  const pair = buildOperation(port, context, {
    kind: "drag-single",
    objectKind: "block",
    objectId: BLOCK_ID,
    position: { x: zoneEntity().x + 40, y: zoneEntity().y + 60 },
    zoneId: ZONE_ID,
  });
  assert.ok(pair !== null);
  applyOperation(port, pair.operation);
  const snapshot = port.snapshot();
  assert.ok(
    snapshot.includes(`"zoneId":"${ZONE_ID}"`),
    "the serialised working copy carries the membership",
  );
  const restored = hydrate(snapshot);
  assert.equal(restored.read("block", BLOCK_ID).zoneId, ZONE_ID);
  assert.equal(restored.snapshot(), snapshot, "a byte-identical round trip keeps membership");
});
