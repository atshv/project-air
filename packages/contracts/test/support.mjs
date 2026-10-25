// Shared helpers for the contract test suites: file access, the versioned
// constants and a small structural JSON Schema validator for the keywords this
// contract uses (type, required, properties, additionalProperties, enum, const,
// pattern, minLength, maxLength, minimum, maximum, items, minItems, maxItems,
// uniqueItems, minProperties, not, allOf, anyOf, oneOf, if/then and $ref).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURE_DIRS, PACKAGE_DIR, SCHEMA_FILES, fixturePath, schemaPath } from "../index.mjs";

export const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const FRACTIONAL_INDEX = /^[0-9A-Za-z]{1,64}$/;
export const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

export const readJson = (relativePath) => JSON.parse(readFileSync(join(PACKAGE_DIR, relativePath), "utf8"));
export const schemaOf = (name) => JSON.parse(readFileSync(schemaPath(name), "utf8"));
export const fixtureOf = (name, file) => JSON.parse(readFileSync(fixturePath(name, file), "utf8"));
export const fixtureFiles = (name) =>
  readdirSync(join(PACKAGE_DIR, FIXTURE_DIRS[name]))
    .filter((file) => file.endsWith(".json"))
    .sort();

export const walk = (value, visit) => {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) walk(child, visit);
  }
};

export const collectRefs = (value, refs = []) => {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (value !== null && typeof value === "object") {
    if (typeof value.$ref === "string") refs.push(value.$ref);
    for (const child of Object.values(value)) collectRefs(child, refs);
  }
  return refs;
};

const CONTEXT = new Map();
for (const name of Object.keys(SCHEMA_FILES)) {
  const schema = schemaOf(name);
  CONTEXT.set(schema.$id, schema);
}

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

/**
 * Validate a value against the subset of JSON Schema used by this contract.
 * External $refs resolve through the schema `$id` map; local `$ref`s resolve
 * inside the current document.
 */
export function validate(value, schema, document) {
  if (schema === true || schema === undefined) return true;
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
  if (typeof value === "number" && schema.maximum !== undefined && value > schema.maximum) return false;
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      return false;
    }
    if (schema.items !== undefined && !value.every((item) => validate(item, schema.items, document))) return false;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) return false;
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
  if (schema.not !== undefined && validate(value, schema.not, document)) return false;
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
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => validate(value, branch, document))) {
    return false;
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((branch) => validate(value, branch, document)).length !== 1) {
    return false;
  }
  if (schema.if !== undefined) {
    if (validate(value, schema.if, document) && schema.then !== undefined) {
      if (!validate(value, schema.then, document)) return false;
    }
  }
  return true;
}

/** The block-type minimum sizes from the if/then branches of the block schema. */
export function blockMinimums(blockSchema) {
  const minimums = {};
  for (const branch of blockSchema.allOf) {
    minimums[branch.if.properties.type.const] = {
      width: branch.then.properties.width.minimum,
      height: branch.then.properties.height.minimum,
    };
  }
  return minimums;
}
