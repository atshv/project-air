// P6-04 (L17): camera/view helpers on top of the engine view-persistence bridge.
export { MINIMUM_VIEW_ZOOM, MAXIMUM_VIEW_ZOOM, VIEW_STORAGE_PREFIX, deviceKeyFor, parseViewRecord, storageKeyFor } from "../../../../packages/engine/src/bridge/view-persistence.ts";
import { MAXIMUM_VIEW_ZOOM, MINIMUM_VIEW_ZOOM } from "../../../../packages/engine/src/bridge/view-persistence.ts";
import type { EngineCamera } from "../../../../packages/engine/src/bridge/engine.ts";

export const DEFAULT_CAMERA: EngineCamera = { panX: 0, panY: 0, zoom: 1 };
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CAMERA.zoom;
  return Math.min(MAXIMUM_VIEW_ZOOM, Math.max(MINIMUM_VIEW_ZOOM, zoom));
}
export function clampCamera(camera: EngineCamera): EngineCamera {
  return { panX: Number.isFinite(camera.panX) ? camera.panX : 0, panY: Number.isFinite(camera.panY) ? camera.panY : 0, zoom: clampZoom(camera.zoom) };
}
export function zoomBy(camera: EngineCamera, factor: number): EngineCamera {
  return clampCamera({ ...camera, zoom: camera.zoom * factor });
}
export function restoreCamera(raw: string | null, expected: { boardId: string; deviceKey: string }): EngineCamera | null {
  return parseViewRecordLoose(raw, expected);
}
function parseViewRecordLoose(raw: string | null, expected: { boardId: string; deviceKey: string }): EngineCamera | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const record = parsed as { boardId?: unknown; deviceKey?: unknown; panX?: unknown; panY?: unknown; zoom?: unknown };
    if (record.boardId !== expected.boardId || record.deviceKey !== expected.deviceKey) return null;
    if (typeof record.panX !== "number" || typeof record.panY !== "number" || typeof record.zoom !== "number") return null;
    return clampCamera({ panX: record.panX, panY: record.panY, zoom: record.zoom });
  } catch { return null; }
}
export function backendChoice(requested: "webgl2" | "auto" | "webgpu", webgpuAdapter: boolean): "webgl2" | "webgpu" {
  if (requested === "webgl2") return "webgl2";
  if (requested === "webgpu") return webgpuAdapter ? "webgpu" : "webgl2";
  return webgpuAdapter ? "webgpu" : "webgl2";
}
