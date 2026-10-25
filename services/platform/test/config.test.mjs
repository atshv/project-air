/**
 * Config validation: fail fast, name the variable, never echo its value.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigError, parseConfig } from "../src/config.ts";

const DATABASE_URL = "postgresql://owner:top-secret-password@127.0.0.1:5433/project-air_slot_1";

function validEnvironment() {
  return { NODE_ENV: "test", PORT: "4110", DATABASE_URL };
}

test("parses a complete environment", () => {
  const config = parseConfig(validEnvironment());
  assert.deepEqual(config, {
    serviceName: "platform",
    nodeEnv: "test",
    logLevel: "info",
    host: "127.0.0.1",
    port: 4110,
    databaseUrl: DATABASE_URL,
  });
});

test("defaults NODE_ENV, LOG_LEVEL and HOST", () => {
  const config = parseConfig({ PORT: "4110", DATABASE_URL });
  assert.equal(config.nodeEnv, "development");
  assert.equal(config.logLevel, "info");
  assert.equal(config.host, "127.0.0.1");
});

test("a missing DATABASE_URL fails fast", () => {
  assert.throws(
    () => parseConfig({ PORT: "4110" }),
    (error) => error instanceof ConfigError && /DATABASE_URL is required/.test(error.message),
  );
});

test("an invalid DATABASE_URL is rejected without echoing the value", () => {
  assert.throws(
    () => parseConfig({ PORT: "4110", DATABASE_URL: "not-a-url" }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /DATABASE_URL/);
      assert.doesNotMatch(error.message, /not-a-url/);
      return true;
    },
  );
});

test("a non-PostgreSQL DATABASE_URL is rejected", () => {
  assert.throws(
    () => parseConfig({ PORT: "4110", DATABASE_URL: "mysql://owner:top-secret-password@127.0.0.1/db" }),
    (error) => error instanceof ConfigError && /postgres/.test(error.message) && !/top-secret/.test(error.message),
  );
});

test("PORT is required and must be a valid port number", () => {
  assert.throws(
    () => parseConfig({ DATABASE_URL }),
    (error) => error instanceof ConfigError && /PORT is required/.test(error.message),
  );
  for (const invalid of ["0", "65536", "-1", "abc", "41.5", ""]) {
    assert.throws(
      () => parseConfig({ PORT: invalid, DATABASE_URL }),
      (error) => error instanceof ConfigError && /PORT/.test(error.message),
      `PORT=${invalid} must be rejected`,
    );
  }
});

test("NODE_ENV and LOG_LEVEL reject unknown values", () => {
  assert.throws(
    () => parseConfig({ ...validEnvironment(), NODE_ENV: "staging" }),
    (error) => error instanceof ConfigError && /NODE_ENV/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), LOG_LEVEL: "verbose" }),
    (error) => error instanceof ConfigError && /LOG_LEVEL/.test(error.message),
  );
  assert.equal(parseConfig({ ...validEnvironment(), LOG_LEVEL: "DEBUG" }).logLevel, "debug");
});

test("HOST must not contain whitespace", () => {
  assert.throws(
    () => parseConfig({ ...validEnvironment(), HOST: "not a host" }),
    (error) => error instanceof ConfigError && /HOST/.test(error.message),
  );
});
