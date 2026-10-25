// Unit tests for the board-content contract 0.1.0.
//
// The suite parses every schema and fixture, validates the fixtures against the
// schemas with a small structural validator for the keywords this contract uses
// (type, required, properties, additionalProperties, enum, const, pattern,
// minLength, maxLength, minimum, items, allOf/if/then and $ref), and checks the
// model rules the task requires: AD-4, the parent relation, the fractional index,
// the minimum sizes, ISO-8601 timestamps and the fixed enums.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  CONTRACT_BASE_URI,
  CONTRACT_VERSION,
  FIXTURE_DIRS,
  PACKAGE_DIR,
  SCHEMA_FILES,
  fixturePath,
  schemaId,
  schemaPath,
} from "../index.mjs";

const SCHEMA_NAMES = Object.keys(SCHEMA_FILES);
const EXPECTED_SCHEMA_NAMES = [
  "account",
  "block",
  "board",
  "board-content",
  "card",
  "edge",
  "note",
  "workspace",
  "zone",
];
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FRACTIONAL_INDEX = /^[0-9A-Za-z]{1,64}$/;
const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

const EXPECTED_MINIMUMS = {
  card: { width: 176, height: 80 },
  zone: { width: 256, height: 192 },
  block: {
    checklist: { width: 224, height: 128 },
    palette: { width: 224, height: 128 },
    columns: { width: 368, height: 192 },
    timeline: { width: 320, height: 160 },
    table: { width: 288, height: 160 },
  },
};

const readJson = (relativePath) => JSON.parse(readFileSync(join(PACKAGE_DIR, relativePath), "utf8"));
const schemaOf = (name) => JSON.parse(readFileSync(schemaPath(name), "utf8"));
const fixtureOf = (name, file) => JSON.parse(readFileSync(fixturePath(name, file), "utf8"));
const fixtureFiles = (name) =>
  readdirSync(join(PACKAGE_DIR, FIXTURE_DIRS[name]))
    .filter((file) => file.endsWith(".json"))
    .sort();

const walk = (value, visit) => {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) walk(child, visit);
  }
};

const collectRefs = (value, refs = []) => {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (value !== null && typeof value === "object") {
    if (typeof value.$ref === "string") refs.push(value.$ref);
    for (const child of Object.values(value)) collectRefs(child, refs);
  }
  return refs;
};

// --- the structural validator -------------------------------------------------

const CONTEXT = new Map();
for (const name of SCHEMA_NAMES) CONTEXT.set(schemaOf(name).$id, schemaOf(name));

function matchesType(value, type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((candidate) => {
    if (candidate === "null") return value === null;
    if (candidate === "array") return Array.isArray(value);
    if (candidate === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    if (candidate === "integer") return Number.isInteger(value);
    if (candidate === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === candidate;
  });
}

function resolvePointer(document, pointer) {
  let current = document;
  for (const rawPart of pointer.split("/")) {
    const part = rawPart.replaceAll("~1", "/").replaceAll("~0", "~");
    current = current[part];
    if (current === undefined) throw new Error(`unresolvable $ref pointer #/${pointer}`);
  }
  return current;
}

function validate(value, schema, document) {
  if (schema === true) return true;
  if (schema === undefined) return true;
  if (typeof schema.$ref === "string") {
    if (schema.$ref.startsWith("#/")) {
      return validate(value, resolvePointer(document, schema.$ref.slice(2)), document);
    }
    const target = CONTEXT.get(new URL(schema.$ref, document.$id).href);
    if (target === undefined) throw new Error(`unresolvable $ref ${schema.$ref}`);
    return validate(value, target, target);
  }
  if (schema.type !== undefined && !matchesType(value, schema.type)) return false;
  if (schema.enum !== undefined && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) return false;
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) return false;
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) return false;
  if (Array.isArray(value)) {
    if (schema.items !== undefined && !value.every((item) => validate(item, schema.items, document))) return false;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (Array.isArray(schema.required) && schema.required.some((key) => !(key in value))) return false;
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) return false;
      }
    }
    for (const [key, subschema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key) && !validate(value[key], subschema, document)) return false;
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      if (branch.if !== undefined) {
        if (validate(value, branch.if, document) && branch.then !== undefined) {
          if (!validate(value, branch.then, document)) return false;
        }
      } else if (!validate(value, branch, document)) {
        return false;
      }
    }
  }
  return true;
}

function blockMinimums(blockSchema) {
  const minimums = {};
  for (const branch of blockSchema.allOf) {
    minimums[branch.if.properties.type.const] = {
      width: branch.then.properties.width.minimum,
      height: branch.then.properties.height.minimum,
    };
  }
  return minimums;
}

