// Document-port tests of the engine logic layer (P4-05).
//
// The pure in-memory fake and the browser adapter over the typed bridge share
// one narrow port. The fake is the deterministic working copy of the operation
// and history tests; the adapter maps stable contract UUIDs to engine slot
// handles and never touches the DOM from the logic layer. A source scan pins
// both the layer rule (no direct WASM/bridge runtime import) and the purity rule
// (no DOM and no network in `src/logic/`).

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  createEngineDocumentPort,
  createInMemoryDocument,
} from "../src/logic/document-port.ts";
import { applyInverse, applyOperation, buildOperation } from "../src/logic/operations.ts";
import {
  BLOCK_ID,
  CARD_ID,
  ZONE_ID,
  cardEntity,
  createContext,
  blockEntity,
  zoneEntity,
} from "./support.mjs";

const LOGIC_DIR = new URL("../src/logic/", import.meta.url);

function logicSource(name) {
  return readFileSync(new URL(name, LOGIC_DIR), "utf8");
}

/** Minimal browser-bridge stand-in: records slots and their rectangles. */
function createStubBackend() {
  const rectangles = new Map();
  let nextSlot = 1;
  return {
    rectangles,
    addRectangle(rectangle) {
      const slot = nextSlot;
      nextSlot += 1;
      rectangles.set(slot, { ...rectangle });
      return slot;
    },
    updateGeometry(slot, geometry) {
      const rectangle = rectangles.get(slot);
      assert.ok(rectangle, `slot ${slot} exists`);
      Object.assign(rectangle, geometry);
    },
    updateZ(slot, z) {
      const rectangle = rectangles.get(slot);
      assert.ok(rectangle, `slot ${slot} exists`);
      rectangle.z = z;
    },
    removeObject(slot) {
      assert.equal(rectangles.delete(slot), true, `slot ${slot} exists`);
    },
  };
}

test("the in-memory fake stores isolated copies and rejects duplicates", () => {
  const port = createInMemoryDocument();
  const card = cardEntity();
  port.add("card", card);
  card.x = 9999;
  assert.equal(port.read("card", CARD_ID)?.x, 512, "the port copied the entity on add");
  const before = port.snapshot();
  const read = port.read("card", CARD_ID);
  assert.ok(read);
  read.x = 9999;
  assert.equal(port.read("card", CARD_ID)?.x, 512, "read returns a copy, not the working copy");
  assert.equal(port.snapshot(), before, "mutating a read result never changes the snapshot");
  assert.throws(() => port.add("card", cardEntity()), /already contains/);
  assert.equal(port.read("zone", ZONE_ID), undefined);
});

test("the fake writes geometry, z and removals and rejects unknown ids", () => {
  const port = createInMemoryDocument();
  port.add("card", cardEntity());
  port.add("zone", zoneEntity());
  port.add("block", blockEntity());

  port.move("card", CARD_ID, 544, 288);
  assert.equal(port.read("card", CARD_ID)?.x, 544);
  port.resize("card", CARD_ID, 192, 96);
  assert.equal(port.read("card", CARD_ID)?.width, 192);
  port.updateZ("card", CARD_ID, "b7");
  assert.equal(port.read("card", CARD_ID)?.z, "b7");

  assert.throws(() => port.move("card", "0192f0c1-7000-7000-8000-000000000999", 0, 0), /contains no/);
  port.remove("card", CARD_ID);
  assert.equal(port.read("card", CARD_ID), undefined);
  assert.throws(() => port.remove("card", CARD_ID), /contains no/);
});

test("the fake snapshot is canonical and changes only on writes", () => {
  const port = createInMemoryDocument();
  port.add("card", cardEntity());
  port.add("zone", zoneEntity());
  port.add("block", blockEntity());
  const snapshot = port.snapshot();
  assert.equal(port.snapshot(), snapshot, "reads do not change the snapshot");
  assert.deepEqual(Object.keys(JSON.parse(snapshot)), ["blocks", "cards", "zones"]);
  port.move("zone", ZONE_ID, 144, 80);
  assert.notEqual(port.snapshot(), snapshot);
  port.move("zone", ZONE_ID, 128, 64);
  assert.equal(port.snapshot(), snapshot, "restoring the values restores the bytes");
});

