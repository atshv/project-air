// Unit tests for the WebSocket sync protocol of contract 0.2.0.
//
// The suite checks the sync schema (12 message types in one versioned document,
// client-to-server and server-to-client, the reconnect and session sequences),
// the fixtures per message type including the edge cases from the task (empty
// batch, unknown operation type, future resync, unjoined presence), the envelope
// rules (UUIDv7 ids, ISO-8601 timestamps, client seq / server serverSeq), the
// P1-02 operation reference and the sequence rules that JSON Schema alone cannot
// express: catch-up order, ack coverage and durable acknowledged batches (AD-2).
//
// The sync fixtures live under fixtures-sync/, outside the 77-fixture parity
// corpus in fixtures/, so the parity test and its count stay unchanged.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  CONTRACT_BASE_URI,
  CONTRACT_VERSION,
  PACKAGE_DIR,
  SYNC_FIXTURE_DIRS,
  SYNC_MESSAGE_TYPES,
  SYNC_SCHEMA_FILE,
  SYNC_SCHEMA_ID,
  schemaId,
  syncFixturePath,
  syncSchemaPath,
} from "../index.mjs";
import {
  ISO_TIMESTAMP,
  JSON_SCHEMA_2020_12,
  UUID_V7,
  schemaOf,
  validate,
  walk,
} from "./support.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SYNC_SCHEMA = JSON.parse(readFileSync(syncSchemaPath(), "utf8"));
const SYNC_DEFS = SYNC_SCHEMA.$defs;
const OPERATION_SCHEMA = schemaOf("operation");

const schemaValid = (data) => validate(data, SYNC_SCHEMA, SYNC_SCHEMA);
const sequenceValid = (definition, data) => validate(data, SYNC_DEFS[definition], SYNC_SCHEMA);
const fixtureFiles = (validity) => readdirSync(join(PACKAGE_DIR, SYNC_FIXTURE_DIRS[validity])).filter((file) => file.endsWith(".json")).sort();
const fixtureOf = (validity, file) => JSON.parse(readFileSync(syncFixturePath(validity, file), "utf8"));
const kebab = (type) => type.replace(/(?<!^)(?=[A-Z])/g, "-").toLowerCase();
const fixtureKey = (entry) => `${entry.direction}:${entry.type}`;
const validFixtureName = (entry) => `${entry.direction === "client-to-server" ? "client" : "server"}-${kebab(entry.type)}.json`;

// The per-type invalid fixture that proves each message type has a violated
// rule; further invalid fixtures cover the sequence and edge-case rules.
const INVALID_FIXTURE = {
  "client-to-server:hello": "client-hello-missing-token-ref.json",
  "client-to-server:joinBoard": "client-join-board-missing-board.json",
  "client-to-server:leaveBoard": "client-leave-board-carries-operations.json",
  "client-to-server:operationBatch": "client-operation-batch-empty.json",
  "client-to-server:resyncRequest": "client-resync-request-negative-seq.json",
  "client-to-server:presence": "client-presence-carries-operations.json",
  "server-to-client:welcome": "server-welcome-missing-snapshot-ref.json",
  "server-to-client:ack": "server-ack-empty-op-ids.json",
  "server-to-client:operationBatch": "server-operation-batch-empty.json",
  "server-to-client:presence": "server-presence-missing-name-ref.json",
  "server-to-client:reject": "server-reject-unknown-code.json",
  "server-to-client:snapshot": "server-snapshot-missing-board-content.json",
};

const SERVER_SEQUENCED = new Set(["welcome", "ack", "operation-batch-broadcast", "snapshot"]);

function definitionOf(entry) {
  const definition = SYNC_DEFS[entry.definition];
  assert.ok(definition !== undefined, `${fixtureKey(entry)} has a schema definition`);
  return definition;
}

/** Snapshot reference as written by the fixtures: snapshot:<boardId>:<serverSeq>. */
const SNAPSHOT_BOARD_ID = "0192f0b1-7000-7000-8000-0000000000b1";

