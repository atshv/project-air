// P6-09 (L05, realtime): pure realtime view helpers. Covers the connection
// state mapping (connecting/joined/offline/error), the terminal session-expiry
// value, presence colour/label/selection projection, the cursor fade/clip and the
// L05 status mapping (Saving/Saved/Not saved – retry/offline/auth).

import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_SESSION_TOKEN_REF,
  CURSOR_CLIP_MARGIN,
  REMOTE_CURSOR_FADE_MS,
  REMOTE_CURSOR_FADED_OPACITY,
  SAVED_VISIBLE_MS,
  TOKEN_REF_PATTERN,
  connectionMessageKey,
  connectionPhase,
  cursorOpacity,
  cursorScreenPoint,
  isSessionExpired,
  presenceColor,
  presenceLabel,
  saveStatusView,
  savedStillVisible,
  selectionRects,
  syncUrl,
  worldToScreen,
} from "../src/board/realtime.ts";

const CAMERA = { panX: 100, panY: 50, zoom: 2 };
const CONTENT = {
  contractVersion: "0.4.0",
  board: { id: "b" },
  zones: [{ id: "zone-1", x: 10, y: 20, width: 200, height: 100 }],
  blocks: [{ id: "block-1", x: 30, y: 40, width: 50, height: 60 }],
  cards: [{ id: "card-1", x: 50, y: 60, width: 176, height: 80 }],
  notes: [],
  edges: [],
};

test("browser hello carries an opaque contract-valid token reference, never a token", () => {
  assert.match(BROWSER_SESSION_TOKEN_REF, TOKEN_REF_PATTERN);
  assert.equal(BROWSER_SESSION_TOKEN_REF.length >= 8, true);
  assert.equal(BROWSER_SESSION_TOKEN_REF.includes("."), false);
});

test("same-origin sync URL follows the page protocol and host", () => {
  assert.equal(syncUrl({ protocol: "http:", host: "127.0.0.1:4300" }), "ws://127.0.0.1:4300/v1/sync");
  assert.equal(syncUrl({ protocol: "https:", host: "air.example" }), "wss://air.example/v1/sync");
});

test("connection state maps SDK status to connecting/joined/offline/error", () => {
  assert.equal(connectionPhase("idle"), "connecting");
  assert.equal(connectionPhase("connecting"), "connecting");
  assert.equal(connectionPhase("joined"), "joined");
  assert.equal(connectionPhase("offline"), "offline");
  assert.equal(connectionPhase("closed"), "offline");
  assert.equal(connectionPhase("joined", true), "error");
  assert.equal(connectionMessageKey("connecting"), "board.sync.connecting");
  assert.equal(connectionMessageKey("joined"), "board.sync.joined");
  assert.equal(connectionMessageKey("offline"), "board.sync.offline");
  assert.equal(connectionMessageKey("error"), "board.sync.error");
});

test("only an AUTH_REQUIRED reject is terminal session expiry", () => {
  assert.equal(isSessionExpired({ code: "AUTH_REQUIRED", detail: "expired" }), true);
  assert.equal(isSessionExpired({ code: "FORBIDDEN" }), false);
  assert.equal(isSessionExpired({ message: "network" }), false);
  assert.equal(isSessionExpired(null), false);
  assert.equal(isSessionExpired("AUTH_REQUIRED"), false);
});

test("presence colours use tokens and fall back to a token, never a raw colour", () => {
  assert.equal(presenceColor("tone-a"), "var(--tone-a)");
  assert.equal(presenceColor("tone-e"), "var(--tone-e)");
  assert.equal(presenceColor("tone-z"), "var(--tone-c)", "an unknown tone falls back to a token");
  assert.equal(presenceColor("#ff0000"), "var(--tone-c)", "a raw colour is never passed through");
  assert.equal(presenceColor(""), "var(--tone-c)");
});

