// P4-17 (L14) resize tests: handle hit area, anchor math, 16 px snap, minima
// (including the zone content minimum), one operation per gesture with inverse,
// cancel restore and the snapshot round trip.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createPointerInput,
  resizeAnchor,
  resizeCursor,
  resizeFromPointer,
  resizeHandleAt,
  resizeHandlePositions,
  resizeMinimumFor,
  RESIZE_GRID_PX,
  RESIZE_HANDLE_PX,
} from "../src/bridge/input.ts";
import { applyInverse, applyOperation, buildOperation } from "../src/logic/operations.ts";
import { BLOCK_ID, CARD_ID, ZONE_ID, blockEntity, cardEntity, createContext, createDocument, zoneEntity } from "./support.mjs";

const rect = { x: 100, y: 50, width: 200, height: 100 };
const zoomTwo = (world) => ({ x: world.x * 2, y: world.y * 2 });

test("the handle hit area is 8 screen px and zoom-independent", () => {
  assert.equal(RESIZE_HANDLE_PX, 8);
  const seWorld = { x: 300, y: 150 };
  const se = zoomTwo(seWorld);
  assert.equal(resizeHandleAt({ x: se.x + 5, y: se.y + 5 }, rect, zoomTwo), "se");
  assert.equal(resizeHandleAt({ x: se.x + 9, y: se.y }, rect, zoomTwo), null);
  const positions = resizeHandlePositions(rect);
  assert.equal(positions.length, 8);
  for (const position of positions) {
    const screen = zoomTwo(position);
    assert.equal(resizeHandleAt(screen, rect, zoomTwo), position.handle, position.handle);
  }
});

test("cursors and anchors follow the handle role", () => {
  assert.equal(resizeCursor("n"), "ns-resize");
  assert.equal(resizeCursor("s"), "ns-resize");
  assert.equal(resizeCursor("e"), "ew-resize");
  assert.equal(resizeCursor("w"), "ew-resize");
  assert.equal(resizeCursor("nw"), "nwse-resize");
  assert.equal(resizeCursor("se"), "nwse-resize");
  assert.equal(resizeCursor("ne"), "nesw-resize");
  assert.equal(resizeCursor("sw"), "nesw-resize");
  assert.deepEqual(resizeAnchor("se"), { horizontal: "left", vertical: "top" });
  assert.deepEqual(resizeAnchor("nw"), { horizontal: "right", vertical: "bottom" });
  assert.deepEqual(resizeAnchor("e"), { horizontal: "left", vertical: null });
  assert.deepEqual(resizeAnchor("n"), { horizontal: null, vertical: "bottom" });
});

test("the opposite edge/corner stays anchored and sizes snap to 16 px", () => {
  const minimum = { width: 176, height: 80 };
  const se = resizeFromPointer({ handle: "se", rect, pointer: { x: 340, y: 190 }, snap: true, minimum });
  assert.deepEqual(se, { x: 100, y: 50, width: 240, height: 144 });
  const seFree = resizeFromPointer({ handle: "se", rect, pointer: { x: 340, y: 190 }, snap: false, minimum });
  assert.deepEqual(seFree, { x: 100, y: 50, width: 240, height: 140 });
  const nw = resizeFromPointer({ handle: "nw", rect, pointer: { x: 60, y: 20 }, snap: true, minimum });
  assert.equal(nw.x + nw.width, rect.x + rect.width, "the east edge stays anchored");
  assert.equal(nw.y + nw.height, rect.y + rect.height, "the south edge stays anchored");
  assert.equal(nw.width % RESIZE_GRID_PX, 0);
  assert.equal(nw.height % RESIZE_GRID_PX, 0);
  const west = resizeFromPointer({ handle: "w", rect, pointer: { x: 60, y: 100 }, snap: true, minimum });
  assert.equal(west.x + west.width, rect.x + rect.width);
  assert.equal(west.height, rect.height, "an edge handle leaves the other axis unchanged");
  const north = resizeFromPointer({ handle: "n", rect, pointer: { x: 150, y: 20 }, snap: true, minimum });
  assert.equal(north.y + north.height, rect.y + rect.height);
  assert.equal(north.width, rect.width);
});

test("the minima clamp every type, and a zone keeps its member extent + 16 px", () => {
  assert.deepEqual(resizeMinimumFor("card"), { width: 176, height: 80 });
  assert.deepEqual(resizeMinimumFor("block", "checklist"), { width: 224, height: 128 });
  assert.deepEqual(resizeMinimumFor("block", "columns"), { width: 368, height: 192 });
  assert.deepEqual(resizeMinimumFor("zone"), { width: 256, height: 192 });
  const members = [
    { x: 100, y: 100, width: 400, height: 200 },
    { x: 620, y: 160, width: 200, height: 300 },
  ];
  assert.deepEqual(resizeMinimumFor("zone", "checklist", members), { width: 736, height: 376 });
  const shrunk = resizeFromPointer({
    handle: "se",
    rect: { x: 0, y: 0, width: 800, height: 500 },
    pointer: { x: 10, y: 10 },
    snap: false,
    minimum: resizeMinimumFor("zone", "checklist", members),
  });
  assert.equal(shrunk.width, 736);
  assert.equal(shrunk.height, 376);
});

function pairFor(gesture) {
  const port = createDocument();
  const context = createContext();
  const pair = buildOperation(port, context, gesture);
  return { port, pair };
}

