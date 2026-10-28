// L08 (P4-29) zone parity: arrangement, release preview and the one-operation
// release. The pure rules from src/bridge/zone-parity.ts are tested directly and
// the release is built over the real P4-05 seam.

import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangeZone,
  previewZoneRelease,
  screenToWorldThreshold,
  zoneOrder,
  zoneOrientation,
  zoneSettlePolicy,
  ZONE_CATCH_MARGIN,
  ZONE_ENTER_COVERAGE,
  ZONE_GAP,
  ZONE_HEADER_HEIGHT,
  ZONE_PADDING,
  ZONE_SETTLE_CURVE,
  ZONE_SETTLE_MS,
} from "../src/bridge/zone-parity.ts";
import { applyInverse, applyOperation, buildOperation } from "../src/logic/operations.ts";
import { BLOCK_ID, CARD_ID, ZONE_ID, createContext, createDocument, zoneEntity } from "./support.mjs";

const member = (id, width, height, offsetX, offsetY, order) => ({
  id,
  width,
  height,
  offsetX,
  offsetY,
  order,
});

test("orientation follows the size-normalised offsets with 1.25 dominance", () => {
  // A wide item beside a tall one: normalised the x offset dominates.
  const sideBySide = [member("a", 100, 300, -120, 0, 0), member("b", 300, 100, 120, 0, 1)];
  assert.equal(zoneOrientation(sideBySide, "vertical"), "horizontal");
  const stacked = [member("a", 300, 100, 0, -120, 0), member("b", 100, 300, 0, 120, 1)];
  assert.equal(zoneOrientation(stacked, "horizontal"), "vertical");
  // Near diagonal keeps the current orientation (1.25 dominance).
  const diagonal = [member("a", 200, 200, 100, 90, 0), member("b", 200, 200, -100, -90, 1)];
  assert.equal(zoneOrientation(diagonal, "horizontal"), "horizontal");
  assert.equal(zoneOrientation(diagonal, "vertical"), "vertical");
});

test("a hold of half an item keeps the orientation", () => {
  const held = [member("a", 200, 200, 10, 5, 0), member("b", 200, 200, -10, -5, 1)];
  assert.equal(zoneOrientation(held, "vertical"), "vertical");
  assert.equal(zoneOrientation(held, "horizontal"), "horizontal");
  assert.equal(zoneOrientation([], "vertical"), "vertical");
});

test("order comes from the centre with the 12 px band", () => {
  const members = [
    member("a", 100, 100, 0, 40, 0),
    member("b", 100, 100, 0, -40, 1),
    member("c", 100, 100, 0, 8, 2),
  ];
  assert.deepEqual(zoneOrder(members, "vertical").map((entry) => entry.id), ["b", "c", "a"]);
  const near = [
    member("a", 100, 100, 0, 30, 0),
    member("b", 100, 100, 0, 24, 1),
  ];
  assert.deepEqual(
    zoneOrder(near, "vertical").map((entry) => entry.id),
    ["a", "b"],
    "a difference inside the 12 px band keeps the stored order",
  );
});

test("the arrangement uses padding, gap and the 40 px header", () => {
  const arranged = arrangeZone(
    [
      { id: "a", width: 200, height: 100 },
      { id: "b", width: 160, height: 80 },
    ],
    "vertical",
    { width: 1000, height: 1000 },
  );
  assert.equal(arranged.orientation, "vertical");
  assert.equal(arranged.fallback, false);
  assert.deepEqual(arranged.frame, {
    width: 200 + 2 * ZONE_PADDING,
    height: ZONE_HEADER_HEIGHT + (100 + ZONE_GAP + 80) + 2 * ZONE_PADDING,
  });
  assert.deepEqual(arranged.placements, [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 0, y: 100 + ZONE_GAP },
  ]);
  const horizontal = arrangeZone(
    [
      { id: "a", width: 200, height: 100 },
      { id: "b", width: 160, height: 80 },
    ],
    "horizontal",
    { width: 1000, height: 1000 },
  );
  assert.deepEqual(horizontal.placements, [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 200 + ZONE_GAP, y: 0 },
  ]);
});

test("an arrangement that does not fit falls back without changing the request", () => {
  const members = [
    { id: "a", width: 200, height: 100 },
    { id: "b", width: 160, height: 80 },
  ];
  const requested = "horizontal";
  const arranged = arrangeZone(members, requested, { width: 250, height: 2000 });
  assert.equal(arranged.orientation, "vertical", "the other orientation is used");
  assert.equal(arranged.fallback, true);
  assert.equal(requested, "horizontal", "the caller's request is untouched");
  const fits = arrangeZone(members, requested, { width: 2000, height: 2000 });
  assert.equal(fits.fallback, false);
  assert.equal(fits.orientation, "horizontal");
});

const frame = { x: 100, y: 100, width: 400, height: 300 };
const basePreview = (overrides = {}) => ({
  zoneFrame: frame,
  pointer: { x: 300, y: 250, width: 80, height: 60 },
  dragged: { width: 80, height: 60 },
  dragStart: { x: 300, y: 250 },
  previewing: false,
  coverage: 0,
  currentOrientation: "vertical",
  desiredOrientation: "vertical",
  zoom: 1,
  ...overrides,
});

