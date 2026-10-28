// P4-22 (L17) view-persistence tests with a fake storage: restore, per-board and
// per-device separation, invalid/corrupt/unknown-version records, throwing
// getters/setters, quota errors, zoom clamp, no write on restore and fit fallback.

import assert from "node:assert/strict";
import test from "node:test";

import {
  deviceKeyFor,
  loadView,
  parseViewRecord,
  saveView,
  storageKeyFor,
  VIEW_RECORD_VERSION,
} from "../src/bridge/view-persistence.ts";

function fakeStorage() {
  const data = new Map();
  const calls = { reads: 0, writes: 0 };
  return {
    data,
    calls,
    getItem(key) {
      calls.reads += 1;
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      calls.writes += 1;
      data.set(key, value);
    },
  };
}

const identity = { boardId: "board-a", deviceKey: "1440x900@1" };
const camera = { panX: 120, panY: 80, zoom: 1.5 };

test("a saved view is restored for the same board and device", () => {
  const storage = fakeStorage();
  assert.equal(saveView(storage, identity, camera), true);
  assert.deepEqual(loadView(storage, identity), camera);
  assert.equal(storage.data.has(storageKeyFor("board-a", "1440x900@1")), true);
});

test("boards and devices keep separate entries", () => {
  const storage = fakeStorage();
  saveView(storage, { boardId: "board-a", deviceKey: "1440x900@1" }, camera);
  saveView(storage, { boardId: "board-b", deviceKey: "1440x900@1" }, { panX: 5, panY: 6, zoom: 2 });
  saveView(storage, { boardId: "board-a", deviceKey: "390x844@1" }, { panX: 9, panY: 9, zoom: 0.5 });
  assert.deepEqual(loadView(storage, { boardId: "board-a", deviceKey: "1440x900@1" }), camera);
  assert.deepEqual(loadView(storage, { boardId: "board-b", deviceKey: "1440x900@1" }), { panX: 5, panY: 6, zoom: 2 });
  assert.deepEqual(loadView(storage, { boardId: "board-a", deviceKey: "390x844@1" }), { panX: 9, panY: 9, zoom: 0.5 });
  assert.equal(loadView(storage, { boardId: "board-c", deviceKey: "1440x900@1" }), null, "no foreign board leak");
});

test("invalid JSON, wrong version and foreign/unknown records are ignored", () => {
  const storage = fakeStorage();
  storage.data.set(storageKeyFor("board-a", "1440x900@1"), "{not json");
  assert.equal(loadView(storage, identity), null);
  storage.data.set(storageKeyFor("board-a", "1440x900@1"), JSON.stringify({ version: 99, boardId: "board-a", deviceKey: "1440x900@1", panX: 1, panY: 2, zoom: 1 }));
  assert.equal(loadView(storage, identity), null);
  storage.data.set(storageKeyFor("board-a", "1440x900@1"), JSON.stringify({ version: VIEW_RECORD_VERSION, boardId: "board-b", deviceKey: "1440x900@1", panX: 1, panY: 2, zoom: 1 }));
  assert.equal(loadView(storage, identity), null);
  storage.data.set(storageKeyFor("board-a", "1440x900@1"), JSON.stringify({ version: VIEW_RECORD_VERSION, boardId: "board-a", deviceKey: "1440x900@1", panX: "x", panY: 2, zoom: 1 }));
  assert.equal(loadView(storage, identity), null);
  assert.equal(parseViewRecord(null, identity), null);
  assert.equal(parseViewRecord("[]", identity), null);
});

test("the zoom is clamped to 0.1 … 8 on read and write", () => {
  const storage = fakeStorage();
  storage.data.set(storageKeyFor("board-a", "1440x900@1"), JSON.stringify({ version: VIEW_RECORD_VERSION, boardId: "board-a", deviceKey: "1440x900@1", panX: 1, panY: 2, zoom: 100 }));
  assert.equal(loadView(storage, identity).zoom, 8);
  storage.data.set(storageKeyFor("board-a", "1440x900@1"), JSON.stringify({ version: VIEW_RECORD_VERSION, boardId: "board-a", deviceKey: "1440x900@1", panX: 1, panY: 2, zoom: 0.001 }));
  assert.equal(loadView(storage, identity).zoom, 0.1);
  saveView(storage, identity, { panX: 1, panY: 2, zoom: 99 });
  assert.equal(loadView(storage, identity).zoom, 8, "the stored record is clamped too");
});

test("throwing getters/setters and quota errors fall back safely", () => {
  const throwingGet = { getItem() { throw new Error("privacy mode"); }, setItem() {} };
  assert.equal(loadView(throwingGet, identity), null);
  const throwingSet = { getItem() { return null; }, setItem() { throw new Error("quota"); } };
  assert.equal(saveView(throwingSet, identity, camera), false);
  assert.equal(saveView(null, identity, camera), false);
  assert.equal(loadView(undefined, identity), null);
});

test("restore never writes; a valid save contains the versioned record", () => {
  const storage = fakeStorage();
  saveView(storage, identity, camera);
  const readsBefore = storage.calls.reads;
  const writesBefore = storage.calls.writes;
  loadView(storage, identity);
  assert.equal(storage.calls.writes, writesBefore, "load must not write");
  assert.equal(storage.calls.reads, readsBefore + 1);
  const raw = JSON.parse(storage.data.get(storageKeyFor("board-a", "1440x900@1")));
  assert.deepEqual(raw, { version: VIEW_RECORD_VERSION, boardId: "board-a", deviceKey: "1440x900@1", panX: 120, panY: 80, zoom: 1.5 });
});

test("the device fingerprint is a coarse viewport class + DPR", () => {
  assert.equal(deviceKeyFor(1440, 900, 1), "1400x900@1");
  assert.equal(deviceKeyFor(390, 844, 3), "400x800@3");
  assert.equal(deviceKeyFor(0, 0, 0), "100x100@1");
});
