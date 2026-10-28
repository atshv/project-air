// Unit tests for the REST API error envelope of contract 0.4.0 (AD-8).
//
// The suite checks the fixed UPPER_SNAKE error-code enum, the required
// messageKey mapping errors.<camelCase(code)>, the closed details shape (field
// paths, never user text), the error fixtures and the translation keys: every
// code has exactly one key in de.json, en.json and en-XA.json. The
// language-check gate proves the full catalogue parity, ICU syntax and the
// deterministic pseudo-locale.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  API_SCHEMA_FILES,
  CONTRACT_BASE_URI,
  CONTRACT_VERSION,
  ERROR_CODES,
  ERROR_MESSAGE_KEYS,
  PACKAGE_DIR,
  apiFixturePath,
  apiSchemaId,
  apiSchemaPath,
} from "../index.mjs";
import { JSON_SCHEMA_2020_12, UUID_V7, validate } from "./support.mjs";

const ERRORS_SCHEMA = JSON.parse(readFileSync(apiSchemaPath("errors"), "utf8"));
const MESSAGES_DIR = join(PACKAGE_DIR, "..", "..", "apps", "web", "messages");
const LOCALES = ["de", "en", "en-XA"];
const REQUEST_ID = "0192f0d0-7000-7000-8000-0000000000d1";
const EXPECTED_CODES = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
];
const EXPECTED_KEYS = [
  "errors.authRequired",
  "errors.forbidden",
  "errors.notFound",
  "errors.validation",
  "errors.conflict",
  "errors.rateLimited",
  "errors.internal",
];
const KEBAB = {
  AUTH_REQUIRED: "auth-required",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not-found",
  VALIDATION: "validation",
  CONFLICT: "conflict",
  RATE_LIMITED: "rate-limited",
  INTERNAL: "internal",
};
const KEY_SEGMENT = /^[a-z][a-zA-Z0-9]*$/;

const camel = (code) => {
  const [head, ...rest] = code.toLowerCase().split("_");
  return head + rest.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
};
const errorValid = (data) => validate(data, ERRORS_SCHEMA, ERRORS_SCHEMA);
const fixtureOf = (validity, file) => JSON.parse(readFileSync(apiFixturePath(validity, file), "utf8"));
const messagesOf = (locale) => JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8"));
const flatten = (value, prefix = [], flat = new Map()) => {
  for (const [key, child] of Object.entries(value)) {
    const path = [...prefix, key];
    if (typeof child === "string") flat.set(path.join("."), child);
    else flatten(child, path, flat);
  }
  return flat;
};

// --- the schema ---------------------------------------------------------------

test("the error schema is versioned JSON Schema 2020-12 with the fixed code enum", () => {
  assert.equal(ERRORS_SCHEMA.$schema, JSON_SCHEMA_2020_12);
  assert.equal(ERRORS_SCHEMA.$id, apiSchemaId("errors"));
  assert.equal(ERRORS_SCHEMA.$id, `${CONTRACT_BASE_URI}api/errors.schema.json`);
  assert.ok(ERRORS_SCHEMA.$id.includes("/0.4.0/"));
  assert.equal(CONTRACT_VERSION, "0.4.0");
  assert.equal(typeof ERRORS_SCHEMA.title, "string");
  assert.equal(typeof ERRORS_SCHEMA.description, "string");
  assert.equal(ERRORS_SCHEMA.type, "object");
  assert.equal(ERRORS_SCHEMA.additionalProperties, false);
  assert.deepEqual([...ERRORS_SCHEMA.required].sort(), ["code", "messageKey", "requestId"]);
  assert.deepEqual(ERRORS_SCHEMA.$defs.errorCode.enum, EXPECTED_CODES);
  assert.deepEqual(ERRORS_SCHEMA.$defs.messageKey.enum, EXPECTED_KEYS);
  assert.deepEqual(ERRORS_SCHEMA.properties.code.$ref, "#/$defs/errorCode");
  assert.deepEqual(ERRORS_SCHEMA.properties.messageKey.$ref, "#/$defs/messageKey");
  assert.deepEqual(ERRORS_SCHEMA.properties.details.$ref, "#/$defs/errorDetails");
  const details = ERRORS_SCHEMA.$defs.errorDetails;
  assert.equal(details.additionalProperties, false);
  assert.ok(details.description.includes("never user text"));
  assert.deepEqual(details.required, ["fields"]);
  assert.match(details.properties.fields.items.pattern, /\^\[a-z\]/);
});

