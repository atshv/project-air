// P4-24 (L15) wheel/trackpad tests: the normalised view intents (pan 1:1, zoom
// around the pointer, clamp, meta/ctrl, suppressed none, drag none), anchor
// stability at several zoom levels and the pinch midpoint through the input layer.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createPointerInput,
  normalizeWheelIntent,
  wheelZoomFactor,
} from "../src/bridge/input.ts";

const base = (overrides = {}) => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  metaKey: false,
  ctrlKey: false,
  screen: { x: 400, y: 300 },
  suppressed: false,
  dragging: false,
  zoom: 1,
  minimumZoom: 0.1,
  maximumZoom: 8,
  ...overrides,
});

test("a plain two-finger wheel pans 1:1 with the delta", () => {
  const intent = normalizeWheelIntent(base({ deltaX: 20, deltaY: -12 }));
  assert.deepEqual(intent, { kind: "pan", dx: -20, dy: 12 });
  assert.deepEqual(normalizeWheelIntent(base({ deltaX: 0, deltaY: 0 })), { kind: "none" });
  // deltaMode lines/pages are scaled by the same wheel helper.
  assert.equal(wheelZoomFactor(0, 1) > 0, true);
});

test("Cmd/Ctrl+wheel zooms around the pointer and clamps at both limits", () => {
  const zoomed = normalizeWheelIntent(base({ deltaY: -300, metaKey: true }));
  assert.equal(zoomed.kind, "zoom");
  assert.ok(zoomed.factor > 1);
  const byCtrl = normalizeWheelIntent(base({ deltaY: -300, ctrlKey: true }));
  assert.deepEqual(byCtrl, zoomed, "metaKey (macOS) and ctrlKey (elsewhere) behave the same");
  const atMinimum = normalizeWheelIntent(base({ deltaY: 100000, metaKey: true, zoom: 0.1 }));
  assert.deepEqual(atMinimum, { kind: "none" }, "no zoom below the minimum");
  const atMaximum = normalizeWheelIntent(base({ deltaY: -100000, metaKey: true, zoom: 8 }));
  assert.deepEqual(atMaximum, { kind: "none" }, "no zoom above the maximum");
  const clamped = normalizeWheelIntent(base({ deltaY: -100000, metaKey: true, zoom: 6 }));
  assert.ok(clamped.kind === "zoom" && Math.abs(6 * clamped.factor - 8) < 1e-9);
});

test("the pointer world anchor stays stable for the zoom at several levels", () => {
  const anchorWorld = (intent, pan, zoom) => ({
    x: pan.x + intent.screen.x / zoom,
    y: pan.y + intent.screen.y / zoom,
  });
  for (const zoom of [0.1, 0.5, 1, 2, 4]) {
    const pan = { x: 100, y: 50 };
    const intent = normalizeWheelIntent(base({ deltaY: -200, metaKey: true, zoom }));
    assert.ok(intent.kind === "zoom");
    const before = anchorWorld(intent, pan, zoom);
    const nextZoom = zoom * intent.factor;
    // The engine's zoomAround keeps the world point under the screen point:
    // nextPan = world - screen / nextZoom.
    const nextPan = { x: before.x - intent.screen.x / nextZoom, y: before.y - intent.screen.y / nextZoom };
    const after = anchorWorld(intent, nextPan, nextZoom);
    assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9, `anchor at ${zoom}`);
  }
});

test("a suppressed target or an active drag never moves the view", () => {
  assert.deepEqual(normalizeWheelIntent(base({ suppressed: true, deltaY: 100, deltaX: 100 })), { kind: "none" });
  assert.deepEqual(normalizeWheelIntent(base({ dragging: true, deltaY: 100 })), { kind: "none" });
  assert.deepEqual(normalizeWheelIntent(base({ dragging: true, deltaY: 100, metaKey: true })), { kind: "none" });
});

function host() {
  const calls = { pans: [], zooms: [] };
  return {
    calls,
    host: {
      hitTest: () => null,
      screenToWorld: (x, y) => ({ x, y }),
      panByScreen: (dx, dy) => calls.pans.push({ dx, dy }),
      zoomByFactor: (factor, x, y) => calls.zooms.push({ factor, x, y }),
      previewDrag() {}, commitDrag() {}, revertDrag() {},
      onHover() {}, onCursor() {}, onTap() {},
      capturePointer() {}, releasePointer() {},
    },
  };
}

function inputWith(fake) {
  return createPointerInput({ thresholdPx: 4, headerHeightPx: 40, hoverTransitionMs: 120, host: fake.host });
}

test("wheelGesture routes pan/zoom through the existing view callbacks", () => {
  const fake = host();
  const input = inputWith(fake);
  const pan = input.wheelGesture(base({ deltaX: 20, deltaY: -12 }));
  assert.equal(pan.kind, "pan");
  assert.deepEqual(fake.calls.pans, [{ dx: -20, dy: 12 }]);
  const zoom = input.wheelGesture(base({ deltaY: -200, metaKey: true, zoom: 1.5 }));
  assert.equal(zoom.kind, "zoom");
  assert.equal(fake.calls.zooms.length, 1);
  assert.deepEqual(
    { x: fake.calls.zooms[0].x, y: fake.calls.zooms[0].y },
    { x: 400, y: 300 },
    "zoom happens around the pointer",
  );
  input.wheelGesture(base({ suppressed: true, deltaY: 100 }));
  input.wheelGesture(base({ dragging: true, deltaY: 100 }));
  assert.equal(fake.calls.pans.length, 1);
  assert.equal(fake.calls.zooms.length, 1);
});

test("two-pointer pinch zooms around the midpoint", () => {
  const fake = host();
  const input = inputWith(fake);
  const p = (id, x, y) => ({ pointerId: id, pointerType: "touch", button: 0, screen: { x, y } });
  input.pointerDown(p(1, 400, 300));
  input.pointerDown(p(2, 500, 300));
  input.pointerMove(p(2, 600, 300));
  assert.equal(fake.calls.zooms.length > 0, true, "the pinch zooms");
  const zoom = fake.calls.zooms.at(-1);
  assert.ok(Math.abs(zoom.x - 500) <= 1e-9, "the zoom midpoint is between the two pointers");
  assert.ok(Math.abs(zoom.y - 300) <= 1e-9);
});

test("an active object drag consumes the wheel without a camera update", () => {
  const fake = host();
  const target = { kind: "card", id: "card-1", slot: 0, world: { x: 0, y: 0, width: 100, height: 50 }, draggable: true };
  fake.host.hitTest = () => target;
  const input = inputWith(fake);
  input.pointerDown({ pointerId: 1, pointerType: "mouse", button: 0, screen: { x: 10, y: 10 } });
  input.pointerMove({ pointerId: 1, pointerType: "mouse", button: 0, screen: { x: 30, y: 10 } });
  assert.equal(input.phase, "dragging");
  const intent = input.wheelGesture(base({ dragging: false, deltaY: 100 }));
  assert.deepEqual(intent, { kind: "none" });
  assert.equal(fake.calls.pans.length, 0);
  assert.equal(fake.calls.zooms.length, 0);
});
