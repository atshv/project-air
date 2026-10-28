// L18 (P4-23) overlay and inline-comfort tests.
//
// The pure halves of the overlay seam are tested without a browser: the anchor
// math through the camera (pan/zoom/DPR), the viewport visibility rule, the focus
// wrap rule, the Enter/Tab/Shift+Tab/Backspace intents (including that the policy
// writes nothing), the 24 px colour field and the field pointer routing. The DOM
// host itself is exercised by the playground capture under reviews/evidence/.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  anchorToScreen,
  applyInlineKey,
  bindFieldPointerRouting,
  COLOUR_FIELD_PX,
  colourFieldStyle,
  nextFocusIndex,
  rectIntersectsViewport,
} from "../src/bridge/overlay.ts";

const tokens = JSON.parse(
  readFileSync(new URL("../../ui-kit/tokens.json", import.meta.url), "utf8"),
);
const viewport = { width: 1000, height: 600 };
const world = { x: 100, y: 50, width: 200, height: 80 };

test("anchor math maps world to CSS px through the camera", () => {
  assert.deepEqual(anchorToScreen(world, { panX: 0, panY: 0, zoom: 1 }, viewport), {
    x: 100,
    y: 50,
    width: 200,
    height: 80,
    visible: true,
  });
  assert.deepEqual(anchorToScreen(world, { panX: 100, panY: 50, zoom: 1 }, viewport), {
    x: 0,
    y: 0,
    width: 200,
    height: 80,
    visible: true,
  });
  assert.deepEqual(anchorToScreen(world, { panX: 0, panY: 0, zoom: 2 }, viewport), {
    x: 200,
    y: 100,
    width: 400,
    height: 160,
    visible: true,
  });
  assert.deepEqual(anchorToScreen(world, { panX: 50, panY: 25, zoom: 0.5 }, viewport), {
    x: 25,
    y: 12.5,
    width: 100,
    height: 40,
    visible: true,
  });
});

test("the anchor is independent of the device pixel ratio", () => {
  const camera = { panX: 12, panY: 7, zoom: 1.5 };
  const atOne = anchorToScreen(world, camera, viewport, 1);
  const atTwo = anchorToScreen(world, camera, viewport, 2);
  const atThree = anchorToScreen(world, camera, viewport, 3);
  assert.deepEqual(atTwo, atOne, "the DOM layer stays in CSS px at DPR 2");
  assert.deepEqual(atThree, atOne, "the DOM layer stays in CSS px at DPR 3");
});

test("a field hides when its object leaves the viewport", () => {
  const camera = { panX: 0, panY: 0, zoom: 1 };
  assert.equal(anchorToScreen(world, camera, viewport).visible, true);
  // Fully left of the viewport.
  assert.equal(
    anchorToScreen({ x: -300, y: 50, width: 200, height: 80 }, camera, viewport).visible,
    false,
  );
  // Fully above the viewport.
  assert.equal(
    anchorToScreen({ x: 100, y: -200, width: 200, height: 80 }, camera, viewport).visible,
    false,
  );
  // Fully right of / below the viewport.
  assert.equal(
    anchorToScreen({ x: 1200, y: 50, width: 200, height: 80 }, camera, viewport).visible,
    false,
  );
  assert.equal(
    anchorToScreen({ x: 100, y: 700, width: 200, height: 80 }, camera, viewport).visible,
    false,
  );
  // Partly visible stays visible.
  assert.equal(
    anchorToScreen({ x: 950, y: 550, width: 200, height: 80 }, camera, viewport).visible,
    true,
  );
  assert.equal(
    rectIntersectsViewport({ x: 0, y: 0, width: 0, height: 10 }, viewport),
    false,
    "a zero-size field never counts as visible",
  );
});

test("a stale camera or viewport returns a hidden rectangle instead of throwing", () => {
  for (const camera of [
    { panX: Number.NaN, panY: 0, zoom: 1 },
    { panX: 0, panY: 0, zoom: 0 },
    { panX: 0, panY: 0, zoom: Number.POSITIVE_INFINITY },
  ]) {
    assert.deepEqual(anchorToScreen(world, camera, viewport), {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      visible: false,
    });
  }
  assert.equal(anchorToScreen(world, { panX: 0, panY: 0, zoom: 1 }, { width: 0, height: 600 }).visible, false);
  assert.equal(
    anchorToScreen(world, { panX: 0, panY: 0, zoom: 1 }, viewport, 0).visible,
    false,
    "a non-positive DPR is not a usable anchor state",
  );
});

test("focus order wraps at both ends", () => {
  assert.equal(nextFocusIndex(3, 0, 1), 1);
  assert.equal(nextFocusIndex(3, 2, 1), 0, "Tab after the last field wraps to the first");
  assert.equal(nextFocusIndex(3, 0, -1), 2, "Shift+Tab before the first wraps to the last");
  assert.equal(nextFocusIndex(3, 1, -1), 0);
  assert.equal(nextFocusIndex(1, 0, 1), 0, "one field focuses itself");
  assert.equal(nextFocusIndex(0, 0, 1), -1, "no field");
  assert.equal(nextFocusIndex(3, -1, 1), 0, "an invalid current index clamps forward");
  assert.equal(nextFocusIndex(3, 9, -1), 2, "an invalid current index clamps backward");
});

const FIELDS = [
  { id: "a", empty: false },
  { id: "b", empty: false },
  { id: "c", empty: false },
];

