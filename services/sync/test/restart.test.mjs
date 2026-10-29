// P5-06 restart harness: real child process on the slot port with the slot
// PostgreSQL, N acked operation batches, SIGTERM, restart, reconnect and exact
// catch-up; then snapshot compaction and a restart that reproduces the same
// state. The JSON numbers are written to reviews/evidence by the test.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { compactBoard } from "../src/compaction.ts";
import { PgSyncStore } from "../src/store.ts";
import { createFakeDocuments, NOTE_ID } from "./restart-fixtures.mjs";

const { Client } = pg;
const BOARD_ID = "0192f0f7-7000-7000-8000-0000000000b1";
const CLIENT_ID = "0192f0f7-7000-7000-8000-0000000000c1";
const CLIENT_B = "0192f0f7-7000-7000-8000-0000000000c2";
const UUID = (tail) => `0192f0f7-7000-7000-8000-${String(tail).padStart(12, "0")}`;

function slot() {
  const config = JSON.parse(readFileSync(join(fileURLToPath(new URL("../../..", import.meta.url)), ".polier-slot"), "utf8"));
  const host = process.env.PGHOST ?? "127.0.0.1";
  const port = process.env.PGPORT ?? "5433";
  return { syncPort: config.ports.sync, databaseUrl: `postgresql://${process.env.PGUSER ?? "projectair"}:${process.env.PGPASSWORD ?? "projectair_local_only"}@${host}:${port}/${config.db_name}` };
}

async function waitHealth(port) {
  for (let index = 0; index < 100; index += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) return; } catch { /* starting */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("restart-server never became healthy");
}

