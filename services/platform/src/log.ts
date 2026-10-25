/**
 * Minimal structured logging on top of `node:process`.
 *
 * One JSON object per line. Callers pass only non-secret fields: the logger
 * never sees the parsed configuration, so connection strings and passwords are
 * not logged by construction. Debug and info go to stdout, warn and error to
 * stderr.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

function defaultWrite(level: LogLevel, line: string): void {
  if (level === "warn" || level === "error") {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

export function createLogger(
  level: LogLevel,
  writer: (level: LogLevel, line: string) => void = defaultWrite,
): Logger {
  const threshold = LEVEL_WEIGHT[level];

  const log = (entryLevel: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LEVEL_WEIGHT[entryLevel] < threshold) {
      return;
    }
    writer(entryLevel, JSON.stringify({ time: new Date().toISOString(), level: entryLevel, message, ...fields }));
  };

  return {
    level,
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
  };
}

/** A logger that discards every entry; used by tests and by health checks. */
export function silentLogger(): Logger {
  return createLogger("error", () => {
    /* discard */
  });
}
