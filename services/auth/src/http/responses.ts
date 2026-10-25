/**
 * JSON envelopes of the auth service.
 *
 * Success: `{ "requestId": "…", "data": … }`
 * Error:   `{ "requestId": "…", "code": "UPPER_SNAKE", "messageKey": "errors.…", "details"?: { "fields": […] } }`
 *
 * The error shape and the seven codes/message keys match contract 0.1.0
 * (`schemas/api/errors.schema.json`); the contract forbids other properties, so
 * no human-readable message is sent to the client.
 */

import type { ServerResponse } from "node:http";

import { MESSAGE_KEYS, type ApiErrorCode, type ErrorDetails } from "./errors.ts";

export interface SuccessEnvelope<T> {
  readonly requestId: string;
  readonly data: T;
}

export interface ErrorEnvelope {
  readonly requestId: string;
  readonly code: ApiErrorCode;
  readonly messageKey: string;
  readonly details?: { readonly fields: readonly string[] };
}

export function successEnvelope<T>(requestId: string, data: T): SuccessEnvelope<T> {
  return { requestId, data };
}

export function errorEnvelope(requestId: string, code: ApiErrorCode, details?: ErrorDetails): ErrorEnvelope {
  const envelope = { requestId, code, messageKey: MESSAGE_KEYS[code] };
  if (details === undefined || details.fields.length === 0) {
    return envelope;
  }
  return { ...envelope, details: { fields: [...details.fields] } };
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
