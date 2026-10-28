// P4-18 (L16) auto-pan tests: the pure time-based edge-band policy and the
// request-animation-frame loop integration (single drag, group drag lifecycle,
// no leaked frame, no operation on cancel, exactly one on release).

import assert from "node:assert/strict";
import test from "node:test";

import {
  autoPanDelta,
  AUTO_PAN_BAND_PX,
  AUTO_PAN_MAX_DELTA_PX,
  AUTO_PAN_MAX_SPEED_PX_PER_S,
  createPointerInput,
} from "../src/bridge/input.ts";

const viewport = { width: 400, height: 300 };
const policy = (pointer, overrides = {}) =>
  autoPanDelta({ pointer, viewport, active: true, deltaSeconds: 0.016, ...overrides });

test("the 48 px band from tokens::space_48 only pans inside the band", () => {
  assert.equal(AUTO_PAN_BAND_PX, 48);
  assert.deepEqual(policy({ x: 200, y: 150 }), { x: 0, y: 0 });
  assert.deepEqual(policy({ x: viewport.width - AUTO_PAN_BAND_PX, y: 150 }), { x: 0, y: 0 });
  assert.deepEqual(policy({ x: viewport.width - AUTO_PAN_BAND_PX - 1, y: 150 }), { x: 0, y: 0 });
  assert.ok(policy({ x: viewport.width - AUTO_PAN_BAND_PX + 1, y: 150 }).x > 0);
});

test("the speed ramps monotonically from 0 at the inner edge to a bounded maximum", () => {
  const samples = [0, 4, 12, 24, 36, 47, 48, 60].map((offset) => policy({ x: viewport.width - AUTO_PAN_BAND_PX + offset, y: 150 }).x);
  assert.equal(samples[0], 0, "the inner band edge has no jump");
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] >= samples[index - 1], `ramp is monotonic at ${index}`);
  }
  const atEdge = policy({ x: viewport.width, y: 150 }).x;
  const beyond = policy({ x: viewport.width + 200, y: 150 }).x;
  assert.ok(atEdge > 0 && atEdge <= AUTO_PAN_MAX_SPEED_PX_PER_S * 0.016);
  assert.equal(beyond, atEdge, "the speed stays at the bounded maximum beyond the edge");
  assert.ok(beyond <= AUTO_PAN_MAX_DELTA_PX, "the per-frame delta is clamped");
  assert.equal(policy({ x: viewport.width + 200, y: 150 }, { deltaSeconds: 0.1 }).x, AUTO_PAN_MAX_DELTA_PX);
});

test("the direction follows the pointer on every edge and corner", () => {
  assert.ok(policy({ x: 10, y: 150 }).x < 0);
  assert.ok(policy({ x: viewport.width - 10, y: 150 }).x > 0);
  assert.ok(policy({ x: 200, y: 10 }).y < 0);
  assert.ok(policy({ x: 200, y: viewport.height - 10 }).y > 0);
  const corner = policy({ x: viewport.width - 10, y: viewport.height - 10 });
  assert.ok(corner.x > 0 && corner.y > 0);
  assert.ok(policy({ x: 10, y: 10 }).x < 0 && policy({ x: 10, y: 10 }).y < 0);
});

test("no drag or no time delta produces no pan", () => {
  assert.deepEqual(policy({ x: viewport.width, y: viewport.height }, { active: false }), { x: 0, y: 0 });
  assert.deepEqual(policy({ x: viewport.width, y: viewport.height }, { deltaSeconds: 0 }), { x: 0, y: 0 });
  assert.deepEqual(policy({ x: viewport.width, y: viewport.height }, { deltaSeconds: -1 }), { x: 0, y: 0 });
});

test("the time-based ramp is deterministic and scales with the delta", () => {
  const pointer = { x: viewport.width, y: 150 };
  const once = policy(pointer, { deltaSeconds: 0.01 });
  const twice = policy(pointer, { deltaSeconds: 0.02 });
  assert.deepEqual(policy(pointer, { deltaSeconds: 0.01 }), once);
  assert.ok(Math.abs(twice.x - Math.min(AUTO_PAN_MAX_DELTA_PX, once.x * 2)) < 1e-9);
});

// -- integration: fake camera/clock and animation-frame loop ------------------

function fakeScheduler() {
  let nextId = 1;
  const pending = new Map();
  return {
    request(callback) {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    tick(timestamp) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(timestamp);
    },
    get pending() {
      return pending.size;
    },
  };
}

const TARGET = { kind: "card", id: "card-1", slot: 0, world: { x: 100, y: 100, width: 100, height: 50 }, draggable: true };
const pointer = (screen, shiftKey = false) => ({ pointerId: 1, pointerType: "mouse", button: 0, screen, shiftKey });

