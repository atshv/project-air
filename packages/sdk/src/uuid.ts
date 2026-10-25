/**
 * UUIDv7 request ids, dependency-free.
 *
 * Request ids only correlate a response with a request; they are not security
 * tokens. A monotonic millisecond timestamp keeps them sortable, the random tail
 * uses WebCrypto when available and Math.random otherwise.
 */

function randomHex(length: number): string {
  const byteLength = Math.ceil(length / 2);
  const bytes = new Uint8Array(byteLength);
  const cryptoImplementation = (
    globalThis as {
      crypto?: { getRandomValues?: (values: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (cryptoImplementation?.getRandomValues !== undefined) {
    cryptoImplementation.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex.slice(0, length);
}

/** RFC 9562 UUIDv7: 48-bit millisecond timestamp, version 7, variant 10. */
export function createRequestId(now: number = Date.now()): string {
  const timestamp = now.toString(16).padStart(12, "0").slice(-12);
  const random = randomHex(18);
  const variant = ((Number.parseInt(random.slice(0, 2), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(3, 5)}-${random.slice(5, 17)}`;
}
