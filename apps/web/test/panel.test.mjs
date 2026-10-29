// P6-07 (L04): panel layout, state machine and the transient camera pan.

import assert from "node:assert/strict";
import test from "node:test";

import {
  PANEL_GAP,
  PANEL_MOTION_MS,
  PANEL_PAN_CLEARANCE,
  PANEL_PAN_MS,
  PANEL_WIDTH,
  panelCameraForCard,
  panelIsVisible,
  panelLeftFor,
  panelPanDuration,
  panelPhaseAfter,
  panelWidthFor,
} from "../src/board/panel.ts";

test("the panel is 400 px with a 12 px gap and full width at a 390 px viewport", () => {
  assert.equal(PANEL_WIDTH, 400);
  assert.equal(PANEL_GAP, 12);
  assert.equal(panelWidthFor(1440), 400);
  assert.equal(panelLeftFor(1440), 1440 - PANEL_GAP - PANEL_WIDTH);
  assert.equal(panelWidthFor(390), 390);
  assert.equal(panelLeftFor(390), 0);
  assert.equal(panelWidthFor(Number.NaN), PANEL_WIDTH);
});

test("the L04 state machine has closed/opening/open/closing transitions", () => {
  assert.equal(PANEL_MOTION_MS, 180);
  assert.equal(panelPhaseAfter("closed", "open"), "opening");
  assert.equal(panelPhaseAfter("closed", "close"), "closed");
  assert.equal(panelPhaseAfter("opening", "opened"), "open");
  assert.equal(panelPhaseAfter("opening", "close"), "closing");
  assert.equal(panelPhaseAfter("open", "close"), "closing");
  assert.equal(panelPhaseAfter("open", "open"), "open");
  assert.equal(panelPhaseAfter("closing", "closed"), "closed");
  assert.equal(panelPhaseAfter("closing", "open"), "opening");
  assert.equal(panelIsVisible("closed"), false);
  assert.equal(panelIsVisible("opening"), true);
  assert.equal(panelIsVisible("open"), true);
  assert.equal(panelIsVisible("closing"), true);
});

test("a card that is already clear of the panel never moves the view", () => {
  const camera = { panX: 0, panY: 0, zoom: 1 };
  assert.equal(panelCameraForCard({ camera, card: { x: 100, y: 100, width: 176, height: 80 }, viewportWidth: 1440 }), null);
  assert.equal(panelCameraForCard({ camera: { panX: 0, panY: 0, zoom: 0 }, card: { x: 900, y: 0, width: 176, height: 80 }, viewportWidth: 1440 }), null);
});

test("a card under the panel is panned 24 px left of it in one transient camera", () => {
  assert.equal(PANEL_PAN_CLEARANCE, 24);
  const camera = { panX: 0, panY: 12, zoom: 1 };
  const target = panelCameraForCard({ camera, card: { x: 900, y: 100, width: 176, height: 80 }, viewportWidth: 1440 });
  assert.notEqual(target, null);
  assert.equal(target.panY, camera.panY);
  assert.equal(target.zoom, camera.zoom);
  const left = (900 - target.panX) * target.zoom;
  const right = left + 176 * target.zoom;
  assert.equal(right, panelLeftFor(1440) - PANEL_PAN_CLEARANCE);
});

test("the pan respects zoom and never applies to the full-width mobile panel", () => {
  const target = panelCameraForCard({ camera: { panX: 0, panY: 0, zoom: 2 }, card: { x: 500, y: 0, width: 100, height: 80 }, viewportWidth: 1440 });
  assert.notEqual(target, null);
  assert.equal((500 - target.panX) * 2 + 100 * 2, panelLeftFor(1440) - PANEL_PAN_CLEARANCE);
  assert.equal(panelCameraForCard({ camera: { panX: 0, panY: 0, zoom: 1 }, card: { x: 100, y: 0, width: 176, height: 80 }, viewportWidth: 390 }), null);
});

test("the panel pan is 300 ms and respects reduced motion", () => {
  assert.equal(PANEL_PAN_MS, 300);
  assert.equal(panelPanDuration(false), 300);
  assert.equal(panelPanDuration(true), 0);
});