test("Enter inserts a new entry directly below the focused one", () => {
  assert.deepEqual(applyInlineKey(FIELDS, 0, { key: "Enter" }), {
    kind: "insert",
    afterIndex: 0,
    focusIndex: 1,
  });
  assert.deepEqual(applyInlineKey(FIELDS, 2, { key: "Enter" }), {
    kind: "insert",
    afterIndex: 2,
    focusIndex: 3,
  });
});

test("Tab and Shift+Tab move focus with the wrap rule", () => {
  assert.deepEqual(applyInlineKey(FIELDS, 0, { key: "Tab" }), { kind: "focus", index: 1 });
  assert.deepEqual(applyInlineKey(FIELDS, 2, { key: "Tab" }), { kind: "focus", index: 0 });
  assert.deepEqual(applyInlineKey(FIELDS, 0, { key: "Tab", shiftKey: true }), {
    kind: "focus",
    index: 2,
  });
  assert.deepEqual(applyInlineKey(FIELDS, 1, { key: "Tab", shiftKey: true }), {
    kind: "focus",
    index: 0,
  });
});

test("Backspace removes only an empty entry and focuses the previous", () => {
  const emptyMiddle = [
    { id: "a", empty: false },
    { id: "b", empty: true },
    { id: "c", empty: false },
  ];
  assert.deepEqual(applyInlineKey(emptyMiddle, 1, { key: "Backspace" }), {
    kind: "remove",
    index: 1,
    focusIndex: 0,
  });
  const emptyFirst = [
    { id: "a", empty: true },
    { id: "b", empty: false },
  ];
  assert.deepEqual(applyInlineKey(emptyFirst, 0, { key: "Backspace" }), {
    kind: "remove",
    index: 0,
    focusIndex: 0,
  });
  const emptyLast = [
    { id: "a", empty: false },
    { id: "b", empty: true },
  ];
  assert.deepEqual(applyInlineKey(emptyLast, 1, { key: "Backspace" }), {
    kind: "remove",
    index: 1,
    focusIndex: 0,
  });
  assert.deepEqual(applyInlineKey([{ id: "only", empty: true }], 0, { key: "Backspace" }), {
    kind: "remove",
    index: 0,
    focusIndex: null,
  });
  // A non-empty entry keeps the key: the field handles the deletion of characters.
  assert.deepEqual(applyInlineKey(FIELDS, 1, { key: "Backspace" }), { kind: "none" });
});

test("every other key stays in the field, and an invalid index emits nothing", () => {
  for (const key of ["a", "ArrowLeft", "Delete", "Escape", "Shift", " "]) {
    assert.deepEqual(applyInlineKey(FIELDS, 1, { key }), { kind: "none" });
  }
  assert.deepEqual(applyInlineKey(FIELDS, -1, { key: "Enter" }), { kind: "none" });
  assert.deepEqual(applyInlineKey(FIELDS, 3, { key: "Tab" }), { kind: "none" });
  assert.deepEqual(applyInlineKey([], 0, { key: "Backspace" }), { kind: "none" });
});

test("the inline policy writes nothing", () => {
  const fields = Object.freeze([
    Object.freeze({ id: "a", empty: false }),
    Object.freeze({ id: "b", empty: true }),
    Object.freeze({ id: "c", empty: false }),
  ]);
  const before = JSON.stringify(fields);
  for (const key of ["Enter", "Tab", "Backspace", "x"]) {
    const intent = applyInlineKey(fields, 1, { key });
    assert.equal(JSON.stringify(fields), before, "the field list is never mutated");
    assert.equal("content" in intent, false, "the intent carries no content");
    assert.equal("storage" in intent, false, "the intent never touches storage");
  }
});

test("the colour field is the 24 px token value", () => {
  assert.equal(COLOUR_FIELD_PX, 24);
  assert.equal(COLOUR_FIELD_PX, Number.parseFloat(tokens.spacing["space-24"]));
  assert.deepEqual(colourFieldStyle(), { width: "24px", height: "24px" });
  assert.deepEqual(colourFieldStyle(16), { width: "16px", height: "16px" });
  assert.throws(() => colourFieldStyle(0), RangeError);
});

test("the playground colour field uses the token, not a raw 24 px value", () => {
  const css = readFileSync(
    new URL("../../../apps/engine-playground/playground.css", import.meta.url),
    "utf8",
  );
  const colourRule = css.match(/\.inline-colour\s*\{[^}]*\}/s);
  assert.ok(colourRule, "the playground has an .inline-colour rule");
  assert.match(colourRule[0], /width:\s*var\(--space-24\)/, "width uses the token");
  assert.match(colourRule[0], /height:\s*var\(--space-24\)/, "height uses the token");
});

test("field pointer events stop at the field and never prevent the wheel default", () => {
  const listeners = new Map();
  const element = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  bindFieldPointerRouting(element);
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "wheel"]) {
    assert.equal(typeof listeners.get(type), "function", `${type} is stopped at the field`);
  }
  for (const type of ["pointerdown", "mousedown", "click"]) {
    let stopped = 0;
    let prevented = 0;
    listeners.get(type)({
      stopPropagation: () => {
        stopped += 1;
      },
      preventDefault: () => {
        prevented += 1;
      },
    });
    assert.equal(stopped, 1, `${type} never reaches the canvas drag layer`);
    assert.equal(prevented, 0, `${type} keeps its native default`);
  }
  let stopped = 0;
  let prevented = 0;
  listeners.get("wheel")({
    stopPropagation: () => {
      stopped += 1;
    },
    preventDefault: () => {
      prevented += 1;
    },
  });
  assert.equal(stopped, 1, "the wheel never zooms the canvas from a field");
  assert.equal(prevented, 0, "a scrollable field keeps its own scrolling");
});
