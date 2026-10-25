/**
 * Config validation: fail fast, name the variable, never echo its value, and
 * refuse the test-session mode in production.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigError, MINIMUM_SECRET_LENGTH, parseConfig } from "../src/config.ts";

const DATABASE_URL = "postgresql://owner:top-secret-password@127.0.0.1:5433/project-air_slot_1";
const SESSION_SECRET = "s".repeat(MINIMUM_SECRET_LENGTH);
const ADMIN_TOKEN = "t".repeat(16);

function validEnvironment() {
  return {
    NODE_ENV: "test",
    AUTH_PORT: "4120",
    DATABASE_URL,
    AUTH_SESSION_SECRET: SESSION_SECRET,
    KRATOS_PUBLIC_URL: "http://127.0.0.1:8433",
    KRATOS_ADMIN_URL: "http://127.0.0.1:8434/",
    KRATOS_ADMIN_TOKEN: ADMIN_TOKEN,
  };
}

test("parses a complete environment and normalises the Kratos URLs", () => {
  const config = parseConfig(validEnvironment());
  assert.deepEqual(config, {
    serviceName: "auth",
    nodeEnv: "test",
    logLevel: "info",
    host: "127.0.0.1",
    port: 4120,
    databaseUrl: DATABASE_URL,
    sessionSecret: SESSION_SECRET,
    kratosPublicUrl: "http://127.0.0.1:8433",
    kratosAdminUrl: "http://127.0.0.1:8434",
    kratosAdminToken: ADMIN_TOKEN,
    testMode: false,
  });
});

test("defaults NODE_ENV, LOG_LEVEL and HOST", () => {
  const { NODE_ENV: _omitted, ...environment } = validEnvironment();
  const config = parseConfig(environment);
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

test("secrets are required, long enough and never echoed", () => {
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

  const { KRATOS_ADMIN_TOKEN: _withoutToken, ...withoutToken } = validEnvironment();
  assert.throws(
    () => parseConfig(withoutToken),
    (error) => error instanceof ConfigError && /KRATOS_ADMIN_TOKEN is required/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), KRATOS_ADMIN_TOKEN: "short" }),
    (error) => error instanceof ConfigError && /KRATOS_ADMIN_TOKEN must be at least 16/.test(error.message),
  );
});

test("the Kratos URLs are required http(s) URLs", () => {
  for (const name of ["KRATOS_PUBLIC_URL", "KRATOS_ADMIN_URL"]) {
    const environment = { ...validEnvironment() };
    delete environment[name];
    assert.throws(
      () => parseConfig(environment),
      (error) => error instanceof ConfigError && new RegExp(`${name} is required`).test(error.message),
      `${name} must be required`,
    );
    assert.throws(
      () => parseConfig({ ...validEnvironment(), [name]: "not-a-url" }),
      (error) => error instanceof ConfigError && new RegExp(`${name} must be a valid`).test(error.message),
      `${name} must reject an invalid URL`,
    );
    assert.throws(
      () => parseConfig({ ...validEnvironment(), [name]: "ftp://127.0.0.1:8433" }),
      (error) => error instanceof ConfigError && new RegExp(`${name} must use the http`).test(error.message),
      `${name} must reject a non-http scheme`,
    );
  }
});

test("a missing or invalid DATABASE_URL fails fast", () => {
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

test("the test-session mode is opt-in and impossible in production", () => {
  assert.equal(parseConfig(validEnvironment()).testMode, false);
  assert.equal(parseConfig({ ...validEnvironment(), AUTH_TEST_MODE: "0" }).testMode, false);
  assert.equal(parseConfig({ ...validEnvironment(), AUTH_TEST_MODE: "1" }).testMode, true);
  assert.throws(
    () => parseConfig({ ...validEnvironment(), AUTH_TEST_MODE: "yes" }),
    (error) => error instanceof ConfigError && /AUTH_TEST_MODE must be unset/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), NODE_ENV: "production", AUTH_TEST_MODE: "1" }),
    (error) => error instanceof ConfigError && /must not be enabled when NODE_ENV is production/.test(error.message),
  );
  assert.equal(
    parseConfig({ ...validEnvironment(), NODE_ENV: "production", AUTH_TEST_MODE: "0" }).testMode,
    false,
  );
});
