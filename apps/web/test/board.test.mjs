import assert from "node:assert/strict";
import test from "node:test";

import { activeToolOrDefault, primaryTool, TOOLS, toolGroups } from "../src/board/toolbar.ts";
import { backendChoice, clampCamera, clampZoom, DEFAULT_CAMERA, restoreCamera, zoomBy } from "../src/board/view.ts";

test("toolbar has groups, one primary accent tool and a default active tool", () => {
  assert.equal(toolGroups().length, 3);
  assert.equal(primaryTool()?.id, "note");
  assert.equal(TOOLS.filter((tool) => tool.primary).length, 1);
  assert.equal(activeToolOrDefault(null), "select");
  assert.equal(activeToolOrDefault("pan"), "pan");
});

test("view camera clamps zoom and rejects foreign/corrupt records", () => {
  assert.equal(clampZoom(0), 0.1);
  assert.equal(clampZoom(100), 8);
  assert.equal(clampZoom(Number.NaN), DEFAULT_CAMERA.zoom);
  assert.deepEqual(clampCamera({ panX: 1, panY: 2, zoom: 99 }), { panX: 1, panY: 2, zoom: 8 });
  assert.equal(zoomBy(DEFAULT_CAMERA, 2).zoom, 2);
  assert.equal(restoreCamera("not json", { boardId: "b", deviceKey: "d" }), null);
  assert.equal(restoreCamera(JSON.stringify({ boardId: "other", deviceKey: "d", panX: 0, panY: 0, zoom: 1 }), { boardId: "b", deviceKey: "d" }), null);
  assert.deepEqual(restoreCamera(JSON.stringify({ boardId: "b", deviceKey: "d", panX: 3, panY: 4, zoom: 0 }), { boardId: "b", deviceKey: "d" }), { panX: 3, panY: 4, zoom: 0.1 });
});

test("backend selection defaults to WebGL2 and fails closed without an adapter", () => {
  assert.equal(backendChoice("webgl2", true), "webgl2");
  assert.equal(backendChoice("auto", false), "webgl2");
  assert.equal(backendChoice("webgpu", false), "webgl2");
  assert.equal(backendChoice("auto", true), "webgpu");
});