/** The cross-field rules of the reconnect catch-up sequence (JSON Schema cannot compare fields). */
function reconnectProblems(sequence) {
  const problems = [];
  const messages = Array.isArray(sequence.messages) ? sequence.messages : [];
  const [request, welcome, snapshot] = messages;
  if (request?.type !== "resyncRequest") problems.push("the reconnect sequence must start with resyncRequest");
  if (welcome?.type !== "welcome") problems.push("welcome must follow the resync request");
  if (snapshot?.type !== "snapshot") problems.push("the snapshot catch-up must close the exchange");
  for (const message of messages) {
    if (message?.clientId !== sequence.clientId) problems.push(`${message?.type} is for another clientId`);
    if (message?.boardId !== sequence.boardId) problems.push(`${message?.type} is for another boardId`);
  }
  if (request !== undefined) {
    if (request.payload?.fromServerSeq !== sequence.fromServerSeq) {
      problems.push("the resync request must start at the sequence fromServerSeq");
    }
    if (sequence.fromServerSeq > sequence.serverSeq) problems.push("the resync request starts from a future serverSeq");
  }
  for (const message of [welcome, snapshot]) {
    if (message !== undefined && message.serverSeq !== sequence.serverSeq) {
      problems.push(`${message.type} must carry the sequence serverSeq`);
    }
  }
  if (welcome !== undefined && welcome.payload?.contractVersion !== sequence.contractVersion) {
    problems.push("welcome must carry the sequence contractVersion");
  }
  if (welcome !== undefined && snapshot !== undefined && welcome.payload?.snapshotRef !== snapshot.payload?.snapshotRef) {
    problems.push("the snapshot does not match the reference in welcome");
  }
  if (snapshot !== undefined && snapshot.payload?.boardContent?.board?.id !== sequence.boardId) {
    problems.push("the snapshot board content is for another board");
  }
  return problems;
}

/** The session rules: join order, per-client seq, serverSeq, duplicate batch and ack coverage (AD-2). */
function sessionProblems(log) {
  const problems = [];
  const joined = new Set();
  const batches = new Map();
  const acked = new Set();
  let previousClientSeq = 0;
  let previousServerSeq = 0;
  let highestServerSeq = 0;
  for (const message of Array.isArray(log.messages) ? log.messages : []) {
    if (message.clientId !== log.clientId) problems.push(`${message.type} is for another clientId`);
    if (typeof message.seq === "number") {
      if (message.seq <= previousClientSeq) problems.push(`client seq ${message.seq} is not strictly increasing`);
      previousClientSeq = Math.max(previousClientSeq, message.seq);
    }
    if (typeof message.serverSeq === "number") {
      if (message.serverSeq < previousServerSeq) problems.push(`serverSeq ${message.serverSeq} decreases`);
      previousServerSeq = Math.max(previousServerSeq, message.serverSeq);
      highestServerSeq = Math.max(highestServerSeq, message.serverSeq);
    }
    if (message.type === "joinBoard") joined.add(message.boardId);
    if (message.type === "leaveBoard") joined.delete(message.boardId);
    if (["presence", "operationBatch", "resyncRequest"].includes(message.type) && !joined.has(message.boardId)) {
      problems.push(`${message.type} for a board the client has not joined`);
    }
    if (message.type === "operationBatch" && typeof message.seq === "number") {
      const batchId = message.payload?.batchId;
      if (batches.has(batchId)) problems.push(`batch ${batchId} is a duplicate batch`);
      batches.set(batchId, message.payload?.operations ?? []);
    }
    if (message.type === "ack") {
      const batchId = message.payload?.batchId;
      if (!batches.has(batchId)) {
        problems.push("ack for a batch the client did not send");
      } else {
        acked.add(batchId);
        const sent = batches.get(batchId).map((operation) => operation.id).sort();
        const covered = [...(message.payload?.opIds ?? [])].sort();
        if (JSON.stringify(sent) !== JSON.stringify(covered)) problems.push(`ack ${batchId} does not cover every operation`);
      }
    }
  }
  for (const batchId of batches.keys()) if (!acked.has(batchId)) problems.push(`batch ${batchId} has no ack`);
  if (log.serverSeq !== highestServerSeq) problems.push("the session serverSeq is not the highest server serverSeq");
  return problems;
}

/** Every operation carried by a message batch or a session log. */
function carriedOperations(data) {
  const found = [];
  walk(data, (node) => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    if (Array.isArray(node.operations)) found.push(...node.operations);
  });
  return found;
}

// --- the schema ---------------------------------------------------------------

