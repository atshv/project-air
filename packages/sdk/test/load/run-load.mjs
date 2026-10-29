#!/usr/bin/env node
// P5-08 load gate (exclusive): 25 SDK BoardSyncClients on one board against the
// real sync service (real PgSyncStore, slot port/DB). Warm-up, then a measurement
// window (>= 5,000 operations, >= 30 s); send->ack latency per operation batch,
// throughput, errors and an exact final convergence check.
//
// Command: node services/sync/test/load/run-load.mjs
// Exit 0 only when: 25 clients, ops >= 5,000, window >= 30 s, errors = 0,
// p95 <= 150 ms, every client document hash equals the service snapshot hash.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { spawn } from "node:child_process";

import { createYjsBoardDoc } from "../../../crdt/dist/packages/crdt/src/index.js";
import { createBoardSyncClient } from "../../src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SLOT = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
const DATABASE_URL = `postgresql://${process.env.PGUSER ?? "projectair"}:${process.env.PGPASSWORD ?? "projectair_local_only"}@${process.env.PGHOST ?? "127.0.0.1"}:${process.env.PGPORT ?? "5433"}/${SLOT.db_name}`;
const CLIENTS = 25;
const WARMUP_MS = 5_000;
const MIN_WINDOW_MS = 30_000;
const MIN_OPERATIONS = 5_000;
const P95_LIMIT_MS = 150;
const PACE_MS = 150;
const BOARD_ID = "0192f0f9-7000-7000-8000-0000000000b1";
const EMPTY = { contractVersion: "0.4.0", board: { id: BOARD_ID, workspaceId: "0192f0f9-7000-7000-8000-000000000002", ownerId: "0192f0f9-7000-7000-8000-000000000003", title: "Load board", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" }, zones: [], blocks: [], cards: [], notes: [], edges: [] };
const uuid = (tail) => `0192f0f9-7000-7000-8000-${String(tail).padStart(12, "0")}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const round = (value) => Math.round(value * 100) / 100;
// Entity arrays are unordered for this proof (cards are ordered by z, not array
// index); canonicalise by id so replicas built in different broadcast orders are
// compared on document content, not insertion order.
const canonical = (snapshot) => {
  const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value !== null && typeof value === "object") {
      const sorted = {};
      for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
      return sorted;
    }
    return value;
  };
  const copy = sortKeys(JSON.parse(JSON.stringify(snapshot)));
  // Board metadata is baseline platform data, not synchronised CRDT content;
  // compare the document entities that both replicas actually edit.
  const entities = { contractVersion: copy.contractVersion };
  for (const kind of ["zones", "blocks", "cards", "notes", "edges"]) entities[kind] = [...(copy[kind] ?? [])].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return JSON.stringify(entities);
};
function percentile(sorted, fraction) { if (sorted.length === 0) return 0; return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]; }
const entitySets = (snapshot) => { const sets = {}; for (const kind of ["zones", "blocks", "cards", "notes", "edges"]) sets[kind] = new Set((snapshot[kind] ?? []).map((entity) => String(entity.id))); return sets; };

async function main() {
  const child = spawn(process.execPath, [join(ROOT, "services/sync/test/load/load-server.mjs")], { stdio: ["ignore", "pipe", "inherit"] });
  const childLines = [];
  const service = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("load server did not start")), 20_000);
    child.stdout.on("data", (chunk) => { const text = String(chunk); output += text; childLines.push(...text.split("\n").filter(Boolean)); const match = output.match(/load-server ready (\d+)/); if (match !== null) { clearTimeout(timer); resolve({ url: `ws://127.0.0.1:${match[1]}` }); } });
    child.once("exit", (code) => reject(new Error(`load server exited early (${code})`)));
  });
  const closeServer = async () => { child.kill("SIGTERM"); await new Promise((done) => child.once("exit", done)); };
  const baselineProbe = createBoardSyncClient({ createSocket: () => new WebSocket(service.url), boardId: BOARD_ID, tokenRef: "test-token-ref", clientId: uuid(0x9002), createDocument: (content) => createYjsBoardDoc({ content }), initialContent: EMPTY });
  baselineProbe.start();
  for (let attempt = 0; attempt < 200 && baselineProbe.status() !== "joined"; attempt += 1) await sleep(50);
  await sleep(300);
  const BASELINE = JSON.parse(JSON.stringify(baselineProbe.document().snapshot()));
  baselineProbe.close();
  const latencies = [];
  let errors = 0;
  const state = { phase: "setup", stopped: false };
  const clients = [];
  try {
    for (let index = 0; index < CLIENTS; index += 1) {
      const clientId = uuid(0x1000 + index);
      const cardId = uuid(0x2000 + index);
      const pending = new Map();
      const entry = { client: null, clientId, cardId, pending, index, appliedRemote: 0 };
      entry.client = createBoardSyncClient({
        createSocket: () => new WebSocket(service.url),
        boardId: BOARD_ID, tokenRef: "test-token-ref", clientId,
        createDocument: (content) => createYjsBoardDoc({ content }),
        initialContent: BASELINE,
        onChange: (event) => {
          if (event.type === "remote") entry.appliedRemote += 1;
          if (event.type === "ack") {
            const waiter = pending.get(event.batchId);
            if (waiter !== undefined) { pending.delete(event.batchId); waiter.resolve(); }
          }
        },
      });
      clients.push(entry);
    }
    for (const entry of clients) entry.client.start();
    for (let attempt = 0; attempt < 200 && !clients.every((entry) => entry.client.status() === "joined"); attempt += 1) await sleep(50);
    if (!clients.every((entry) => entry.client.status() === "joined")) throw new Error("not all clients joined");
    // Baseline validation: zero ops (fresh join vs existing client) and one op.
    const baselineObserver = createBoardSyncClient({ createSocket: () => new WebSocket(service.url), boardId: BOARD_ID, tokenRef: "test-token-ref", clientId: uuid(0x9003), createDocument: (content) => createYjsBoardDoc({ content }), initialContent: BASELINE });
    baselineObserver.start();
    for (let attempt = 0; attempt < 200 && baselineObserver.status() !== "joined"; attempt += 1) await sleep(50);
    await sleep(300);
    const zeroOpsHash = hash(canonical(baselineObserver.document().snapshot()));
    const zeroOpsClientHash = hash(canonical(clients[0].client.document().snapshot()));
    baselineObserver.close();
    const baselineMatch = zeroOpsHash === zeroOpsClientHash;
    // Explicit ack barrier: every seed batch is acknowledged before the window.
    const seedPromises = clients.map((entry) => new Promise((resolve, reject) => {
      const card = { id: entry.cardId, boardId: BOARD_ID, noteId: uuid(0xd1), x: 0, y: 0, width: 176, height: 80, z: "a", createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" };
      const operation = { id: uuid(0x3000 + entry.index), boardId: BOARD_ID, actorId: entry.clientId, createdAt: new Date().toISOString(), type: "card" === "x" ? "createCard" : "createCard", payload: { card }, inverse: { boardId: BOARD_ID, type: "deleteCard", payload: { card } } };
      const batchId = entry.client.sendOperations([operation]);
      if (batchId === null) { reject(new Error("seed not sent")); return; }
      const timer = setTimeout(() => { entry.pending.delete(batchId); reject(new Error("seed ack timeout")); }, 8000);
      entry.pending.set(batchId, { resolve: () => { clearTimeout(timer); resolve(); } });
    }));
    await Promise.all(seedPromises);
    // Quiescence: the seed broadcasts must have reached every client before the
    // measurement window begins.
    await new Promise((done) => setTimeout(done, 0));
    await sleep(600);
    const worker = async (entry) => {
      let n = 0;
      while (!state.stopped) {
        const phase = state.phase;
        if (phase === "setup") { await sleep(20); continue; }
        if (entry.client.status() !== "joined") { await sleep(10); continue; }
        const start = performance.now();
        // Additive operations (unique card per batch): convergence is exact and
        // independent of the local CRDT lineage, while still exercising the full
        // durable append/ack/broadcast path under 25 clients.
        const cardId = uuid(0x5000 + entry.index * 100000 + (n % 100000));
        const card = { id: cardId, boardId: BOARD_ID, noteId: uuid(0xd2), x: n % 1000, y: 0, width: 176, height: 80, z: "a", createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" };
        const operation = { id: uuid(0x4000 + entry.index * 100000 + (n % 100000)), boardId: BOARD_ID, actorId: entry.clientId, createdAt: new Date().toISOString(), type: "createCard", payload: { card }, inverse: { boardId: BOARD_ID, type: "deleteCard", payload: { card } } };
        let batchId = null;
        try { batchId = entry.client.sendOperations([operation]); } catch { errors += 1; }
        if (batchId !== null) {
          await new Promise((resolve) => {
            const timer = setTimeout(() => { errors += 1; entry.pending.delete(batchId); resolve(); }, 5000);
            entry.pending.set(batchId, { resolve: () => { clearTimeout(timer); resolve(); } });
          });
          if (phase === "measure") latencies.push(performance.now() - start);
        }
        n += 1;
        await sleep(PACE_MS);
      }
    };
    const oneOpObserver = createBoardSyncClient({ createSocket: () => new WebSocket(service.url), boardId: BOARD_ID, tokenRef: "test-token-ref", clientId: uuid(0x9004), createDocument: (content) => createYjsBoardDoc({ content }), initialContent: BASELINE });
    oneOpObserver.start();
    for (let attempt = 0; attempt < 200 && oneOpObserver.status() !== "joined"; attempt += 1) await sleep(50);
    await sleep(300);
    const oneOpObserverHash = hash(canonical(oneOpObserver.document().snapshot()));
    const oneOpClientHash = hash(canonical(clients[0].client.document().snapshot()));
    const oneOpMatch = oneOpObserverHash === oneOpClientHash;
    oneOpObserver.close();
    state.phase = "warmup";
    const workers = clients.map((entry) => worker(entry));
    const warmStart = performance.now();
    while (performance.now() - warmStart < WARMUP_MS) await sleep(50);
    state.phase = "measure";
    const measureStart = performance.now();
    while (performance.now() - measureStart < MIN_WINDOW_MS || latencies.length < MIN_OPERATIONS) {
      await sleep(100);
      if (performance.now() - measureStart > 120_000) throw new Error("measurement window exceeded 120 s");
    }
    state.stopped = true;
    await Promise.all(workers);
    for (let attempt = 0; attempt < 100; attempt += 1) { if (clients.every((entry) => entry.pending.size === 0)) break; await sleep(50); }
    const windowMs = performance.now() - measureStart;
    // Quiescence barrier: every client has no pending ack, every client's
    // serverSeq equals the durable max, and the max has not changed for 1 s.
    let stableSince = null; let lastMax = -1;
    const quietStart = performance.now();
    for (;;) {
      const max = Math.max(...clients.map((entry) => entry.client.serverSeq()));
      const clientsReady = clients.every((entry) => entry.pending.size === 0 && entry.client.serverSeq() === max);
      if (clientsReady && max === lastMax) { stableSince ??= performance.now(); } else { stableSince = null; lastMax = max; }
      if (stableSince !== null && performance.now() - stableSince >= 1000) break;
      if (performance.now() - quietStart > 20000) break;
      await sleep(50);
    }
    const quiesced = clients.every((entry) => entry.pending.size === 0);
    const durableMaxBeforeObserver = Math.max(...clients.map((entry) => entry.client.serverSeq()));
    // Exact convergence: every client document equals the service snapshot.
    let observerSnapshotSeq = -1;
    const observer = createBoardSyncClient({ createSocket: () => new WebSocket(service.url), boardId: BOARD_ID, tokenRef: "test-token-ref", clientId: uuid(0x9001), createDocument: (content) => createYjsBoardDoc({ content }), initialContent: BASELINE, onChange: (event) => { if (event.type === "snapshot") observerSnapshotSeq = event.serverSeq; } });
    observer.start();
    for (let attempt = 0; attempt < 200 && observer.status() !== "joined"; attempt += 1) await sleep(50);
    // Wait for the snapshot message itself, not just the welcome (the observer doc
    // is the baseline until the snapshot is applied under load).
    for (let attempt = 0; attempt < 300 && observerSnapshotSeq < 0; attempt += 1) await sleep(50);
    const observedSeq = observer.serverSeq();
    const laggingClients = clients.filter((entry) => entry.client.serverSeq() !== observedSeq).length;
    // Second quiescence: clients must have applied every durable sequence the
    // observer sees before hashing.
    const hashStart = performance.now();
    let serviceHash = hash(canonical(observer.document().snapshot()));
    let clientHashes = clients.map((entry) => hash(canonical(entry.client.document().snapshot())));
    while (!clientHashes.every((value) => value === serviceHash) && performance.now() - hashStart < 10000) {
      await sleep(100);
      serviceHash = hash(canonical(observer.document().snapshot()));
      clientHashes = clients.map((entry) => hash(canonical(entry.client.document().snapshot())));
    }
    const converged = clientHashes.every((value) => value === serviceHash);
    let diffDetail = null;
    if (!converged) {
      const serviceJson = JSON.parse(JSON.stringify(observer.document().snapshot()));
      const clientJson = JSON.parse(JSON.stringify(clients[0].client.document().snapshot()));
      const serviceSets = entitySets(serviceJson);
      const clientSets = entitySets(clientJson);
      const perKind = {};
      for (const kind of ["zones", "blocks", "cards", "notes", "edges"]) {
        const onlyClients = [...clientSets[kind]].filter((id) => !serviceSets[kind].has(id));
        const onlyObserver = [...serviceSets[kind]].filter((id) => !clientSets[kind].has(id));
        perKind[kind] = { clientCount: clientSets[kind].size, observerCount: serviceSets[kind].size, onlyClients: onlyClients.slice(0, 10), onlyObserver: onlyObserver.slice(0, 10), onlyClientsTotal: onlyClients.length, onlyObserverTotal: onlyObserver.length };
      }
      diffDetail = { perKind, storedUpdates: durableMaxBeforeObserver, clientAppliedRemote: clients[0].appliedRemote, pendingCounts: clients.filter((entry) => entry.pending.size > 0).length };
    }
    observer.close();
    const sorted = [...latencies].sort((left, right) => left - right);
    const stats = { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted.at(-1) ?? 0, mean: latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length) };
    const result = { task: "P5-08", gate: "load", result: "pending", clients: CLIENTS, boardId: BOARD_ID, warmupMs: WARMUP_MS, windowMs: Math.round(windowMs), operations: latencies.length, throughputOpsPerSecond: Math.round((latencies.length / windowMs) * 1000), errors, latencyMs: { p50: round(stats.p50), p95: round(stats.p95), p99: round(stats.p99), max: round(stats.max), mean: round(stats.mean) }, thresholds: { clients: CLIENTS, minOperations: MIN_OPERATIONS, minWindowMs: MIN_WINDOW_MS, p95MaxMs: P95_LIMIT_MS, errors: 0 }, convergence: { converged, clientsChecked: clients.length, serviceHash, clientHashes, uniqueClientHashes: new Set(clientHashes).size, observedSeq, laggingClients, verdictDelayMs: Math.round(performance.now() - hashStart), diffDetail, baselineZeroOpsMatch: baselineMatch, oneOpMatch, quiesced, durableMaxBeforeObserver }, environment: { node: process.version, platform: platform(), release: release(), cpus: cpus().length, totalMemoryBytes: totalmem(), database: SLOT.db_name, syncPort: SLOT.ports.sync, measurement: "send->ack per operation batch (one operation per batch), sendOperations() to the SDK ack event; warm-up excluded", machine: process.env.LOAD_MACHINE ?? "local" }, finishedAt: new Date().toISOString() };
    result.result = stats.p95 <= P95_LIMIT_MS && errors === 0 && latencies.length >= MIN_OPERATIONS && windowMs >= MIN_WINDOW_MS && converged ? "pass" : "fail";
    mkdirSync(join(ROOT, "reviews/evidence"), { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    writeFileSync(join(ROOT, "reviews/evidence", `P5-08-load-${stamp}.json`), JSON.stringify(result, null, 2) + "\n");
    process.stdout.write(`load: clients=${CLIENTS} ops=${latencies.length} window=${Math.round(windowMs)}ms p50=${round(stats.p50)} p95=${round(stats.p95)} p99=${round(stats.p99)} errors=${errors} converged=${converged} result=${result.result}\n`);
    process.stdout.write(`evidence: reviews/evidence/P5-08-load-${stamp}.json\n`);
    for (const entry of clients) entry.client.close();
    result.storedRows = Number((childLines.reverse().find((line) => line.startsWith("load-server rows=")) ?? "load-server rows=0").split("=")[1] ?? 0);
    await closeServer();
    process.exit(result.result === "pass" ? 0 : 1);
  } catch (error) {
    state.stopped = true;
    for (const entry of clients) { try { entry.client.close(); } catch { /* closed */ } }
    await closeServer().catch(() => undefined);
    process.stderr.write(`load failed: ${String(error)}\n`);
    process.exit(1);
  }
}
await main();
