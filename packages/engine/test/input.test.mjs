// Pointer input layer tests (L03 / P4-14).
//
// The state machine is DOM-free, so the suite drives it directly: a fake host
// records the pan/zoom, preview, commit and hover callbacks, and one integration
// case wires the real P4-05 seam (`buildOperation`/`applyOperation`/`createHistory`
// over the in-memory document port) to prove that one completed drag is exactly
// one move operation with its inverse and that a click or a cancel writes nothing.
//
// The numbers are asserted against the generated `packages/ui-kit/tokens.json`
// values (design rule §13, AD-7): 4 px drag-threshold, 40 px header-height and
// 120 ms motion-hover.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PointerInput,
  createPointerInput,
  crossesDragThreshold,
  cursorFor,
  cursorForSuppressed,
  isGrip,
  isSuppressedTarget,
  normaliseWheelDelta,
  wheelZoomFactor,
} from "../src/bridge/input.ts";
import { createHistory } from "../src/logic/history.ts";
import { applyOperation, buildOperation } from "../src/logic/operations.ts";
import {
  cardEntity,
  createContext,
  createDocument,
  uuidv7,
} from "./support.mjs";

const tokens = JSON.parse(
  readFileSync(new URL("../../ui-kit/tokens.json", import.meta.url), "utf8"),
);
const thresholds = {
  thresholdPx: Number.parseFloat(tokens.sizes["drag-threshold"]),
  headerHeightPx: Number.parseFloat(tokens.sizes["header-height"]),
  hoverTransitionMs: Number.parseFloat(tokens.motion["motion-hover"]),
};

const CARD_TARGET = {
  kind: "card",
  id: uuidv7(0x201),
  slot: 1,
  world: { x: 100, y: 100, width: 200, height: 120 },
  draggable: true,
};
const BLOCK_TARGET = {
  kind: "block",
  id: uuidv7(0x202),
  slot: 2,
  world: { x: 400, y: 100, width: 200, height: 160 },
  draggable: true,
};
const ZONE_TARGET = {
  kind: "zone",
  id: uuidv7(0x203),
  slot: 3,
  world: { x: 700, y: 100, width: 260, height: 240 },
  draggable: true,
};
const TARGETS = [CARD_TARGET, BLOCK_TARGET, ZONE_TARGET];

function createHost({ targets = TARGETS } = {}) {
  const calls = {
    pan: [],
    zoom: [],
    preview: [],
    commit: [],
    revert: [],
    tap: [],
    hover: [],
    cursor: [],
    capture: [],
    release: [],
  };
  const host = {
    hitTest(screenX, screenY) {
      return (
        targets.find(
          (target) =>
            screenX >= target.world.x &&
            screenX <= target.world.x + target.world.width &&
            screenY >= target.world.y &&
            screenY <= target.world.y + target.world.height,
        ) ?? null
      );
    },
    screenToWorld(screenX, screenY) {
      // Zoom 1, pan 0: screen coordinates are world coordinates.
      return { x: screenX, y: screenY };
    },
    panByScreen(deltaX, deltaY) {
      calls.pan.push({ deltaX, deltaY });
    },
    zoomByFactor(factor, screenX, screenY) {
      calls.zoom.push({ factor, screenX, screenY });
    },
    previewDrag(target, position) {
      calls.preview.push({ target, position });
    },
    commitDrag(target, position) {
      calls.commit.push({ target, position });
    },
    revertDrag(target) {
      calls.revert.push(target);
    },
    onTap(target, screen) {
      calls.tap.push({ target, screen });
    },
    onHover(state) {
      calls.hover.push(state);
    },
    onCursor(cursor) {
      calls.cursor.push(cursor);
    },
    capturePointer(pointerId) {
      calls.capture.push(pointerId);
    },
    releasePointer(pointerId) {
      calls.release.push(pointerId);
    },
  };
  return { host, calls };
}

const inputFor = (host) => createPointerInput({ ...thresholds, host });

function pointer(pointerId, screen, extra = {}) {
  return { pointerId, pointerType: "mouse", button: 0, screen, ...extra };
}

