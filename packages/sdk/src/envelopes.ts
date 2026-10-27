/**
 * Envelope parsing and error mapping of the platform API (contract 0.2.0).
 *
 * Success envelopes: list `{requestId, items, nextCursor}`, single
 * `{requestId, <resource>}`, delete `{requestId, deletedId}`.
 * Error envelope: `{requestId, code, messageKey, details?{fields}}`.
 */

import { ApiError, type ApiErrorCode } from "./errors.ts";
import type { DeleteResult, ListResult } from "./types.ts";

const ERROR_CODES: readonly ApiErrorCode[] = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

function malformed(requestId: string): ApiError {
  return new ApiError({
    status: 0,
    code: "INTERNAL",
    messageKey: "errors.internal",
    requestId,
    message: "the server returned an unexpected response envelope",
  });
}

export function parseList<T>(body: unknown, sentRequestId: string): ListResult<T> {
  if (
    !isRecord(body) ||
    typeof body.requestId !== "string" ||
    !Array.isArray(body.items) ||
    !(body.nextCursor === null || typeof body.nextCursor === "string")
  ) {
    throw malformed(sentRequestId);
  }
  return {
    requestId: body.requestId,
    items: body.items as readonly T[],
    nextCursor: body.nextCursor,
  };
}

export function parseResource<T>(body: unknown, property: string, sentRequestId: string): T {
  if (!isRecord(body) || typeof body.requestId !== "string" || !isRecord(body[property])) {
    throw malformed(sentRequestId);
  }
  return body[property] as unknown as T;
}

export function parseDeleted(body: unknown, sentRequestId: string): DeleteResult {
  if (!isRecord(body) || typeof body.requestId !== "string" || typeof body.deletedId !== "string") {
    throw malformed(sentRequestId);
  }
  return { requestId: body.requestId, deletedId: body.deletedId };
}

/** Maps a contract error body to `ApiError`; anything unexpected becomes INTERNAL. */
export function toApiError(body: unknown, status: number, sentRequestId: string): ApiError {
  if (isRecord(body) && isErrorCode(body.code) && typeof body.messageKey === "string") {
    const requestId = typeof body.requestId === "string" ? body.requestId : sentRequestId;
    const details = isRecord(body.details) && Array.isArray(body.details.fields)
      ? { fields: body.details.fields.filter((field): field is string => typeof field === "string") }
      : undefined;
    return new ApiError({
      status,
      code: body.code,
      messageKey: body.messageKey,
      requestId,
      ...(details === undefined ? {} : { details }),
    });
  }
  return new ApiError({
    status,
    code: "INTERNAL",
    messageKey: "errors.internal",
    requestId: sentRequestId,
    message: `the server answered ${status} without a contract error envelope`,
  });
}

/** A request that never reached the server (network failure). */
export function toTransportError(error: unknown, sentRequestId: string): ApiError {
  const reason = error instanceof Error ? error.message : "the request failed";
  return new ApiError({
    status: 0,
    code: "INTERNAL",
    messageKey: "errors.internal",
    requestId: sentRequestId,
    message: reason,
  });
}
