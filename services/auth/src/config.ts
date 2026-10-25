/**
 * Runtime configuration for the auth service.
 *
 * The environment is parsed exactly once at start-up. A missing or malformed
 * value raises a `ConfigError`; the entry point turns that into exit code 2 and
 * a message that names the variable but never echoes its value, so no
 * credential, token or connection string can reach a log.
 *
 * The test-session mode is impossible in production: `AUTH_TEST_MODE=1` together
 * with `NODE_ENV=production` fails the start-up.
 */

import { LOG_LEVELS, type LogLevel } from "./log.ts";

export type NodeEnvironment = "development" | "test" | "production";

export const NODE_ENVIRONMENTS: readonly NodeEnvironment[] = ["development", "test", "production"];

/** Secrets shorter than this are rejected before the service starts. */
export const MINIMUM_SECRET_LENGTH = 32;
/** The shared admin token may be shorter than a signing secret, but not empty. */
export const MINIMUM_ADMIN_TOKEN_LENGTH = 16;

export interface AuthConfig {
  readonly serviceName: "auth";
  readonly nodeEnv: NodeEnvironment;
  readonly logLevel: LogLevel;
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  /** Read from `AUTH_SESSION_SECRET`; signs the HMAC test sessions, never logged. */
  readonly sessionSecret: string;
  /** Kratos public API, e.g. `http://127.0.0.1:8433` (no trailing slash). */
  readonly kratosPublicUrl: string;
  /** Kratos admin API, e.g. `http://127.0.0.1:8434` (no trailing slash). */
  readonly kratosAdminUrl: string;
  /** Shared secret for `POST /internal/invitations`; never logged. */
  readonly kratosAdminToken: string;
  /** `AUTH_TEST_MODE=1` outside production only. */
  readonly testMode: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

const HOST_PATTERN = /^[A-Za-z0-9.:[\]_-]{1,255}$/;

function required(environment: Environment, name: string): string {
  const raw = environment[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") {
    throw new ConfigError(`${name} is required but is not set`);
  }
  return value;
}

function parseNodeEnvironment(environment: Environment): NodeEnvironment {
  const raw = environment.NODE_ENV;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") {
    return "development";
  }
  if (!(NODE_ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new ConfigError(`NODE_ENV must be one of ${NODE_ENVIRONMENTS.join(", ")}`);
  }
  return value as NodeEnvironment;
}

function parseLogLevel(environment: Environment): LogLevel {
  const raw = environment.LOG_LEVEL;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "") {
    return "info";
  }
  if (!(LOG_LEVELS as readonly string[]).includes(value)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);
  }
  return value as LogLevel;
}

function parsePort(environment: Environment, name: string): number {
  const value = required(environment, name);
  if (!/^[0-9]{1,5}$/.test(value)) {
    throw new ConfigError(`${name} must be a whole number between 1 and 65535`);
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new ConfigError(`${name} must be a whole number between 1 and 65535`);
  }
  return port;
}

function parseHost(environment: Environment): string {
  const raw = environment.HOST;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") {
    return "127.0.0.1";
  }
  if (!HOST_PATTERN.test(value)) {
    throw new ConfigError("HOST must be a host name or IP address");
  }
  return value;
}

function parseDatabaseUrl(environment: Environment): string {
  const raw = required(environment, "DATABASE_URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Deliberately no value in the message: it usually contains a password.
    throw new ConfigError("DATABASE_URL must be a valid PostgreSQL URL such as postgresql://user:password@host:5432/database");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConfigError("DATABASE_URL must use the postgres:// or postgresql:// scheme");
  }
  if (url.hostname === "") {
    throw new ConfigError("DATABASE_URL must name a database host");
  }
  if (url.pathname.replaceAll("/", "") === "") {
    throw new ConfigError("DATABASE_URL must name a database");
  }
  return raw;
}

function parseHttpUrl(environment: Environment, name: string): string {
  const raw = required(environment, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} must be a valid http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`${name} must use the http:// or https:// scheme`);
  }
  if (url.hostname === "") {
    throw new ConfigError(`${name} must name a host`);
  }
  return raw.replace(/\/+$/, "");
}

function parseSessionSecret(environment: Environment): string {
  const value = required(environment, "AUTH_SESSION_SECRET");
  if (value.length < MINIMUM_SECRET_LENGTH) {
    throw new ConfigError(`AUTH_SESSION_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters long`);
  }
  // The value is returned for signing but never logged or included in an error.
  return value;
}

function parseAdminToken(environment: Environment): string {
  const value = required(environment, "KRATOS_ADMIN_TOKEN");
  if (value.length < MINIMUM_ADMIN_TOKEN_LENGTH) {
    throw new ConfigError(`KRATOS_ADMIN_TOKEN must be at least ${MINIMUM_ADMIN_TOKEN_LENGTH} characters long`);
  }
  return value;
}

function parseTestMode(environment: Environment, nodeEnv: NodeEnvironment): boolean {
  const raw = environment.AUTH_TEST_MODE;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "" || value === "0") {
    return false;
  }
  if (value !== "1") {
    throw new ConfigError('AUTH_TEST_MODE must be unset, "0" or "1"');
  }
  if (nodeEnv === "production") {
    throw new ConfigError("AUTH_TEST_MODE must not be enabled when NODE_ENV is production");
  }
  return true;
}

/**
 * Parses the environment once. The port comes from the variable the slot
 * tooling exports (`AUTH_PORT` for the auth service); ports and database names
 * are never hard-coded in the service.
 */
export function parseConfig(environment: Environment = process.env): AuthConfig {
  const nodeEnv = parseNodeEnvironment(environment);
  return {
    serviceName: "auth",
    nodeEnv,
    logLevel: parseLogLevel(environment),
    host: parseHost(environment),
    port: parsePort(environment, "AUTH_PORT"),
    databaseUrl: parseDatabaseUrl(environment),
    sessionSecret: parseSessionSecret(environment),
    kratosPublicUrl: parseHttpUrl(environment, "KRATOS_PUBLIC_URL"),
    kratosAdminUrl: parseHttpUrl(environment, "KRATOS_ADMIN_URL"),
    kratosAdminToken: parseAdminToken(environment),
    testMode: parseTestMode(environment, nodeEnv),
  };
}