test("the sync schema is versioned JSON Schema 2020-12 with one message union", () => {
  assert.equal(SYNC_SCHEMA.$schema, JSON_SCHEMA_2020_12);
  assert.equal(SYNC_SCHEMA.$id, SYNC_SCHEMA_ID);
  assert.equal(SYNC_SCHEMA_ID, `${CONTRACT_BASE_URI}sync.schema.json`);
  assert.equal(CONTRACT_VERSION, "0.2.0");
  assert.ok(SYNC_SCHEMA.$id.includes("/0.2.0/"));
  assert.equal(typeof SYNC_SCHEMA.title, "string");
  assert.ok(SYNC_SCHEMA.title.length > 0);
  assert.equal(typeof SYNC_SCHEMA.description, "string");
  assert.ok(SYNC_SCHEMA.description.length > 0);
  assert.equal(SYNC_SCHEMA.$ref, "#/$defs/sync-message");
  const branches = SYNC_SCHEMA.$defs["sync-message"].oneOf;
  assert.equal(branches.length, SYNC_MESSAGE_TYPES.length, "one union branch per message type and direction");
  for (const branch of branches) {
    const definition = branch.$ref.replace("#/$defs/", "");
    assert.ok(Object.hasOwn(SYNC_DEFS, definition), `${branch.$ref} resolves inside the sync schema`);
  }
  const typeSet = branches.map((branch) => SYNC_DEFS[branch.$ref.replace("#/$defs/", "")].properties.type.const);
  assert.deepEqual(typeSet.sort(), SYNC_MESSAGE_TYPES.map((entry) => entry.type).sort());
});

test("every message type is documented with its direction and the required metadata", () => {
  assert.equal(SYNC_MESSAGE_TYPES.length, 12, "six client-to-server and six server-to-client messages");
  assert.equal(SYNC_MESSAGE_TYPES.filter((entry) => entry.direction === "client-to-server").length, 6);
  assert.equal(SYNC_MESSAGE_TYPES.filter((entry) => entry.direction === "server-to-client").length, 6);
  for (const entry of SYNC_MESSAGE_TYPES) {
    const definition = definitionOf(entry);
    const label = fixtureKey(entry);
    assert.equal(definition.type, "object", `${label} is an object`);
    assert.equal(definition.additionalProperties, false, `${label} rejects unknown fields`);
    assert.ok(definition.title.includes(entry.type), `${label} title names the type`);
    assert.equal(typeof definition.description, "string");
    assert.ok(
      definition.description.startsWith(entry.direction === "client-to-server" ? "Client-to-server" : "Server-to-client"),
      `${label} documents its direction`,
    );
    assert.equal(definition.properties.type.const, entry.type, `${label} has its type const`);
    for (const field of ["id", "clientId", "type", "sentAt", "payload"]) {
      assert.ok(definition.required.includes(field), `${label} requires ${field}`);
      assert.ok(Object.hasOwn(definition.properties, field), `${label} declares ${field}`);
    }
    if (entry.direction === "client-to-server") {
      assert.ok(definition.required.includes("seq"), `${label} carries a client seq`);
      assert.ok(!Object.hasOwn(definition.properties, "serverSeq"), `${label} has no serverSeq`);
    } else if (SERVER_SEQUENCED.has(entry.definition)) {
      assert.ok(definition.required.includes("serverSeq"), `${label} is durable and carries a serverSeq`);
    } else {
      assert.ok(!Object.hasOwn(definition.properties, "serverSeq"), `${label} is not durable and has no serverSeq`);
    }
    if (entry.definition === "hello") {
      assert.ok(!Object.hasOwn(definition.properties, "boardId"), "hello names no board");
    } else if (entry.definition === "reject") {
      assert.ok(Object.hasOwn(definition.properties, "boardId"), "reject may name the rejected board");
      assert.ok(!definition.required.includes("boardId"), "reject boardId is optional");
    } else {
      assert.ok(definition.required.includes("boardId"), `${label} names its board`);
    }
  }
  assert.equal(SYNC_DEFS.hello.properties.seq.$ref, "#/$defs/clientSeq");
  assert.equal(SYNC_DEFS["ack"].properties.serverSeq.$ref, "#/$defs/serverSeq");
  assert.equal(SYNC_DEFS["resync-request"].properties.payload.properties.fromServerSeq.$ref, "#/$defs/fromServerSeq");
  assert.equal(SYNC_DEFS.reject.properties.payload.properties.code.$ref, "#/$defs/errorCode");
  assert.deepEqual(SYNC_DEFS.errorCode.enum, [
    "AUTH_REQUIRED",
    "FORBIDDEN",
    "NOT_FOUND",
    "VALIDATION",
    "CONFLICT",
    "RATE_LIMITED",
    "INTERNAL",
  ]);
});

