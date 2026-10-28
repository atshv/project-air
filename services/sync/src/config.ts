// P5-03: typed environment configuration for the sync service. Values come from
// the dev loop/slot environment; nothing is hardcoded and no secret is logged.

export interface SyncConfig {
  readonly serviceName: "sync";
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly authServiceUrl: string;
  readonly platformServiceUrl: string;
  readonly logLevel: "debug" | "info" | "warn" | "error";
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = (environment[name] ?? "").trim();
  if (value === "") throw new ConfigError(`${name} is required but is not set`);
  return value;
}

export function loadSyncConfig(environment: Environment = process.env): SyncConfig {
  const port = Number(required(environment, "SYNC_PORT"));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new ConfigError("SYNC_PORT must be a valid TCP port");
  const logLevel = (environment.LOG_LEVEL ?? "info") as SyncConfig["logLevel"];
  if (!["debug", "info", "warn", "error"].includes(logLevel)) throw new ConfigError("LOG_LEVEL must be debug|info|warn|error");
  return {
    serviceName: "sync",
    host: (environment.HOST ?? "127.0.0.1").trim(),
    port,
    databaseUrl: required(environment, "DATABASE_URL"),
    authServiceUrl: required(environment, "AUTH_SERVICE_URL").replace(/\/+$/, ""),
    platformServiceUrl: required(environment, "PLATFORM_SERVICE_URL").replace(/\/+$/, ""),
    logLevel,
  };
}
