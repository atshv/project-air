/**
 * Config validation: fail fast, name the variable, never echo its value.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigError, MINIMUM_SESSION_SECRET_LENGTH, parseConfig } from "../src/config.ts";

const DATABASE_URL = "postgresql://owner:top-secret-password@127.0.0.1:5433/project-air_slot_1";
const SESSION_SECRET = "s".repeat(MINIMUM_SESSION_SECRET_LENGTH);

function validEnvironment() {
  return { NODE_ENV: "test", AUTH_PORT: "4120", DATABASE_URL, AUTH_SESSION_SECRET: SESSION_SECRET };
}

test("parses a complete environment", () => {
  const config = parseConfig(validEnvironment());
  assert.deepEqual(config, {
    serviceName: "auth",
    nodeEnv: "test",
    logLevel: "info",
    host: "127.0.0.1",
    port: 4120,
    databaseUrl: DATABASE_URL,
    sessionSecret: SESSION_SECRET,
  });
});

test("defaults NODE_ENV, LOG_LEVEL and HOST", () => {
  const config = parseConfig({ AUTH_PORT: "4120", DATABASE_URL, AUTH_SESSION_SECRET: SESSION_SECRET });
  assert.equal(config.nodeEnv, "development");
  assert.equal(config.logLevel, "info");
  assert.equal(config.host, "127.0.0.1");
});

test("AUTH_PORT is required and must be a valid port number", () => {
  const { AUTH_PORT: _omitted, ...withoutPort } = validEnvironment();
  assert.throws(
    () => parseConfig(withoutPort),
    (error) => error instanceof ConfigError && /AUTH_PORT is required/.test(error.message),
  );
  for (const invalid of ["0", "65536", "-1", "abc", "41.5", ""]) {
    assert.throws(
      () => parseConfig({ ...validEnvironment(), AUTH_PORT: invalid }),
      (error) => error instanceof ConfigError && /AUTH_PORT/.test(error.message),
      `AUTH_PORT=${invalid} must be rejected`,
    );
  }
});

test("a missing or short AUTH_SESSION_SECRET fails fast without echoing the secret", () => {
  const { AUTH_SESSION_SECRET: _omitted, ...withoutSecret } = validEnvironment();
  assert.throws(
    () => parseConfig(withoutSecret),
    (error) => error instanceof ConfigError && /AUTH_SESSION_SECRET is required/.test(error.message),
  );
  const shortSecret = "too-short-secret";
  assert.throws(
    () => parseConfig({ ...validEnvironment(), AUTH_SESSION_SECRET: shortSecret }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /AUTH_SESSION_SECRET must be at least/);
      assert.doesNotMatch(error.message, new RegExp(shortSecret));
      return true;
    },
  );
});

test("a missing DATABASE_URL fails fast", () => {
  assert.throws(
    () => parseConfig({ AUTH_PORT: "4120", AUTH_SESSION_SECRET: SESSION_SECRET }),
    (error) => error instanceof ConfigError && /DATABASE_URL is required/.test(error.message),
  );
});

test("an invalid DATABASE_URL is rejected without echoing the value", () => {
  assert.throws(
    () => parseConfig({ ...validEnvironment(), DATABASE_URL: "not-a-url" }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /DATABASE_URL/);
      assert.doesNotMatch(error.message, /not-a-url/);
      return true;
    },
  );
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
