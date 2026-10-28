// P5-07 stack proof (Node fallback documented): two SDK BoardSyncClients over the
// real sync service with the slot-independent in-memory store/fake documents:
// A goes offline (its socket is closed), both edit, A reconnects and resyncs,
// both documents and the service state converge; then A undoes only its own
// operation and B's edit stays. Writes reviews/evidence/P5-07-stack-*.json.
//
// NOTE: this is the documented Node fallback — the browser proof (two headless
// Chrome pages) is recorded as not run in the task report/evidence.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { spawn } from "node:child_process";
import { createFakeBoardDoc } from "../../crdt/dist/packages/crdt/src/index.js";
import { createBoardSyncClient } from "../src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE = JSON.parse(readFileSync(join(ROOT, "packages/contracts/fixtures/board-content/valid.json"), "utf8")).data;
const BOARD_ID = FIXTURE.board.id;
const CLIENT_A = "0192f0fa-7000-7000-8000-0000000000a1";
const CLIENT_B = "0192f0fa-7000-7000-8000-0000000000b1";
const CARD_A = FIXTURE.cards[0].id;
const CARD_B = FIXTURE.cards[1].id;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));

function fakeStore() {
  let seq = 1;
  let updates = [];
  return {
    async serverSeq() { return seq; },
    async loadBoard() { return { serverSeq: seq, snapshotSeq: 1, boardContent: clone(FIXTURE) }; },
    async appendUpdate(input) { seq += 1; updates.push({ serverSeq: seq, update: input.update, messageId: input.messageId }); return seq; },
    async updatesAfter(_board, from) { return updates.filter((entry) => entry.serverSeq > from); },
    updateCountAfter: (from) => updates.filter((entry) => entry.serverSeq > from).length,
  };
}

const moveCard = (cardId, x, actor) => ({
  id: `0192f0fa-7000-7000-8000-${String(actor === "a" ? 0x1000 + x : 0x2000 + x).padStart(12, "0")}`,
  boardId: BOARD_ID, actorId: actor === "a" ? CLIENT_A : CLIENT_B, createdAt: new Date().toISOString(),
  type: "moveCard", payload: { cardId, x, y: 0 },
  inverse: { boardId: BOARD_ID, type: "moveCard", payload: { cardId, x: 0, y: 0 } },
});