test("the wire codes stay UPPER_SNAKE and the message keys are lowerCamelCase", () => {
  assert.deepEqual([...ERROR_CODES], EXPECTED_CODES);
  assert.deepEqual(Object.keys(ERROR_MESSAGE_KEYS).sort(), [...ERROR_CODES].sort());
  for (const code of ERROR_CODES) {
    assert.match(code, /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/, `${code} is a stable UPPER_SNAKE code`);
    const key = ERROR_MESSAGE_KEYS[code];
    assert.equal(key, `errors.${camel(code)}`, `${code} maps to its camelCase key`);
    assert.match(key, /^errors\.[a-z][a-zA-Z0-9]*$/, `${key} is English lowerCamelCase`);
    for (const segment of key.split(".")) {
      assert.match(segment, KEY_SEGMENT, `${key} passes the language-check key-format`);
    }
  }
  assert.equal(new Set(Object.values(ERROR_MESSAGE_KEYS)).size, ERROR_CODES.length, "every code has its own key");
  assert.deepEqual([...Object.values(ERROR_MESSAGE_KEYS)].sort(), [...EXPECTED_KEYS].sort());
});

test("the oneOf ties every code to exactly one message key", () => {
  const branches = ERRORS_SCHEMA.oneOf;
  assert.equal(branches.length, ERROR_CODES.length);
  for (const code of ERROR_CODES) {
    const branch = branches.find((entry) => entry.properties.code.const === code);
    assert.ok(branch !== undefined, `${code} has a mapping branch`);
    assert.equal(branch.properties.messageKey.const, ERROR_MESSAGE_KEYS[code]);
    assert.ok(errorValid({ requestId: REQUEST_ID, code, messageKey: ERROR_MESSAGE_KEYS[code] }));
  }
  assert.ok(!errorValid({ requestId: REQUEST_ID, code: "FORBIDDEN", messageKey: "errors.authRequired" }));
  assert.ok(!errorValid({ requestId: REQUEST_ID, code: "TEAPOT", messageKey: "errors.internal" }));
  assert.ok(!errorValid({ requestId: REQUEST_ID, code: "INTERNAL", messageKey: "errors.internal", text: "nope" }));
});

// --- fixtures -----------------------------------------------------------------

test("every error code has a valid fixture and the invalid ones are rejected", () => {
  for (const code of ERROR_CODES) {
    const file = `errors-${KEBAB[code]}.json`;
    const wrapper = fixtureOf("valid", file);
    assert.deepEqual(Object.keys(wrapper).sort(), ["data", "reason", "schema", "valid"]);
    assert.equal(wrapper.schema, API_SCHEMA_FILES.errors);
    assert.equal(wrapper.valid, true);
    assert.ok(wrapper.reason.length > 10);
    assert.equal(wrapper.data.code, code);
    assert.equal(wrapper.data.messageKey, ERROR_MESSAGE_KEYS[code]);
    assert.match(wrapper.data.requestId, UUID_V7);
    assert.ok(errorValid(wrapper.data), `${file} satisfies the error schema`);
  }
  const invalid = {
    "errors-unknown-code.json": /unknown error code/,
    "errors-mismatched-message-key.json": /must match/,
    "errors-missing-request-id.json": /requestId/,
    "errors-details-with-text.json": /field paths/,
  };
  for (const [file, reason] of Object.entries(invalid)) {
    const wrapper = fixtureOf("invalid", file);
    assert.equal(wrapper.schema, API_SCHEMA_FILES.errors);
    assert.equal(wrapper.valid, false);
    assert.match(wrapper.reason, reason, `${file} names the violated rule`);
    assert.ok(!errorValid(wrapper.data), `${file} is rejected`);
  }
});

