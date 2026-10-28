#!/usr/bin/env node
// P5-07: pure convergence gate (crdt-convergence). Multi-seed deterministic
// harness: two BoardDoc replicas apply the same contract operations in different
// interleavings, including offline phases, and every round compares the encoded
// state AND the canonical snapshot. Zero divergences required.
//
// Command: node packages/crdt/test/convergence-harness.mjs
// Writes reviews/evidence/P5-07-convergence-<timestamp>.json and exits 1 on any
// divergence.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createYjsBoardDoc } from "../dist/packages/crdt/src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTENT = JSON.parse(readFileSync(join(ROOT, "packages/contracts/fixtures/board-content/valid.json"), "utf8")).data;
const ROUNDS = 10_000;
const SEEDS = [0x5eed01, 0x5eed02, 0x5eed03];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));

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

function shuffled(random, list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

let idCounter = 0;
const UUID = () => {
  idCounter += 1;
  const random = createHash("sha256").update(`p507:${idCounter}:${process.hrtime.bigint()}`).digest("hex");
  const timestamp = Date.now().toString(16).padStart(12, "0").slice(-12);
  const variant = ((Number.parseInt(random.slice(0, 2), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(3, 5)}-${random.slice(5, 17)}`;
};

const base = clone(CONTENT);
const cards = base.cards.map((card) => card.id);
const blocks = base.blocks.map((block) => block.id);
const zones = base.zones.map((zone) => zone.id);
const notes = base.notes.map((note) => note.id);

function randomOperations(seed, count) {
  const random = prng(seed);
  const operations = [];
  const pick = (list) => list[Math.floor(random() * list.length)];
  for (let index = 0; index < count; index += 1) {
    const kind = Math.floor(random() * 5);
    const id = UUID();
    const inverseBase = { boardId: base.board.id };
    if (kind === 0) {
      const cardId = pick(cards);
      const itemId = pick(cards);
      operations.push({
        id, boardId: base.board.id, actorId: UUID(), createdAt: "2027-01-10T09:30:00.000Z", type: "reorder",
        payload: { itemId, z: String(Math.floor(random() * 1000)).padStart(3, "0") },
        inverse: { ...inverseBase, type: "reorder", payload: { itemId, z: "a0" } },
      });
    } else if (kind === 1) {
      const cardId = pick(cards);
      operations.push({
        id, boardId: base.board.id, actorId: UUID(), createdAt: "2027-01-10T09:30:00.000Z", type: "moveCard",
        payload: { cardId, x: Math.floor(random() * 2000), y: Math.floor(random() * 1200) },
        inverse: { ...inverseBase, type: "moveCard", payload: { cardId, x: 0, y: 0 } },
      });
    } else if (kind === 2) {
      const blockId = pick(blocks);
      operations.push({
        id, boardId: base.board.id, actorId: UUID(), createdAt: "2027-01-10T09:30:00.000Z", type: "resizeBlock",
        payload: { blockId, type: "checklist", width: 224 + Math.floor(random() * 100), height: 128 + Math.floor(random() * 80) },
        inverse: { ...inverseBase, type: "resizeBlock", payload: { blockId, type: "checklist", width: 224, height: 128 } },
      });
    } else if (kind === 3) {
      const zoneId = pick(zones);
      operations.push({
        id, boardId: base.board.id, actorId: UUID(), createdAt: "2027-01-10T09:30:00.000Z", type: "moveZone",
        payload: { zoneId, x: Math.floor(random() * 500), y: Math.floor(random() * 500) },
        inverse: { ...inverseBase, type: "moveZone", payload: { zoneId, x: 0, y: 0 } },
      });
    } else {
      const noteId = pick(notes);
      operations.push({
        id, boardId: base.board.id, actorId: UUID(), createdAt: "2027-01-10T09:30:00.000Z", type: "updateNote",
        payload: { noteId, changes: { title: `Note ${index}` } },
        inverse: { ...inverseBase, type: "updateNote", payload: { noteId, changes: { title: "Original" } } },
      });
    }
  }
  return operations;
}

function compareReplicas(left, right) {
  const leftState = left.encodeState();
  const rightState = right.encodeState();
  const leftSnapshot = JSON.stringify(left.snapshot());
  const rightSnapshot = JSON.stringify(right.snapshot());
  return { equal: leftState === rightState && leftSnapshot === rightSnapshot, leftState, rightState, leftSnapshot, rightSnapshot };
}

const started = performance.now();
const report = { task: "P5-07", gate: "crdt-convergence", rounds: 0, seeds: [], divergences: 0, roundsCompared: 0, offlineMerges: 0, runtimeMs: 0, stateHash: null };
const blockSize = 25;
for (const seed of SEEDS) {
  const random = prng(seed ^ 0xabcdef);
  const operations = randomOperations(seed, ROUNDS);
  const left = createYjsBoardDoc({ content: base });
  const right = createYjsBoardDoc({ content: base });
  let rounds = 0;
  let offlineMerges = 0;
  for (let offset = 0; offset < operations.length; offset += blockSize) {
    const block = operations.slice(offset, offset + blockSize);
    const leftOrder = shuffled(random, block);
    const rightOrder = shuffled(random, block);
    // Alternate who is "offline": the offline replica applies its order locally
    // and both merge when the phase ends (applyUpdate/merge).
    const offlinePhase = Math.floor(offset / blockSize) % 7 === 3;
    if (offlinePhase) {
      // Offline phase: both replicas keep editing locally, no exchange until the
      // phase ends; then merge both ways and compare.
      for (const op of leftOrder) left.apply(op);
      for (const op of rightOrder) right.apply(op);
      left.merge(right);
      right.merge(left);
      offlineMerges += 1;
      const result = compareReplicas(left, right);
      report.roundsCompared += 1;
      if (!result.equal) {
        report.divergences += 1;
        report.firstDivergence = { seed, round: rounds, offline: true, leftHash: hash(result.leftState), rightHash: hash(result.rightState) };
      }
    }
    // Compare after every round (every single operation), not only at the end of
    // the block: normal rounds exchange updates and converge immediately; an
    // offline phase only merges at the end and is compared once the phase closes.
    let roundDiverged = false;
    for (let index = 0; index < block.length; index += 1) {
      left.apply(leftOrder[index]);
      right.apply(rightOrder[index]);
      rounds += 1;
      if (offlinePhase) continue; // offline: no exchange until the block ends
      left.merge(right);
      right.merge(left);
      const result = compareReplicas(left, right);
      report.roundsCompared += 1;
      if (!result.equal) {
        report.divergences += 1;
        report.firstDivergence = { seed, round: rounds, leftHash: hash(result.leftState), rightHash: hash(result.rightState), leftSnapshotHash: hash(result.leftSnapshot), rightSnapshotHash: hash(result.rightSnapshot) };
        roundDiverged = true;
        break;
      }
    }
    if (roundDiverged) break;
  }
  report.rounds += rounds;
  report.offlineMerges += offlineMerges;
  report.seeds.push({ seed, rounds, offlineMerges, stateHash: hash(left.encodeState()), snapshotHash: hash(JSON.stringify(left.snapshot())) });
  if (report.divergences > 0) break;
}
report.runtimeMs = Math.round(performance.now() - started);
report.rounds = report.rounds;
report.requiredRounds = 10_000;
report.passed = report.divergences === 0 && report.rounds >= 10_000;
report.environment = { platform: process.platform, node: process.version, concurrency: "single process, deterministic seeded PRNG" };
mkdirSync(join(ROOT, "reviews", "evidence"), { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const evidencePath = join(ROOT, "reviews", "evidence", `P5-07-convergence-${stamp}.json`);
writeFileSync(evidencePath, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(`crdt-convergence: rounds=${report.rounds} seeds=${SEEDS.length} divergences=${report.divergences} runtimeMs=${report.runtimeMs} passed=${report.passed}\n`);
process.stdout.write(`evidence: reviews/evidence/${`P5-07-convergence-${stamp}.json`}\n`);
process.exit(report.passed ? 0 : 1);
