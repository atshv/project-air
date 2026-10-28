// P5-03: RFC 6455 codec tests: handshake accept, masked client frames,
// fragmentation, ping/pong/close, bounded message size and malformed frames.

import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptKey, createWsConnection, decodeFrame, encodeFrame, handshakeResponse,
  MAX_MESSAGE_BYTES, MessageAssembler, WebSocketProtocolError, OPCODE,
} from "../src/ws.ts";

function maskedFrame(opcode, payload, fin = true) {
  const data = Buffer.from(payload);
  const header = Buffer.alloc(6);
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  header[1] = 0x80 | data.length;
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  mask.copy(header, 2);
  const masked = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index += 1) masked[index] = data[index] ^ mask[index % 4];
  return Buffer.concat([header, masked]);
}

test("the handshake accept value matches the RFC 6455 vector", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  assert.match(handshakeResponse("dGhlIHNhbXBsZSBub25jZQ=="), /101 Switching Protocols/);
  assert.match(handshakeResponse("dGhlIHNhbXBsZSBub25jZQ=="), /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);
});

test("masked client frames decode and unmasked/reserved frames are rejected", () => {
  const frame = decodeFrame(maskedFrame(OPCODE.text, "hello"));
  assert.equal(frame.fin, true);
  assert.equal(frame.opcode, OPCODE.text);
  assert.equal(frame.payload.toString(), "hello");
  const unmasked = Buffer.concat([Buffer.from([0x81, 0x02]), Buffer.from("hi")]);
  assert.throws(() => decodeFrame(unmasked), WebSocketProtocolError);
  const reserved = maskedFrame(OPCODE.text, "x");
  reserved[0] |= 0x40;
  assert.throws(() => decodeFrame(reserved), WebSocketProtocolError);
  // A truncated frame needs more bytes rather than throwing.
  const short = maskedFrame(OPCODE.text, "hello").subarray(0, 4);
  assert.equal(decodeFrame(short), null);
});

test("fragmentation reassembles and enforces the bounded size", () => {
  const assembler = new MessageAssembler();
  assert.equal(assembler.push({ fin: false, opcode: OPCODE.text, payload: Buffer.from("Hel") }), null);
  assert.equal(assembler.push({ fin: true, opcode: OPCODE.continuation, payload: Buffer.from("lo") }).payload.toString(), "Hello");
  assert.throws(() => assembler.push({ fin: true, opcode: OPCODE.continuation, payload: Buffer.from("x") }), WebSocketProtocolError);
  assert.throws(() => encodeFrame(OPCODE.text, Buffer.alloc(MAX_MESSAGE_BYTES + 1)), WebSocketProtocolError);
});

function fakeSocket() {
  const written = [];
  const listeners = new Map();
  const socket = {
    write(chunk) { written.push(Buffer.from(chunk)); return true; },
    end() {},
    on(event, handler) { listeners.set(event, handler); },
    feed(chunk) { listeners.get("data")?.(Buffer.from(chunk)); },
  };
  return { socket, written };
}

test("ping is answered with pong and close ends the connection", () => {
  const { socket, written } = fakeSocket();
  const connection = createWsConnection(socket, "127.0.0.1");
  let closed = false;
  connection.onClose(() => { closed = true; });
  socket.feed(maskedFrame(OPCODE.ping, "ping"));
  const pong = written.find((chunk) => (chunk[0] & 0x0f) === OPCODE.pong);
  assert.ok(pong !== undefined, "a pong frame is written");
  assert.equal(pong[0] & 0x0f, OPCODE.pong, "the response is a pong");
  assert.equal(pong[1] & 0x80, 0, "server frames are unmasked");
  assert.equal(pong.subarray(2).toString(), "ping", "the pong echoes the ping payload");
  socket.feed(maskedFrame(OPCODE.close, Buffer.from([0x03, 0xe8])));
  assert.equal(closed, true);
});

test("an oversized declared frame closes with 1009 before allocating it", () => {
  const { socket, written } = fakeSocket();
  const connection = createWsConnection(socket);
  const header = Buffer.alloc(14);
  header[0] = 0x82;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(MAX_MESSAGE_BYTES + 1), 2);
  socket.feed(header);
  const close = written.find((chunk) => (chunk[0] & 0x0f) === OPCODE.close);
  assert.ok(close !== undefined, "a close frame is sent");
  const code = close.subarray(2, 4).readUInt16BE(0);
  assert.equal(code, 1009);
  void connection;
});