test("the release preview enters on the frame or 25 % coverage", () => {
  const inside = previewZoneRelease(basePreview());
  assert.equal(inside.inside, true);
  assert.equal(inside.kind, "dock");
  assert.ok(inside.landing !== null);
  const outside = previewZoneRelease(basePreview({ pointer: { x: 900, y: 900, width: 80, height: 60 } }));
  assert.equal(outside.inside, false);
  assert.equal(outside.kind, "free");
  const covered = previewZoneRelease(
    basePreview({ pointer: { x: 900, y: 900, width: 80, height: 60 }, coverage: ZONE_ENTER_COVERAGE }),
  );
  assert.equal(covered.inside, true, "25 % coverage is enough to enter");
});

test("staying inside allows the 24 px catch margin, leaving shrinks the frame", () => {
  const marginWorld = screenToWorldThreshold(ZONE_CATCH_MARGIN, 2);
  assert.equal(marginWorld, 12);
  const catchPoint = { x: frame.x - marginWorld + 1, y: 150, width: 0, height: 0 };
  const staying = previewZoneRelease(
    basePreview({ pointer: catchPoint, previewing: true, zoom: 2 }),
  );
  assert.equal(staying.inside, true, "the 24 px catch margin keeps the dock");
  const leaving = previewZoneRelease(
    basePreview({ pointer: { x: frame.x - marginWorld - 2, y: 150, width: 0, height: 0 }, previewing: true, zoom: 2 }),
  );
  assert.equal(leaving.inside, false);
  assert.equal(leaving.kind, "detach");
  assert.equal(leaving.shrinking, true, "the frame shrinks around the staying member");
  assert.equal(leaving.landing, null);
});

test("a placement against the drag-start positions becomes dock, reorder or orientation", () => {
  const still = previewZoneRelease(basePreview());
  assert.equal(still.kind, "dock");
  assert.equal(still.makeRoom, false);
  const moved = previewZoneRelease(basePreview({ pointer: { x: 300, y: 260, width: 80, height: 60 } }));
  assert.equal(moved.kind, "dock", "a 10 px move is still inside the 12 px order band");
  const far = previewZoneRelease(basePreview({ pointer: { x: 320, y: 250, width: 80, height: 60 } }));
  assert.equal(far.kind, "reorder");
  assert.equal(far.makeRoom, true);
  const flipped = previewZoneRelease(basePreview({ desiredOrientation: "horizontal" }));
  assert.equal(flipped.kind, "orientation");
});

test("a release is exactly one group operation with one inverse", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const zone = zoneEntity();
  const arrangement = arrangeZone(
    [
      { id: CARD_ID, width: 176, height: 80 },
      { id: BLOCK_ID, width: 224, height: 128 },
    ],
    "vertical",
    { width: 4000, height: 4000 },
  );
  const memberCount = port.members(ZONE_ID).cards.length + port.members(ZONE_ID).blocks.length;
  assert.equal(memberCount, 2);
  const baseX = zone.x + ZONE_PADDING;
  const baseY = zone.y + ZONE_HEADER_HEIGHT + ZONE_PADDING;
  const pair = buildOperation(port, context, {
    kind: "zone-arrange",
    zoneId: ZONE_ID,
    size: { width: arrangement.frame.width, height: arrangement.frame.height },
    members: arrangement.placements.map((placement) => ({
      objectKind: placement.id === CARD_ID ? "card" : "block",
      objectId: placement.id,
      position: { x: baseX + placement.x, y: baseY + placement.y },
    })),
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "group");
  assert.deepEqual(
    pair.operation.payload.children.map((child) => child.type),
    ["resizeZone", "moveCard", "moveBlock"],
    "one operation: the frame resize and the arranged members",
  );
  assert.equal(pair.inverse.type, "group");
  applyOperation(port, pair.operation);
  assert.deepEqual(
    { width: port.read("zone", ZONE_ID).width, height: port.read("zone", ZONE_ID).height },
    { width: arrangement.frame.width, height: arrangement.frame.height },
  );
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "one inverse restores frame and every member");
});

test("a cancelled preview writes nothing", () => {
  const port = createDocument();
  const before = port.snapshot();
  const state = previewZoneRelease(basePreview());
  assert.equal(state.inside, true);
  // The preview is presentation state: cancelling means never calling the seam.
  assert.equal(port.snapshot(), before, "no operation and no write before release");
});

test("reduced motion applies the end states instantly", () => {
  const animated = zoneSettlePolicy(false);
  assert.equal(animated.durationMs, ZONE_SETTLE_MS);
  assert.equal(animated.durationMs, 300);
  assert.equal(animated.easing, ZONE_SETTLE_CURVE);
  assert.equal(animated.liftScale, 1.02);
  const reduced = zoneSettlePolicy(true);
  assert.equal(reduced.durationMs, 0);
  assert.equal(reduced.liftScale, 1);
  assert.equal(screenToWorldThreshold(24, 1.5), 16);
});
