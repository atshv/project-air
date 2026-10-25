/**
 * Body helpers for the JSON routes.
 */

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function integerValue(record: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return undefined;
  }
  return value;
}
