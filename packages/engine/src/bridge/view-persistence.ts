// P4-22 (L17): camera-view persistence for the playground.
//
// A versioned record per board and device: {version, boardId, deviceKey, panX,
// panY, zoom}. All storage access is guarded (localStorage itself can throw on
// property access in privacy mode, and getItem/setItem can throw on quota or
// permissions); a corrupt, foreign or unknown-version record is ignored and the
// caller falls back to the L19 fit. Nothing is written by a restore; writes only
// happen on user camera actions and are debounced by the caller.

import type { EngineCamera } from "./engine.ts";

export const VIEW_RECORD_VERSION = 1;
export const VIEW_STORAGE_PREFIX = "project-air:view";
export const MINIMUM_VIEW_ZOOM = 0.1;
export const MAXIMUM_VIEW_ZOOM = 8;

export interface ViewRecord {
  readonly version: number;
  readonly boardId: string;
  readonly deviceKey: string;
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

/** The minimal storage surface; null/undefined means storage is unavailable. */
export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Coarse device fingerprint: viewport class (100 CSS px) + DPR. */
export function deviceKeyFor(width: number, height: number, dpr: number): string {
  const classWidth = Math.max(100, Math.round(width / 100) * 100);
  const classHeight = Math.max(100, Math.round(height / 100) * 100);
  const ratio = Number.isFinite(dpr) && dpr > 0 ? Math.round(dpr * 100) / 100 : 1;
  return `${classWidth}x${classHeight}@${ratio}`;
}

export function storageKeyFor(boardId: string, deviceKey: string): string {
  return `${VIEW_STORAGE_PREFIX}:v${VIEW_RECORD_VERSION}:${boardId}:${deviceKey}`;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validates one record against the current board/device and clamps the zoom. */
export function parseViewRecord(
  raw: string | null,
  expected: { readonly boardId: string; readonly deviceKey: string },
): EngineCamera | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Partial<ViewRecord>;
  if (record.version !== VIEW_RECORD_VERSION) {
    return null;
  }
  if (record.boardId !== expected.boardId || record.deviceKey !== expected.deviceKey) {
    return null;
  }
  if (!finiteNumber(record.panX) || !finiteNumber(record.panY) || !finiteNumber(record.zoom)) {
    return null;
  }
  return {
    panX: record.panX,
    panY: record.panY,
    zoom: Math.min(MAXIMUM_VIEW_ZOOM, Math.max(MINIMUM_VIEW_ZOOM, record.zoom)),
  };
}

/** Reads a valid camera for this board/device, or null (guarded storage access). */
export function loadView(
  storage: ViewStorage | null | undefined,
  identity: { readonly boardId: string; readonly deviceKey: string },
): EngineCamera | null {
  if (storage === null || storage === undefined) {
    return null;
  }
  try {
    return parseViewRecord(storage.getItem(storageKeyFor(identity.boardId, identity.deviceKey)), identity);
  } catch {
    return null;
  }
}

/** Writes one validated camera; returns false when storage is unavailable/throwing. */
export function saveView(
  storage: ViewStorage | null | undefined,
  identity: { readonly boardId: string; readonly deviceKey: string },
  camera: EngineCamera,
): boolean {
  if (storage === null || storage === undefined) {
    return false;
  }
  if (!finiteNumber(camera.panX) || !finiteNumber(camera.panY) || !finiteNumber(camera.zoom)) {
    return false;
  }
  const record: ViewRecord = {
    version: VIEW_RECORD_VERSION,
    boardId: identity.boardId,
    deviceKey: identity.deviceKey,
    panX: camera.panX,
    panY: camera.panY,
    zoom: Math.min(MAXIMUM_VIEW_ZOOM, Math.max(MINIMUM_VIEW_ZOOM, camera.zoom)),
  };
  try {
    storage.setItem(storageKeyFor(identity.boardId, identity.deviceKey), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Guarded access to the browser storage (property access itself may throw). */
export function safeBrowserStorage(): ViewStorage | null {
  try {
    const storage = globalThis.localStorage;
    if (storage === null || storage === undefined) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}
