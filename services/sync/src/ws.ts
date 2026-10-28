// P5-03: a minimal RFC 6455 WebSocket server codec. No extensions, no
// compression; bounded message size, masked client frames, fragmentation,
// ping/pong and close. Node's global WebSocket is the client in the tests.

import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_MESSAGE_BYTES = 1_048_576; // 1 MiB bounded inbound message
export const MAX_OUTBOUND_BYTES = 64 * 1_048_576; // 64 MiB bounded outbound frame (snapshots must fit)

export const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

export class WebSocketProtocolError extends Error {
  readonly closeCode: number;
  constructor(message: string, closeCode = 1002) {
    super(message);
    this.name = "WebSocketProtocolError";
    this.closeCode = closeCode;
  }
}

/** RFC 6455 handshake accept value. */
export function acceptKey(clientKey: string): string {
  return createHash("sha1").update(clientKey + WS_GUID).digest("base64");
}

export function handshakeResponse(clientKey: string): string {
  if (typeof clientKey !== "string" || clientKey.length === 0) {
    throw new WebSocketProtocolError("missing Sec-WebSocket-Key", 1002);
  }
  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${acceptKey(clientKey)}`,
    "",
    "",
  ].join("\r\n");
}

export interface Frame {
  readonly fin: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
}

/** Encodes one unmasked server frame. */
export function encodeFrame(opcode: number, payload: Buffer | Uint8Array | string, fin = true, maxBytes = MAX_MESSAGE_BYTES): Buffer {
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
  if (data.length > maxBytes) throw new WebSocketProtocolError("frame payload too large", 1009);
  const length = data.length;
  let headerLength = 2;
  if (length >= 126 && length <= 0xffff) headerLength += 2;
  else if (length > 0xffff) headerLength += 8;
  const frame = Buffer.alloc(headerLength + length);
  frame[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  if (length < 126) frame[1] = length;
  else if (length <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }
  data.copy(frame, headerLength);
  return frame;
}

export interface DecodedFrame extends Frame {
  readonly consumed: number;
}

/** Decodes one masked client frame from a buffer; needs more bytes otherwise. */
export function decodeFrame(buffer: Buffer, offset = 0): DecodedFrame | null {
  if (buffer.length - offset < 2) return null;
  const first = buffer[offset]!;
  const second = buffer[offset + 1]!;
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  if ((first & 0x70) !== 0) throw new WebSocketProtocolError("reserved bits without an extension", 1002);
  const masked = (second & 0x80) !== 0;
  if (!masked) throw new WebSocketProtocolError("client frames must be masked", 1002);
  let length = second & 0x7f;
  let cursor = offset + 2;
  if (length === 126) {
    if (buffer.length - cursor < 2) return null;
    length = buffer.readUInt16BE(cursor);
    cursor += 2;
  } else if (length === 127) {
    if (buffer.length - cursor < 8) return null;
    const big = buffer.readBigUInt64BE(cursor);
    if (big > BigInt(MAX_MESSAGE_BYTES)) throw new WebSocketProtocolError("message too large", 1009);
    length = Number(big);
    cursor += 8;
  }
  if (length > MAX_MESSAGE_BYTES) throw new WebSocketProtocolError("message too large", 1009);
  if (buffer.length - cursor < 4 + length) return null;
  const mask = buffer.subarray(cursor, cursor + 4);
  cursor += 4;
  const payload = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = buffer[cursor + index]! ^ mask[index % 4]!;
  }
  cursor += length;
  return { fin, opcode, payload, consumed: cursor - offset };
}

/** Reassembles fragmented text/binary frames and enforces the message size bound. */
export class MessageAssembler {
  #opcode: number | null = null;
  #chunks: Buffer[] = [];
  #size = 0;

  push(frame: Frame): { opcode: number; payload: Buffer } | null {
    if (frame.opcode === OPCODE.continuation) {
      if (this.#opcode === null) throw new WebSocketProtocolError("continuation without a message", 1002);
    } else if (frame.opcode === OPCODE.text || frame.opcode === OPCODE.binary) {
      if (this.#opcode !== null) throw new WebSocketProtocolError("new message during fragmentation", 1002);
      this.#opcode = frame.opcode;
      this.#chunks = [];
      this.#size = 0;
    } else {
      return null; // control frames are handled by the connection
    }
    this.#chunks.push(frame.payload);
    this.#size += frame.payload.length;
    if (this.#size > MAX_MESSAGE_BYTES) throw new WebSocketProtocolError("message too large", 1009);
    if (!frame.fin) return null;
    const payload = Buffer.concat(this.#chunks);
    const opcode = this.#opcode;
    this.#opcode = null;
    this.#chunks = [];
    this.#size = 0;
    return { opcode: opcode ?? OPCODE.text, payload };
  }
}

export interface WsConnection {
  readonly socket: Duplex;
  readonly remoteAddress: string;
  send(opcode: number, payload: Buffer | string): void;
  sendText(text: string): void;
  sendJson(value: unknown): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (text: string) => void): void;
  onClose(handler: () => void): void;
}

/** Creates one server-side connection over an upgraded socket. */
export function createWsConnection(socket: Duplex, remoteAddress = ""): WsConnection {
  const assembler = new MessageAssembler();
  let buffer = Buffer.alloc(0);
  let closed = false;
  const closeHandlers: (() => void)[] = [];
  const messageHandlers: ((text: string) => void)[] = [];

  const finish = () => {
    if (closed) return;
    closed = true;
    for (const handler of closeHandlers) handler();
  };
  const send = (opcode: number, payload: Buffer | string): void => {
    if (closed) return;
    socket.write(encodeFrame(opcode, payload, true, MAX_OUTBOUND_BYTES));
  };
  const connection: WsConnection = {
    socket,
    remoteAddress,
    send,
    sendText(text) { send(OPCODE.text, text); },
    sendJson(value) { send(OPCODE.text, JSON.stringify(value)); },
    close(code = 1000, reason = "") {
      if (closed) return;
      send(OPCODE.close, Buffer.concat([Buffer.from([(code >> 8) & 0xff, code & 0xff]), Buffer.from(reason)]));
      finish();
      socket.end();
    },
    onMessage(handler) { messageHandlers.push(handler); },
    onClose(handler) { closeHandlers.push(handler); },
  };

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    try {
      for (;;) {
        let frame: DecodedFrame | null;
        try {
          frame = decodeFrame(buffer);
        } catch (error) {
          connection.close(error instanceof WebSocketProtocolError ? error.closeCode : 1002);
          return;
        }
        if (frame === null) return;
        buffer = buffer.subarray(frame.consumed);
        if (frame.opcode === OPCODE.ping) {
          send(OPCODE.pong, frame.payload);
          continue;
        }
        if (frame.opcode === OPCODE.pong) continue;
        if (frame.opcode === OPCODE.close) {
          connection.close(1000);
          return;
        }
        const message = assembler.push(frame);
        if (message !== null) {
          const text = message.payload.toString("utf8");
          for (const handler of messageHandlers) handler(text);
        }
      }
    } catch (error) {
      connection.close(error instanceof WebSocketProtocolError ? error.closeCode : 1011);
    }
  });
  socket.on("close", finish);
  socket.on("error", finish);
  socket.on("end", finish);
  return connection;
}

/** True when the HTTP request is a valid WebSocket upgrade. */
export function isUpgradeRequest(request: IncomingMessage): boolean {
  const upgrade = (request.headers.upgrade ?? "").toLowerCase();
  const connection = (request.headers.connection ?? "").toLowerCase();
  const key = request.headers["sec-websocket-key"];
  const version = request.headers["sec-websocket-version"];
  return upgrade === "websocket" && connection.includes("upgrade") && typeof key === "string" && key.length > 0 && version === "13";
}
