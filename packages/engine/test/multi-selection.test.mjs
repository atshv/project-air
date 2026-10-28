// Multi-selection tests (L10 / P4-16).
//
// The input layer is driven directly with a fake host that mirrors the playground
// (selection targets, world-space band intersection, native selection/band
// callbacks, joint-drag preview/commit/revert). The operation-seam cases use the
// real P4-05 seam over the in-memory document port: one joint drag is exactly one
// `group` of moves and one selection delete is exactly one `group` of deletes,
// each with the exactly one inverse that restores the working copy.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createPointerInput,
  worldRectsIntersect,
} from "../src/bridge/input.ts";
import {
  applyInverse,
  applyOperation,
  buildOperation,
} from "../src/logic/operations.ts";
import {
  CARD_ID,
  blockEntity,
  cardEntity,
  createContext,
  createDocument,
} from "./support.mjs";

const OPTIONS = { thresholdPx: 4, headerHeightPx: 40, hoverTransitionMs: 120 };

function target(kind, id, world) {
  return { kind, id, slot: 0, world, draggable: true };
}

const CARD_ONE = target("card", "card-one", { x: 100, y: 100, width: 80, height: 60 });
const CARD_TWO = target("card", "card-two", { x: 300, y: 100, width: 80, height: 60 });
const CARD_THREE = target("card", "card-three", { x: 500, y: 100, width: 80, height: 60 });
const TARGETS = [CARD_ONE, CARD_TWO, CARD_THREE];

function createHost() {
  const calls = {
    pan: [],
    preview: [],
    commit: [],
    revert: [],
    groupPreview: [],
    groupCommit: [],
    groupRevert: [],
    selection: [],
    band: [],
    tap: [],
    cursor: [],
  };
  const state = { selection: [], band: null };
  const host = {
    hitTest(screenX, screenY) {
      return (
        TARGETS.find(
          (candidate) =>
            screenX >= candidate.world.x &&
            screenX <= candidate.world.x + candidate.world.width &&
            screenY >= candidate.world.y &&
            screenY <= candidate.world.y + candidate.world.height,
        ) ?? null
      );
    },
    screenToWorld(screenX, screenY) {
      return { x: screenX, y: screenY };
    },
    panByScreen(deltaX, deltaY) {
      calls.pan.push({ deltaX, deltaY });
    },
    zoomByFactor() {},
    previewDrag(_target, position) {
      calls.preview.push(position);
    },
    commitDrag(_target, position) {
      calls.commit.push(position);
    },
    revertDrag() {
      calls.revert.push(true);
    },
    selectionTargets() {
      return state.selection;
    },
    targetsInRect(rect) {
      return TARGETS.filter((candidate) => worldRectsIntersect(candidate.world, rect));
    },
    previewGroupDrag(members) {
      calls.groupPreview.push(members);
    },
    commitGroupDrag(members) {
      calls.groupCommit.push(members);
    },
    revertGroupDrag(members) {
      calls.groupRevert.push(members);
    },
    onSelectionChange(selection) {
      state.selection = [...selection];
      calls.selection.push([...selection]);
    },
    onBandChange(band) {
      state.band = band;
      calls.band.push(band);
    },
    onTap(_target, screen) {
      calls.tap.push(screen);
    },
    onHover() {},
    onCursor(cursor) {
      calls.cursor.push(cursor);
    },
    capturePointer() {},
    releasePointer() {},
  };
  return { host, calls, state };
}

const inputFor = (host) => createPointerInput({ ...OPTIONS, host });

function pointer(pointerId, screen, extra = {}) {
  return { pointerId, pointerType: "mouse", button: 0, screen, ...extra };
}

const centreOf = (candidate) => ({
  x: candidate.world.x + candidate.world.width / 2,
  y: candidate.world.y + candidate.world.height / 2,
});

function click(input, candidate, extra = {}) {
  const point = centreOf(candidate);
  input.pointerDown(pointer(1, point, extra));
  input.pointerUp(pointer(1, point, extra));
}

test("a plain click replaces the selection, Shift-click toggles add and remove", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);

  click(input, CARD_ONE);
  assert.deepEqual(
    input.selection.map((candidate) => candidate.id),
    ["card-one"],
    "a plain click selects exactly the clicked object",
  );
  click(input, CARD_TWO, { shiftKey: true });
  assert.deepEqual(
    input.selection.map((candidate) => candidate.id),
    ["card-one", "card-two"],
    "Shift-click adds to the selection",
  );
  click(input, CARD_ONE, { shiftKey: true });
  assert.deepEqual(
    input.selection.map((candidate) => candidate.id),
    ["card-two"],
    "Shift-click on a selected object removes it",
  );
  click(input, CARD_THREE);
  assert.deepEqual(
    input.selection.map((candidate) => candidate.id),
    ["card-three"],
    "a plain click replaces a multi-selection",
  );
  assert.ok(calls.selection.length >= 4, "every selection change is reported");
});

