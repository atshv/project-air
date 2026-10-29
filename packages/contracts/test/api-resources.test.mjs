// Unit tests for the REST API resource envelopes of contract 0.5.0.
//
// The suite checks the four resource schemas (workspace, board, note, card) with
// their closed list-request/list-response/response/create-request/update-request/
// delete-request/delete-response envelopes, the pagination and requestId rules,
// the reference to the P1-01 entities and the fixtures under fixtures-api/.
// The error envelope and its translation keys are covered by api-errors.test.mjs.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  API_FIXTURE_DIRS,
  API_RESOURCES,
  API_SCHEMA_FILES,
  CONTRACT_BASE_URI,
  CONTRACT_VERSION,
  PACKAGE_DIR,
  apiFixturePath,
  apiSchemaId,
  apiSchemaPath,
  schemaId,
} from "../index.mjs";
import {
  ISO_TIMESTAMP,
  JSON_SCHEMA_2020_12,
  UUID_V7,
  schemaOf,
  validate,
  walk,
} from "./support.mjs";

const ENVELOPE_DEFS = [
  "list-request",
  "list-response",
  "response",
  "create-request",
  "update-request",
  "delete-request",
  "delete-response",
];
const ID_KEYS = { workspace: "workspaceId", board: "boardId", note: "noteId", card: "cardId" };
const CREATE_REQUIRED = {
  workspace: ["name", "ownerId"],
  board: ["workspaceId", "ownerId", "title", "visibility"],
  note: ["workspaceId", "title"],
  card: ["boardId", "noteId", "x", "y", "width", "height", "z"],
};
const SERVER_ONLY_FIELDS = ["id", "createdAt", "updatedAt"];

const SCHEMAS = new Map(API_RESOURCES.map((resource) => {
  const file = apiSchemaPath(resource);
  return [resource, JSON.parse(readFileSync(file, "utf8"))];
}));

const fixtureFiles = (validity) =>
  readdirSync(join(PACKAGE_DIR, API_FIXTURE_DIRS[validity])).filter((file) => file.endsWith(".json")).sort();
const fixtureOf = (validity, file) => JSON.parse(readFileSync(apiFixturePath(validity, file), "utf8"));
const validAgainst = (schema, definition, data) => validate(data, schema.$defs[definition], schema);
const schemaValid = (schema, data) => validate(data, schema, schema);

// --- the schemas --------------------------------------------------------------

test("the four API resource schemas are versioned JSON Schema 2020-12 with closed envelopes", () => {
  assert.deepEqual([...API_RESOURCES], ["workspace", "board", "note", "card"]);
  assert.equal(CONTRACT_VERSION, "0.5.0");
  for (const resource of API_RESOURCES) {
    const schema = SCHEMAS.get(resource);
    assert.equal(schema.$schema, JSON_SCHEMA_2020_12, `${resource} uses JSON Schema 2020-12`);
    assert.equal(schema.$id, apiSchemaId(resource));
    assert.equal(schema.$id, `${CONTRACT_BASE_URI}api/${resource}.schema.json`);
    assert.ok(schema.$id.includes("/0.5.0/"), `${resource} carries version 0.5.0`);
    assert.equal(typeof schema.title, "string");
    assert.ok(schema.title.length > 0, `${resource} has a title`);
    assert.equal(typeof schema.description, "string");
    assert.ok(schema.description.length > 0, `${resource} has a description`);
    assert.equal(schema.$ref, "#/$defs/envelopes");
    const branches = schema.$defs.envelopes.oneOf;
    assert.equal(branches.length, ENVELOPE_DEFS.length, `${resource} has one branch per envelope`);
    assert.deepEqual(
      branches.map((branch) => branch.$ref.replace("#/$defs/", "")).sort(),
      [...ENVELOPE_DEFS].sort(),
    );
    for (const definition of ENVELOPE_DEFS) {
      const envelope = schema.$defs[definition];
      assert.equal(envelope.type, "object", `${resource} ${definition} is an object`);
      assert.equal(envelope.additionalProperties, false, `${resource} ${definition} is closed`);
      assert.ok(envelope.required.includes("requestId"), `${resource} ${definition} carries a requestId`);
      assert.equal(typeof envelope.description, "string", `${resource} ${definition} is documented`);
    }
  }
});

