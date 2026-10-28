// Tests for the operation contract 0.4.0 (AD-1).
//
// The suite checks the operation schema, the fixture coverage per operation type,
// schema validity of the fixtures, and the model rules that JSON Schema cannot
// compare across fields: exactly one inverse per operation, the inverse board and
// target match the operation, the group inverse reverses the child inverses,
// groups do not nest, updates store the previous values, deletes store the
// object, and the resize operations respect the P1-01 minimum sizes.

import assert from "node:assert/strict";
import test from "node:test";

import { OPERATION_TYPES, SCHEMA_FILES, fixturePath, schemaId, schemaPath } from "../index.mjs";
import { FRACTIONAL_INDEX, fixtureFiles, fixtureOf, schemaOf, validate, walk } from "./support.mjs";

const OPERATION_SCHEMA = schemaOf("operation");
const OPERATION_FIXTURES = "operation";

const EXPECTED_TYPES = [
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
  "updateNoteBody",
];

const EXPECTED_INVERSE_TYPE = {
  createNote: "deleteNote",
  updateNote: "updateNote",
  deleteNote: "group",
  createCard: "deleteCard",
  moveCard: "moveCard",
  resizeCard: "resizeCard",
  deleteCard: "createCard",
  createZone: "deleteZone",
  moveZone: "moveZone",
  resizeZone: "resizeZone",
  deleteZone: "group",
  createBlock: "deleteBlock",
  moveBlock: "moveBlock",
  resizeBlock: "resizeBlock",
  updateBlock: "updateBlock",
  deleteBlock: "createBlock",
  createEdge: "deleteEdge",
  deleteEdge: "createEdge",
  reorder: "reorder",
  updateNoteBody: "updateNoteBody",
  group: "group",
};

