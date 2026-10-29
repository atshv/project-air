// L08 (P4-30) zone lifecycle and names: grouping thresholds, emptied-zone
// removal, one-operation creation/wrap/rename with inverse, title rules and the
// fixed 40 px header.

import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultZoneTitle,
  groupingDecision,
  headerGeometry,
  normalizeZoneTitle,
  planZoneGroup,
  zoneFrameLook,
  GROUP_CONTACT_PX,
  GROUP_OVERLAP,
  GROUP_POINTER_PX,
  ZONE_HEADER,
  ZONE_TITLE_MAX,
} from "../src/bridge/zone-lifecycle.ts";
import { applyInverse, applyOperation, buildOperation } from "../src/logic/operations.ts";
import { BLOCK_ID, CARD_ID, ZONE_ID, blockEntity, cardEntity, createContext, createDocument, uuidv7, zoneEntity } from "./support.mjs";

test("grouping starts at 20 % overlap or 16 px, and 32 px contact keeps it", () => {
  assert.equal(GROUP_OVERLAP, 0.2);
  assert.equal(GROUP_POINTER_PX, 16);
  assert.equal(GROUP_CONTACT_PX, 32);
  assert.equal(groupingDecision({ overlap: 0.19, pointerDistance: 17, contact: 10 }, false).start, false);
  assert.equal(groupingDecision({ overlap: 0.2, pointerDistance: 100, contact: 10 }, false).start, true);
  assert.equal(groupingDecision({ overlap: 0, pointerDistance: 16, contact: 10 }, false).start, true);
  assert.equal(groupingDecision({ overlap: 0, pointerDistance: 40, contact: 31 }, true).keep, true);
  assert.equal(groupingDecision({ overlap: 0, pointerDistance: 40, contact: 33 }, true).keep, false);
  assert.equal(groupingDecision({ overlap: 0.35, pointerDistance: 100, contact: 10 }, true).start, true);
});

test("presentation look: dashed while grouping, dashed and dimmed when emptied", () => {
  assert.deepEqual(zoneFrameLook({ grouping: true, memberCount: 2, lastMemberLeaving: false }), { dashed: true, dimmed: false });
  assert.deepEqual(zoneFrameLook({ grouping: false, memberCount: 1, lastMemberLeaving: true }), { dashed: true, dimmed: true });
  assert.deepEqual(zoneFrameLook({ grouping: false, memberCount: 0, lastMemberLeaving: false }), { dashed: true, dimmed: true });
  assert.deepEqual(zoneFrameLook({ grouping: false, memberCount: 2, lastMemberLeaving: false }), { dashed: false, dimmed: false });
});

test("default titles follow the playground language", () => {
  assert.equal(defaultZoneTitle("en"), "New zone");
  assert.equal(defaultZoneTitle("de"), "Neue Zone");
  assert.equal(defaultZoneTitle(), "New zone");
});

test("rename normalises whitespace, emptiness and the 40-character limit", () => {
  assert.deepEqual(normalizeZoneTitle("  Lake   trip  "), { title: "Lake trip", changed: true });
  assert.deepEqual(normalizeZoneTitle("Lake trip"), { title: "Lake trip", changed: false });
  assert.deepEqual(normalizeZoneTitle("   "), { title: "New zone", changed: true });
  assert.deepEqual(normalizeZoneTitle("   ", "de"), { title: "Neue Zone", changed: true });
  const long = "x".repeat(ZONE_TITLE_MAX + 20);
  assert.equal(normalizeZoneTitle(long).title.length, ZONE_TITLE_MAX);
  assert.equal(ZONE_TITLE_MAX, 40);
});

test("the header stays 40 px and never scales with the frame", () => {
  assert.equal(ZONE_HEADER, 40);
  for (const scale of [0.5, 1, 1.5, 2]) {
    assert.equal(headerGeometry(scale).height, 40, "the header band is fixed");
  }
  assert.deepEqual(headerGeometry(1), { height: 40, scale: 1 });
  assert.deepEqual(headerGeometry(2), { height: 40, scale: 0.5 });
});

test("the group layout places members with padding below the header", () => {
  const layout = planZoneGroup(
    [
      { id: "a", x: 100, y: 100, width: 200, height: 100 },
      { id: "b", x: 100, y: 260, width: 200, height: 100 },
    ],
    null,
    "vertical",
    { width: 2000, height: 2000 },
  );
  assert.equal(layout.orientation, "vertical");
  assert.equal(layout.frame.x, 84);
  assert.equal(layout.frame.y, 44);
  assert.deepEqual(layout.members[0], { id: "a", x: 100, y: 100 });
  assert.equal(layout.members[1].y, 100 + 100 + 12);
});

