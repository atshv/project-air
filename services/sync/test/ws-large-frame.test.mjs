// P5-08: outbound frames must carry large snapshots (>1 MiB) while inbound
// client messages stay bounded at 1 MiB.
import assert from "node:assert/strict";
import test from "node:test";

import { decodeFrame, encodeFrame, MAX_MESSAGE_BYTES, MAX_OUTBOUND_BYTES, WebSocketProtocolError } from "../src/ws.ts";

test("encodeFrame produces a valid 127-length frame for a 1.5 MiB outbound payload", () => {
  const payload = Buffer.alloc(1_500_000, 0x61);
  const frame = encodeFrame(0x1, payload, true, MAX_OUTBOUND_BYTES);
  assert.equal(frame[0] & 0x0f, 0x1);
  assert.equal(frame[1] & 0x7f, 127, "extended 64-bit length case");
  assert.equal(Number(frame.readBigUInt64BE(2)), payload.length);
  assert.deepEqual(frame.subarray(10), payload);
});

test("the default inbound bound still rejects >1 MiB frames", () => {
  const oversized = Buffer.alloc(MAX_MESSAGE_BYTES + 1);
  assert.throws(() => encodeFrame(0x1, oversized), WebSocketProtocolError);
  assert.throws(() => decodeFrame(maskedFrame(oversized)), WebSocketProtocolError);
});

function maskedFrame(payload) {
  const header = Buffer.alloc(14);
  header[0] = 0x81;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  header.writeUInt32BE(0, 10);
  return Buffer.concat([header, payload]);
}
