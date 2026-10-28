// P5-03: secret-free structured logs (JSON lines); connection strings, tokens
// and message payload bodies are never logged.

export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const SECRET_KEYS = /(token|secret|password|authorization|database_url|connection)/i;

export function createLogger(level: LogLevel, write: (line: string) => void = (line) => process.stdout.write(line + "\n")): Logger {
  const log = (severity: LogLevel, event: string, fields: Record<string, unknown> = {}): void => {
    if (ORDER[severity] < ORDER[level]) return;
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      safe[key] = SECRET_KEYS.test(key) ? "[redacted]" : value;
    }
    write(JSON.stringify({ time: new Date().toISOString(), level: severity, service: "sync", event, ...safe }));
  };
  return {
    debug: (event, fields) => log("debug", event, fields),
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
  };
}