test("the envelopes cover list, get, create, update and delete", () => {
  for (const resource of API_RESOURCES) {
    const schema = SCHEMAS.get(resource);
    const defs = schema.$defs;
    assert.deepEqual(defs["list-request"].required, ["requestId"]);
    assert.deepEqual(Object.keys(defs["list-request"].properties).sort(), ["cursor", "limit", "requestId"]);
    assert.deepEqual([...defs["list-response"].required].sort(), ["items", "nextCursor", "requestId"].sort());
    assert.equal(defs["list-response"].properties.items.items.$ref, "#/$defs/entity");
    assert.equal(defs["list-response"].properties.nextCursor.$ref, "#/$defs/nextCursor");
    assert.equal(defs["nextCursor"].type[0], "string");
    assert.ok(defs["nextCursor"].type.includes("null"), "the end of a list is nextCursor null");
    assert.equal(defs.limit.minimum, 1);
    assert.equal(defs.limit.maximum, 100);
    assert.deepEqual([...defs.response.required].sort(), ["requestId", resource].sort());
    assert.equal(defs.response.properties[resource].$ref, "#/$defs/entity");
    assert.deepEqual([...defs["create-request"].required].sort(), ["requestId", resource].sort());
    assert.equal(defs["create-request"].properties[resource].$ref, "#/$defs/create");
    assert.deepEqual([...defs["update-request"].required].sort(), ["changes", ID_KEYS[resource], "requestId"].sort());
    assert.equal(defs["update-request"].properties.changes.$ref, "#/$defs/changes");
    assert.deepEqual([...defs["delete-request"].required].sort(), [ID_KEYS[resource], "requestId"].sort());
    assert.deepEqual([...defs["delete-response"].required].sort(), ["deletedId", "requestId"].sort());
    assert.equal(defs.changes.minProperties, 1, `${resource} updates change at least one field`);
    assert.equal(defs.changes.additionalProperties, false);
    assert.equal(defs.create.additionalProperties, false);
    assert.deepEqual([...defs.create.required].sort(), [...CREATE_REQUIRED[resource]].sort());
    for (const field of SERVER_ONLY_FIELDS) {
      assert.ok(!Object.hasOwn(defs.create.properties, field), `${resource} create has no ${field}`);
      assert.ok(!Object.hasOwn(defs.changes.properties, field), `${resource} changes has no ${field}`);
    }
  }
});

test("the envelopes reference the P1-01 entity schemas instead of restating them", () => {
  for (const resource of API_RESOURCES) {
    const schema = SCHEMAS.get(resource);
    const entity = schema.$defs.entity;
    assert.equal(entity.$ref, `../${resource}.schema.json`);
    assert.equal(new URL(entity.$ref, schema.$id).href, schemaId(resource));
    assert.equal(new URL(entity.$ref, schema.$id).href, schemaOf(resource).$id);
    const response = fixtureOf("valid", `${resource}-response.json`).data;
    assert.ok(
      validate(response[resource], schemaOf(resource), schemaOf(resource)),
      `${resource} response carries a valid P1-01 entity`,
    );
  }
});

test("card create and changes mirror the P1-01 minimum sizes and the nullable zone parent", () => {
  const schema = SCHEMAS.get("card");
  const entity = schemaOf("card");
  const create = schema.$defs.create.properties;
  assert.equal(create.width.minimum, entity.properties.width.minimum);
  assert.equal(create.height.minimum, entity.properties.height.minimum);
  assert.equal(schema.$defs.changes.properties.width.minimum, entity.properties.width.minimum);
  assert.equal(schema.$defs.changes.properties.height.minimum, entity.properties.height.minimum);
  assert.deepEqual(create.zoneId.type, ["string", "null"]);
  assert.deepEqual(schema.$defs.changes.properties.zoneId.type, ["string", "null"]);
  assert.equal(create.z.pattern, entity.properties.z.pattern);
  assert.ok(create.x.type === "number" && create.y.type === "number");
});

// --- fixtures -----------------------------------------------------------------

test("every resource envelope has a valid fixture that satisfies it", () => {
  for (const resource of API_RESOURCES) {
    const schema = SCHEMAS.get(resource);
    for (const definition of ENVELOPE_DEFS) {
      const file = `${resource}-${definition}.json`;
      assert.ok(fixtureFiles("valid").includes(file), `${file} exists`);
      const wrapper = fixtureOf("valid", file);
      assert.deepEqual(Object.keys(wrapper).sort(), ["data", "reason", "schema", "valid"]);
      assert.equal(wrapper.schema, API_SCHEMA_FILES[resource], `${file} names its resource schema`);
      assert.equal(wrapper.valid, true);
      assert.ok(wrapper.reason.length > 10, `${file} documents a reason`);
      assert.ok(validAgainst(schema, definition, wrapper.data), `${file} satisfies its envelope`);
      assert.ok(schemaValid(schema, wrapper.data), `${file} satisfies the envelope union`);
    }
  }
});

test("the invalid fixtures violate their envelope and name the rule", () => {
  const INVALID_CASES = [
    ["list-response-pagination.json", "list-response", "nextCursor"],
    ["response-wrong-entity.json", "response", "carry the"],
    ["create-request-server-field.json", "create-request", "server-assigned"],
    ["update-request-empty-changes.json", "update-request", "changes"],
  ];
  for (const resource of API_RESOURCES) {
    const schema = SCHEMAS.get(resource);
    for (const [suffix, definition, needle] of INVALID_CASES) {
      const file = `${resource}-${suffix}`;
      assert.ok(fixtureFiles("invalid").includes(file), `${file} exists`);
      const wrapper = fixtureOf("invalid", file);
      assert.deepEqual(Object.keys(wrapper).sort(), ["data", "reason", "schema", "valid"]);
      assert.equal(wrapper.schema, API_SCHEMA_FILES[resource]);
      assert.equal(wrapper.valid, false);
      assert.ok(wrapper.reason.includes(needle), `${file} reason names ${needle}`);
      assert.ok(!validAgainst(schema, definition, wrapper.data), `${file} breaks ${definition}`);
      assert.ok(!schemaValid(schema, wrapper.data), `${file} is rejected by the envelope union`);
    }
  }
});