test("the input layer enforces the token values of L03", () => {
  assert.equal(thresholds.thresholdPx, 4);
  assert.equal(thresholds.headerHeightPx, 40);
  assert.equal(thresholds.hoverTransitionMs, 120);
  const input = inputFor(createHost().host);
  assert.equal(input.thresholdPx, thresholds.thresholdPx);
  assert.equal(input.headerHeightPx, thresholds.headerHeightPx);
  assert.equal(input.hoverTransitionMs, thresholds.hoverTransitionMs);
  assert.throws(
    () => new PointerInput({ ...thresholds, thresholdPx: Number.NaN, host: createHost().host }),
    RangeError,
  );
});

test("3.9 px is a click, 4.1 px crosses the threshold", () => {
  assert.equal(crossesDragThreshold(3.9, 0, thresholds.thresholdPx), false);
  assert.equal(crossesDragThreshold(0, 3.9, thresholds.thresholdPx), false);
  assert.equal(crossesDragThreshold(4, 0, thresholds.thresholdPx), true);
  assert.equal(crossesDragThreshold(2.9, 2.9, thresholds.thresholdPx), true);
  assert.equal(crossesDragThreshold(Number.NaN, 0, thresholds.thresholdPx), false);
});

test("a release below the threshold is a click that writes nothing", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  const start = { x: 200, y: 160 };
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 3.9, y: start.y }));
  input.pointerUp(pointer(1, { x: start.x + 3.9, y: start.y }));
  assert.equal(calls.commit.length, 0, "no drag operation was committed");
  assert.equal(calls.preview.length, 0, "no drag preview moved the object");
  assert.equal(calls.tap.length, 1, "the press became one click");
  assert.equal(calls.tap[0].target, CARD_TARGET);
  assert.equal(calls.pan.length, 0, "a click does not pan");
  assert.deepEqual(calls.capture, [1]);
  assert.deepEqual(calls.release, [1]);
});

test("a drag starts once at the threshold and follows the pointer 1:1", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  const start = { x: 200, y: 160 };
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 4.1, y: start.y }));
  assert.equal(input.phase, "dragging");
  assert.equal(calls.preview.length, 1);
  assert.deepEqual(calls.preview[0].position, { x: 104.1, y: 100 });
  input.pointerMove(pointer(1, { x: start.x + 60, y: start.y + 30 }));
  input.pointerUp(pointer(1, { x: start.x + 60, y: start.y + 30 }));
  assert.equal(calls.commit.length, 1, "exactly one operation per drag");
  assert.deepEqual(calls.commit[0].position, { x: 160, y: 130 });
  assert.equal(calls.tap.length, 0);
});

test("a note card drags on its whole body, blocks and zones only on the header", () => {
  assert.equal(isGrip("card", 0, thresholds.headerHeightPx), true);
  assert.equal(isGrip("card", 119, thresholds.headerHeightPx), true);
  assert.equal(isGrip("block", 0, thresholds.headerHeightPx), true);
  assert.equal(isGrip("block", 39.9, thresholds.headerHeightPx), true);
  assert.equal(isGrip("block", 40, thresholds.headerHeightPx), true);
  assert.equal(isGrip("block", 40.1, thresholds.headerHeightPx), false);
  assert.equal(isGrip("zone", 20, thresholds.headerHeightPx), true);
  assert.equal(isGrip("zone", 41, thresholds.headerHeightPx), false);

  for (const [target, offsetY] of [
    [BLOCK_TARGET, 20],
    [ZONE_TARGET, 20],
  ]) {
    const { host, calls } = createHost();
    const input = inputFor(host);
    const start = { x: target.world.x + 20, y: target.world.y + offsetY };
    input.pointerDown(pointer(1, start));
    input.pointerMove(pointer(1, { x: start.x + 10, y: start.y + 10 }));
    input.pointerUp(pointer(1, { x: start.x + 10, y: start.y + 10 }));
    assert.equal(calls.commit.length, 1, `${target.kind} header drag commits one move`);
    assert.equal(calls.commit[0].target.kind, target.kind);
  }

  // A block body below the 40 px band moves nothing and does not pan.
  const { host, calls } = createHost();
  const input = inputFor(host);
  const start = { x: BLOCK_TARGET.world.x + 20, y: BLOCK_TARGET.world.y + 41 };
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 30, y: start.y + 30 }));
  input.pointerUp(pointer(1, { x: start.x + 30, y: start.y + 30 }));
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.preview.length, 0);
  assert.equal(calls.pan.length, 0);
  assert.equal(calls.tap.length, 0);
});

