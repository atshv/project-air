// Tests for the zone parent rule of contract 0.3.0 (L08, AD-1).
//
// Cards and blocks carry an optional nullable zone parent; a zone never carries one
// (no nested zones in v1). JSON Schema validates the shape of the reference but
// cannot compare it with the `zones` array, so the additive corpus under
// `fixtures/containment` carries the referential rule: every non-null parent names
// a zone of the same board and no zone has a parent. The fixtures are part of the
// TypeScript/C++ parity corpus; the platform migration adds the foreign key (P4-26).

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CONTAINMENT_FIXTURE_DIR, CONTRACT_VERSION, PACKAGE_DIR } from "../index.mjs";
import { fixtureOf, schemaOf, validate } from "./support.mjs";

const DIRECTORY = join(PACKAGE_DIR, CONTAINMENT_FIXTURE_DIR);
const FILES = readdirSync(DIRECTORY).filter((file) => file.endsWith(".json")).sort();
const containmentOf = (file) => JSON.parse(readFileSync(join(DIRECTORY, file), "utf8"));
const boardSchema = schemaOf("board-content");

/** Parent problems that JSON Schema cannot report: dangling, cross-board and nested. */
function parentProblems(content) {
  const problems = [];
  const boardId = content.board?.id;
  const zoneIds = new Set((content.zones ?? []).map((zone) => zone.id));
  for (const zone of content.zones ?? []) {
    if (Object.hasOwn(zone, "zoneId")) problems.push(`zone ${zone.id} carries a parent zone`);
    if (zone.boardId !== boardId) problems.push(`zone ${zone.id} belongs to another board`);
  }
  for (const item of [...(content.cards ?? []), ...(content.blocks ?? [])]) {
    if (item.boardId !== boardId) problems.push(`${item.id} belongs to another board`);
    const parent = item.zoneId ?? null;
    if (parent !== null && !zoneIds.has(parent)) problems.push(`${item.id} has a dangling zone parent ${parent}`);
  }
  return problems;
}

test("the containment corpus is additive and uses the board-content schema", () => {
  assert.deepEqual(CONTAINMENT_FIXTURE_DIR, "fixtures/containment");
  assert.deepEqual(FILES, ["invalid-dangling-parent.json", "valid-parents.json"]);
  for (const file of FILES) {
    const wrapper = containmentOf(file);
    assert.deepEqual(Object.keys(wrapper).sort(), ["data", "reason", "schema", "valid"]);
    assert.equal(wrapper.schema, "schemas/board-content.schema.json");
    assert.equal(wrapper.valid, file.startsWith("valid"), `${file} matches its file name`);
    assert.equal(wrapper.data.contractVersion, CONTRACT_VERSION, `${file} uses the current contractVersion`);
    assert.ok(wrapper.reason.length > 10, `${file} documents a reason`);
  }
});

test("valid containment fixtures are schema-valid and follow the parent rule", () => {
  const { data } = containmentOf("valid-parents.json");
  assert.ok(validate(data, boardSchema, boardSchema), "the valid containment fixture satisfies the root schema");
  assert.deepEqual(parentProblems(data), [], "every parent resolves and no zone is nested");
  const zoned = data.cards.find((card) => card.zoneId !== null && card.zoneId !== undefined);
  const boardLevelCard = data.cards.find((card) => card.zoneId === null);
  const boardLevelBlock = data.blocks.find((block) => !Object.hasOwn(block, "zoneId"));
  assert.ok(zoned !== undefined, "a card inside a zone is covered");
  assert.ok(boardLevelCard !== undefined, "a card with an explicit null parent is covered");
  assert.ok(boardLevelBlock !== undefined, "a block without a parent field is covered");
});

test("the dangling parent fixture is rejected by the containment rule", () => {
  const { data } = containmentOf("invalid-dangling-parent.json");
  const problems = parentProblems(data);
  assert.ok(problems.some((problem) => problem.includes("dangling zone parent")), "the dangling parent is named");
  assert.ok(
    validate(data, boardSchema, boardSchema),
    "the dangling parent is schema-valid: JSON Schema cannot compare the reference, so the model rule is the rejection",
  );
});

test("a nested zone is rejected by the zone schema", () => {
  const nested = fixtureOf("zone", "invalid-nested.json");
  assert.equal(nested.valid, false);
  assert.ok(Object.hasOwn(nested.data, "zoneId"), "the nested fixture carries a parent zone");
  assert.ok(!validate(nested.data, schemaOf("zone"), schemaOf("zone")), "zones reject a parent field");
});

test("cards and blocks carry an optional nullable parent and zones carry none", () => {
  for (const name of ["card", "block"]) {
    const schema = schemaOf(name);
    const parent = schema.properties.zoneId;
    assert.ok(!schema.required.includes("zoneId"), `${name}.zoneId is optional`);
    assert.deepEqual(parent.type, ["string", "null"], `${name}.zoneId is nullable`);
    assert.match(parent.description, /Parent zone/);
  }
  assert.ok(!Object.hasOwn(schemaOf("zone").properties, "zoneId"), "a zone has no parent property");
  assert.ok(Object.hasOwn(schemaOf("board-content").properties, "zones"));
});
