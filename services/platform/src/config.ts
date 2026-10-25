/**
 * Runtime configuration for the platform service.
 *
 * The environment is parsed exactly once at start-up. A missing or malformed
 * value raises a `ConfigError`; the entry point turns that into exit code 2
 * and a message that names the variable but never echoes its value, so no
 * credential or connection string can reach a log.
 */

import { LOG_LEVELS, type LogLevel } from "./log.ts";

export type NodeEnvironment = "development" | "test" | "production";

export const NODE_ENVIRONMENTS: readonly NodeEnvironment[] = ["development", "test", "production"];

export interface PlatformConfig {
  readonly serviceName: "platform";
  readonly nodeEnv: NodeEnvironment;
  readonly logLevel: LogLevel;
  readonly host: string;
  readonly port: number;
  /** Owner connection (`DATABASE_URL`): migrations and operations. */
  readonly databaseUrl: string;
  /** Restricted `app_user` connection (`APP_DATABASE_URL`) used by the API (AD-5). */
  readonly appDatabaseUrl: string;
  /** Base URL of the auth service (`AUTH_SERVICE_URL`), e.g. `http://127.0.0.1:4120`. */
  readonly authServiceUrl: string;
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

function parsePostgresUrl(environment: Environment, name: string): string {
  const raw = required(environment, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Deliberately no value in the message: it usually contains a password.
    throw new ConfigError(`${name} must be a valid PostgreSQL URL such as postgresql://user:password@host:5432/database`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConfigError(`${name} must use the postgres:// or postgresql:// scheme`);
  }
  if (url.hostname === "") {
    throw new ConfigError(`${name} must name a database host`);
  }
  if (url.pathname.replaceAll("/", "") === "") {
    throw new ConfigError(`${name} must name a database`);
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

/**
 * Parses the environment once. The port comes from the variable the slot
 * tooling exports (`PORT` for the platform); ports and database names are
 * never hard-coded in the service.
 */
export function parseConfig(environment: Environment = process.env): PlatformConfig {
  return {
    serviceName: "platform",
    nodeEnv: parseNodeEnvironment(environment),
    logLevel: parseLogLevel(environment),
    host: parseHost(environment),
    port: parsePort(environment, "PORT"),
    databaseUrl: parsePostgresUrl(environment, "DATABASE_URL"),
    appDatabaseUrl: parsePostgresUrl(environment, "APP_DATABASE_URL"),
    authServiceUrl: parseHttpUrl(environment, "AUTH_SERVICE_URL"),
  };
}