function dragHost() {
  const pan = { x: 0, y: 0 };
  const calls = { pans: [], previews: [], commits: [], reverts: [], selected: false };
  const host = {
    hitTest: () => TARGET,
    screenToWorld: (x, y) => ({ x: x + pan.x, y: y + pan.y }),
    worldToScreen: (world) => ({ x: world.x - pan.x, y: world.y - pan.y }),
    panByScreen: (dx, dy) => {
      pan.x += dx;
      pan.y += dy;
      calls.pans.push({ x: pan.x, y: pan.y });
    },
    zoomByFactor() {},
    previewDrag: (target, position) => calls.previews.push({ x: position.x, y: position.y }),
    commitDrag: (target, position) => calls.commits.push({ x: position.x, y: position.y }),
    revertDrag: () => calls.reverts.push(true),
    selectionTargets: () => (calls.selected ? [TARGET] : []),
    targetsInRect: () => [],
    previewGroupDrag: () => {},
    commitGroupDrag: () => {},
    revertGroupDrag: () => {},
    snapDrag: (target, position) => position,
    onDragMove() {},
    onSelectionChange: (targets) => { calls.selected = targets.length > 0; },
    onTap() {},
    onHover() {},
    onCursor() {},
    capturePointer() {},
    releasePointer() {},
    viewportSize: () => ({ width: viewport.width, height: viewport.height }),
  };
  return { host, pan, calls };
}

function startEdgeDrag({ shift = false } = {}) {
  const scheduler = fakeScheduler();
  const { host, pan, calls } = dragHost();
  const input = createPointerInput({ thresholdPx: 4, headerHeightPx: 40, hoverTransitionMs: 120, host, scheduler });
  input.pointerDown(pointer({ x: 150, y: 125 }));
  input.pointerMove(pointer({ x: 160, y: 125 }));
  assert.equal(input.phase, "dragging");
  assert.equal(scheduler.pending, 1, "exactly one animation frame is requested");
  // Move the pointer into the right edge band without further input events.
  input.pointerMove(pointer({ x: viewport.width - 10, y: 125 }, shift));
  return { input, scheduler, host, pan, calls };
}

test("while a drag runs, the camera pans and the preview follows the pointer", () => {
  const { input, scheduler, pan, calls } = startEdgeDrag();
  scheduler.tick(1000); // first frame only records the timestamp (no jump)
  assert.deepEqual(calls.pans, []);
  scheduler.tick(1016); // 16 ms later: the ramp pans the camera
  assert.equal(calls.pans.length, 1);
  assert.ok(pan.x > 0);
  const lastPreview = calls.previews.at(-1);
  assert.ok(Math.abs(lastPreview.x - (TARGET.world.x + 0)) > 0, "the preview moved with the camera");
  // Grabbed point stays under the pointer: object position + grab offset - pan == pointer.
  const grabOffsetX = 150 - TARGET.world.x;
  const grabbedWorld = lastPreview.x + grabOffsetX;
  assert.ok(Math.abs(grabbedWorld - (viewport.width - 10 + pan.x)) < 1e-6);
  assert.equal(scheduler.pending, 1);
  input.pointerUp(pointer({ x: viewport.width - 10, y: 125 }));
  assert.equal(scheduler.pending, 0, "the loop stops on release (no leaked frame)");
  assert.equal(calls.commits.length, 1, "exactly one move operation is committed");
  assert.equal(calls.reverts.length, 0);
  assert.ok(calls.commits[0].x > TARGET.world.x, "the committed position is the pointer-derived one");
});

test("a cancelled drag stops the loop, reverts and writes no operation", () => {
  const { input, scheduler, calls } = startEdgeDrag();
  scheduler.tick(1000);
  scheduler.tick(1016);
  assert.ok(calls.pans.length === 1);
  input.pointerCancel(1);
  assert.equal(scheduler.pending, 0);
  assert.equal(calls.reverts.length, 1);
  assert.equal(calls.commits.length, 0);
});

test("no loop starts without a drag or outside the band", () => {
  const scheduler = fakeScheduler();
  const { host, calls } = dragHost();
  const input = createPointerInput({ thresholdPx: 4, headerHeightPx: 40, hoverTransitionMs: 120, host, scheduler });
  input.pointerDown(pointer({ x: 200, y: 150 }));
  input.pointerMove(pointer({ x: 202, y: 150 }));
  assert.equal(scheduler.pending, 0, "a click below the threshold starts no loop");
  input.pointerUp(pointer({ x: 202, y: 150 }));
  assert.equal(scheduler.pending, 0);
  assert.equal(calls.commits.length, 0);
});
