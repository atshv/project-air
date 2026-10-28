// P4-19 (L20) placement tests: centre/grid start, 32 px cascade, ten-attempt
// cap, visible-object-only avoidance, clamping into the visible area, zoom-level
// determinism and the five-add integration through the create operation seam.

import assert from "node:assert/strict";
import test from "node:test";

import {
  placeNewObject,
  PLACEMENT_CASCADE_PX,
  PLACEMENT_GRID_PX,
  PLACEMENT_MAX_ATTEMPTS,
} from "../src/bridge/placement.ts";
import { applyInverse, applyOperation, buildOperation, keyAfter } from "../src/logic/operations.ts";
import { createInMemoryDocument } from "../src/logic/document-port.ts";

const SIZE = { width: 224, height: 128 };
const VISIBLE = { x: 0, y: 0, width: 1000, height: 700 };
const gridAligned = (value) => Math.abs(value % PLACEMENT_GRID_PX) < 1e-9;
const rect = (result) => ({ x: result.x, y: result.y, width: result.width, height: result.height });
const inside = (result, visible = VISIBLE) =>
  result.x >= visible.x - 1e-9 &&
  result.y >= visible.y - 1e-9 &&
  result.x + result.width <= visible.x + visible.width + 1e-9 &&
  result.y + result.height <= visible.y + visible.height + 1e-9;
const overlaps = (left, right) =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

function uuidv7(counter) {
  return `018f0d00-0000-7000-8000-${counter.toString(16).padStart(12, "0")}`;
}

function context() {
  let operations = 0;
  return {
    boardId: uuidv7(0xb0a1),
    actorId: uuidv7(0xac01),
    createOperationId: () => uuidv7(0x10000 + operations++),
    now: () => "2026-01-01T00:00:00.000Z",
  };
}

test("a new object starts at the snapped view centre on the 16 px grid", () => {
  const result = placeNewObject({ visible: VISIBLE, objects: [], size: SIZE });
  assert.deepEqual(rect(result), { x: 384, y: 288, width: 224, height: 128 });
  assert.equal(result.attempts, 1);
  assert.equal(result.capped, false);
  assert.ok(gridAligned(result.x) && gridAligned(result.y));
  assert.ok(inside(result));
});

test("an overlapping visible object cascades the candidate 32 px right and down", () => {
  const tall = { x: 0, y: 0, width: 1000, height: 900 };
  const first = placeNewObject({ visible: tall, objects: [], size: SIZE });
  // The first axis to clear wins: ceil(128 / 32) = 4 cascade steps.
  const blocked = placeNewObject({ visible: tall, objects: [rect(first)], size: SIZE });
  const steps = Math.min(Math.ceil(SIZE.width / PLACEMENT_CASCADE_PX), Math.ceil(SIZE.height / PLACEMENT_CASCADE_PX));
  assert.deepEqual(rect(blocked), {
    x: first.x + steps * PLACEMENT_CASCADE_PX,
    y: first.y + steps * PLACEMENT_CASCADE_PX,
    width: SIZE.width,
    height: SIZE.height,
  });
  assert.equal(blocked.attempts, steps + 1);
  assert.ok(inside(blocked, tall));
  assert.equal(overlaps(rect(blocked), rect(first)), false);
});

test("the cascade never exceeds ten attempts and returns the tenth candidate", () => {
  const tall = { x: 0, y: 0, width: 1000, height: 900 };
  const start = placeNewObject({ visible: tall, objects: [], size: SIZE });
  const blockers = Array.from({ length: PLACEMENT_MAX_ATTEMPTS }, (_, index) => ({
    x: start.x + index * PLACEMENT_CASCADE_PX,
    y: start.y + index * PLACEMENT_CASCADE_PX,
    width: SIZE.width,
    height: SIZE.height,
  }));
  const result = placeNewObject({ visible: tall, objects: blockers, size: SIZE });
  assert.equal(PLACEMENT_MAX_ATTEMPTS, 10);
  assert.equal(result.attempts, 10);
  assert.equal(result.capped, true);
  assert.equal(result.fallback, true, "a fully blocked cascade falls back to a free visible slot");
  assert.ok(inside(result, tall));
  assert.ok(gridAligned(result.x) && gridAligned(result.y));

});