test("the index exports the sync schema, message table and fixture paths", () => {
  assert.equal(SYNC_SCHEMA_FILE, "schemas/sync/sync.schema.json");
  assert.ok(syncSchemaPath().endsWith(SYNC_SCHEMA_FILE));
  assert.ok(syncFixturePath("valid", "client-hello.json").endsWith("fixtures-sync/valid/client-hello.json"));
  assert.ok(syncFixturePath("invalid", "unknown-message-type.json").endsWith("fixtures-sync/invalid/unknown-message-type.json"));
  assert.throws(() => syncFixturePath("broken", "x.json"), /unknown sync fixture validity/);
  assert.deepEqual(Object.keys(SYNC_MESSAGE_TYPES[0]), ["type", "direction", "definition"]);
  assert.deepEqual([...SYNC_MESSAGE_TYPES].map((entry) => entry.direction).sort(), [
    ...Array(6).fill("client-to-server"),
    ...Array(6).fill("server-to-client"),
  ].sort());
});

// --- fixtures -----------------------------------------------------------------

test("every message type has a valid and an invalid fixture in the wrapper", () => {
  for (const entry of SYNC_MESSAGE_TYPES) {
    const validFile = validFixtureName(entry);
    const invalidFile = INVALID_FIXTURE[fixtureKey(entry)];
    assert.ok(fixtureFiles("valid").includes(validFile), `${fixtureKey(entry)} has a valid fixture`);
    assert.ok(fixtureFiles("invalid").includes(invalidFile), `${fixtureKey(entry)} has an invalid fixture`);
    for (const [validity, file] of [["valid", validFile], ["invalid", invalidFile]]) {
      const wrapper = fixtureOf(validity, file);
      assert.deepEqual(Object.keys(wrapper).sort(), ["data", "reason", "schema", "valid"], `${validity}/${file} has the wrapper`);
      assert.equal(wrapper.schema, SYNC_SCHEMA_FILE, `${validity}/${file} names the sync schema`);
      assert.equal(wrapper.valid, validity === "valid", `${validity}/${file} matches its directory`);
      assert.equal(typeof wrapper.reason, "string");
      assert.ok(wrapper.reason.length > 10, `${validity}/${file} documents a reason`);
      assert.equal(typeof wrapper.data, "object");
    }
    const validData = fixtureOf("valid", validFile).data;
    assert.equal(validData.type, entry.type, `${validFile} is a ${entry.type} message`);
    assert.equal(typeof validData.payload, "object", `${validFile} carries a payload`);
    assert.ok(schemaValid(validData), `${validFile} satisfies the sync schema`);
    assert.ok(!schemaValid(fixtureOf("invalid", invalidFile).data), `${invalidFile} violates the sync schema`);
  }
});

test("every sync fixture names the sync schema and its validity", () => {
  for (const validity of ["valid", "invalid"]) {
    const files = fixtureFiles(validity);
    assert.ok(files.length > 0, `${validity} fixtures exist`);
    for (const file of files) {
      const wrapper = fixtureOf(validity, file);
      assert.deepEqual(Object.keys(wrapper).sort(), ["data", "reason", "schema", "valid"], `${validity}/${file} has the wrapper`);
      assert.equal(wrapper.schema, SYNC_SCHEMA_FILE, `${validity}/${file} maps to the sync schema`);
      assert.equal(wrapper.valid, validity === "valid", `${validity}/${file} matches its directory`);
      assert.ok(wrapper.reason.length > 10, `${validity}/${file} names the violated rule`);
      assert.equal(typeof wrapper.data, "object");
    }
  }
});

test("valid message fixtures use UUIDv7 ids and ISO-8601 timestamps", () => {
  for (const file of fixtureFiles("valid")) {
    walk(fixtureOf("valid", file).data, (node) => {
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (typeof value !== "string") continue;
        if (key === "id" || /Id$/.test(key)) assert.match(value, UUID_PATTERN, `${file}: ${key} is a UUIDv7`);
        if (/At$/.test(key)) assert.match(value, ISO_TIMESTAMP, `${file}: ${key} is ISO-8601`);
      }
    });
  }
});