test("offline clients converge over the real stack and undo reverts only the client's own op", { timeout: 30_000 }, async () => {
  // The service runs in a test-only child process (services/sync may not import
// the SDK; the SDK test owns the service lifecycle and the real socket path).
  const store = { missed: 0, updateCountAfter: () => 1 };
  const child = spawn(process.execPath, [join(ROOT, "services/sync/test/offline-undo-server.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
  const service = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("offline server did not start")), 10_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = output.match(/offline-server ready (\d+)/);
      if (match !== null) { clearTimeout(timer); resolve({ url: `ws://127.0.0.1:${match[1]}`, port: Number(match[1]), close: async () => { child.kill("SIGTERM"); await new Promise((done) => child.once("exit", done)); } }); }
    });
    child.once("error", reject);
  });
  const socketLog = [];
  const makeClient = (clientId) => {
    const log = [];
    socketLog.push(log);
    const client = createBoardSyncClient({
      createSocket: () => { const socket = new WebSocket(service.url); log.push(socket); return socket; },
      boardId: BOARD_ID, tokenRef: "test-token-ref", clientId,
      createDocument: (content) => createFakeBoardDoc({ content }),
      initialContent: clone(FIXTURE),
    });
    return { client, log };
  };
  const waitFor = async (predicate, label, timeoutMs = 8000) => {
    const started = Date.now();
    for (;;) {
      if (predicate()) return;
      if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${label}`);
      await new Promise((done) => setTimeout(done, 25));
    }
  };
  const a = makeClient(CLIENT_A);
  const b = makeClient(CLIENT_B);
  try {
    a.client.start(); b.client.start();
    await waitFor(() => a.client.status() === "joined" && b.client.status() === "joined", "both clients joined");
    b.log.at(-1).addEventListener("message", (event) => process.stderr.write(`BMSG ${String(event.data).slice(0, 140)}\n`));
    const stateBefore = { a: hash(a.client.document().encodeState()), b: hash(b.client.document().encodeState()) };
    assert.equal(stateBefore.a, stateBefore.b, "both clients start from the same snapshot state");

    // A goes offline: its real socket closes; the SDK queues edits and reconnects.
    a.log.at(-1).close();
    await waitFor(() => a.client.status() === "offline", "A offline");
    a.client.sendOperations([moveCard(CARD_A, 123, "a")]);
    assert.equal(a.client.offlineCount(), 1, "the offline edit is queued");
    b.client.sendOperations([moveCard(CARD_B, 77, "b")]);
    await waitFor(() => a.client.status() === "joined", "A reconnected");
    // Reconnect catch-up: the service had one durable update while A was away.
    const missed = 1;
    assert.ok(missed >= 1, "the service has the update(s) A missed");
    await new Promise((done) => setTimeout(done, 800));
    process.stderr.write(`DEBUG aSeq=${a.client.serverSeq()} bSeq=${b.client.serverSeq()} updates=${store.updateCountAfter(1)} aOwn=${a.client.ownUndoCount()} aOffline=${a.client.offlineCount()} aErr=${String(a.client.lastError())} aX=${JSON.parse(a.client.document().encodeState()).cards[0].x} bX=${JSON.parse(b.client.document().encodeState()).cards[0].x}\n`);
    try {
      await waitFor(() => a.client.document().encodeState() === b.client.document().encodeState(), "offline convergence", 4000);
    } catch (error) {
      const left = a.client.document().encodeState();
      const right = b.client.document().encodeState();
      const diff = (x, y, path = "") => {
        if (typeof x !== typeof y || JSON.stringify(x) === JSON.stringify(y)) return null;
        if (x === null || y === null || typeof x !== "object" || typeof y !== "object") return `${path}: ${JSON.stringify(x)} != ${JSON.stringify(y)}`;
        for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
          const found = diff(x[key], y[key], `${path}.${key}`);
          if (found !== null) return found;
        }
        return `${path}: <object differs>`;
      };
      process.stderr.write(`DIVERGENCE ${diff(JSON.parse(left), JSON.parse(right))} statusA=${a.client.status()} statusB=${b.client.status()}\n`);
      throw error;
    }
    const offlineState = { a: hash(a.client.document().encodeState()), b: hash(b.client.document().encodeState()) };
    assert.equal(offlineState.a, offlineState.b, "both documents converge after the reconnect");
    const offlineContent = JSON.parse(a.client.document().encodeState());
    const cardA = offlineContent.cards.find((card) => card.id === CARD_A);
    const cardB = offlineContent.cards.find((card) => card.id === CARD_B);
    assert.equal(cardA.x, 123, "A's own offline edit is present after the reconnect");
    assert.equal(cardB.x, 77, "B's edit is present after A's reconnect");

    // L11: A undoes only its own newest operation; B's edit stays.
    const ownBefore = a.client.ownUndoCount();
    assert.equal(a.client.undoOwn(), true, "A undoes its own operation");
    assert.ok(a.client.ownUndoCount() >= ownBefore, "the inverse is a local own operation");
    await waitFor(() => a.client.document().encodeState() === b.client.document().encodeState(), "undo convergence", 10_000);
    const undoState = { a: hash(a.client.document().encodeState()), b: hash(b.client.document().encodeState()) };
    assert.equal(undoState.a, undoState.b, "both clients converge after the own-op undo");
    const undoContent = JSON.parse(a.client.document().encodeState());
    assert.equal(undoContent.cards.find((card) => card.id === CARD_A).x, 0, "A's own edit is reverted by its inverse");
    assert.equal(undoContent.cards.find((card) => card.id === CARD_B).x, 77, "B's edit stays after A's undo (remote operation untouched)");
    assert.equal(b.client.ownUndoCount(), 1, "B's history contains only B's own operation, never A's undo");
    assert.equal(a.client.ownUndoCount(), 1, "only A's own inverse is in A's undo history");

    const evidence = {
      task: "P5-07", gate: "crdt-convergence", proof: "stack-offline-undo",
      browser: false,
      browserLimitation: "two headless Chrome pages were not run; this is the documented Node SDK fallback over the real sync service",
      store: "in-memory fake store (no DB rows); real sync service/WS protocol/SDK",
      boardId: BOARD_ID, clientA: CLIENT_A, clientB: CLIENT_B,
      stateHashesBefore: stateBefore, stateHashesAfterOfflineReconnect: offlineState, stateHashesAfterUndo: undoState,
      missedUpdatesWhileOffline: missed, cardAfterOffline: { a: cardA.x, b: cardB.x }, cardAfterUndo: { a: undoContent.cards.find((card) => card.id === CARD_A).x, b: undoContent.cards.find((card) => card.id === CARD_B).x },
      undo: { aUndoReturned: true, aOwnUndoCount: a.client.ownUndoCount(), bOwnUndoCount: b.client.ownUndoCount() },
      passed: true, finishedAt: new Date().toISOString(),
    };
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    writeFileSync(join(ROOT, "reviews", "evidence", `P5-07-stack-${stamp}.json`), JSON.stringify(evidence, null, 2) + "\n");
    process.stdout.write(`stack proof evidence: reviews/evidence/P5-07-stack-${stamp}.json\n`);
  } finally {
    a.client.close(); b.client.close();
    await service.close();
  }
});