const MINIMUM_SIZES = {
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

const kebab = (type) => type.replace(/(?<!^)(?=[A-Z])/g, "-").toLowerCase();
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;

const operationDefinitions = (schema) => schema.$defs ?? {};
const payloadDefinition = (type) => operationDefinitions(OPERATION_SCHEMA)[`payload-${kebab(type)}`];
const schemaValid = (data) => validate(data, OPERATION_SCHEMA, OPERATION_SCHEMA);

/** Every operation object inside a fixture (the operation itself and group children). */
function operationsIn(operation, found = []) {
  if (operation === null || typeof operation !== "object") return found;
  if (typeof operation.type === "string" && Object.hasOwn(EXPECTED_INVERSE_TYPE, operation.type)) {
    found.push(operation);
  }
  if (operation.type === "group" && Array.isArray(operation.payload?.children)) {
    for (const child of operation.payload.children) operationsIn(child, found);
  }
  return found;
}

/** The ids an operation acts on, read from its payload. */
function targetIds({ type, payload }) {
  const ids = [];
  const push = (...values) => {
    for (const value of values) if (typeof value === "string") ids.push(value);
  };
  switch (type) {
    case "createNote":
      push(payload.note?.id);
      break;
    case "updateNote":
      push(payload.noteId);
      break;
    case "deleteNote":
      push(payload.note?.id);
      push(...(payload.cards ?? []).map((card) => card.id));
      break;
    case "createCard":
      push(payload.card?.id);
      break;
    case "moveCard":
    case "resizeCard":
      push(payload.cardId);
      break;
    case "deleteCard":
      push(payload.card?.id);
      break;
    case "createZone":
      push(payload.zone?.id);
      break;
    case "moveZone":
    case "resizeZone":
      push(payload.zoneId);
      break;
    case "deleteZone":
      push(payload.zone?.id);
      push(...(payload.cards ?? []).map((card) => card.id));
      push(...(payload.blocks ?? []).map((block) => block.id));
      break;
    case "createBlock":
      push(payload.block?.id);
      break;
    case "moveBlock":
    case "resizeBlock":
    case "updateBlock":
      push(payload.blockId);
      break;
    case "deleteBlock":
      push(payload.block?.id);
      break;
    case "createEdge":
    case "deleteEdge":
      push(payload.edge?.id);
      break;
    case "reorder":
      push(payload.itemId);
      break;
    case "group":
      for (const child of payload.children ?? []) ids.push(...targetIds(child));
      break;
    default:
      break;
  }
  return ids;
}

/** The model rules that JSON Schema cannot express across fields. */
function modelProblems(operation) {
  const problems = [];
  for (const current of operationsIn(operation)) {
    const inverse = current.inverse;
    if (inverse === null || typeof inverse !== "object") {
      problems.push(`${current.type} has no inverse`);
      continue;
    }
    if (Object.keys(current).filter((key) => key === "inverse").length !== 1) {
      problems.push(`${current.type} must carry exactly one inverse`);
    }
    if (inverse.boardId !== current.boardId) {
      problems.push(`${current.type} inverse boardId does not match the operation boardId`);
    }
    const expectedType = EXPECTED_INVERSE_TYPE[current.type];
    if (inverse.type !== expectedType) {
      problems.push(`${current.type} inverse type ${inverse.type} is not ${expectedType}`);
      continue;
    }
    if (current.type === "group") {
      const children = current.payload?.children;
      if (!Array.isArray(children) || children.length === 0) {
        problems.push("a group needs at least one child");
        continue;
      }
      for (const child of children) {
        if (child?.type === "group") problems.push("groups do not nest");
      }
      const reversed = [...children].map((child) => child.inverse).reverse();
      if (JSON.stringify(reversed) !== JSON.stringify(inverse.payload?.children ?? null)) {
        problems.push("the group inverse is not the reversed child inverses");
      }
    }
    const forwardTargets = targetIds(current);
    if (inverse.type === "group") {
      if (!Array.isArray(inverse.payload.children) || inverse.payload.children.length === 0) {
        problems.push(`${current.type} group inverse has no children`);
        continue;
      }
      const restored = inverse.payload.children.flatMap((pair) => targetIds(pair));
      for (const id of forwardTargets) {
        if (!restored.includes(id)) problems.push(`${current.type} group inverse does not restore ${id}`);
      }
    } else if (forwardTargets.length > 0) {
      const inverseTargets = targetIds({ type: inverse.type, payload: inverse.payload });
      if (inverseTargets.length === 0) {
        problems.push(`${current.type} inverse carries no target`);
      } else if (inverseTargets[0] !== forwardTargets[0]) {
        problems.push(`${current.type} inverse target ${inverseTargets[0]} does not match ${forwardTargets[0]}`);
      }
    }
  }
  return problems;
}

test("the operation schema is versioned JSON Schema 2020-12 with the operation vocabulary", () => {
  assert.equal(OPERATION_SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(OPERATION_SCHEMA.$id, schemaId("operation"));
  assert.ok(OPERATION_SCHEMA.$id.includes("/0.4.0/"));
  assert.equal(OPERATION_SCHEMA.$ref, "#/$defs/operation");
  assert.deepEqual(OPERATION_SCHEMA.$defs.operationType.enum, EXPECTED_TYPES);
  assert.deepEqual([...OPERATION_TYPES], EXPECTED_TYPES);
  const operation = OPERATION_SCHEMA.$defs.operation;
  assert.equal(operation.type, "object");
  assert.equal(operation.additionalProperties, false);
  assert.deepEqual(operation.required.sort(), [
    "actorId",
    "boardId",
    "createdAt",
    "id",
    "inverse",
    "payload",
    "type",
  ]);
  assert.deepEqual(Object.keys(OPERATION_SCHEMA.$defs.inverse.properties).sort(), ["boardId", "payload", "type"]);
  assert.equal(OPERATION_SCHEMA.$defs.inverse.additionalProperties, false);
});

test("index exports the operation schema path, id and type vocabulary", () => {
  assert.equal(SCHEMA_FILES.operation, "schemas/operation.schema.json");
  assert.ok(schemaPath("operation").endsWith("schemas/operation.schema.json"));
  assert.ok(fixturePath(OPERATION_FIXTURES, "valid-group.json").endsWith("fixtures/operation/valid-group.json"));
  assert.equal(schemaId("operation"), `${OPERATION_SCHEMA.$id}`);
  assert.equal(Array.isArray(OPERATION_TYPES), true);
});

test("every operation type has a valid and at least one invalid fixture", () => {
  const files = fixtureFiles(OPERATION_FIXTURES);
  for (const type of EXPECTED_TYPES) {
    const name = kebab(type);
    assert.ok(files.includes(`valid-${name}.json`), `${type} has a valid fixture`);
    assert.ok(
      files.some((file) => file.startsWith(`invalid-${name}`)),
      `${type} has an invalid fixture`,
    );
  }
});

test("every operation fixture maps to the operation schema with the fixture wrapper", () => {
  for (const file of fixtureFiles(OPERATION_FIXTURES)) {
    const wrapper = fixtureOf(OPERATION_FIXTURES, file);
    assert.deepEqual(Object.keys(wrapper).sort(), ["data", "reason", "schema", "valid"]);
    assert.equal(wrapper.schema, SCHEMA_FILES.operation, `${file} names the operation schema`);
    assert.equal(wrapper.valid, file.startsWith("valid"), `${file} matches its file name`);
    assert.equal(typeof wrapper.reason, "string");
    assert.ok(wrapper.reason.length > 10, `${file} documents a reason`);
    assert.equal(typeof wrapper.data, "object");
  }
});

test("valid operation fixtures satisfy the schema and the inverse model", () => {
  for (const file of fixtureFiles(OPERATION_FIXTURES).filter((entry) => entry.startsWith("valid"))) {
    const { data } = fixtureOf(OPERATION_FIXTURES, file);
    assert.ok(schemaValid(data), `${file} satisfies the operation schema`);
    assert.deepEqual(modelProblems(data), [], `${file} follows the inverse model`);
  }
});

test("invalid operation fixtures break the schema or the inverse model and name the rule", () => {
  for (const file of fixtureFiles(OPERATION_FIXTURES).filter((entry) => entry.startsWith("invalid"))) {
    const wrapper = fixtureOf(OPERATION_FIXTURES, file);
    const rejected = !schemaValid(wrapper.data) || modelProblems(wrapper.data).length > 0;
    assert.ok(rejected, `${file} is rejected`);
    assert.equal(typeof wrapper.reason, "string");
    assert.ok(wrapper.reason.length > 10, `${file} names the violated rule`);
  }
});

test("every operation carries exactly one inverse with board, type and payload", () => {
  for (const file of fixtureFiles(OPERATION_FIXTURES).filter((entry) => entry.startsWith("valid"))) {
    const { data } = fixtureOf(OPERATION_FIXTURES, file);
    for (const operation of operationsIn(data)) {
      assert.equal(Object.hasOwn(operation, "inverse"), true);
      assert.equal(typeof operation.inverse, "object");
      assert.deepEqual(Object.keys(operation.inverse).sort(), ["boardId", "payload", "type"]);
      assert.equal(operation.inverse.boardId, operation.boardId);
    }
  }
});

test("operation ids are UUIDv7 and timestamps are ISO-8601", () => {
  for (const file of fixtureFiles(OPERATION_FIXTURES).filter((entry) => entry.startsWith("valid"))) {
    const { data } = fixtureOf(OPERATION_FIXTURES, file);
    for (const operation of operationsIn(data)) {
      assert.match(operation.id, UUID_V7, `${file} operation id`);
      assert.match(operation.boardId, UUID_V7, `${file} board id`);
      assert.match(operation.actorId, UUID_V7, `${file} actor id`);
      assert.match(operation.createdAt, ISO_TIMESTAMP, `${file} createdAt`);
      assert.match(operation.inverse.boardId, UUID_V7, `${file} inverse board id`);
    }
  }
});

test("each operation type pairs with its documented inverse type", () => {
  for (const file of fixtureFiles(OPERATION_FIXTURES).filter((entry) => entry.startsWith("valid"))) {
    const { data } = fixtureOf(OPERATION_FIXTURES, file);
    for (const operation of operationsIn(data)) {
      assert.equal(
        operation.inverse.type,
        EXPECTED_INVERSE_TYPE[operation.type],
        `${file}: ${operation.type} inverse`,
      );
    }
  }
});

test("groups have ordered children and the inverse reverses the child inverses", () => {
  const { data } = fixtureOf(OPERATION_FIXTURES, "valid-group.json");
  assert.equal(data.type, "group");
  assert.ok(data.payload.children.length >= 1);
  for (const child of data.payload.children) {
    assert.notEqual(child.type, "group", "groups do not nest");
  }
  assert.equal(data.inverse.type, "group");
  assert.deepEqual(
    data.inverse.payload.children,
    [...data.payload.children].map((child) => child.inverse).reverse(),
  );
  assert.ok(data.inverse.payload.children.length >= 1);
});

test("groups do not nest and need at least one child", () => {
  const groupPayload = OPERATION_SCHEMA.$defs["group-payload"];
  assert.equal(groupPayload.properties.children.minItems, 1);
  assert.equal(groupPayload.properties.children.items.$ref, "#/$defs/child-operation");
  const childOperation = OPERATION_SCHEMA.$defs["child-operation"];
  assert.deepEqual(childOperation.allOf[1].not.properties.type, { const: "group" });
  assert.ok(modelProblems(fixtureOf(OPERATION_FIXTURES, "invalid-group-nested.json").data).length > 0);
  assert.ok(!schemaValid(fixtureOf(OPERATION_FIXTURES, "invalid-group-empty.json").data));
});

test("updates store only changed fields and the inverse stores the previous values", () => {
  for (const file of ["valid-update-note.json", "valid-update-block.json"]) {
    const { data } = fixtureOf(OPERATION_FIXTURES, file);
    assert.equal(data.inverse.type, data.type);
    assert.deepEqual(
      Object.keys(data.inverse.payload.changes).sort(),
      Object.keys(data.payload.changes).sort(),
      `${file}: the inverse carries the same fields`,
    );
    assert.equal(data.payload.changes && Object.keys(data.payload.changes).length >= 1, true);
  }
  const updateNote = payloadDefinition("updateNote");
  assert.equal(updateNote.properties.changes.minProperties, 1);
  assert.equal(updateNote.properties.changes.additionalProperties, false);
  const updateBlock = payloadDefinition("updateBlock");
  assert.equal(updateBlock.properties.changes.minProperties, 1);
  assert.equal(updateBlock.properties.changes.additionalProperties, false);
});

test("deletes store the object and creates have the matching delete as inverse", () => {
  const pairs = [
    ["valid-create-note.json", "deleteNote"],
    ["valid-create-card.json", "deleteCard"],
    ["valid-create-zone.json", "deleteZone"],
    ["valid-create-block.json", "deleteBlock"],
    ["valid-create-edge.json", "deleteEdge"],
  ];
  for (const [file, deleteType] of pairs) {
    const { data } = fixtureOf(OPERATION_FIXTURES, file);
    assert.equal(data.inverse.type, deleteType, `${file} inverse type`);
    const createTarget = targetIds(data)[0];
    assert.ok(targetIds({ type: data.inverse.type, payload: data.inverse.payload }).includes(createTarget));
  }
  const deleteCard = fixtureOf(OPERATION_FIXTURES, "valid-delete-card.json").data;
  assert.equal(deleteCard.inverse.type, "createCard");
  assert.equal(deleteCard.payload.card.id, deleteCard.inverse.payload.card.id);
  const deleteNote = fixtureOf(OPERATION_FIXTURES, "valid-delete-note.json").data;
  assert.ok(Array.isArray(deleteNote.payload.cards));
  assert.deepEqual(new Set(targetIds(deleteNote)), new Set([
    deleteNote.payload.note.id,
    ...deleteNote.payload.cards.map((card) => card.id),
  ]));
  const deleteZone = fixtureOf(OPERATION_FIXTURES, "valid-delete-zone.json").data;
  assert.ok(["keep", "delete"].includes(deleteZone.payload.policy));
  assert.ok(Array.isArray(deleteZone.payload.cards) && Array.isArray(deleteZone.payload.blocks));
});

test("the reorder operation stores the new z and its inverse the previous z", () => {
  const { data } = fixtureOf(OPERATION_FIXTURES, "valid-reorder.json");
  const payloadDefinition = schemaOf("reorder-payload");
  assert.equal(data.type, "reorder");
  assert.equal(data.inverse.type, "reorder");
  assert.deepEqual(payloadDefinition.required, ["itemId", "z"]);
  assert.equal(payloadDefinition.properties.itemId.type, "string");
  assert.equal(payloadDefinition.properties.z.type, "string");
  assert.equal(payloadDefinition.properties.z.pattern, FRACTIONAL_INDEX.source);
  assert.equal(data.inverse.payload.itemId, data.payload.itemId, "the inverse names the same item");
  assert.notEqual(data.inverse.payload.z, data.payload.z, "the inverse carries the previous z");
  assert.equal(
    schemaValid(fixtureOf(OPERATION_FIXTURES, "invalid-reorder.json").data),
    false,
    "a reorder without z is schema-invalid",
  );
  assert.ok(
    modelProblems(fixtureOf(OPERATION_FIXTURES, "invalid-reorder-inverse-target.json").data).length > 0,
    "a reorder inverse for another item is model-invalid",
  );
});

test("resize operations respect the P1-01 minimum sizes", () => {
  const card = schemaOf("card");
  const zone = schemaOf("zone");
  const block = schemaOf("block");
  assert.equal(payloadDefinition("resizeCard").properties.width.minimum, card.properties.width.minimum);
  assert.equal(payloadDefinition("resizeCard").properties.height.minimum, card.properties.height.minimum);
  assert.equal(payloadDefinition("resizeZone").properties.width.minimum, zone.properties.width.minimum);
  assert.equal(payloadDefinition("resizeZone").properties.height.minimum, zone.properties.height.minimum);
  const resizeBlock = payloadDefinition("resizeBlock");
  const blockMinimums = {};
  for (const branch of block.allOf) {
    blockMinimums[branch.if.properties.type.const] = {
      width: branch.then.properties.width.minimum,
      height: branch.then.properties.height.minimum,
    };
  }
  const resizeMinimums = {};
  for (const branch of resizeBlock.allOf) {
    resizeMinimums[branch.if.properties.type.const] = {
      width: branch.then.properties.width.minimum,
      height: branch.then.properties.height.minimum,
    };
  }
  assert.deepEqual(resizeMinimums, blockMinimums);
  assert.deepEqual(blockMinimums, MINIMUM_SIZES.block);

  const resizeCard = fixtureOf(OPERATION_FIXTURES, "valid-resize-card.json").data;
  assert.ok(resizeCard.payload.width >= card.properties.width.minimum);
  assert.ok(resizeCard.payload.height >= card.properties.height.minimum);
  const resizeZone = fixtureOf(OPERATION_FIXTURES, "valid-resize-zone.json").data;
  assert.ok(resizeZone.payload.width >= zone.properties.width.minimum);
  assert.ok(resizeZone.payload.height >= zone.properties.height.minimum);
  for (const [type, minimum] of Object.entries(MINIMUM_SIZES.block)) {
    const valid = fixtureOf(OPERATION_FIXTURES, "valid-resize-block.json").data;
    if (valid.payload.type === type) {
      assert.ok(valid.payload.width >= minimum.width);
      assert.ok(valid.payload.height >= minimum.height);
    }
  }
});

test("move payloads carry a position and an optional zone parent", () => {
  for (const [type, idName] of [
    ["moveCard", "cardId"],
    ["moveZone", "zoneId"],
    ["moveBlock", "blockId"],
  ]) {
    const payload = payloadDefinition(type);
    assert.deepEqual(payload.required, [idName, "x", "y"]);
    assert.equal(payload.properties.zoneId.type[0], "string");
    assert.equal(payload.properties.zoneId.type[1], "null");
  }
});

test("the group inverse is checked against the reversed child inverses", () => {
  const notReversed = fixtureOf(OPERATION_FIXTURES, "invalid-group-not-reversed.json");
  assert.ok(schemaValid(notReversed.data), "the wrong order is schema-valid");
  assert.ok(modelProblems(notReversed.data).some((problem) => problem.includes("group inverse")), "the model rejects it");
});

test("an inverse with a mismatching board or target is invalid", () => {
  const mismatchedBoard = fixtureOf(OPERATION_FIXTURES, "invalid-inverse-board.json");
  assert.ok(schemaValid(mismatchedBoard.data), "the board mismatch is schema-valid");
  assert.ok(modelProblems(mismatchedBoard.data).some((problem) => problem.includes("boardId")));
  const mismatchedTarget = fixtureOf(OPERATION_FIXTURES, "invalid-inverse-target.json");
  assert.ok(schemaValid(mismatchedTarget.data), "the target mismatch is schema-valid");
  assert.ok(modelProblems(mismatchedTarget.data).some((problem) => problem.includes("target")));
});

test("every valid operation payload object still satisfies the P1-01 entity schemas", () => {
  for (const file of fixtureFiles(OPERATION_FIXTURES).filter((entry) => entry.startsWith("valid"))) {
    const { data } = fixtureOf(OPERATION_FIXTURES, file);
    walk(data.payload, (node) => {
      if (node === null || typeof node !== "object") return;
      const entityName =
        Object.hasOwn(node, "noteId") && Object.hasOwn(node, "boardId") && !Object.hasOwn(node, "type") ? "card" :
        Object.hasOwn(node, "workspaceId") && Object.hasOwn(node, "title") && !Object.hasOwn(node, "boardId") ? "note" :
        Object.hasOwn(node, "workspaceId") && Object.hasOwn(node, "ownerId") ? "board" :
        Object.hasOwn(node, "type") && Object.hasOwn(node, "z") ? "block" :
        Object.hasOwn(node, "from") && Object.hasOwn(node, "to") ? "edge" :
        Object.hasOwn(node, "boardId") && Object.hasOwn(node, "title") && Object.hasOwn(node, "visibility") ? "zone" : null;
      if (entityName !== null) {
        assert.ok(validate(node, schemaOf(entityName), schemaOf(entityName)), `${file}: ${entityName} is valid`);
      }
    });
  }
});