function spawnServer({ syncPort, databaseUrl }) {
  return spawn(process.execPath, ["services/sync/test/restart-server.mjs"], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: {
      ...process.env,
      SYNC_PORT: String(syncPort),
      DATABASE_URL: databaseUrl,
      AUTH_SERVICE_URL: "http://127.0.0.1:4120",
      PLATFORM_SERVICE_URL: "http://127.0.0.1:4110",
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  const closeInfo = {};
  const closed = new Promise((resolve) => ws.addEventListener("close", (event) => { closeInfo.event = event; resolve(true); }));
  ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  return {
    ws, messages, closed, closeInfo,
    send(message) { ws.send(JSON.stringify(message)); },
    async waitFor(predicate, timeoutMs = 5000) {
      const started = Date.now();
      for (;;) {
        const found = messages.find(predicate);
        if (found !== undefined) return found;
        if (Date.now() - started > timeoutMs) throw new Error(`timeout; messages=${JSON.stringify(messages).slice(0, 400)}`);
        await new Promise((done) => setTimeout(done, 10));
      }
    },
  };
}

async function joinBoard(port, clientId = CLIENT_ID) {
  const socket = await connect(port);
  socket.send({ id: UUID(0x9000 + Math.floor(Math.random() * 1000)), type: "hello", clientId, payload: { tokenRef: "test-token-ref", contractVersion: "0.5.0" } });
  socket.send({ id: UUID(0x9100 + Math.floor(Math.random() * 1000)), type: "joinBoard", clientId, boardId: BOARD_ID, seq: 2, payload: {} });
  const welcome = await socket.waitFor((message) => message.type === "welcome");
  const snapshot = await socket.waitFor((message) => message.type === "snapshot");
  return { socket, welcome, snapshot };
}

const operation = (index) => ({
  id: UUID(0x2000 + index), boardId: BOARD_ID, actorId: UUID(0x3000), createdAt: new Date().toISOString(),
  type: "reorder", payload: { itemId: UUID(0x4000 + index), z: "a" },
  inverse: { boardId: BOARD_ID, type: "reorder", payload: { itemId: UUID(0x4000 + index), z: "b" } },
});

// P6-08: one contract 0.4.0 note-body operation at the end of the batch list so
// the body survives the same ack → persist → restart → compaction path.
const BODY = {
  version: "1",
  blocks: [
    { type: "paragraph", text: "Restart body." },
    { type: "list", text: "Source", marks: ["link"], href: "https://example.test/source" },
  ],
};
const BODY_PLAIN_TEXT = "Restart body.\n- Source";
const NOTE = { id: NOTE_ID, workspaceId: UUID(0xa2), title: "Restart note", createdAt: "2027-01-10T09:30:00.000Z", updatedAt: "2027-01-10T09:30:00.000Z" };
const bodyOperations = [
  {
    id: UUID(0x2100), boardId: BOARD_ID, actorId: UUID(0x3000), createdAt: new Date().toISOString(),
    type: "createNote", payload: { note: NOTE },
    inverse: { boardId: BOARD_ID, type: "deleteNote", payload: { note: NOTE, cards: [] } },
  },
  {
    id: UUID(0x2101), boardId: BOARD_ID, actorId: UUID(0x3000), createdAt: new Date().toISOString(),
    type: "updateNoteBody", payload: { noteId: NOTE_ID, body: BODY },
    inverse: { boardId: BOARD_ID, type: "updateNoteBody", payload: { noteId: NOTE_ID, body: { version: "1", blocks: [] } } },
  },
];

// P6-13: contract 0.5.0 — a zone rename and a checklist content edit take the
// same ack → persist → restart → compaction path.
const ZONE = { id: UUID(0x7100), boardId: BOARD_ID, title: "Research", x: 0, y: 0, width: 256, height: 192, z: "a", createdAt: "2027-01-10T09:30:00.000Z", updatedAt: "2027-01-10T09:30:00.000Z" };
const BLOCK = { id: UUID(0x7200), boardId: BOARD_ID, type: "checklist", x: 0, y: 240, width: 224, height: 128, z: "a", createdAt: "2027-01-10T09:30:00.000Z", updatedAt: "2027-01-10T09:30:00.000Z" };
const CHECKLIST = { kind: "checklist", items: [{ id: UUID(0x7300), text: "Survives the restart", done: true }] };
const contentOperations = [
  {
    id: UUID(0x2200), boardId: BOARD_ID, actorId: UUID(0x3000), createdAt: new Date().toISOString(),
    type: "createZone", payload: { zone: ZONE }, inverse: { boardId: BOARD_ID, type: "deleteZone", payload: { zone: ZONE, policy: "keep", cards: [], blocks: [] } },
  },
  {
    id: UUID(0x2201), boardId: BOARD_ID, actorId: UUID(0x3000), createdAt: new Date().toISOString(),
    type: "updateZone", payload: { zoneId: ZONE.id, title: "Field research" }, inverse: { boardId: BOARD_ID, type: "updateZone", payload: { zoneId: ZONE.id, title: ZONE.title } },
  },
  {
    id: UUID(0x2202), boardId: BOARD_ID, actorId: UUID(0x3000), createdAt: new Date().toISOString(),
    type: "createBlock", payload: { block: BLOCK }, inverse: { boardId: BOARD_ID, type: "deleteBlock", payload: { block: BLOCK } },
  },
  {
    id: UUID(0x2203), boardId: BOARD_ID, actorId: UUID(0x3000), createdAt: new Date().toISOString(),
    type: "updateBlockContent", payload: { blockId: BLOCK.id, content: CHECKLIST },
    inverse: { boardId: BOARD_ID, type: "updateBlockContent", payload: { blockId: BLOCK.id, content: { kind: "checklist", items: [] } } },
  },
];
const tailOperations = [...bodyOperations, ...contentOperations];

test("restart, catch-up and snapshot compaction preserve every acked update", { timeout: 90_000 }, async () => {
  const { syncPort, databaseUrl } = slot();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const store = new PgSyncStore({ connectionString: databaseUrl });
  const operationCount = 22;
  const evidencePath = join(fileURLToPath(new URL("../../..", import.meta.url)), "reviews", "evidence", `P5-06-restart-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.json`);
  let child = null;
  try {
    await client.query("DELETE FROM sync_updates WHERE board_id = $1", [BOARD_ID]);
    await client.query("DELETE FROM sync_snapshots WHERE board_id = $1", [BOARD_ID]);

    // First run: empty board baseline 1, N acked operations, then SIGTERM.
    child = spawnServer({ syncPort, databaseUrl });
    await waitHealth(syncPort);
    const first = await joinBoard(syncPort);
    assert.equal(first.welcome.serverSeq, 1, "an empty board starts at the baseline serverSeq 1");
    const acked = [];
    let seq = 3;
    for (let index = 0; index < operationCount; index += 1) {
      const op = index < operationCount - tailOperations.length ? operation(index) : tailOperations[index - (operationCount - tailOperations.length)];
      first.socket.send({ id: UUID(0x5000 + index), type: "operationBatch", clientId: CLIENT_ID, boardId: BOARD_ID, seq, payload: { batchId: UUID(0x6000 + index), operations: [op] } });
      const ack = await first.socket.waitFor((message) => message.type === "ack" && message.payload?.batchId === UUID(0x6000 + index));
      acked.push({ id: op.id, serverSeq: ack.serverSeq });
      seq += 1;
    }
    assert.deepEqual(acked.map((entry) => entry.serverSeq), Array.from({ length: operationCount }, (_, index) => 2 + index), "the acked serverSeq values are contiguous from 2");
    const observer = await joinBoard(syncPort, CLIENT_B);
    child.kill("SIGTERM");
    const closeEvent = await observer.socket.closed;
    assert.equal(closeEvent, true, "shutdown closes the connected sockets");
    await new Promise((resolve) => child.once("exit", resolve));
    const persisted = await client.query("SELECT server_seq FROM sync_updates WHERE board_id = $1 ORDER BY server_seq", [BOARD_ID]);
    assert.equal(persisted.rowCount, operationCount, "every acked update is durable across the restart");
    assert.equal(Number(persisted.rows.at(-1).server_seq), operationCount + 1, "the durable sequence continues after the last ack");

    // Second run: serverSeq continues; the reloaded document has every acked op.
    child = spawnServer({ syncPort, databaseUrl });
    await waitHealth(syncPort);
    const second = await joinBoard(syncPort);
    assert.equal(second.welcome.serverSeq, operationCount + 1, "serverSeq continues monotonically across the restart");
    const ids = second.snapshot.payload.boardContent.cards.map((card) => card.id).sort();
    assert.deepEqual(ids, acked.map((entry) => entry.id).sort(), "every acked operation is present after the restart (snapshot+replay)");
    const restartedNote = second.snapshot.payload.boardContent.notes.find((note) => note.id === NOTE_ID);
    assert.deepEqual(restartedNote.body, BODY, "the updateNoteBody body survives the restart (replayed update)");
    assert.equal(restartedNote.plainText, BODY_PLAIN_TEXT, "the derived plainText survives the restart");
    assert.equal(second.snapshot.payload.boardContent.zones.find((zone) => zone.id === ZONE.id).title, "Field research", "the updateZone title survives the restart");
    assert.deepEqual(second.snapshot.payload.boardContent.blocks.find((block) => block.id === BLOCK.id).content, CHECKLIST, "the updateBlockContent content survives the restart");
    const preCompactionSnapshot = second.snapshot.payload.boardContent;
    // Exact catch-up boundaries at the log level: empty, one, large gaps.
    assert.equal((await client.query("SELECT count(*)::int AS count FROM sync_updates WHERE board_id = $1 AND server_seq > $2", [BOARD_ID, operationCount + 1])).rows[0].count, 0, "empty catch-up at the current sequence");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM sync_updates WHERE board_id = $1 AND server_seq > $2", [BOARD_ID, operationCount])).rows[0].count, 1, "one-update catch-up after the previous sequence");
    const large = await client.query("SELECT server_seq FROM sync_updates WHERE board_id = $1 AND server_seq > 1 ORDER BY server_seq", [BOARD_ID]);
    assert.equal(large.rowCount, operationCount, "the large gap returns exactly the missed ordered updates");
    assert.deepEqual(large.rows.map((row) => Number(row.server_seq)), Array.from({ length: operationCount }, (_, index) => 2 + index), "catch-up is ordered with no gaps or duplicates");
    const resync = await (async () => {
      second.socket.send({ id: UUID(0x9200), type: "resyncRequest", clientId: CLIENT_ID, boardId: BOARD_ID, seq, payload: { fromServerSeq: operationCount + 1 } });
      return second.socket.waitFor((message) => message.type === "snapshot" && message.id === UUID(0x9200));
    })();
    assert.equal(resync.serverSeq, operationCount + 1, "a current client's catch-up is empty but confirmed at the current sequence");
    second.socket.ws.close();

    // Snapshot compaction: threshold 1, snapshot at the current sequence, prune
    // only covered updates; the crash-order property is covered by the store's
    // snapshot-then-prune transaction in writeCompactedSnapshot.
    const compacted = await compactBoard({ boardId: BOARD_ID, store, documents: createFakeDocuments(), minUpdates: 1 });
    assert.equal(compacted.skipped, false);
    assert.equal(compacted.snapshotSeq, operationCount + 1, "the snapshot is written at the current serverSeq");
    assert.equal(compacted.pruned, operationCount, "only the covered updates are pruned");
    const afterCompaction = await client.query("SELECT count(*)::int AS count FROM sync_updates WHERE board_id = $1", [BOARD_ID]);
    assert.equal(afterCompaction.rows[0].count, 0, "bounded DB growth: the log is pruned after compaction");
    const snapshots = await client.query("SELECT server_seq FROM sync_snapshots WHERE board_id = $1 ORDER BY server_seq", [BOARD_ID]);
    assert.deepEqual(snapshots.rows.map((row) => Number(row.server_seq)), [1, operationCount + 1], "the baseline and the compacted snapshot remain");

    // Third run: restart after compaction reproduces the same state.
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    child = spawnServer({ syncPort, databaseUrl });
    await waitHealth(syncPort);
    const third = await joinBoard(syncPort);
    assert.equal(third.welcome.serverSeq, operationCount + 1, "serverSeq continues after compaction");
    assert.deepEqual(third.snapshot.payload.boardContent, preCompactionSnapshot, "a compacted restart reproduces exactly the uncompacted state");
    const postIds = third.snapshot.payload.boardContent.cards.map((card) => card.id).sort();
    assert.deepEqual(postIds, acked.map((entry) => entry.id).sort(), "no acknowledged update is lost by compaction");
    const compactedNote = third.snapshot.payload.boardContent.notes.find((note) => note.id === NOTE_ID);
    assert.deepEqual(compactedNote.body, BODY, "compaction keeps the note body");
    assert.equal(compactedNote.plainText, BODY_PLAIN_TEXT, "compaction keeps the derived plainText");
    assert.equal(third.snapshot.payload.boardContent.zones.find((zone) => zone.id === ZONE.id).title, "Field research", "compaction keeps the zone title");
    assert.deepEqual(third.snapshot.payload.boardContent.blocks.find((block) => block.id === BLOCK.id).content, CHECKLIST, "compaction keeps the block content");
    third.socket.ws.close();

    writeFileSync(evidencePath, JSON.stringify({
      task: "P5-06", gate: "restart-harness", result: "pass",
      operations: operationCount, ackedServerSeqs: acked.map((entry) => entry.serverSeq),
      bodyOperation: { type: "updateNoteBody", noteId: NOTE_ID, plainText: BODY_PLAIN_TEXT },
      serverSeqAfterRestart: second.welcome.serverSeq, compaction: compacted,
      catchUp: { emptyAt: operationCount + 1, oneUpdateAfter: operationCount, largeGapRows: large.rowCount },
      shutdown: "sockets closed on SIGTERM; the retryable 1012 close code is covered by the service close path", databaseUrl: "(slot database, not logged)", finishedAt: new Date().toISOString(),
    }, null, 2) + "\n");
    process.stdout.write(`restart harness evidence: ${evidencePath}\n`);
  } finally {
    if (child !== null) { try { child.kill("SIGTERM"); } catch { /* exited */ } }
    await store.close().catch(() => undefined);
    await client.end().catch(() => undefined);
  }
});