test("field, button, editable and scrollable targets are suppressed", () => {
  assert.equal(isSuppressedTarget({ tagName: "input" }), true);
  assert.equal(isSuppressedTarget({ tagName: "textarea" }), true);
  assert.equal(isSuppressedTarget({ tagName: "select" }), true);
  assert.equal(isSuppressedTarget({ tagName: "button" }), true);
  assert.equal(isSuppressedTarget({ tagName: "div", contentEditable: true }), true);
  assert.equal(isSuppressedTarget({ tagName: "div", dataField: true }), true);
  assert.equal(isSuppressedTarget({ tagName: "div", overflowY: "auto" }), true);
  assert.equal(isSuppressedTarget({ tagName: "div", overflowX: "scroll" }), true);
  assert.equal(isSuppressedTarget({ tagName: "div" }), false);
  assert.equal(cursorForSuppressed({ tagName: "input" }), "text");
  assert.equal(cursorForSuppressed({ tagName: "textarea" }), "text");
  assert.equal(cursorForSuppressed({ tagName: "div", contentEditable: true }), "text");
  assert.equal(cursorForSuppressed({ tagName: "button" }), "default");
  assert.equal(cursorForSuppressed({ tagName: "div", overflowY: "auto" }), "default");

  // A suppressed press keeps its own pointer handling and starts no gesture.
  const { host, calls } = createHost();
  const input = inputFor(host);
  const start = { x: 200, y: 160 };
  input.pointerDown(pointer(1, start, { suppressed: true }));
  input.pointerMove(pointer(1, { x: start.x + 40, y: start.y + 40 }));
  input.pointerUp(pointer(1, { x: start.x + 40, y: start.y + 40 }));
  assert.equal(input.phase, "idle");
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.preview.length, 0);
  assert.equal(calls.pan.length, 0);
  assert.equal(calls.tap.length, 0);
  assert.equal(calls.capture.length, 0, "a suppressed target is not captured");
});

test("cursors map to grab, grabbing, text and default", () => {
  assert.equal(cursorFor({}), "default");
  assert.equal(cursorFor({ grip: true }), "grab");
  assert.equal(cursorFor({ dragging: true }), "grabbing");
  assert.equal(cursorFor({ dragging: true, grip: true }), "grabbing");
  assert.equal(cursorFor({ suppressed: true, editable: true }), "text");
  assert.equal(cursorFor({ suppressed: true }), "default");

  const { host, calls } = createHost();
  const input = inputFor(host);
  input.pointerHover(pointer(1, { x: 200, y: 160 }));
  assert.equal(input.cursor, "grab");
  assert.deepEqual(calls.cursor, ["grab"]);
  input.pointerHover(pointer(1, { x: 10, y: 10 }));
  assert.equal(input.cursor, "default");
  input.pointerDown(pointer(1, { x: 200, y: 160 }));
  input.pointerMove(pointer(1, { x: 220, y: 180 }));
  assert.equal(input.cursor, "grabbing");
  assert.ok(calls.cursor.includes("grabbing"));
});

test("the header hover surface applies to block/zone headers only", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  input.pointerHover(pointer(1, { x: BLOCK_TARGET.world.x + 10, y: BLOCK_TARGET.world.y + 20 }));
  const blockHover = calls.hover.at(-1);
  assert.equal(blockHover.header, true);
  assert.equal(blockHover.grip, true);
  assert.equal(blockHover.target, BLOCK_TARGET);
  input.pointerHover(pointer(1, { x: BLOCK_TARGET.world.x + 10, y: BLOCK_TARGET.world.y + 60 }));
  assert.equal(calls.hover.at(-1).header, false);
  input.pointerHover(pointer(1, { x: 120, y: 120 }));
  assert.equal(calls.hover.at(-1).header, false, "a card body has no header band");
  input.pointerLeave();
  assert.equal(calls.hover.at(-1).target, null);
});