// --- the contract -------------------------------------------------------------

test("index exports the versioned schema and fixture paths", () => {
  assert.equal(CONTRACT_VERSION, "0.1.0");
  assert.equal(CONTRACT_BASE_URI, "https://project-air.dev/contracts/0.1.0/");
  assert.deepEqual([...SCHEMA_NAMES].sort(), EXPECTED_SCHEMA_NAMES);
  assert.deepEqual(Object.keys(FIXTURE_DIRS).sort(), EXPECTED_SCHEMA_NAMES);
  for (const name of EXPECTED_SCHEMA_NAMES) {
    assert.ok(schemaPath(name).endsWith(SCHEMA_FILES[name]), `${name} schema path resolves`);
    assert.equal(schemaId(name), `${CONTRACT_BASE_URI}${name}.schema.json`);
    assert.ok(FIXTURE_DIRS[name].startsWith("fixtures/"));
  }
  assert.throws(() => schemaPath("unknown"), /unknown contract schema/);
  assert.throws(() => schemaId("unknown"), /unknown contract schema/);
  assert.throws(() => fixturePath("unknown", "valid.json"), /unknown contract schema/);
});

test("every schema is JSON Schema 2020-12 with a versioned $id and required fields", () => {
  for (const name of EXPECTED_SCHEMA_NAMES) {
    const schema = schemaOf(name);
    assert.equal(schema.$schema, JSON_SCHEMA_2020_12, `${name} uses JSON Schema 2020-12`);
    assert.equal(schema.$id, schemaId(name), `${name} has the versioned $id`);
    assert.ok(schema.$id.includes("/0.1.0/"), `${name} carries version 0.1.0`);
    assert.equal(typeof schema.title, "string");
    assert.ok(schema.title.length > 0, `${name} has a title`);
    assert.equal(typeof schema.description, "string");
    assert.ok(schema.description.length > 0, `${name} has a description`);
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false, `${name} rejects unknown fields`);
    assert.ok(Array.isArray(schema.required) && schema.required.length > 0);
    for (const key of schema.required) {
      assert.ok(Object.hasOwn(schema.properties ?? {}, key), `${name}.${key} is declared`);
    }
  }
});

test("every schema has at least one valid and one invalid fixture with the wrapper", () => {
  for (const name of EXPECTED_SCHEMA_NAMES) {
    const files = fixtureFiles(name);
    const valid = files.filter((file) => file.startsWith("valid"));
    const invalid = files.filter((file) => file.startsWith("invalid"));
    assert.ok(valid.length >= 1, `${name} has a valid fixture`);
    assert.ok(invalid.length >= 1, `${name} has an invalid fixture`);
    for (const file of files) {
      const wrapper = fixtureOf(name, file);
      assert.deepEqual(
        Object.keys(wrapper).sort(),
        ["data", "reason", "schema", "valid"],
        `${name}/${file} has the fixture wrapper`,
      );
      assert.equal(wrapper.schema, SCHEMA_FILES[name], `${name}/${file} names its schema`);
      assert.equal(typeof wrapper.valid, "boolean");
      assert.equal(wrapper.valid, file.startsWith("valid"), `${name}/${file} matches its file name`);
      assert.equal(typeof wrapper.reason, "string");
      assert.ok(wrapper.reason.length > 10, `${name}/${file} documents a reason`);
      assert.equal(typeof wrapper.data, "object");
    }
  }
});

test("every fixture schema path resolves to a schema", () => {
  const schemas = new Set(Object.values(SCHEMA_FILES));
  for (const name of EXPECTED_SCHEMA_NAMES) {
    for (const file of fixtureFiles(name)) {
      assert.ok(schemas.has(fixtureOf(name, file).schema), `${name}/${file} maps to a schema`);
    }
  }
});

test("valid fixtures satisfy their schema", () => {
  for (const name of EXPECTED_SCHEMA_NAMES) {
    const schema = schemaOf(name);
    for (const file of fixtureFiles(name).filter((entry) => entry.startsWith("valid"))) {
      const wrapper = fixtureOf(name, file);
      assert.ok(validate(wrapper.data, schema, schema), `${name}/${file} is valid`);
    }
  }
});

test("invalid fixtures violate their schema and name the broken rule", () => {
  for (const name of EXPECTED_SCHEMA_NAMES) {
    for (const file of fixtureFiles(name).filter((entry) => entry.startsWith("invalid"))) {
      const wrapper = fixtureOf(name, file);
      assert.ok(!validate(wrapper.data, schemaOf(name), schemaOf(name)), `${name}/${file} is invalid`);
      assert.match(wrapper.reason, /[a-z]/, `${name}/${file} explains the violation`);
    }
  }
});