test("every API fixture has the wrapper and maps to an API schema", () => {
  const schemas = new Set(Object.values(API_SCHEMA_FILES));
  for (const validity of ["valid", "invalid"]) {
    const files = fixtureFiles(validity);
    assert.ok(files.length > 0);
    for (const file of files) {
      const wrapper = fixtureOf(validity, file);
      assert.deepEqual(Object.keys(wrapper).sort(), ["data", "reason", "schema", "valid"], `${validity}/${file}`);
      assert.ok(schemas.has(wrapper.schema), `${validity}/${file} names an API schema`);
      assert.equal(wrapper.valid, validity === "valid", `${validity}/${file} matches its directory`);
      assert.ok(wrapper.reason.length > 10, `${validity}/${file} names the reason`);
      assert.equal(typeof wrapper.data, "object");
    }
  }
});

test("valid API fixtures use UUIDv7 ids and ISO-8601 timestamps", () => {
  for (const file of fixtureFiles("valid")) {
    walk(fixtureOf("valid", file).data, (node) => {
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (typeof value !== "string") continue;
        if (key === "id" || /Id$/.test(key)) assert.match(value, UUID_V7, `${file}: ${key} is a UUIDv7`);
        if (/At$/.test(key)) assert.match(value, ISO_TIMESTAMP, `${file}: ${key} is ISO-8601`);
      }
    });
  }
});

test("an empty list is valid with items [] and nextCursor null", () => {
  const file = "workspace-list-response.json";
  const data = fixtureOf("valid", file).data;
  assert.deepEqual(data.items, []);
  assert.equal(data.nextCursor, null);
  assert.ok(validAgainst(SCHEMAS.get("workspace"), "list-response", data));
  const schema = SCHEMAS.get("workspace");
  assert.ok(!schemaValid(schema, { requestId: data.requestId, items: [] }), "nextCursor is required");
});

test("pagination bounds are encoded in the schema", () => {
  const schema = SCHEMAS.get("workspace");
  const requestId = fixtureOf("valid", "workspace-list-request.json").data.requestId;
  assert.ok(!validAgainst(schema, "list-request", { requestId, limit: 0 }));
  assert.ok(!validAgainst(schema, "list-request", { requestId, limit: 101 }));
  assert.ok(!validAgainst(schema, "list-request", { requestId, cursor: "not a cursor!" }));
  assert.ok(validAgainst(schema, "list-request", { requestId, cursor: "cursor-0001", limit: 100 }));
});

test("update requests need a non-empty changes object", () => {
  for (const resource of API_RESOURCES) {
    const schema = SCHEMAS.get(resource);
    const valid = fixtureOf("valid", `${resource}-update-request.json`).data;
    assert.ok(Object.keys(valid.changes).length >= 1, `${resource} update changes at least one field`);
    assert.ok(validAgainst(schema, "update-request", valid));
    assert.ok(!validAgainst(schema, "update-request", { ...valid, changes: {} }));
  }
});

test("delete envelopes name the resource id", () => {
  for (const resource of API_RESOURCES) {
    const schema = SCHEMAS.get(resource);
    const idKey = ID_KEYS[resource];
    const request = fixtureOf("valid", `${resource}-delete-request.json`).data;
    const response = fixtureOf("valid", `${resource}-delete-response.json`).data;
    assert.match(request[idKey], UUID_V7);
    assert.equal(response.deletedId, request[idKey], `${resource} delete response confirms the request`);
    assert.ok(validAgainst(schema, "delete-request", request));
    assert.ok(validAgainst(schema, "delete-response", response));
  }
});

test("the index exports the API resources, schema paths and fixture paths", () => {
  assert.deepEqual(Object.keys(API_SCHEMA_FILES).sort(), ["board", "card", "errors", "note", "workspace"]);
  for (const name of Object.keys(API_SCHEMA_FILES)) {
    assert.ok(apiSchemaPath(name).endsWith(API_SCHEMA_FILES[name]));
    assert.equal(apiSchemaId(name), `${CONTRACT_BASE_URI}api/${name}.schema.json`);
  }
  assert.ok(apiFixturePath("valid", "workspace-response.json").endsWith("fixtures-api/valid/workspace-response.json"));
  assert.ok(apiFixturePath("invalid", "board-response-wrong-entity.json").endsWith("fixtures-api/invalid/board-response-wrong-entity.json"));
  assert.throws(() => apiSchemaPath("unknown"), /unknown API schema/);
  assert.throws(() => apiSchemaId("unknown"), /unknown API schema/);
  assert.throws(() => apiFixturePath("broken", "x.json"), /unknown API fixture validity/);
});