test("a second pointer cancels the drag and pinches instead", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  const start = { x: 200, y: 160 };
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 30, y: start.y }));
  assert.equal(calls.commit.length, 0);
  input.pointerDown({ ...pointer(2, { x: start.x + 100, y: start.y }), pointerType: "touch" });
  assert.equal(calls.revert.length, 1, "the running drag is reverted");
  assert.equal(input.phase, "pinch");
  input.pointerMove({ ...pointer(2, { x: start.x + 140, y: start.y }), pointerType: "touch" });
  assert.ok(calls.zoom.length >= 1, "the two-pointer gesture zooms the view");
  input.pointerUp(pointer(1, { x: start.x + 30, y: start.y }));
  input.pointerUp({ ...pointer(2, { x: start.x + 140, y: start.y }), pointerType: "touch" });
  assert.equal(calls.commit.length, 0, "a cancelled drag writes no operation");
});

test("a cancelled drag is reverted without an operation", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  const start = { x: 200, y: 160 };
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 30, y: start.y }));
  assert.equal(calls.preview.length, 1);
  input.pointerCancel(1);
  assert.equal(calls.revert.length, 1);
  assert.equal(calls.commit.length, 0);
  assert.equal(input.phase, "idle");
  assert.deepEqual(calls.release, [1]);

  input.cancelAll();
  assert.equal(calls.commit.length, 0);
});

test("the right button and the wheel do not drag the board", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  input.pointerDown(pointer(1, { x: 200, y: 160 }, { button: 2 }));
  input.pointerMove(pointer(1, { x: 260, y: 200 }));
  input.pointerUp(pointer(1, { x: 260, y: 200 }));
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.capture.length, 0, "a non-primary button is ignored");

  assert.equal(input.wheel(120, 0, { x: 200, y: 160 }, false), true);
  assert.equal(calls.zoom.length, 1);
  assert.ok(calls.zoom[0].factor < 1, "a positive delta zooms out");
  assert.equal(input.wheel(-120, 0, { x: 200, y: 160 }, true), false);
  assert.equal(calls.zoom.length, 1, "a scrollable chrome target keeps its own wheel");
  assert.equal(normaliseWheelDelta(1, 1), 16);
  assert.equal(normaliseWheelDelta(1, 2), 100);
  assert.equal(normaliseWheelDelta(1, 0), 1);
  assert.ok(wheelZoomFactor(-1, 0) > 1);
});

test("panning is view-only and writes no operation", () => {
  const { host, calls } = createHost();
  const input = inputFor(host);
  input.pointerDown(pointer(1, { x: 10, y: 10 }));
  input.pointerMove(pointer(1, { x: 30, y: 25 }));
  input.pointerMove(pointer(1, { x: 40, y: 30 }));
  input.pointerUp(pointer(1, { x: 40, y: 30 }));
  assert.equal(calls.pan.length, 2);
  assert.deepEqual(calls.pan[0], { deltaX: 20, deltaY: 15 });
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.preview.length, 0);
});

test("one completed drag is one move operation with its inverse through the seam", () => {
  const { host, calls } = createHost({ targets: [] });
  const port = createDocument();
  const context = createContext();
  const history = createHistory(port);
  const card = cardEntity();
  const target = {
    kind: "card",
    id: card.id,
    slot: 0,
    world: { x: card.x, y: card.y, width: card.width, height: card.height },
    draggable: true,
  };
  host.hitTest = () => target;
  host.commitDrag = (hit, position) => {
    calls.commit.push({ target: hit, position });
    const pair = buildOperation(port, context, {
      kind: "drag-single",
      objectKind: hit.kind,
      objectId: hit.id,
      position,
    });
    if (pair === null) {
      return;
    }
    applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
  };
  const before = port.snapshot();
  const input = inputFor(host);
  const start = { x: card.x + 10, y: card.y + 10 };
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 40, y: start.y + 20 }));
  input.pointerUp(pointer(1, { x: start.x + 40, y: start.y + 20 }));

  assert.equal(calls.commit.length, 1);
  assert.equal(history.undoDepth(), 1, "exactly one history entry");
  assert.equal(history.describe(), "Move card");
  const moved = port.read("card", card.id);
  assert.equal(moved.x, card.x + 40);
  assert.equal(moved.y, card.y + 20);
  history.undo();
  assert.equal(port.snapshot(), before, "the inverse restores the working copy");
  assert.equal(history.undoDepth(), 0);
});

