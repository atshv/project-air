/**
 * Cursor pagination: order by `(created_at, id)` and encode that pair as an
 * opaque base64url cursor (contract pattern `[0-9A-Za-z._~-]{1,256}`).
 */

import type { PoolClient, QueryResult, QueryResultRow } from "pg";

import { validationFailed } from "../http/errors.ts";
import { sqlStateOf } from "../db/errors.ts";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
const CURSOR_PATTERN = /^[0-9A-Za-z._~-]{1,256}$/;
const CURSOR_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CURSOR_SQL_STATES = new Set(["22P02", "22007", "22008"]);

export interface PageCursor {
  /** PostgreSQL `created_at::text` (microsecond precision, round-trippable). */
  readonly createdAt: string;
  readonly id: string;
}

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}(?::\d{2})?|Z)$/;

export interface PageQuery {
  readonly limit: number;
  readonly cursor: PageCursor | null;
}

export function limitFromQuery(query: URLSearchParams): number {
  const raw = query.get("limit");
  if (raw === null || raw === "") {
    return DEFAULT_PAGE_SIZE;
  }
  if (!/^[0-9]{1,3}$/.test(raw)) {
    throw validationFailed(["limit"]);
  }
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_PAGE_SIZE) {
    throw validationFailed(["limit"]);
  }
  return limit;
}

export function cursorFromQuery(query: URLSearchParams): PageCursor | null {
  const raw = query.get("cursor");
  if (raw === null || raw === "") {
    return null;
  }
  if (!CURSOR_PATTERN.test(raw)) {
    throw validationFailed(["cursor"]);
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw validationFailed(["cursor"]);
  }
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) {
    throw validationFailed(["cursor"]);
  }
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  // PostgreSQL renders "+00"; JavaScript needs "+00:00" for Date.parse.
  let normalisedTimestamp = createdAt.includes(" ") ? createdAt.replace(" ", "T") : createdAt;
  if (/[+-]\d{2}$/.test(normalisedTimestamp)) {
    normalisedTimestamp = `${normalisedTimestamp}:00`;
  }
  if (
    !TIMESTAMP_PATTERN.test(createdAt) ||
    Number.isNaN(Date.parse(normalisedTimestamp)) ||
    !CURSOR_ID_PATTERN.test(id)
  ) {
    throw validationFailed(["cursor"]);
  }
  return { createdAt, id };
}

export function parsePageQuery(query: URLSearchParams): PageQuery {
  return { limit: limitFromQuery(query), cursor: cursorFromQuery(query) };
}

export function encodeCursor(createdAtText: string, id: string): string {
  return Buffer.from(`${createdAtText}|${id}`, "utf8").toString("base64url");
}

/** Explicit requestId for GET envelopes: `?requestId=<uuid v7>` (contract list-request). */
export function requestIdFromQuery(query: URLSearchParams, fallback: string): string {
  const raw = query.get("requestId");
  if (raw === null || raw === "") {
    return fallback;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw)) {
    throw validationFailed(["requestId"]);
  }
  return raw;
}

/**
 * Runs one page query and maps a cursor that PostgreSQL cannot parse to a
 * `VALIDATION` error with the `cursor` field (never a 500).
 */
export async function runPageQuery<T extends QueryResultRow>(
  client: PoolClient,
  cursor: PageCursor | null,
  text: string,
  values: readonly unknown[],
): Promise<QueryResult<T>> {
  try {
    return await client.query<T>(text, [...values]);
  } catch (error) {
    if (cursor !== null) {
      const state = sqlStateOf(error);
      if (state !== undefined && CURSOR_SQL_STATES.has(state)) {
        throw validationFailed(["cursor"]);
      }
    }
    throw error;
  }
}
