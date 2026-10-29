// P6-09 (L05, realtime): pure helpers for the board's realtime UI.
//
// The board page owns no protocol logic of its own: the SDK `BoardSyncClient`
// speaks contract 0.4.0 (hello/welcome/snapshot/catch-up, reconnect, presence
// throttling, autosave events). This module only maps SDK state to view state
// and places remote cursors/selection outlines in screen space, so it can be
// tested with `node --test` without a DOM, canvas or network.

import type { BoardSyncStatus, AutosaveStatus } from "../../../../packages/sdk/src/index.ts";
import type { BoardContent } from "../../../../packages/contracts/generated/types.ts";
import type { EngineCamera } from "../../../../packages/engine/src/bridge/engine.ts";

/** Same-origin sync endpoint; the session cookie travels with the upgrade. */
export const SYNC_PATH = "/v1/sync";

/**
 * Opaque token reference sent in `hello` by the browser. It is not a token: the
 * sync service authenticates the WebSocket by the same-origin session cookie
 * from the upgrade; the reference only satisfies the contract's required field.
 */
export const BROWSER_SESSION_TOKEN_REF = "browser-session";

/** Matches the token contract tokenRef pattern (`^[A-Za-z0-9._:-]{8,128}$`). */
export const TOKEN_REF_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** `--motion-saved`: "Saved" stays visible for 2 s after the server confirmation. */
export const SAVED_VISIBLE_MS = 2_000;

/** Design rules §12: a remote cursor fades to opacity 0.4 after 5 s without movement. */
export const REMOTE_CURSOR_FADE_MS = 5_000;
export const REMOTE_CURSOR_FADED_OPACITY = 0.4;

/** Person colours come from `--tone-a` … `--tone-e`; anything else uses a token fallback. */
export const PRESENCE_TONES = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"] as const;
export const PRESENCE_TONE_FALLBACK = "tone-c";

/** A cursor this many CSS px outside the viewport is clipped (not rendered). */
export const CURSOR_CLIP_MARGIN = 32;

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export type ConnectionPhase = "connecting" | "joined" | "offline" | "error";

/** Maps the SDK status (plus a terminal session rejection) to the four shown states. */
export function connectionPhase(status: BoardSyncStatus, sessionExpired = false): ConnectionPhase {
  if (sessionExpired) return "error";
  switch (status) {
    case "joined": return "joined";
    case "offline":
    case "closed": return "offline";
    case "idle":
    case "connecting":
    default: return "connecting";
  }
}

export function connectionMessageKey(phase: ConnectionPhase): string {
  return `board.sync.${phase}`;
}

/**
 * A sync reject with `AUTH_REQUIRED` is terminal: the session is gone, so the
 * board shows the L05 error with retry/login instead of reconnecting in a loop.
 */
export function isSessionExpired(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "AUTH_REQUIRED";
}

/** Same-origin WebSocket URL (`wss:` behind https), never an absolute service host. */
export function syncUrl(location: { readonly protocol: string; readonly host: string }): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}${SYNC_PATH}`;
}

/** CSS value of one presence colour reference; only palette tokens are accepted. */
export function presenceColor(colorRef: string): string {
  const tone = PRESENCE_TONES.find((candidate) => candidate === colorRef) ?? PRESENCE_TONE_FALLBACK;
  return `var(--${tone})`;
}

/**
 * Label of a remote participant from the server-derived `nameRef` (`user:<id>`).
 * A display name is not on the wire (the contract carries a reference only), so
 * the label is a short deterministic id fragment instead of invented text.
 */
export function presenceLabel(nameRef: string): string {
  const id = nameRef.startsWith("user:") ? nameRef.slice("user:".length) : nameRef;
  const compact = id.replace(/[^A-Za-z0-9]/g, "");
  if (compact.length === 0) return "?";
  return compact.slice(-4).toUpperCase();
}

/** Design rules §12 cursor fade: 1 while moving, 0.4 after 5 s without an update. */
export function cursorOpacity(lastSeenMs: number, nowMs: number): number {
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return 1;
  return nowMs - lastSeenMs >= REMOTE_CURSOR_FADE_MS ? REMOTE_CURSOR_FADED_OPACITY : 1;
}

/** World → screen projection of the engine camera (see packages/engine camera.cpp). */
export function worldToScreen(camera: EngineCamera, world: ScreenPoint): ScreenPoint {
  return { x: (world.x - camera.panX) * camera.zoom, y: (world.y - camera.panY) * camera.zoom };
}

/** Screen position of a remote cursor, or `visible: false` when it is clipped away. */
export function cursorScreenPoint(
  camera: EngineCamera,
  cursor: ScreenPoint,
  viewport: { readonly width: number; readonly height: number },
): { readonly point: ScreenPoint; readonly visible: boolean } {
  const point = worldToScreen(camera, cursor);
  const visible =
    point.x >= -CURSOR_CLIP_MARGIN &&
    point.y >= -CURSOR_CLIP_MARGIN &&
    point.x <= viewport.width + CURSOR_CLIP_MARGIN &&
    point.y <= viewport.height + CURSOR_CLIP_MARGIN;
  return { point, visible };
}

export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Selection outlines of one remote participant: the contract lists selected ids,
 * the app resolves them against the projected board content. Unknown ids (an
 * object removed in the meantime) are skipped.
 */
export function selectionRects(content: BoardContent | null, ids: readonly string[]): WorldRect[] {
  if (content === null || ids.length === 0) return [];
  const wanted = new Set(ids);
  const rects: WorldRect[] = [];
  for (const object of [...content.zones, ...content.blocks, ...content.cards]) {
    if (!wanted.has(object.id)) continue;
    rects.push({ x: object.x, y: object.y, width: object.width, height: object.height });
  }
  return rects;
}

export type SaveIndicator = "hidden" | "saving" | "saved" | "error" | "offline" | "auth";

export interface SaveStatusView {
  readonly state: SaveIndicator;
  readonly messageKey: string;
  readonly retryable: boolean;
}

export interface SaveStatusInput {
  /** The one autosave path's status (SDK `createAutosave`). */
  readonly autosave: AutosaveStatus;
  readonly sync: BoardSyncStatus;
  /** The sync service rejected the session (terminal; retry/login, no loop). */
  readonly sessionExpired: boolean;
}

/**
 * The L05 status region: server-confirmation only ("saved" comes from the
 * autosave's acknowledged save), offline beats saving (the queue holds the
 * change), and an expired session is a terminal error with retry/login.
 */
export function saveStatusView(input: SaveStatusInput): SaveStatusView {
  if (input.sessionExpired) {
    return { state: "auth", messageKey: "board.sync.authRequired", retryable: true };
  }
  if (input.sync === "offline" || input.sync === "closed") {
    return { state: "offline", messageKey: "board.sync.offlineChanges", retryable: false };
  }
  switch (input.autosave) {
    case "error":
      return { state: "error", messageKey: "canvas.save.failed", retryable: true };
    case "saving":
      return { state: "saving", messageKey: "canvas.save.saving", retryable: false };
    case "saved":
      return { state: "saved", messageKey: "canvas.save.saved", retryable: false };
    case "idle":
    default:
      return { state: "hidden", messageKey: "", retryable: false };
  }
}

/** "Saved" fades after exactly the saved-visibility window. */
export function savedStillVisible(nowMs: number, savedAtMs: number | null): boolean {
  if (savedAtMs === null) return false;
  return nowMs - savedAtMs < SAVED_VISIBLE_MS;
}
