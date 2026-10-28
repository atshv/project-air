// P5-02: conformance suite for the BoardDoc interface, run for the Yjs adapter
// and for the second fake adapter (ADR-0011 keeps the library replaceable).
// Seeded PRNG: 10,000 randomized rounds, different orders, offline batches,
// snapshot round-trip and op+inverse state equality.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createFakeBoardDoc } from "../src/index.ts";
import { createYjsBoardDoc } from "../src/yjs-doc.ts";

const PACKAGE_DIR = new URL("..", import.meta.url).pathname;
const CONTENT = JSON.parse(readFileSync(join(PACKAGE_DIR, "../contracts/fixtures/board-content/valid.json"), "utf8")).data;

const UUID = (n) => `0192f0d0-7000-7000-8000-${String(n).padStart(12, "0")}`;

function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const base = clone(CONTENT);

function operation(type, payload, index) {
  return {
    id: UUID(0x100000 + index),
    boardId: base.board.id,
    actorId: UUID(0xac00),
    createdAt: "2027-01-10T09:30:00.000Z",
    type,
    payload,
    inverse: { boardId: base.board.id, type: "reorder", payload: { itemId: base.cards[0].id, z: base.cards[0].z } },
  };
}

function randomOperations(seed, count) {
  const random = prng(seed);
  const cards = base.cards.map((card) => card.id);
  const blocks = base.blocks.map((block) => block.id);
  const zones = base.zones.map((zone) => zone.id);
  const notes = base.notes.map((note) => note.id);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const operations = [];
  for (let index = 0; index < count; index += 1) {
    const kind = Math.floor(random() * 4);
    if (kind === 0) {
      operations.push(operation("moveCard", { cardId: pick(cards), x: Math.floor(random() * 2000), y: Math.floor(random() * 1200), zoneId: random() < 0.4 ? null : undefined }, index));
    } else if (kind === 1) {
      operations.push(operation("resizeBlock", { blockId: pick(blocks), type: "checklist", width: 224 + Math.floor(random() * 100), height: 128 + Math.floor(random() * 80) }, index));
    } else if (kind === 2) {
      operations.push(operation("reorder", { itemId: pick(cards), z: String(Math.floor(random() * 1000)).padStart(3, "0") }, index));
    } else if (kind === 3) {
      operations.push(operation("updateNote", { noteId: pick(notes), changes: { title: `Note ${index}` } }, index));
    } else {
      operations.push(operation("moveZone", { zoneId: pick(zones), x: Math.floor(random() * 500), y: Math.floor(random() * 500) }, index));
    }
  }
  return operations;
}