test("operation batches carry P1-02 operations through the operation schema reference", () => {
  const operationRef = SYNC_DEFS["operation-batch-payload"].properties.operations.items.$ref;
  assert.equal(operationRef, "operation.schema.json");
  assert.equal(new URL(operationRef, SYNC_SCHEMA.$id).href, schemaId("operation"));
  assert.equal(new URL(operationRef, SYNC_SCHEMA.$id).href, OPERATION_SCHEMA.$id);
  assert.equal(SYNC_DEFS["operation-batch-payload"].properties.operations.minItems, 1);
  assert.equal(SYNC_DEFS["operation-batch-broadcast"].properties.payload.$ref, "#/$defs/operation-batch-payload");
  for (const file of ["client-operation-batch.json", "server-operation-batch.json", "session-sequence.json"]) {
    const operations = carriedOperations(fixtureOf("valid", file).data);
    assert.ok(operations.length >= 1, `${file} carries operations`);
    for (const operation of operations) {
      assert.ok(validate(operation, OPERATION_SCHEMA, OPERATION_SCHEMA), `${file} operation satisfies operation.schema.json`);
    }
  }
  assert.ok(!schemaValid(fixtureOf("invalid", "client-operation-batch-empty.json").data), "an empty batch is invalid");
  assert.ok(
    !schemaValid(fixtureOf("invalid", "client-operation-batch-unknown-operation.json").data),
    "a batch with an unknown operation type is invalid",
  );
});

test("presence messages carry presence only, never operation data", () => {
  const presence = SYNC_DEFS["presence-payload"];
  assert.equal(presence.additionalProperties, false);
  assert.deepEqual(Object.keys(presence.properties).sort(), ["colorRef", "cursor", "nameRef", "selection"]);
  for (const forbidden of ["operations", "inverse", "batchId", "changes"]) {
    assert.ok(!Object.hasOwn(presence.properties, forbidden), `presence has no ${forbidden}`);
  }
  for (const file of ["client-presence.json", "server-presence.json"]) {
    const data = fixtureOf("valid", file).data;
    for (const forbidden of ["operations", "inverse"]) {
      assert.ok(!Object.hasOwn(data.payload, forbidden), `${file} carries no ${forbidden}`);
    }
  }
  assert.ok(!schemaValid(fixtureOf("invalid", "client-presence-carries-operations.json").data));
});

test("message ids and sequence rules live in the envelope", () => {
  assert.equal(SYNC_DEFS.clientSeq.minimum, 1);
  assert.equal(SYNC_DEFS.serverSeq.minimum, 1);
  assert.equal(SYNC_DEFS.fromServerSeq.minimum, 0);
  for (const file of fixtureFiles("valid")) {
    const data = fixtureOf("valid", file).data;
    for (const message of Array.isArray(data.messages) ? data.messages : [data]) {
      assert.match(message.id, UUID_V7, `${file}: message id is a UUIDv7`);
      assert.match(message.clientId, UUID_V7, `${file}: clientId is a UUIDv7`);
      if (message.seq !== undefined) assert.ok(Number.isInteger(message.seq) && message.seq >= 1, `${file}: seq >= 1`);
      if (message.serverSeq !== undefined) {
        assert.ok(Number.isInteger(message.serverSeq) && message.serverSeq >= 1, `${file}: serverSeq >= 1`);
      }
    }
  }
  assert.ok(!schemaValid(fixtureOf("invalid", "client-resync-request-negative-seq.json").data));
});

test("no unknown message type matches the envelope", () => {
  const decl = SYNC_DEFS["sync-message"].oneOf.map((branch) => SYNC_DEFS[branch.$ref.replace("#/$defs/", "")].properties.type.const);
  const expected = [...new Set(decl)].sort();
  assert.deepEqual(expected, [
    "ack",
    "hello",
    "joinBoard",
    "leaveBoard",
    "operationBatch",
    "presence",
    "reject",
    "resyncRequest",
    "snapshot",
    "welcome",
  ]);
  assert.ok(!schemaValid(fixtureOf("invalid", "unknown-message-type.json").data), "an unknown type is invalid");
  for (const file of fixtureFiles("valid").filter((entry) => !entry.includes("sequence"))) {
    const data = fixtureOf("valid", file).data;
    assert.ok(expected.includes(data.type), `${file} uses a known message type`);
  }
});

// --- reconnect and session sequences ------------------------------------------