test("presence labels come from the server nameRef, not from client text", () => {
  assert.equal(presenceLabel("user:0192f0e7-7000-7000-8000-00000000abcd"), "ABCD");
  assert.equal(presenceLabel("user:account-42"), "NT42");
  assert.equal(presenceLabel("account-42"), "NT42");
  assert.equal(presenceLabel(""), "?");
  assert.equal(presenceLabel("user:"), "?");
});

test("remote cursors fade after 5 s and project into screen space with clipping", () => {
  assert.equal(cursorOpacity(0, 1_000), 1);
  assert.equal(cursorOpacity(1_000, 1_000 + REMOTE_CURSOR_FADE_MS - 1), 1);
  assert.equal(cursorOpacity(1_000, 1_000 + REMOTE_CURSOR_FADE_MS), REMOTE_CURSOR_FADED_OPACITY);
  assert.equal(cursorOpacity(1_000, 99_000), 0.4);

  assert.deepEqual(worldToScreen(CAMERA, { x: 120, y: 60 }), { x: 40, y: 20 });
  const inside = cursorScreenPoint(CAMERA, { x: 120, y: 60 }, { width: 800, height: 600 });
  assert.deepEqual(inside.point, { x: 40, y: 20 });
  assert.equal(inside.visible, true);
  const clipped = cursorScreenPoint(CAMERA, { x: 10_000, y: 10_000 }, { width: 800, height: 600 });
  assert.equal(clipped.visible, false, "a cursor far outside the viewport is clipped");
  const margin = cursorScreenPoint(CAMERA, { x: 100 + (800 + CURSOR_CLIP_MARGIN) / 2, y: 50 }, { width: 800, height: 600 });
  assert.equal(margin.visible, true, "the clip margin still renders near the edge");
});

test("remote selection resolves known ids and skips removed objects", () => {
  const rects = selectionRects(CONTENT, ["card-1", "zone-1", "missing"]);
  assert.deepEqual(rects, [
    { x: 10, y: 20, width: 200, height: 100 },
    { x: 50, y: 60, width: 176, height: 80 },
  ]);
  assert.deepEqual(selectionRects(null, ["card-1"]), []);
  assert.deepEqual(selectionRects(CONTENT, []), []);
});

test("L05 status maps saving/saved/error/offline/session-expiry honestly", () => {
  assert.deepEqual(saveStatusView({ autosave: "idle", sync: "joined", sessionExpired: false }), {
    state: "hidden", messageKey: "", retryable: false,
  });
  assert.deepEqual(saveStatusView({ autosave: "saving", sync: "joined", sessionExpired: false }), {
    state: "saving", messageKey: "canvas.save.saving", retryable: false,
  });
  assert.deepEqual(saveStatusView({ autosave: "saved", sync: "joined", sessionExpired: false }), {
    state: "saved", messageKey: "canvas.save.saved", retryable: false,
  });
  const error = saveStatusView({ autosave: "error", sync: "joined", sessionExpired: false });
  assert.equal(error.state, "error");
  assert.equal(error.messageKey, "canvas.save.failed");
  assert.equal(error.retryable, true, "the L05 error is clickable");

  const offline = saveStatusView({ autosave: "saving", sync: "offline", sessionExpired: false });
  assert.equal(offline.state, "offline", "offline wins over saving: the queue holds the change");
  assert.equal(offline.messageKey, "board.sync.offlineChanges");
  assert.equal(offline.retryable, false, "an offline queue flushes itself on reconnect");

  const auth = saveStatusView({ autosave: "saved", sync: "offline", sessionExpired: true });
  assert.equal(auth.state, "auth");
  assert.equal(auth.messageKey, "board.sync.authRequired");
  assert.equal(auth.retryable, true, "an expired session offers retry/login");
});

test("Saved disappears exactly after 2 s", () => {
  assert.equal(SAVED_VISIBLE_MS, 2_000);
  assert.equal(savedStillVisible(10_000, null), false);
  assert.equal(savedStillVisible(10_000, 8_001), true);
  assert.equal(savedStillVisible(10_000, 8_000), false);
});