test("a plain empty click clears the selection, Esc clears it too", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  click(input, CARD_ONE);
  click(input, CARD_TWO, { shiftKey: true });
  assert.equal(input.selection.length, 2);

  input.pointerDown(pointer(1, { x: 700, y: 550 }));
  input.pointerUp(pointer(1, { x: 700, y: 550 }));
  assert.equal(input.selection.length, 0, "an empty plain click clears the selection");

  click(input, CARD_ONE);
  click(input, CARD_TWO, { shiftKey: true });
  assert.equal(input.selection.length, 2);
  assert.equal(input.keyDown("Escape"), true, "Esc clears a non-empty selection");
  assert.equal(input.selection.length, 0);
  assert.equal(calls.selection.at(-1).length, 0);
  assert.equal(input.keyDown("Escape"), false, "Esc is a no-op without a selection");
});

test("a Shift-drag on empty canvas draws a band and selects by intersection", () => {
  const { host, calls, state } = createHost();
  const input = inputFor(host);
  input.pointerDown(pointer(1, { x: 50, y: 50 }, { shiftKey: true }));
  input.pointerMove(pointer(1, { x: 350, y: 250 }, { shiftKey: true }));
  assert.ok(state.band !== null, "the live band is reported while dragging");
  assert.deepEqual(state.band, { x: 50, y: 50, width: 300, height: 200 });
  assert.equal(calls.pan.length, 0, "a band drag never pans");
  input.pointerUp(pointer(1, { x: 350, y: 250 }, { shiftKey: true }));
  assert.deepEqual(
    input.selection.map((candidate) => candidate.id),
    ["card-one", "card-two"],
    "the band selects every object whose bounds intersect it",
  );
  assert.equal(state.band, null, "the band disappears on release");
  assert.equal(calls.band.at(-1), null);
});

test("a plain drag on empty canvas still pans and draws no band", () => {
  const { host, calls, state } = createHost();
  const input = inputFor(host);
  input.pointerDown(pointer(1, { x: 50, y: 50 }));
  input.pointerMove(pointer(1, { x: 90, y: 70 }));
  input.pointerUp(pointer(1, { x: 90, y: 70 }));
  assert.equal(calls.pan.length, 1);
  assert.equal(state.band, null, "no band without Shift");
  assert.equal(calls.band.length, 0);
  assert.equal(input.selection.length, 0);
});

test("the world-space band rule is bounds intersection, not containment", () => {
  const outer = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(worldRectsIntersect(outer, { x: 50, y: 50, width: 10, height: 10 }), true);
  assert.equal(worldRectsIntersect(outer, { x: 100, y: 0, width: 10, height: 10 }), true);
  assert.equal(worldRectsIntersect(outer, { x: 101, y: 0, width: 10, height: 10 }), false);
  assert.equal(worldRectsIntersect(outer, { x: -20, y: -20, width: 10, height: 10 }), false);
  assert.equal(worldRectsIntersect(outer, { x: 50, y: 100, width: 10, height: 10 }), true);
  assert.equal(worldRectsIntersect(outer, { x: 50, y: 101, width: 10, height: 10 }), false);
});

test("a joint drag previews and commits once, and the selection survives", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  click(input, CARD_ONE);
  click(input, CARD_TWO, { shiftKey: true });
  assert.equal(input.selection.length, 2);

  const start = centreOf(CARD_ONE);
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 30, y: start.y + 20 }));
  assert.equal(calls.groupPreview.length, 1, "the joint drag previews the members");
  const previewed = calls.groupPreview[0];
  assert.equal(previewed.length, 2, "both selected objects are previewed");
  assert.deepEqual(
    previewed.map((member) => member.position),
    [
      { x: 130, y: 120 },
      { x: 330, y: 120 },
    ],
    "every member moves by the same world delta",
  );
  input.pointerUp(pointer(1, { x: start.x + 30, y: start.y + 20 }));
  assert.equal(calls.groupCommit.length, 1, "exactly one joint operation per drag");
  assert.equal(calls.commit.length, 0, "no per-object single drag is committed");
  assert.equal(calls.groupCommit[0].length, 2);
  assert.deepEqual(
    input.selection.map((candidate) => candidate.id),
    ["card-one", "card-two"],
    "the selection survives the release",
  );
});

