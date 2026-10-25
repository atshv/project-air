// Entry point of the Project air board-content contract, version 0.1.0.
//
// The contract is the single JSON Schema source for the board data model: one
// schema per entity, one root board-content schema, and valid/invalid fixtures
// for every schema. This module exports the stable paths; it has no runtime
// dependencies.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Contract version carried by every schema `$id` and the root document. */
export const CONTRACT_VERSION = "0.1.0";

/** Base URI of the versioned schemas. It is a namespace, not a fetched URL. */
export const CONTRACT_BASE_URI = `https://project-air.dev/contracts/${CONTRACT_VERSION}/`;

/** Operation types of contract 0.1.0 (AD-1: one gesture = one operation). */
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
  "group",
]);

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