test("a click or a cancel on the seam writes no operation and no history", () => {
  const { host } = createHost({ targets: [] });
  const port = createDocument();
  const history = createHistory(port);
  const card = cardEntity();
  const target = {
    kind: "card",
    id: card.id,
    slot: 0,
    world: { x: card.x, y: card.y, width: card.width, height: card.height },
    draggable: true,
  };
  host.hitTest = () => target;
  host.commitDrag = () => {
    throw new Error("a click or a cancel must never commit");
  };
  const before = port.snapshot();
  const input = inputFor(host);

  input.pointerDown(pointer(1, { x: card.x + 10, y: card.y + 10 }));
  input.pointerMove(pointer(1, { x: card.x + 13.9, y: card.y + 10 }));
  input.pointerUp(pointer(1, { x: card.x + 13.9, y: card.y + 10 }));
  assert.equal(port.snapshot(), before);
  assert.equal(history.undoDepth(), 0);

  input.pointerDown(pointer(2, { x: card.x + 10, y: card.y + 10 }));
  input.pointerMove(pointer(2, { x: card.x + 60, y: card.y + 10 }));
  input.pointerCancel(2);
  assert.equal(port.snapshot(), before);
  assert.equal(history.undoDepth(), 0);
});

test("the 200 % state keeps the same token rule set", () => {
  // The state machine is independent of the camera; the threshold stays screen px
  // (the caller maps screen to world), so a zoomed scene must not change L03.
  const input = inputFor(createHost().host);
  assert.equal(input.thresholdPx, 4);
  assert.equal(input.headerHeightPx, 40);
  assert.equal(input.hoverTransitionMs, 120);
});

test("a drag previews and commits the snapped position from the host", () => {
  const { host, calls } = createHost();
  const snaps = [];
  let cleared = 0;
  host.snapDrag = (target, position, free) => {
    snaps.push({ target, position, free });
    // Deterministic stand-in for the native L07 core: the 16 px grid.
    return { x: Math.round(position.x / 16) * 16, y: Math.round(position.y / 16) * 16 };
  };
  host.clearSnap = () => {
    cleared += 1;
  };
  const input = inputFor(host);
  const start = { x: 200, y: 160 };
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 30, y: start.y + 20 }));
  input.pointerUp(pointer(1, { x: start.x + 30, y: start.y + 20 }));
  assert.equal(snaps.length, 1, "one snap request per drag move");
  assert.equal(snaps[0].free, false, "the Shift state travels with the request");
  assert.equal(calls.commit.length, 1);
  // Grab offset (100, 60) at the card top-left (100, 100); the raw target is
  // (130, 120) and the stand-in core snaps both axes to 128.
  assert.deepEqual(calls.preview.at(-1).position, { x: 128, y: 128 });
  assert.deepEqual(
    calls.commit[0].position,
    calls.preview.at(-1).position,
    "the released position is exactly the snapped preview",
  );
  assert.ok(cleared >= 1, "the guides are cleared when the drag ends");
});

test("Shift asks the host for a free position and commits the pointer position", () => {
  const { host, calls } = createHost();
  const frees = [];
  host.snapDrag = (_target, position, free) => {
    frees.push(free);
    return free ? position : { x: 0, y: 0 };
  };
  const input = inputFor(host);
  const start = { x: 200, y: 160 };
  input.pointerDown(pointer(1, start));
  input.pointerMove(pointer(1, { x: start.x + 30, y: start.y + 20 }, { shiftKey: true }));
  input.pointerUp(pointer(1, { x: start.x + 30, y: start.y + 20 }, { shiftKey: true }));
  assert.deepEqual(frees, [true], "the layer passes the Shift state to the snap");
  assert.deepEqual(calls.commit[0].position, { x: 130, y: 120 });
});

test("panning and zooming never request a snap", () => {
  const { host, calls } = createHost();
  let snaps = 0;
  host.snapDrag = (_target, position) => {
    snaps += 1;
    return position;
  };
  const input = inputFor(host);
  input.pointerDown(pointer(1, { x: 10, y: 10 }));
  input.pointerMove(pointer(1, { x: 30, y: 25 }));
  input.pointerMove(pointer(1, { x: 40, y: 30 }));
  input.pointerUp(pointer(1, { x: 40, y: 30 }));
  assert.equal(snaps, 0, "no snap work runs during a pan");
  assert.equal(calls.pan.length, 2);
  assert.equal(calls.commit.length, 0);
});
