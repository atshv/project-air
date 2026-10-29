// P6-14: the engine surface for an app. The built `dist/bridge/app.js` (the
// test task depends on the build) exposes every interaction module the app wires
// (docs/engine.md "Using the engine from an app"), and fitBlockToContent grows a
// block to its bound preview through the L02 binding path.
import assert from "node:assert/strict";
import test from "node:test";

const surface = await import("../dist/bridge/app.js");

test("the app surface exports the bridge and every interaction module", () => {
  const expected = [
    "createEngine", "EngineError", // bridge (L02 binding, snapping, hit testing)
    "createPointerInput", "crossesDragThreshold", "autoPanDelta", "resizeFromPointer", "normalizeWheelIntent", // L03, L16, L14, L15
    "placeNewObject", // L20
    "applyInlineKey", "anchorToScreen", // L18 overlay
    "arrangeZone", "previewZoneRelease", "zoneSettlePolicy", // L08 parity
    "groupingDecision", "normalizeZoneTitle", "defaultZoneTitle", "planZoneGroup", // L08 lifecycle
    "keyboardIntent", "CONTEXT_MENU_ITEMS", // L12
    "storageKeyFor", "parseViewRecord", // L17
    "fitBlockToContent",
  ];
  for (const name of expected) {
    assert.notEqual(surface[name], undefined, `${name} is exported`);
  }
});

test("fitBlockToContent binds the text and never shrinks below the type minimum", () => {
  const bound = [];
  const engine = {
    bindObjectText(slot, text) { bound.push({ slot, text }); },
    requiredTextHeight() { return 211.4; },
  };
  assert.equal(surface.fitBlockToContent(engine, 3, { title: "Checklist", preview: "One\nTwo" }, 128), 212);
  assert.deepEqual(bound[0], { slot: 3, text: { title: "Checklist", preview: "One\nTwo" } });
  assert.equal(surface.fitBlockToContent(engine, 3, { title: "Checklist", preview: "" }, 128), 128, "an empty preview keeps the minimum");
  const tall = { bindObjectText() {}, requiredTextHeight() { return 90; } };
  assert.equal(surface.fitBlockToContent(tall, 1, { preview: "x" }, 128), 128, "a short preview keeps the minimum");
});