test("the bridge adapter maps contract ids to slots and projects to the engine", () => {
  const backend = createStubBackend();
  const port = createEngineDocumentPort(backend);
  port.add("zone", zoneEntity());
  port.add("card", cardEntity());
  port.add("block", blockEntity());

  assert.deepEqual([...backend.rectangles.values()].map((rectangle) => rectangle.layer).sort(), [
    "blocks",
    "note-cards",
    "zones",
  ]);
  assert.equal(port.read("card", CARD_ID)?.id, CARD_ID);
  assert.equal(
    backend.rectangles.get(2).z,
    cardEntity().z,
    "the adapter projects the contract z into the engine",
  );
  const read = port.read("card", CARD_ID);
  assert.ok(read);
  read.x = 9999;
  assert.equal(backend.rectangles.get(2).x, 512, "read returns a copy of the stored entity");
  assert.equal(port.read("card", CARD_ID)?.x, 512);

  port.move("card", CARD_ID, 544, 288);
  assert.equal(backend.rectangles.get(2).x, 544, "the card slot receives the new geometry");
  assert.equal(port.read("card", CARD_ID)?.x, 544);

  port.resize("block", BLOCK_ID, 256, 144);
  assert.equal(backend.rectangles.get(3).width, 256);
  port.updateZ("card", CARD_ID, "b7");
  assert.equal(backend.rectangles.get(2).z, "b7");

  assert.throws(() => port.move("card", "0192f0c1-7000-7000-8000-000000000999", 0, 0), /contains no/);
  port.remove("card", CARD_ID);
  assert.equal(backend.rectangles.size, 2);
  assert.equal(port.read("card", CARD_ID), undefined);
});

test("an operation and its inverse round-trip through the bridge adapter", () => {
  const backend = createStubBackend();
  const port = createEngineDocumentPort(backend);
  port.add("zone", zoneEntity());
  port.add("card", cardEntity());
  port.add("block", blockEntity());
  const before = [...backend.rectangles.entries()].map(([slot, rectangle]) => [slot, { ...rectangle }]);
  const pair = buildOperation(port, createContext(), {
    kind: "drag-single",
    objectKind: "card",
    objectId: CARD_ID,
    position: { x: 528, y: 272 },
  });
  assert.ok(pair);

  applyOperation(port, pair.operation);
  assert.equal(backend.rectangles.get(2).x, 528);
  assert.equal(backend.rectangles.get(2).y, 272);
  applyInverse(port, pair.inverse);
  assert.deepEqual(
    [...backend.rectangles.entries()].map(([slot, rectangle]) => [slot, { ...rectangle }]),
    before,
    "the adapter round trip restores the engine working copy byte-identically",
  );
});

test("the logic layer imports the bridge for types only and uses no DOM or network", () => {
  const files = readdirSync(LOGIC_DIR).filter((name) => name.endsWith(".ts"));
  assert.deepEqual(files.sort(), [
    "document-port.ts",
    "gestures.ts",
    "history.ts",
    "operations.ts",
  ]);
  const forbidden = [
    [/\bfetch\s*\(/, "fetch"],
    [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
    [/\bWebSocket\b/, "WebSocket"],
    [/\blocalStorage\b/, "localStorage"],
    [/\bdocument\s*\./, "document access"],
    [/\bwindow\s*\./, "window access"],
    [/\bHTMLCanvasElement\b/, "canvas element"],
    [/["']node:/, "Node builtin import"],
    [/\brequire\s*\(/, "CommonJS require"],
  ];
  for (const file of files) {
    const source = logicSource(file);
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} must not use ${label}`);
    }
    for (const line of source.split("\n")) {
      if (line.includes("bridge/engine.ts")) {
        assert.match(line, /^import type /, `${file}: the bridge import must be type-only`);
      }
    }
  }
  // The modules above loaded in Node, which has no DOM: the layer is testable natively.
  assert.equal(typeof globalThis.document, "undefined");
});
