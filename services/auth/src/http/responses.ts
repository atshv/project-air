/**
 * JSON envelopes shared by every response of the service.
 *
 * Success: `{ "requestId": "…", "data": … }`
 * Error:   `{ "requestId": "…", "error": { "code": "UPPER_SNAKE", "message": "…" } }`
 *
 * The request id is always mirrored in the `x-request-id` response header.
 */

import type { ServerResponse } from "node:http";

import type { ApiErrorCode } from "./errors.ts";

export interface SuccessEnvelope<T> {
  readonly requestId: string;
  readonly data: T;
}

export interface ErrorEnvelope {
  readonly requestId: string;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
  };
}

export function successEnvelope<T>(requestId: string, data: T): SuccessEnvelope<T> {
  return { requestId, data };
}

export function errorEnvelope(requestId: string, code: ApiErrorCode, message: string): ErrorEnvelope {
  return { requestId, error: { code, message } };
}

/** Writes one JSON response; does nothing when the response is already done. */
export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  const payload = JSON.stringify(body) ?? "null";
  if (response.headersSent) {
    response.end(payload);
    return;
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}