test("valid fixtures carry every required top-level field", () => {
  for (const name of EXPECTED_SCHEMA_NAMES) {
    const required = schemaOf(name).required;
    for (const file of fixtureFiles(name).filter((entry) => entry.startsWith("valid"))) {
      const { data } = fixtureOf(name, file);
      for (const key of required) {
        assert.ok(Object.hasOwn(data, key), `${name}/${file} has required field ${key}`);
      }
    }
  }
});

test("valid ids are UUIDv7 and valid timestamps are ISO-8601 with timezone", () => {
  for (const name of EXPECTED_SCHEMA_NAMES) {
    for (const file of fixtureFiles(name).filter((entry) => entry.startsWith("valid"))) {
      const { data } = fixtureOf(name, file);
      walk(data, (node) => {
        if (node === null || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node)) {
          if (typeof value !== "string") continue;
          if (/Id$/.test(key) || key === "id") {
            assert.match(value, UUID_V7, `${name}/${file}: ${key} is a UUIDv7`);
          }
          if (/At$/.test(key)) {
            assert.match(value, ISO_TIMESTAMP, `${name}/${file}: ${key} is ISO-8601`);
          }
        }
      });
    }
  }
});

test("minimum sizes are encoded in the schemas", () => {
  const card = schemaOf("card");
  const zone = schemaOf("zone");
  assert.equal(card.properties.width.minimum, EXPECTED_MINIMUMS.card.width);
  assert.equal(card.properties.height.minimum, EXPECTED_MINIMUMS.card.height);
  assert.equal(zone.properties.width.minimum, EXPECTED_MINIMUMS.zone.width);
  assert.equal(zone.properties.height.minimum, EXPECTED_MINIMUMS.zone.height);
  assert.deepEqual(blockMinimums(schemaOf("block")), EXPECTED_MINIMUMS.block);
});

test("valid fixtures sit exactly on the minimum sizes", () => {
  const card = fixtureOf("card", "valid.json").data;
  assert.deepEqual([card.width, card.height], [176, 80]);
  const zone = fixtureOf("zone", "valid.json").data;
  assert.deepEqual([zone.width, zone.height], [256, 192]);
  for (const [type, minimum] of Object.entries(EXPECTED_MINIMUMS.block)) {
    const block = fixtureOf("block", `valid-${type}.json`).data;
    assert.equal(block.type, type);
    assert.deepEqual([block.width, block.height], [minimum.width, minimum.height], `${type} minimum`);
  }
});

test("invalid minimum-size fixtures are below their type minimum", () => {
  const card = fixtureOf("card", "invalid-width.json").data;
  assert.ok(card.width < EXPECTED_MINIMUMS.card.width);
  const zone = fixtureOf("zone", "invalid-height.json").data;
  assert.ok(zone.height < EXPECTED_MINIMUMS.zone.height);
  for (const [type, minimum] of Object.entries(EXPECTED_MINIMUMS.block)) {
    const block = fixtureOf("block", `invalid-${type}.json`).data;
    assert.equal(block.type, type);
    assert.ok(
      block.width < minimum.width || block.height < minimum.height,
      `${type} invalid fixture is below its minimum`,
    );
  }
});

test("fixed enums are part of the schemas", () => {
  assert.deepEqual(schemaOf("account").properties.locale.enum, ["de", "en"]);
  assert.deepEqual(schemaOf("board").properties.visibility.enum, ["private", "workspace", "link"]);
  assert.deepEqual(schemaOf("block").properties.type.enum, [
    "checklist",
    "palette",
    "columns",
    "timeline",
    "table",
  ]);
  assert.deepEqual(schemaOf("board-content").required[0], "contractVersion");
  assert.equal(schemaOf("board-content").properties.contractVersion.const, "0.1.0");
});

test("the fractional index is a string", () => {
  for (const name of ["card", "zone", "block"]) {
    const z = schemaOf(name).properties.z;
    assert.equal(z.type, "string", `${name}.z is a string`);
    assert.equal(z.pattern, FRACTIONAL_INDEX.source, `${name}.z uses the fractional-index pattern`);
  }
  assert.ok(FRACTIONAL_INDEX.test("a0"));
  assert.ok(FRACTIONAL_INDEX.test("a0V"));
  assert.ok(!FRACTIONAL_INDEX.test("-"));
  assert.ok(!FRACTIONAL_INDEX.test("a 0"));
  const invalid = fixtureOf("card", "invalid-z.json");
  assert.equal(typeof invalid.data.z, "number");
});

