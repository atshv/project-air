/**
 * Request ids for the platform service.
 *
 * The contract's API envelopes (`schemas/api/*.schema.json`) require a UUIDv7
 * `requestId`, so the router mints one per request and only keeps a
 * client-supplied `x-request-id` when it is already a UUIDv7.
 */

import { randomBytes } from "node:crypto";

export const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** RFC 9562 UUIDv7: 48-bit millisecond timestamp, version 7, variant 10, random tail. */
export function createUuid(now: number = Date.now()): string {
  const timestamp = now.toString(16).padStart(12, "0").slice(-12);
  const random = randomBytes(9).toString("hex");
  const variant = ((Number.parseInt(random.slice(0, 2), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(3, 5)}-${random.slice(5, 17)}`;
}

/** A new request id (UUIDv7, as the contract requires). */
export function createRequestId(now: number = Date.now()): string {
  return createUuid(now);
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}
