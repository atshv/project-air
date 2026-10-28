// Entry point of the Project air contract, version 0.3.0.
//
// The contract is the single JSON Schema source for the board data model: one
// schema per entity, one root board-content schema, and valid/invalid fixtures
// for every schema. It also defines the WebSocket sync protocol and the REST API
// resource/error envelopes as versioned schemas with their own fixtures. This
// module exports the stable paths and vocabularies; it has no runtime
// dependencies.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Contract version carried by every schema `$id` and the root document. */
export const CONTRACT_VERSION = "0.3.0";

/** Base URI of the versioned schemas. It is a namespace, not a fetched URL. */
export const CONTRACT_BASE_URI = `https://project-air.dev/contracts/${CONTRACT_VERSION}/`;

/** Operation types of contract 0.3.0 (AD-1: one gesture = one operation). */
export const OPERATION_TYPES = Object.freeze([
  "createNote",
  "updateNote",
  "deleteNote",
  "createCard",
  "moveCard",
  "resizeCard",
  "deleteCard",
  "createZone",
  "moveZone",
  "resizeZone",
  "deleteZone",
  "createBlock",
  "moveBlock",
  "resizeBlock",
  "updateBlock",
  "deleteBlock",
  "createEdge",
  "deleteEdge",
  "reorder",
  "group",
]);

/** Sync protocol schema file, relative to the package directory. */
export const SYNC_SCHEMA_FILE = "schemas/sync/sync.schema.json";

/** Versioned `$id` of the sync protocol schema. */
export const SYNC_SCHEMA_ID = `${CONTRACT_BASE_URI}sync.schema.json`;

/**
 * The 12 sync message types with their direction and their `$defs` key in
 * `schemas/sync/sync.schema.json`. The README message table lists the same rows.
 */
export const SYNC_MESSAGE_TYPES = Object.freeze(
  [
    { type: "hello", direction: "client-to-server", definition: "hello" },
    { type: "joinBoard", direction: "client-to-server", definition: "join-board" },
    { type: "leaveBoard", direction: "client-to-server", definition: "leave-board" },
    { type: "operationBatch", direction: "client-to-server", definition: "operation-batch" },
    { type: "resyncRequest", direction: "client-to-server", definition: "resync-request" },
    { type: "presence", direction: "client-to-server", definition: "presence" },
    { type: "welcome", direction: "server-to-client", definition: "welcome" },
    { type: "ack", direction: "server-to-client", definition: "ack" },
    { type: "operationBatch", direction: "server-to-client", definition: "operation-batch-broadcast" },
    { type: "presence", direction: "server-to-client", definition: "presence-broadcast" },
    { type: "reject", direction: "server-to-client", definition: "reject" },
    { type: "snapshot", direction: "server-to-client", definition: "snapshot" },
  ].map((entry) => Object.freeze(entry)),
);

/** Sync fixture directories by validity, relative to the package directory. */
export const SYNC_FIXTURE_DIRS = Object.freeze({
  valid: "fixtures-sync/valid",
  invalid: "fixtures-sync/invalid",
});

/**
 * Gate fixture directories by validity, relative to the package directory. The
 * Polier `contracts` gate (P1-06) needs direct `valid/*.json` and
 * `invalid/*.json` files; these specimens copy canonical fixtures byte for byte.
 */
export const GATE_FIXTURE_DIRS = Object.freeze({
  valid: "fixtures-gate/valid",
  invalid: "fixtures-gate/invalid",
});

/**
 * Board-content containment fixtures: parent references, board-level items and a
 * dangling parent. JSON Schema cannot compare a card/block `zoneId` with the
 * `zones` array, so this additive corpus carries the rule for the parity harness
 * and `test/containment.test.mjs` (the server enforces it at rest, P4-26).
 */
export const CONTAINMENT_FIXTURE_DIR = "fixtures/containment";

/** REST API resources with request/response envelopes. */
export const API_RESOURCES = Object.freeze(["workspace", "board", "note", "card"]);

/** REST API schema files, relative to the package directory. */
export const API_SCHEMA_FILES = Object.freeze({
  workspace: "schemas/api/workspace.schema.json",
  board: "schemas/api/board.schema.json",
  note: "schemas/api/note.schema.json",
  card: "schemas/api/card.schema.json",
  errors: "schemas/api/errors.schema.json",
});

/** Error codes of contract 0.3.0: stable UPPER_SNAKE wire codes, never translated. */
export const ERROR_CODES = Object.freeze([
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
]);