test("dragging an unselected object makes it the sole selection", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  click(input, CARD_ONE);
  const start = centreOf(CARD_THREE);
  input.pointerDown(pointer(1, start));
  assert.deepEqual(
    input.selection.map((candidate) => candidate.id),
    ["card-three"],
    "the press replaces the selection with the unselected object",
  );
  input.pointerMove(pointer(1, { x: start.x + 20, y: start.y }));
  input.pointerUp(pointer(1, { x: start.x + 20, y: start.y }));
  assert.equal(calls.groupCommit.length, 0, "a single selected object drags alone");
  assert.equal(calls.commit.length, 1, "the P4-14 single drag commits");
});

test("a cancelled joint drag restores every member and writes nothing", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  click(input, CARD_ONE);
  click(input, CARD_TWO, { shiftKey: true });
  const start = centreOf(CARD_ONE);
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 40, y: start.y + 10 }));
  assert.equal(calls.groupPreview.length, 1);
  input.pointerCancel(1);
  assert.equal(calls.groupRevert.length, 1, "the cancelled joint drag is reverted");
  assert.equal(calls.groupCommit.length, 0, "no operation is committed");
  assert.equal(calls.commit.length, 0);
  assert.equal(input.selection.length, 2, "the selection survives the cancel");
});

test("the joint drag snap moves every member by the snapped delta", () => {
  const { host, calls } = createHost();
  host.snapDrag = (_target, position) => ({
    x: Math.round(position.x / 16) * 16,
    y: Math.round(position.y / 16) * 16,
  });
  const input = inputFor(host);
  click(input, CARD_ONE);
  click(input, CARD_TWO, { shiftKey: true });
  const start = centreOf(CARD_ONE);
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 21, y: start.y + 5 }));
  const previewed = calls.groupPreview.at(-1);
  const deltaX = previewed[0].position.x - CARD_ONE.world.x;
  const deltaY = previewed[0].position.y - CARD_ONE.world.y;
  for (const member of previewed) {
    assert.equal(member.position.x, member.target.world.x + deltaX);
    assert.equal(member.position.y, member.target.world.y + deltaY);
  }
});

test("one selection delete is exactly one group operation with an inverse", () => {
  const port = createDocument();
  const context = createContext();
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "delete-selection",
    members: [
      { objectKind: "card", objectId: CARD_ID },
      { objectKind: "block", objectId: blockEntity().id },
    ],
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "group");
  assert.deepEqual(
    pair.operation.payload.children.map((child) => child.type),
    ["deleteCard", "deleteBlock"],
    "one group with one delete child per object",
  );
  assert.equal(pair.inverse.type, "group");
  assert.deepEqual(
    pair.inverse.payload.children.map((child) => child.type),
    ["createBlock", "createCard"],
    "the inverse recreates in reverse order",
  );
  applyOperation(port, pair.operation);
  assert.equal(port.read("card", CARD_ID), undefined, "the card is gone");
  assert.equal(port.read("block", blockEntity().id), undefined, "the block is gone");
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "the inverse restores the working copy");
});

test("a joint drag is exactly one group operation with an inverse", () => {
  const port = createDocument();
  const context = createContext();
  const block = blockEntity();
  const before = port.snapshot();
  const pair = buildOperation(port, context, {
    kind: "drag-group",
    members: [
      { objectKind: "card", objectId: CARD_ID, position: { x: cardEntity().x + 32, y: cardEntity().y } },
      { objectKind: "block", objectId: block.id, position: { x: block.x, y: block.y + 32 } },
    ],
  });
  assert.ok(pair !== null);
  assert.equal(pair.operation.type, "group");
  assert.deepEqual(
    pair.operation.payload.children.map((child) => child.type),
    ["moveCard", "moveBlock"],
  );
  applyOperation(port, pair.operation);
  assert.equal(port.read("card", CARD_ID).x, cardEntity().x + 32);
  assert.equal(port.read("block", block.id).y, block.y + 32);
  applyInverse(port, pair.inverse);
  assert.equal(port.snapshot(), before, "one inverse restores both members");
});

test("an empty selection delete and a duplicate member are rejected", () => {
  const port = createDocument();
  const context = createContext();
  assert.equal(
    buildOperation(port, context, { kind: "delete-selection", members: [] }),
    null,
    "an empty selection yields no operation",
  );
  assert.throws(
    () =>
      buildOperation(port, context, {
        kind: "delete-selection",
        members: [
          { objectKind: "card", objectId: CARD_ID },
          { objectKind: "card", objectId: CARD_ID },
        ],
      }),
    /twice/,
    "a duplicated member is rejected",
  );
});