test("details carry field paths, never user text", () => {
  const validation = fixtureOf("valid", "errors-validation.json").data;
  assert.deepEqual(validation.details.fields, ["board.title", "card.width"]);
  assert.ok(errorValid(validation));
  assert.ok(!errorValid({
    requestId: REQUEST_ID,
    code: "VALIDATION",
    messageKey: "errors.validation",
    details: { fields: ["Board title is missing"] },
  }));
  assert.ok(!errorValid({
    requestId: REQUEST_ID,
    code: "VALIDATION",
    messageKey: "errors.validation",
    details: { fields: ["board.title"], message: "text" },
  }));
});

// --- translation keys ---------------------------------------------------------

test("every error code has exactly one message key in de, en and en-XA", () => {
  const catalogues = new Map(LOCALES.map((locale) => [locale, flatten(messagesOf(locale))]));
  const deKeys = [...catalogues.get("de").keys()].sort();
  for (const locale of LOCALES) {
    const flat = catalogues.get(locale);
    assert.deepEqual([...flat.keys()].sort(), deKeys, `${locale}.json has the same keys as de.json`);
    for (const code of ERROR_CODES) {
      const key = ERROR_MESSAGE_KEYS[code];
      assert.ok(flat.has(key), `${locale}.json carries ${key}`);
      const value = flat.get(key);
      assert.equal(typeof value, "string");
      assert.ok(value.trim().length > 0, `${locale}.json ${key} is not empty`);
    }
  }
  for (const locale of LOCALES) {
    const errors = messagesOf(locale).errors;
    for (const code of ERROR_CODES) {
      const segment = camel(code);
      assert.equal(
        Object.keys(errors).filter((key) => key === segment).length,
        1,
        `${locale}.json has exactly one errors.${segment}`,
      );
      assert.equal(Object.keys(errors).filter((key) => key.toLowerCase() === segment.toLowerCase()).length, 1);
    }
  }
});

test("the German error messages follow the style rules and the English ones differ", () => {
  const de = flatten(messagesOf("de"));
  const en = flatten(messagesOf("en"));
  for (const code of ERROR_CODES) {
    const key = ERROR_MESSAGE_KEYS[code];
    const german = de.get(key);
    assert.ok(!german.includes("!"), `${key} has no exclamation mark`);
    assert.ok(!german.includes("\u00df"), `${key} uses ss, never the sharp-s character`);
    assert.ok(german.endsWith("."), `${key} is one short sentence`);
    assert.ok(german.length <= 120, `${key} stays short`);
    assert.notEqual(german, en.get(key), `${key} is translated, not copied`);
  }
});

test("the pseudo locale carries the generated values for the error keys", () => {
  const de = flatten(messagesOf("de"));
  const pseudo = flatten(messagesOf("en-XA"));
  for (const code of ERROR_CODES) {
    const key = ERROR_MESSAGE_KEYS[code];
    const value = pseudo.get(key);
    assert.match(value, /^\[.+\]$/, `${key} is bracketed by the pseudo generator`);
    assert.notEqual(value, de.get(key), `${key} is a pseudo transformation of the German value`);
  }
});

test("the index exports the error code table and the API schema path", () => {
  assert.ok(Object.isFrozen(ERROR_CODES));
  assert.ok(Object.isFrozen(ERROR_MESSAGE_KEYS));
  assert.equal(ERROR_CODES.length, 7);
  assert.ok(apiSchemaPath("errors").endsWith(API_SCHEMA_FILES.errors));
  assert.throws(() => apiSchemaPath("unknown"), /unknown API schema/);
});