function shuffled(seed, list) {
  const random = prng(seed);
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function suite(name, create) {
  test(`${name}: 10,000 randomized rounds in different orders converge`, () => {
    const rounds = 10_000;
    const operations = randomOperations(0xc0ffee, rounds);
    const left = create({ content: base });
    const right = create({ content: base });
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    for (const op of operations) left.apply(op);
    for (const op of shuffled(0xbeef, operations)) right.apply(op);
    left.merge(right);
    right.merge(left);
    const elapsedMs = performance.now() - started;
    const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
    assert.equal(left.encodeState(), right.encodeState(), "the encoded states are byte-identical");
    assert.deepEqual(left.snapshot(), right.snapshot(), "the canonical snapshots are equal");
    assert.equal(left.stateVector().length > 0, true);
    console.log(`${name}: rounds=${rounds} elapsedMs=${elapsedMs.toFixed(1)} heapDeltaMb=${heapDeltaMb.toFixed(2)} stateBytes=${left.encodeState().length}`);
  });

  test(`${name}: an offline batch merges after reconnect`, () => {
    const operations = randomOperations(0x1234, 400);
    const online = create({ content: base });
    const offline = create({ content: base });
    for (const op of operations.slice(0, 200)) online.apply(op);
    for (const op of operations.slice(200)) offline.apply(op);
    online.merge(offline);
    // The two documents disagree about the same fields; after merging in both
    // directions they converge (offline first-write wins per field, deterministic).
    offline.merge(online);
    online.merge(offline);
    offline.merge(online);
    assert.deepEqual(online.snapshot(), offline.snapshot());
  });

  test(`${name}: the snapshot round-trips into an identical document`, () => {
    const operations = randomOperations(0x55aa, 100);
    const doc = create({ content: base });
    for (const op of operations) doc.apply(op);
    const snapshot = doc.snapshot();
    const restored = create({ content: snapshot });
    assert.equal(restored.encodeState(), doc.encodeState());
    assert.deepEqual(restored.snapshot(), snapshot);
  });

  test(`${name}: every operation type plus its inverse restores the state`, () => {
    const doc = create({ content: base });
    const initial = doc.encodeState();
    const card = base.cards[0];
    const zone = base.zones[0];
    const block = base.blocks[0];
    const note = base.notes[0];
    const samples = [
      operation("moveCard", { cardId: card.id, x: card.x + 16, y: card.y + 16 }, 1),
      operation("resizeCard", { cardId: card.id, width: card.width + 16, height: card.height + 16 }, 2),
      operation("moveBlock", { blockId: block.id, x: block.x + 16, y: block.y + 16 }, 3),
      operation("resizeBlock", { blockId: block.id, type: block.type, width: block.width + 16, height: block.height + 16 }, 4),
      operation("moveZone", { zoneId: zone.id, x: zone.x + 16, y: zone.y + 16 }, 5),
      operation("resizeZone", { zoneId: zone.id, width: zone.width + 16, height: zone.height + 16 }, 6),
      operation("updateNote", { noteId: note.id, changes: { title: "Renamed" } }, 7),
      operation("reorder", { itemId: card.id, z: "zz" }, 8),
    ];
    for (const op of samples) {
      const before = doc.encodeState();
      doc.apply(op);
      assert.notEqual(doc.encodeState(), before, `${op.type} changes the state`);
      doc.apply(inverseOf(op));
      assert.equal(doc.encodeState(), before, `${op.type} plus inverse restores the state`);
    }
    assert.equal(doc.encodeState(), initial);
  });
}

function inverseOf(op) {
  // The contract builders provide the real inverse payloads; for the samples the
  // original base values are the inverse (the document core only needs shapes).
  const p = op.payload;
  if (op.type === "moveCard") {
    const card = base.cards.find((entry) => entry.id === p.cardId);
    return { ...op, type: "moveCard", payload: { cardId: p.cardId, x: card.x, y: card.y, zoneId: card.zoneId ?? null } };
  }
  if (op.type === "resizeCard") {
    const card = base.cards.find((entry) => entry.id === p.cardId);
    return { ...op, type: "resizeCard", payload: { cardId: p.cardId, width: card.width, height: card.height } };
  }
  if (op.type === "moveBlock") {
    const block = base.blocks.find((entry) => entry.id === p.blockId);
    return { ...op, type: "moveBlock", payload: { blockId: p.blockId, x: block.x, y: block.y, zoneId: block.zoneId ?? null } };
  }
  if (op.type === "resizeBlock") {
    const block = base.blocks.find((entry) => entry.id === p.blockId);
    return { ...op, type: "resizeBlock", payload: { blockId: p.blockId, type: block.type, width: block.width, height: block.height } };
  }
  if (op.type === "moveZone") {
    const zone = base.zones.find((entry) => entry.id === p.zoneId);
    return { ...op, type: "moveZone", payload: { zoneId: p.zoneId, x: zone.x, y: zone.y } };
  }
  if (op.type === "resizeZone") {
    const zone = base.zones.find((entry) => entry.id === p.zoneId);
    return { ...op, type: "resizeZone", payload: { zoneId: p.zoneId, width: zone.width, height: zone.height } };
  }
  if (op.type === "updateNote") {
    const note = base.notes.find((entry) => entry.id === p.noteId);
    return { ...op, type: "updateNote", payload: { noteId: p.noteId, changes: { title: note.title } } };
  }
  const card = base.cards.find((entry) => entry.id === p.itemId);
  return { ...op, type: "reorder", payload: { itemId: p.itemId, z: card.z } };
}

for (const [name, create] of [
  ["yjs", createYjsBoardDoc],
  ["fake", createFakeBoardDoc],
]) {
  // The samples carry the real inverse only for the fake-with-inverse field; the
  // conformance inverseOf helper reconstructs the payload changes for both.
  suite(name, create);
}