/**
 * Translation key per wire error code: `errors.<camelCase(code)>`. The keys are
 * English lowerCamelCase because `language-check` rejects uppercase and
 * underscore segments; the values live in `apps/web/messages` (AD-8).
 */
export const ERROR_MESSAGE_KEYS = Object.freeze({
  AUTH_REQUIRED: "errors.authRequired",
  FORBIDDEN: "errors.forbidden",
  NOT_FOUND: "errors.notFound",
  VALIDATION: "errors.validation",
  CONFLICT: "errors.conflict",
  RATE_LIMITED: "errors.rateLimited",
  INTERNAL: "errors.internal",
});

/** API fixture directories by validity, relative to the package directory. */
export const API_FIXTURE_DIRS = Object.freeze({
  valid: "fixtures-api/valid",
  invalid: "fixtures-api/invalid",
});

/** Absolute package directory, used to resolve the exported relative paths. */
export const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

/** Schema files by entity, relative to the package directory. */
export const SCHEMA_FILES = Object.freeze({
  account: "schemas/account.schema.json",
  workspace: "schemas/workspace.schema.json",
  board: "schemas/board.schema.json",
  note: "schemas/note.schema.json",
  card: "schemas/card.schema.json",
  zone: "schemas/zone.schema.json",
  block: "schemas/block.schema.json",
  edge: "schemas/edge.schema.json",
  operation: "schemas/operation.schema.json",
  "reorder-payload": "schemas/reorder-payload.schema.json",
  "board-content": "schemas/board-content.schema.json",
});

/** Fixture directories by entity, relative to the package directory. */
export const FIXTURE_DIRS = Object.freeze({
  account: "fixtures/account",
  workspace: "fixtures/workspace",
  board: "fixtures/board",
  note: "fixtures/note",
  card: "fixtures/card",
  zone: "fixtures/zone",
  block: "fixtures/block",
  edge: "fixtures/edge",
  operation: "fixtures/operation",
  "reorder-payload": "fixtures/reorder-payload",
  "board-content": "fixtures/board-content",
});

function assertKnown(name) {
  if (!Object.hasOwn(SCHEMA_FILES, name)) {
    throw new Error(`unknown contract schema "${name}"`);
  }
}

/** Absolute path of one schema file. */
export function schemaPath(name) {
  assertKnown(name);
  return join(PACKAGE_DIR, SCHEMA_FILES[name]);
}

/** Versioned `$id` of one schema. */
export function schemaId(name) {
  assertKnown(name);
  return `${CONTRACT_BASE_URI}${name}.schema.json`;
}

/** Absolute path of one fixture file of one schema. */
export function fixturePath(name, file) {
  assertKnown(name);
  return join(PACKAGE_DIR, FIXTURE_DIRS[name], file);
}

/** Absolute path of the sync protocol schema. */
export function syncSchemaPath() {
  return join(PACKAGE_DIR, SYNC_SCHEMA_FILE);
}

/** Absolute path of one sync fixture file. */
export function syncFixturePath(validity, file) {
  if (!Object.hasOwn(SYNC_FIXTURE_DIRS, validity)) {
    throw new Error(`unknown sync fixture validity "${validity}"`);
  }
  return join(PACKAGE_DIR, SYNC_FIXTURE_DIRS[validity], file);
}

/** Absolute path of one gate fixture specimen. */
export function gateFixturePath(validity, file) {
  if (!Object.hasOwn(GATE_FIXTURE_DIRS, validity)) {
    throw new Error(`unknown gate fixture validity "${validity}"`);
  }
  return join(PACKAGE_DIR, GATE_FIXTURE_DIRS[validity], file);
}

/** Absolute path of one REST API schema file. */
export function apiSchemaPath(name) {
  if (!Object.hasOwn(API_SCHEMA_FILES, name)) {
    throw new Error(`unknown API schema "${name}"`);
  }
  return join(PACKAGE_DIR, API_SCHEMA_FILES[name]);
}

/** Versioned `$id` of one REST API schema. */
export function apiSchemaId(name) {
  if (!Object.hasOwn(API_SCHEMA_FILES, name)) {
    throw new Error(`unknown API schema "${name}"`);
  }
  return `${CONTRACT_BASE_URI}api/${name}.schema.json`;
}

/** Absolute path of one REST API fixture file. */
export function apiFixturePath(validity, file) {
  if (!Object.hasOwn(API_FIXTURE_DIRS, validity)) {
    throw new Error(`unknown API fixture validity "${validity}"`);
  }
  return join(PACKAGE_DIR, API_FIXTURE_DIRS[validity], file);
}
