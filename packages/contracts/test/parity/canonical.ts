// Canonical fixture description for the TypeScript/C++ parity harness.
//
// One fixture and wrapper are reduced to a stable description: the fixture path,
// its schema, validity, model type, inverse type, the UUID ids and the sorted
// top-level fields, and the normalized reason. The C++ program in test/cpp
// produces the same line; test/parity.test.mjs compares both sets for every
// fixture. This module has no Node imports so the package typecheck can compile
// it without Node type definitions; it is type-checked against the generated
// contract types.

import type { BoardContent, Operation } from "../../generated/types.ts";

export interface FixtureWrapper {
  schema: string;
  valid: boolean;
  reason: string;
  data: unknown;
}

export interface CanonicalResult {
  fixture: string;
  schema: string;
  valid: boolean;
  type: string;
  inverse: string;
  ids: string[];
  fields: string[];
  reason: string;
}

export const OPERATION_SCHEMA = "schemas/operation.schema.json";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// Type-level use of the generated model: `pnpm --filter ./packages/contracts
// typecheck` proves that the codegen output exposes the entities and the
// discriminated operation union.
export function boardOf(content: BoardContent): BoardContent["board"] {
  return content.board;
}

export function operationTypeOf(operation: Operation): Operation["type"] {
  return operation.type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectIds(value: unknown, ids: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.match(UUID_PATTERN) ?? []) ids.add(match);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, ids);
    return;
  }
  if (isRecord(value)) {
    for (const child of Object.values(value)) collectIds(child, ids);
  }
}

function typeOfFixture(wrapper: FixtureWrapper, data: Record<string, unknown>): string {
  if (wrapper.schema === OPERATION_SCHEMA) {
    return typeof data.type === "string" ? data.type : "-";
  }
  return wrapper.schema.replace(/^schemas\//, "").replace(/\.schema\.json$/, "");
}

function inverseTypeOf(data: Record<string, unknown>): string {
  const inverse = data.inverse;
  if (!isRecord(inverse)) return "-";
  return typeof inverse.type === "string" ? inverse.type : "-";
}

/** Reduce one fixture to its canonical description. */
export function canonicalResult(fixture: string, wrapper: FixtureWrapper): CanonicalResult {
  const data = isRecord(wrapper.data) ? wrapper.data : {};
  const ids = new Set<string>();
  collectIds(wrapper.data, ids);
  return {
    fixture,
    schema: wrapper.schema,
    valid: wrapper.valid,
    type: typeOfFixture(wrapper, data),
    inverse: inverseTypeOf(data),
    ids: [...ids].sort(),
    fields: Object.keys(data).sort(),
    reason: wrapper.reason.replace(/\s+/g, " ").trim(),
  };
}

/** The canonical single-line form: path|schema|valid|type|inverse|ids|fields|reason. */
export function canonicalLine(result: CanonicalResult): string {
  return [
    result.fixture,
    result.schema,
    result.valid ? "true" : "false",
    result.type,
    result.inverse,
    result.ids.join(","),
    result.fields.join(","),
    result.reason,
  ].join("|");
}

/** Canonical lines for all fixtures, sorted by fixture path. */
export function canonicalLines(entries: ReadonlyArray<readonly [string, FixtureWrapper]>): string[] {
  return entries.map(([fixture, wrapper]) => canonicalLine(canonicalResult(fixture, wrapper))).sort();
}

/** Compare the TypeScript and C++ canonical line sets; empty means parity. */
export function diffCanonical(expected: readonly string[], actual: readonly string[]): string[] {
  const differences: string[] = [];
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    const left = expected[index] ?? "<missing>";
    const right = actual[index] ?? "<missing>";
    if (left !== right) differences.push(`line ${index + 1}: TS ${left} != C++ ${right}`);
  }
  return differences;
}