test("timestamps are ISO-8601 strings with timezone", () => {
  for (const name of ["account", "workspace", "board", "note", "card", "zone", "block", "edge"]) {
    for (const key of ["createdAt", "updatedAt"]) {
      const property = schemaOf(name).properties[key];
      assert.equal(property.type, "string", `${name}.${key} is a string`);
      assert.ok(ISO_TIMESTAMP.test("2027-01-10T09:00:00.000Z"), "UTC timestamp is accepted");
      assert.ok(ISO_TIMESTAMP.test("2027-01-10T10:00:00+01:00"), "offset timestamp is accepted");
      assert.ok(!ISO_TIMESTAMP.test("2027-01-10"), "a date is not a timestamp");
    }
  }
});

test("AD-4: a note exists once and cards only reference it", () => {
  const root = fixtureOf("board-content", "valid.json").data;
  const noteIds = root.notes.map((note) => note.id);
  assert.equal(new Set(noteIds).size, noteIds.length, "notes are not duplicated");
  assert.deepEqual([...new Set(root.cards.map((card) => card.noteId))].sort(), [...noteIds].sort());
  const cardSchema = schemaOf("card");
  assert.ok(cardSchema.required.includes("noteId"));
  for (const forbidden of ["title", "body", "content"]) {
    assert.ok(!Object.hasOwn(cardSchema.properties, forbidden), `a card does not embed ${forbidden}`);
  }
  const noteSchema = schemaOf("note");
  assert.ok(noteSchema.required.includes("id"));
  assert.ok(noteSchema.required.includes("workspaceId"));
});

test("the parent relation is board to zone to card, without nested zones", () => {
  const root = fixtureOf("board-content", "valid.json").data;
  const zoneIds = new Set(root.zones.map((zone) => zone.id));
  for (const zone of root.zones) {
    assert.equal(zone.boardId, root.board.id);
    assert.ok(!Object.hasOwn(zone, "zoneId"), "a zone has no parent zone");
  }
  for (const card of root.cards) {
    assert.equal(card.boardId, root.board.id);
    assert.ok(zoneIds.has(card.zoneId), "a zoned card points at a zone of the board");
  }
  for (const block of root.blocks) {
    assert.equal(block.boardId, root.board.id);
  }
  const zoneSchema = schemaOf("zone");
  assert.ok(Object.hasOwn(zoneSchema.properties, "boardId"));
  assert.ok(!Object.hasOwn(zoneSchema.properties, "zoneId"));
  assert.deepEqual(schemaOf("card").properties.zoneId.type, ["string", "null"]);
  const nested = fixtureOf("zone", "invalid-nested.json").data;
  assert.ok(Object.hasOwn(nested, "zoneId"));
});

test("edges connect cards only", () => {
  const root = fixtureOf("board-content", "valid.json").data;
  const cardIds = new Set(root.cards.map((card) => card.id));
  for (const edge of root.edges) {
    assert.equal(edge.from.kind, "card");
    assert.equal(edge.to.kind, "card");
    assert.ok(cardIds.has(edge.from.id));
    assert.ok(cardIds.has(edge.to.id));
  }
  const endpoint = schemaOf("edge").$defs["card-endpoint"];
  assert.equal(endpoint.properties.kind.const, "card");
  const invalid = fixtureOf("edge", "invalid-zone-endpoint.json").data;
  assert.equal(invalid.from.kind, "zone");
});

test("the root schema references every board-content entity", () => {
  const root = schemaOf("board-content");
  const refs = collectRefs(root);
  assert.deepEqual(
    refs.sort(),
    [
      "block.schema.json",
      "board.schema.json",
      "card.schema.json",
      "edge.schema.json",
      "note.schema.json",
      "zone.schema.json",
    ],
  );
  for (const ref of refs) {
    const target = schemaOf(ref.replace(".schema.json", ""));
    assert.ok(target !== undefined, `${ref} points at an existing schema`);
    assert.equal(new URL(ref, root.$id).href, target.$id, `${ref} resolves to the target $id`);
  }
  assert.deepEqual(root.required.sort(), [
    "blocks",
    "board",
    "cards",
    "contractVersion",
    "edges",
    "notes",
    "zones",
  ]);
});

test("the package has no runtime dependencies and defines the test command", () => {
  const manifest = readJson("package.json");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(typeof manifest.scripts.test, "string");
  assert.match(manifest.scripts.test, /node --test/);
});