test("a resize gesture is exactly one operation with an inverse", () => {
  const before = (() => {
    const port = createDocument();
    return { port, snapshot: port.snapshot() };
  })();
  const context = createContext();
  const pair = buildOperation(before.port, context, {
    kind: "resize",
    objectKind: "card",
    objectId: CARD_ID,
    size: { width: 240, height: 144 },
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "resizeCard");
  assert.equal(pair.inverse.type, "resizeCard");
  applyOperation(before.port, pair.operation);
  assert.deepEqual(
    { width: before.port.read("card", CARD_ID).width, height: before.port.read("card", CARD_ID).height },
    { width: 240, height: 144 },
  );
  applyInverse(before.port, pair.inverse);
  assert.equal(before.port.snapshot(), before.snapshot);
});

test("a west/north handle commits one group of the resize and the anchoring move", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const card = port.read("card", CARD_ID);
  const pair = buildOperation(port, context, {
    kind: "resize",
    objectKind: "card",
    objectId: CARD_ID,
    size: { width: card.width + 32, height: card.height + 16 },
    position: { x: card.x - 32, y: card.y - 16 },
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "group");
  assert.deepEqual(pair.operation.payload.children.map((child) => child.type), ["resizeCard", "moveCard"]);
  applyOperation(port, pair.operation);
  assert.deepEqual(
    { x: port.read("card", CARD_ID).x, width: port.read("card", CARD_ID).width },
    { x: card.x - 32, width: card.width + 32 },
  );
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before);
});

test("the seam rejects sizes below the type minimum and the zone content minimum", () => {
  const port = createDocument();
  const context = createContext();
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "resize",
        objectKind: "card",
        objectId: CARD_ID,
        size: { width: 175, height: 80 },
      }),
    /needs at least/,
  );
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "resize",
        objectKind: "block",
        objectId: BLOCK_ID,
        size: { width: 200, height: 128 },
      }),
    /needs at least/,
    "checklist blocks need 224 px",
  );
  const zone = zoneEntity();
  const members = port.members(ZONE_ID);
  const minimum = resizeMinimumFor("zone", "checklist", [
    ...members.cards.map((card) => ({ x: card.x, y: card.y, width: card.width, height: card.height })),
    ...members.blocks.map((block) => ({ x: block.x, y: block.y, width: block.width, height: block.height })),
  ]);
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "resize",
        objectKind: "zone",
        objectId: ZONE_ID,
        size: { width: minimum.width - 1, height: zone.height },
      }),
    /needs at least/,
  );
});

test("the resized size survives a snapshot round trip", () => {
  const port = createDocument();
  const context = createContext();
  const pair = buildOperation(port, context, {
    kind: "resize",
    objectKind: "block",
    objectId: BLOCK_ID,
    size: { width: 256, height: 144 },
  });
  applyOperation(port, pair.operation);
  const snapshot = port.snapshot();
  const hydrated = JSON.parse(snapshot);
  assert.equal(hydrated.blocks.find((block) => block.id === BLOCK_ID).width, 256);
  assert.equal(hydrated.blocks.find((block) => block.id === BLOCK_ID).height, 144);
  assert.ok(snapshot.includes('"width":256'));
});

// -- input layer: handle press, preview, commit, cancel -----------------------

const CARD_TARGET = {
  kind: "card",
  id: "card-1",
  slot: 0,
  world: { x: 100, y: 100, width: 200, height: 100 },
  draggable: true,
};

function inputHost() {
  const calls = { previews: [], commits: [], reverts: [], selection: [] };
  const host = {
    hitTest: () => CARD_TARGET,
    screenToWorld: (x, y) => ({ x, y }),
    worldToScreen: (world) => ({ x: world.x, y: world.y }),
    panByScreen() {},
    zoomByFactor() {},
    previewDrag() {},
    commitDrag() {},
    revertDrag() {},
    selectionTargets: () => (selection.length === 0 ? [] : [CARD_TARGET]),
    targetsInRect: () => [],
    onSelectionChange: (targets) => { selection.length = 0; selection.push(...targets); calls.selection.push(targets.length); },
    onTap() {},
    onHover() {},
    onCursor() {},
    capturePointer() {},
    releasePointer() {},
    previewResize: (target, next) => calls.previews.push({ ...next }),
    commitResize: (target, next) => calls.commits.push({ ...next }),
    revertResize: () => calls.reverts.push(true),
    resizeMinimum: () => ({ width: 176, height: 80 }),
  };
  const selection = [];
  return { host, calls };
}

const pointer = (screen) => ({ pointerId: 1, pointerType: "mouse", button: 0, screen });

test("pressing a handle previews and commits exactly one resize; cancel restores", () => {
  const { host, calls } = inputHost();
  const input = createPointerInput({ thresholdPx: 4, headerHeightPx: 40, hoverTransitionMs: 120, host });
  const centre = { x: 200, y: 150 };
  input.pointerDown(pointer(centre));
  input.pointerUp(pointer(centre));
  assert.equal(input.selection.length, 1, "the click selects the card");
  const se = { x: 300, y: 200 };
  input.pointerDown(pointer(se));
  assert.equal(input.phase, "resizing");
  input.pointerMove(pointer({ x: 340, y: 240 }));
  assert.equal(calls.previews.length, 1);
  assert.equal(calls.previews[0].width % 16, 0);
  assert.equal(calls.previews[0].height % 16, 0);
  input.pointerUp(pointer({ x: 340, y: 240 }));
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.reverts.length, 0);

  // Escape during a resize restores and writes nothing.
  input.pointerDown(pointer(se));
  input.pointerMove(pointer({ x: 320, y: 220 }));
  assert.equal(input.keyDown("Escape"), true);
  assert.equal(calls.reverts.length, 1);
  assert.equal(calls.commits.length, 1, "no second operation on cancel");
  assert.equal(input.phase, "idle");
  assert.equal(input.selection.length, 1, "the selection survives the cancel");
});