test("the reconnect sequence starts from a known serverSeq and ends with the snapshot", () => {
  const sequence = fixtureOf("valid", "reconnect-sequence.json");
  assert.ok(sequenceValid("reconnect-sequence", sequence.data), "the reconnect fixture satisfies the sequence schema");
  assert.deepEqual(reconnectProblems(sequence.data), []);
  const [request, welcome, snapshot] = sequence.data.messages;
  assert.equal(request.type, "resyncRequest");
  assert.equal(request.payload.fromServerSeq, sequence.data.fromServerSeq);
  assert.equal(welcome.payload.snapshotRef, snapshot.payload.snapshotRef);
  assert.equal(snapshot.payload.boardContent.board.id, sequence.data.boardId);
  assert.equal(request.payload.fromServerSeq, 42);
  assert.equal(sequence.data.serverSeq, 43);
  assert.equal(SYNC_DEFS["reconnect-sequence"].properties.messages.minItems, 3);
  assert.equal(SYNC_DEFS["reconnect-sequence"].properties.messages.maxItems, 3);
  const invalid = fixtureOf("invalid", "reconnect-future-resync.json").data;
  assert.deepEqual(
    reconnectProblems(invalid).filter((problem) => problem.includes("future serverSeq")),
    ["the resync request starts from a future serverSeq"],
    "a resync from a future serverSeq is invalid with a clear reason",
  );
  assert.ok(reconnectProblems(fixtureOf("invalid", "reconnect-wrong-order.json").data).length > 0);
  assert.ok(!sequenceValid("reconnect-sequence", fixtureOf("invalid", "reconnect-missing-snapshot.json").data));
});

test("the session sequence keeps join order, sequences, duplicate batches and ack coverage", () => {
  const sequence = fixtureOf("valid", "session-sequence.json");
  assert.ok(sequenceValid("session-sequence", sequence.data), "the session fixture satisfies the sequence schema");
  assert.deepEqual(sessionProblems(sequence.data), []);
  const unjoined = fixtureOf("invalid", "session-presence-unjoined.json");
  assert.ok(sequenceValid("session-sequence", unjoined.data), "the unjoined presence is schema-valid but breaks the session rule");
  assert.ok(
    sessionProblems(unjoined.data).some((problem) => problem.includes("has not joined")),
    "presence for a board the client has not joined is invalid with a clear reason",
  );
  assert.ok(
    sessionProblems(fixtureOf("invalid", "session-duplicate-batch.json").data).some((problem) => problem.includes("duplicate batch")),
    "a duplicate batch is invalid",
  );
  assert.ok(
    sessionProblems(fixtureOf("invalid", "session-ack-uncovered.json").data).some((problem) => problem.includes("does not cover")),
    "an ack that does not cover the batch is invalid",
  );
  const serverSeq = Math.max(
    ...sequence.data.messages.filter((message) => typeof message.serverSeq === "number").map((message) => message.serverSeq),
  );
  assert.equal(sequence.data.serverSeq, serverSeq);
});

test("every acknowledged batch is durable before the client sees the ack", () => {
  const sequence = fixtureOf("valid", "session-sequence.json").data;
  const batch = sequence.messages.find((message) => message.type === "operationBatch" && message.seq !== undefined);
  const ack = sequence.messages.find((message) => message.type === "ack");
  assert.ok(batch !== undefined && ack !== undefined, "the session log has a batch and its ack");
  assert.equal(ack.payload.batchId, batch.payload.batchId, "the ack correlates with the batch");
  assert.deepEqual([...ack.payload.opIds].sort(), batch.payload.operations.map((operation) => operation.id).sort());
  const welcome = sequence.messages.find((message) => message.type === "welcome");
  assert.ok(welcome !== undefined, "the session log starts with a welcome");
  assert.ok(ack.serverSeq >= welcome.serverSeq, "the ack advances the durable serverSeq");
});

test("the board content in a snapshot is the root board-content document", () => {
  const data = fixtureOf("valid", "server-snapshot.json").data;
  assert.equal(data.type, "snapshot");
  assert.equal(data.payload.snapshotRef, `snapshot:${SNAPSHOT_BOARD_ID}:43`);
  assert.equal(data.payload.boardContent.contractVersion, CONTRACT_VERSION);
  assert.equal(data.payload.boardContent.board.id, data.boardId);
  assert.ok(schemaValid(data));
});