test("grouping two free objects creates the zone in one operation with inverse", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const newZoneId = uuidv7(0x700);
  const layout = planZoneGroup(
    [
      { id: CARD_ID, x: cardEntity().x, y: cardEntity().y, width: cardEntity().width, height: cardEntity().height },
      { id: BLOCK_ID, x: blockEntity().x, y: blockEntity().y, width: blockEntity().width, height: blockEntity().height },
    ],
    null,
    "vertical",
    { width: 2000, height: 2000 },
  );
  const pair = buildOperation(port, context, {
    kind: "zone-group",
    newZoneId,
    title: defaultZoneTitle("en"),
    frame: layout.frame,
    members: [
      { objectKind: "card", objectId: CARD_ID, position: layout.members.find((m) => m.id === CARD_ID) },
      { objectKind: "block", objectId: BLOCK_ID, position: layout.members.find((m) => m.id === BLOCK_ID) },
    ],
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "group");
  assert.deepEqual(pair.operation.payload.children.map((child) => child.type), ["createZone", "moveCard", "moveBlock"]);
  assert.equal(pair.inverse.type, "group");
  applyOperation(port, pair.operation);
  const zone = port.read("zone", newZoneId);
  assert.equal(zone.title, "New zone");
  assert.equal(port.read("card", CARD_ID).zoneId, newZoneId);
  assert.equal(port.read("block", BLOCK_ID).zoneId, newZoneId);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "one inverse removes the zone and restores both objects");
});

test("a one-item zone wraps both members and keeps its title", () => {
  const port = createDocument();
  const context = createContext();
  const zone = zoneEntity();
  const free = port.read("card", CARD_ID);
  // Board-level free card plus the existing zone (title stays).
  const layout = planZoneGroup(
    [
      { id: CARD_ID, x: free.x, y: free.y, width: free.width, height: free.height },
      { id: BLOCK_ID, x: zone.x, y: zone.y, width: zone.width, height: zone.height },
    ],
    { x: zone.x, y: zone.y },
    "vertical",
    { width: 4000, height: 4000 },
  );
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "zone-group",
    zoneId: ZONE_ID,
    title: zone.title,
    frame: layout.frame,
    members: [
      { objectKind: "card", objectId: CARD_ID, position: layout.members.find((m) => m.id === CARD_ID) },
    ],
  });
  assert.ok(pair !== null);
  assert.deepEqual(pair.operation.payload.children.map((child) => child.type), ["resizeZone", "moveCard"]);
  applyOperation(port, pair.operation);
  assert.equal(port.read("zone", ZONE_ID).title, zone.title, "the wrap never renames");
  assert.equal(port.read("card", CARD_ID).zoneId, ZONE_ID);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before);
});

test("an emptied zone is removed as one undoable operation", () => {
  const port = createDocument();
  const context = createContext();
  const zone = zoneEntity();
  // Empty the zone through the real removal of both members.
  const removeMembers = buildOperation(port, context, {
    kind: "delete-selection",
    members: [
      { objectKind: "card", objectId: CARD_ID },
      { objectKind: "block", objectId: BLOCK_ID },
    ],
  });
  applyOperation(port, removeMembers.operation);
  assert.equal(port.members(ZONE_ID).cards.length, 0);
  const before = port.snapshot();
  const pair = buildOperation(port, context, { kind: "delete-zone", zoneId: ZONE_ID, policy: "keep" });
  assert.equal(pair.operation.type, "deleteZone");
  applyOperation(port, pair.operation);
  assert.equal(port.read("zone", ZONE_ID), undefined);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "title, slot and members come back with the inverse");
});

test("rename is one operation with inverse that restores the old title and members", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, { kind: "zone-rename", zoneId: ZONE_ID, title: "Lake trip" });
  assert.ok(pair !== null);
  // P6-14: contract 0.5.0 renames with one updateZone (was a P4-30 group).
  assert.equal(pair.operation.type, "updateZone");
  assert.equal(pair.inverse.type, "updateZone");
  assert.equal(pair.inverse.payload.title, zoneEntity().title, "the inverse carries the previous title");
  applyOperation(port, pair.operation);
  assert.equal(port.read("zone", ZONE_ID).title, "Lake trip");
  assert.equal(port.read("card", CARD_ID).zoneId, ZONE_ID, "the members stay in the zone");
  assert.equal(port.read("block", BLOCK_ID).zoneId, ZONE_ID);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "the inverse restores the title, slot and members");
});

test("a rename to the same title writes nothing", () => {
  const port = createDocument();
  const context = createContext();
  const pair = buildOperation(port, context, {
    kind: "zone-rename",
    zoneId: ZONE_ID,
    title: zoneEntity().title,
  });
  assert.equal(pair, null);
});
