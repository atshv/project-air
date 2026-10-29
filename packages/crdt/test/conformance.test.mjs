// P5-02: conformance suite for the BoardDoc interface, run for the Yjs adapter
// and for the second fake adapter (ADR-0011 keeps the library replaceable).
// Seeded PRNG: 10,000 randomized rounds, different orders, offline batches,
// snapshot round-trip and op+inverse state equality.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createFakeBoardDoc } from "../src/index.ts";
import { derivePlainText, validateNoteBody } from "../src/note-body.ts";
import { createYjsBoardDoc } from "../src/yjs-doc.ts";
import { validate as contractValidate } from "../../contracts/test/support.mjs";
import { derivePlainText as contractPlainText } from "../../contracts/plaintext.mjs";

const PACKAGE_DIR = new URL("..", import.meta.url).pathname;
const CONTENT = JSON.parse(readFileSync(join(PACKAGE_DIR, "../contracts/fixtures/board-content/valid.json"), "utf8")).data;
const NOTE_BODY_SCHEMA = JSON.parse(readFileSync(join(PACKAGE_DIR, "../contracts/schemas/note-body-payload.schema.json"), "utf8"));
const NOTE_BODY_FIXTURES = join(PACKAGE_DIR, "../contracts/fixtures/note-body");

// Contract 0.4.0 body with a paragraph, an unordered list item carrying an https
// link mark and a heading: exercises links, lists and text derivation.
const BODY = {
  version: "1",
  blocks: [
    { type: "paragraph", text: "Hello world.", marks: ["bold", "italic"] },
    { type: "list", text: "Source", ordered: false, marks: ["link"], href: "https://example.test/source" },
    { type: "heading", text: "Notes", level: 2 },
  ],
};
const BODY_PLAIN_TEXT = "Hello world.\n- Source\nNotes";

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
      operation("updateNoteBody", { noteId: note.id, body: BODY }, 9),
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

  // P6-08: contract 0.4.0 body operations. The body tests are focused rather
  // than part of the randomized loop so the 10k-round suite keeps its runtime.
  test(`${name}: updateNoteBody stores the body and derived plainText and snapshots round-trip it`, () => {
    const doc = create({ content: base });
    const note = base.notes[0];
    const before = doc.encodeState();
    const op = operation("updateNoteBody", { noteId: note.id, body: BODY }, 0x201);
    doc.apply(op);

    const stored = doc.snapshot().notes.find((entry) => entry.id === note.id);
    assert.deepEqual(stored.body, BODY, "the structured body is stored as given");
    assert.equal(stored.plainText, BODY_PLAIN_TEXT, "the derived plainText is stored on the note");
    assert.equal(stored.plainText, contractPlainText(BODY), "plainText matches the contract derivation");
    assert.equal(stored.updatedAt, note.updatedAt, "the operation carries no timestamp; updatedAt is preserved");

    const snapshot = doc.snapshot();
    const restored = create({ content: snapshot });
    assert.equal(restored.encodeState(), doc.encodeState(), "the snapshot round-trips the body");
    assert.deepEqual(restored.snapshot(), snapshot);

    doc.apply(bodyInverse(note.id, note.body, op.id));
    assert.equal(doc.encodeState(), before, "the inverse restores the byte-identical previous note");
  });

  test(`${name}: a bodyless note stays byte-identical through apply and the empty-body inverse`, () => {
    const doc = create({ content: base });
    const note = base.notes[1];
    assert.equal(note.body, undefined, "the fixture carries one note without a body");
    const before = doc.encodeState();
    const op = operation("updateNoteBody", { noteId: note.id, body: BODY }, 0x202);
    doc.apply(op);
    assert.equal(doc.snapshot().notes.find((entry) => entry.id === note.id).plainText, BODY_PLAIN_TEXT);

    // The contract treats an absent body as the empty body: the inverse of a
    // note that never had a body is the empty body, so the note must be
    // byte-identical again (no body/plainText fields).
    doc.apply(bodyInverse(note.id, { version: "1", blocks: [] }, op.id));
    assert.equal(doc.encodeState(), before, "an empty-body inverse restores the bodyless note");
    assert.equal(doc.snapshot().notes.find((entry) => entry.id === note.id).body, undefined);
  });

  test(`${name}: an empty body clears a note and its inverse restores the body`, () => {
    const doc = create({ content: base });
    const note = base.notes[0];
    const before = doc.encodeState();
    const op = operation("updateNoteBody", { noteId: note.id, body: { version: "1", blocks: [] } }, 0x203);
    doc.apply(op);
    const cleared = doc.snapshot().notes.find((entry) => entry.id === note.id);
    assert.equal(cleared.body, undefined, "the empty body canonicalises to no body fields");
    assert.equal(cleared.plainText, undefined);
    doc.apply(bodyInverse(note.id, note.body, op.id));
    assert.equal(doc.encodeState(), before, "the inverse restores the previous body byte-identically");
  });

  test(`${name}: body rejections fail closed and leave the document unchanged`, () => {
    const rejects = (operationToApply, pattern) => {
      const doc = create({ content: base });
      assert.throws(() => {
        doc.apply(operationToApply);
        // The fake adapter is a log: rejection surfaces on the next evaluation.
        doc.snapshot();
      }, pattern);
    };
    const note = base.notes[0];
    const invalidBodies = [
      { version: "1", blocks: [{ type: "image", text: "x" }] },
      { version: "1", blocks: [{ type: "paragraph", text: "x", marks: ["strike"] }] },
      { version: "1", blocks: [{ type: "paragraph", text: "x", extra: true }] },
      { version: "1", blocks: [{ type: "paragraph", text: "x", marks: ["link"] }] },
      { version: "1", blocks: [{ type: "paragraph", text: "x", marks: ["link"], href: "javascript:alert(1)" }] },
      { version: "1", blocks: [{ type: "list", text: "x", marks: ["bold", "bold"] }] },
      { version: "2", blocks: [] },
      { blocks: [] },
      { version: "1", blocks: [{ type: "paragraph" }] },
    ];
    for (const [index, body] of invalidBodies.entries()) {
      rejects(operation("updateNoteBody", { noteId: note.id, body }, 0x300 + index), /invalid note body/);
    }
    rejects(operation("updateNoteBody", { noteId: UUID(0xdead), body: BODY }, 0x320), /missing note/);
    rejects({ ...operation("updateNoteBody", { noteId: note.id, body: BODY }, 0x321), type: "futureOperation" }, /unsupported contract operation/);
  });

  test(`${name}: two replicas converge with body operations`, () => {
    const secondBody = { version: "1", blocks: [{ type: "paragraph", text: "Second" }] };
    const operations = [
      operation("updateNoteBody", { noteId: base.notes[0].id, body: BODY }, 0x401),
      operation("updateNoteBody", { noteId: base.notes[1].id, body: { version: "1", blocks: [{ type: "heading", text: "Two", level: 1 }] } }, 0x402),
      operation("updateNoteBody", { noteId: base.notes[0].id, body: secondBody }, 0x403),
    ];
    const left = create({ content: base });
    const right = create({ content: base });
    left.apply(operations[0]); left.apply(operations[2]); left.apply(operations[1]);
    right.apply(operations[1]); right.apply(operations[0]); right.apply(operations[2]);
    left.merge(right);
    right.merge(left);
    assert.equal(left.encodeState(), right.encodeState(), "the encoded states are byte-identical");
    assert.deepEqual(left.snapshot(), right.snapshot());
    const note = left.snapshot().notes.find((entry) => entry.id === base.notes[0].id);
    assert.deepEqual(note.body, secondBody);
    assert.equal(note.plainText, "Second");
  });

  test(`${name}: body validation agrees with the contract schema and fixtures`, () => {
    const files = readdirSync(NOTE_BODY_FIXTURES).filter((file) => file.endsWith(".json")).sort();
    assert.equal(files.length >= 5, true, "the contract carries valid and invalid body fixtures");
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(join(NOTE_BODY_FIXTURES, file), "utf8"));
      const contractAccepts = contractValidate(fixture.data, NOTE_BODY_SCHEMA, NOTE_BODY_SCHEMA);
      assert.equal(contractAccepts, fixture.valid, `${file}: the fixture states its contract validity`);
      let accepts = true;
      try {
        validateNoteBody(clone(fixture.data));
      } catch {
        accepts = false;
      }
      assert.equal(accepts, contractAccepts, `${file}: the document core agrees with the contract`);
      if (contractAccepts) {
        assert.equal(derivePlainText(clone(fixture.data)), contractPlainText(fixture.data), `${file}: plainText matches the contract derivation`);
      }
    }
    const bodies = [
      BODY,
      { version: "1", blocks: [] },
      { version: "1", blocks: [{ type: "list", text: " One  two ", ordered: true }, { type: "list", text: "Unordered" }, { type: "paragraph", text: "  spaced   text " }] },
      { version: "1", blocks: [{ type: "heading", text: "", level: 6 }, { type: "paragraph", text: "tail" }] },
    ];
    for (const body of bodies) assert.equal(derivePlainText(body), contractPlainText(body), "derived plainText matches the contract module");
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
  if (op.type === "updateNoteBody") {
    const note = base.notes.find((entry) => entry.id === p.noteId);
    return { ...op, type: "updateNoteBody", payload: { noteId: p.noteId, body: clone(note.body ?? { version: "1", blocks: [] }) } };
  }
  const card = base.cards.find((entry) => entry.id === p.itemId);
  return { ...op, type: "reorder", payload: { itemId: p.itemId, z: card.z } };
}

/** The inverse of a body operation: the previous body on the same operation id. */
function bodyInverse(noteId, previousBody, id) {
  return {
    id,
    boardId: base.board.id,
    type: "updateNoteBody",
    payload: { noteId, body: clone(previousBody) },
  };
}

for (const [name, create] of [
  ["yjs", createYjsBoardDoc],
  ["fake", createFakeBoardDoc],
]) {
  // The samples carry the real inverse only for the fake-with-inverse field; the
  // conformance inverseOf helper reconstructs the payload changes for both.
  suite(name, create);
}
