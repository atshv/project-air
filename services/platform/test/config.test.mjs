/**
 * Config validation: fail fast, name the variable, never echo its value.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigError, parseConfig } from "../src/config.ts";

const DATABASE_URL = "postgresql://owner:top-secret-password@127.0.0.1:5433/project-air_slot_1";
const APP_DATABASE_URL = "postgresql://app_user:app-secret@127.0.0.1:5433/project-air_slot_1";
const AUTH_SERVICE_URL = "http://127.0.0.1:4120/";

function validEnvironment() {
  return {
    NODE_ENV: "test",
    PORT: "4110",
    DATABASE_URL,
    APP_DATABASE_URL,
    AUTH_SERVICE_URL,
  };
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
    appDatabaseUrl: APP_DATABASE_URL,
    authServiceUrl: "http://127.0.0.1:4120",
  });
});

test("defaults NODE_ENV, LOG_LEVEL and HOST", () => {
  const { NODE_ENV: _omitted, ...environment } = validEnvironment();
  const config = parseConfig(environment);
  assert.equal(config.nodeEnv, "development");
  assert.equal(config.logLevel, "info");
  assert.equal(config.host, "127.0.0.1");
});

test("a missing DATABASE_URL fails fast", () => {
  const { DATABASE_URL: _omitted, ...environment } = validEnvironment();
  assert.throws(
    () => parseConfig(environment),
    (error) => error instanceof ConfigError && /DATABASE_URL is required/.test(error.message),
  );
});

test("the app_user connection is required and must be a PostgreSQL URL", () => {
  const { APP_DATABASE_URL: _omitted, ...environment } = validEnvironment();
  assert.throws(
    () => parseConfig(environment),
    (error) => error instanceof ConfigError && /APP_DATABASE_URL is required/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), APP_DATABASE_URL: "not-a-url" }),
    (error) => error instanceof ConfigError && /APP_DATABASE_URL/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), APP_DATABASE_URL: "http://127.0.0.1:5433/db" }),
    (error) => error instanceof ConfigError && /APP_DATABASE_URL must use the postgres/.test(error.message),
  );
});

test("the auth service URL is required and must be http(s)", () => {
  const { AUTH_SERVICE_URL: _omitted, ...environment } = validEnvironment();
  assert.throws(
    () => parseConfig(environment),
    (error) => error instanceof ConfigError && /AUTH_SERVICE_URL is required/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), AUTH_SERVICE_URL: "not-a-url" }),
    (error) => error instanceof ConfigError && /AUTH_SERVICE_URL must be a valid/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), AUTH_SERVICE_URL: "ftp://127.0.0.1:4120" }),
    (error) => error instanceof ConfigError && /AUTH_SERVICE_URL must use the http/.test(error.message),
  );
});

test("port, NODE_ENV, LOG_LEVEL and HOST are validated", () => {
  assert.throws(
    () => parseConfig({ ...validEnvironment(), PORT: "abc" }),
    (error) => error instanceof ConfigError && /PORT/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), PORT: "0" }),
    (error) => error instanceof ConfigError && /PORT/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), NODE_ENV: "staging" }),
    (error) => error instanceof ConfigError && /NODE_ENV/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), LOG_LEVEL: "verbose" }),
    (error) => error instanceof ConfigError && /LOG_LEVEL/.test(error.message),
  );
  assert.throws(
    () => parseConfig({ ...validEnvironment(), HOST: "not a host" }),
    (error) => error instanceof ConfigError && /HOST/.test(error.message),
  );
});