test("only visible objects block the candidate", () => {
  const hidden = { x: VISIBLE.x + VISIBLE.width + 400, y: VISIBLE.y, width: 224, height: 128 };
  const result = placeNewObject({ visible: VISIBLE, objects: [hidden], size: SIZE });
  const free = placeNewObject({ visible: VISIBLE, objects: [], size: SIZE });
  assert.deepEqual(rect(result), rect(free), "an object outside the visible bounds is not occupied");
  assert.equal(result.attempts, 1);
});

test("the result is clamped inside the visible area and stays on the grid", () => {
  const visible = { x: 100, y: 100, width: 600, height: 400 };
  const start = placeNewObject({ visible, objects: [], size: SIZE });
  const blockers = Array.from({ length: 12 }, (_, index) => ({
    x: start.x + index * PLACEMENT_CASCADE_PX,
    y: start.y + index * PLACEMENT_CASCADE_PX,
    width: SIZE.width,
    height: SIZE.height,
  }));
  const result = placeNewObject({ visible, objects: blockers, size: SIZE });
  assert.ok(inside(result, visible), "the object stays fully inside the visible bounds");
  assert.ok(gridAligned(result.x) && gridAligned(result.y), "clamping then snapping inward keeps the grid");
  // The clamping cascade (a large step) cannot leave the visible area either.
  const huge = placeNewObject({ visible, objects: [rect(start)], size: SIZE, cascadePx: 5000 });
  assert.ok(inside(huge, visible));
  assert.ok(gridAligned(huge.x) && gridAligned(huge.y));
});

test("the placement is deterministic and independent of zoom except for the visible bounds", () => {
  const wide = { x: 0, y: 0, width: 1000, height: 700 };
  const zoomed = { x: 250, y: 175, width: 500, height: 350 };
  const first = placeNewObject({ visible: wide, objects: [], size: SIZE });
  assert.deepEqual(placeNewObject({ visible: wide, objects: [], size: SIZE }), first);
  const second = placeNewObject({ visible: zoomed, objects: [], size: SIZE });
  assert.ok(gridAligned(first.x) && gridAligned(second.x));
  assert.ok(inside(first, wide) && inside(second, zoomed));
  // Same visible bounds always give the same position, whatever the zoom was.
  assert.deepEqual(placeNewObject({ visible: zoomed, objects: [], size: SIZE }), second);
});

test("five consecutive creates through the seam give five visible, non-overlapping cards", () => {
  const port = createInMemoryDocument();
  const operationContext = context();
  const created = [];
  const operations = [];
  let z = "0";
  for (let index = 0; index < 5; index += 1) {
    const visibleObjects = created.map((card) => ({ x: card.x, y: card.y, width: card.width, height: card.height }));
    const placement = placeNewObject({ visible: VISIBLE, objects: visibleObjects, size: SIZE });
    assert.ok(inside(placement));
    assert.ok(gridAligned(placement.x) && gridAligned(placement.y));
    assert.ok(placement.attempts >= 1 && placement.attempts <= PLACEMENT_MAX_ATTEMPTS);
    z = keyAfter(z);
    const draft = {
      kind: "card",
      id: uuidv7(0x7000 + index),
      noteId: uuidv7(0x9000 + index),
      x: placement.x,
      y: placement.y,
      width: SIZE.width,
      height: SIZE.height,
      z,
    };
    const pair = buildOperation(port, operationContext, { kind: "create", draft });
    assert.ok(pair !== null);
    assert.equal(pair.operation.type, "createCard");
    assert.equal(pair.inverse.type, "deleteCard");
    operations.push(pair.operation);
    applyOperation(port, pair.operation);
    created.push(port.read("card", draft.id));
    // The single create operation carries the placement position (no second write).
    assert.equal(port.read("card", draft.id).x, placement.x);
    assert.equal(port.read("card", draft.id).y, placement.y);
  }
  assert.equal(created.length, 5);
  for (let index = 0; index < created.length; index += 1) {
    for (let other = index + 1; other < created.length; other += 1) {
      assert.equal(overlaps(created[index], created[other]), false, `cards ${index}/${other} must not overlap`);
    }
  }
  assert.equal(new Set(operations.map((operation) => operation.id)).size, 5);
  // The last create also reverts cleanly through its inverse.
  const last = operations[operations.length - 1];
  applyInverse(port, last.inverse);
  assert.equal(port.kindOf(created[4].id), undefined);
});
