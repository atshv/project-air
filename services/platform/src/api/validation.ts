/**
 * Explicit validation of the contract API envelopes (no validation library).
 *
 * Every parser collects the dotted field paths it rejected and the route throws
 * one `VALIDATION` error with those paths in `details.fields`; the contract
 * forbids user-visible text in `details`.
 */

import { notFound, validationFailed } from "../http/errors.ts";
import { REQUEST_ID_PATTERN } from "../http/request-id.ts";

export type FieldList = string[];

const UUID_V7_PATTERN = REQUEST_ID_PATTERN;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks that `body` is a closed envelope with exactly the allowed properties
 * and that every required property is present.
 */
export function parseEnvelope(
  body: unknown,
  prefix: string,
  required: readonly string[],
  allowed: readonly string[],
): Record<string, unknown> {
  const fields: FieldList = [];
  if (!isRecord(body)) {
    throw validationFailed(prefix === "" ? required.map((key) => key) : required.map((key) => `${prefix}${key}`));
  }
  for (const key of required) {
    if (!(key in body)) {
      fields.push(prefix + key);
    }
  }
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      fields.push(prefix + key);
    }
  }
  if (fields.length > 0) {
    throw validationFailed(fields);
  }
  return body;
}

export function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A path id; a malformed uuid can never address a row, so it is a 404. */
export function pathUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw notFound("the resource does not exist");
  }
  return value;
}

/** The mutation envelope requires a client UUIDv7 requestId (echoed in the response). */
export function requiredRequestId(record: Record<string, unknown>, prefix: string = ""): string {
  const value = record.requestId;
  if (!isUuidV7(value)) {
    throw validationFailed([prefix + "requestId"]);
  }
  return value;
}

export function requestIdField(record: Record<string, unknown>, prefix: string, fields: FieldList): string | undefined {
  const value = record.requestId;
  if (!isUuidV7(value)) {
    fields.push(prefix + "requestId");
    return undefined;
  }
  return value;
}

export function uuidField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fields: FieldList,
): string | undefined;
export function uuidField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fields: FieldList,
  options: { nullable: true },
): string | null | undefined;
export function uuidField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fields: FieldList,
  options: { nullable?: boolean } = {},
): string | null | undefined {
  const value = record[key];
  if (value === undefined && options.nullable === true) {
    return null;
  }
  if (value === null && options.nullable === true) {
    return null;
  }
  if (!isUuidV7(value)) {
    fields.push(path);
    return undefined;
  }
  return value;
}

export function stringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  min: number,
  max: number,
  fields: FieldList,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    fields.push(path);
    return undefined;
  }
  const length = [...value].length;
  if (length < min || length > max) {
    fields.push(path);
    return undefined;
  }
  return value;
}

export function numberField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fields: FieldList,
  minimum?: number,
): number | undefined {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fields.push(path);
    return undefined;
  }
  if (minimum !== undefined && value < minimum) {
    fields.push(path);
    return undefined;
  }
  return value;
}

export function booleanField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fields: FieldList,
): boolean | undefined {
  const value = record[key];
  if (typeof value !== "boolean") {
    fields.push(path);
    return undefined;
  }
  return value;
}

export function enumField<T extends string>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  values: readonly T[],
  fields: FieldList,
): T | undefined {
  const value = record[key];
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    fields.push(path);
    return undefined;
  }
  return value as T;
}

export function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], prefix: string, fields: FieldList): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      fields.push(prefix + key);
    }
  }
}

/** Throws when the parser collected any invalid field path. */
export function requireValid(fields: FieldList): void {
  if (fields.length > 0) {
    throw validationFailed(fields);
  }
}
