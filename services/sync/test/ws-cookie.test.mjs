// P6-09: the browser session handshake over a real WebSocket. The service is
// started through the shared factory, the client is a raw `node:http` upgrade so
// it can send the same-origin `Cookie` header a browser sends, and the
// authenticator/authorizer are fakes that only accept that cookie. Proves:
// allowed with a cookie, rejected without/with a foreign cookie, the tokenRef
// fallback still reaches the authenticator, and no cookie value is ever logged.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { request } from "node:http";
import test from "node:test";

import { createSyncService } from "../src/service.ts";

const BOARD_ID = "0192f0e7-7000-7000-8000-0000000000b1";
const CLIENT_ID = "0192f0e7-7000-7000-8000-0000000000c1";
const SESSION_COOKIE = "ory_kratos_session=p6-09-handshake-value";
const BROWSER_TOKEN_REF = "browser-session";

function encodeClientFrame(opcode, text) {
  const data = Buffer.from(text, "utf8");
  const mask = randomBytes(4);
  const length = data.length;
  const headerLength = length < 126 ? 2 : length <= 0xffff ? 4 : 10;
  const header = Buffer.alloc(headerLength + 4);
  header[0] = 0x80 | opcode;
  if (length < 126) {
    header[1] = 0x80 | length;
  } else if (length <= 0xffff) {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  mask.copy(header, headerLength);
  const masked = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) masked[index] = data[index] ^ mask[index % 4];
  return Buffer.concat([header, masked]);
}

function decodeServerFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  if ((second & 0x80) !== 0) throw new Error("server frames are unmasked");
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  return { opcode: first & 0x0f, payload: buffer.subarray(offset, offset + length), consumed: offset + length };
}

/** A minimal RFC 6455 client that can set request headers (Node's WebSocket cannot). */
async function connect(url, headers) {
  const target = new URL(url);
  const client = request({
    hostname: target.hostname,
    port: target.port,
    path: "/",
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
      ...headers,
    },
  });
  client.end();
  const [response, socket, head] = await once(client, "upgrade");
  assert.equal(response.statusCode, 101, "the WebSocket upgrade is accepted");
  let buffer = Buffer.alloc(0);
  const messages = [];
  const waiters = [];
  const push = (message) => {
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index !== -1) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    messages.push(message);
  };
  const consume = () => {
    for (;;) {
      const frame = decodeServerFrame(buffer);
      if (frame === null) return;
      buffer = buffer.subarray(frame.consumed);
      if (frame.opcode === 0x1) push(JSON.parse(frame.payload.toString("utf8")));
    }
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    consume();
  });
  if (head.length > 0) {
    buffer = Buffer.concat([buffer, head]);
    consume();
  }
  return {
    messages,
    send(message) {
      socket.write(encodeClientFrame(0x1, JSON.stringify(message)));
    },
    next(predicate = () => true, timeoutMs = 4_000) {
      const found = messages.findIndex(predicate);
      if (found !== -1) return Promise.resolve(messages.splice(found, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index !== -1) waiters.splice(index, 1);
            reject(new Error(`timeout; messages=${JSON.stringify(messages).slice(0, 400)}`));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
    close() {
      socket.destroy();
    },
  };
}

const hello = () => ({
  id: "0192f0e7-7000-7000-8000-0000000000d1",
  type: "hello",
  clientId: CLIENT_ID,
  sentAt: new Date().toISOString(),
  seq: 1,
  payload: { tokenRef: BROWSER_TOKEN_REF, contractVersion: "0.5.0" },
});
const join = () => ({
  id: "0192f0e7-7000-7000-8000-0000000000d2",
  type: "joinBoard",
  clientId: CLIENT_ID,
  boardId: BOARD_ID,
  sentAt: new Date().toISOString(),
  seq: 2,
  payload: {},
});

function fakeDocument() {
  return {
    apply() {},
    encodeUpdate() { return "dXBkYXRl"; },
    applyUpdate() {},
    stateVector() { return "state"; },
    snapshot() {
      return {
        contractVersion: "0.5.0",
        board: { id: BOARD_ID, workspaceId: "0192f0e7-7000-7000-8000-0000000000e1", ownerId: "0192f0e7-7000-7000-8000-0000000000e2", title: "Board", visibility: "private", archived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
        zones: [], blocks: [], cards: [], notes: [], edges: [],
      };
    },
  };
}

test("a browser cookie on the upgrade authenticates the socket; missing or foreign cookies are rejected without data", { timeout: 20_000 }, async () => {
  const logs = [];
  const logger = {
    debug: (event, fields) => logs.push(JSON.stringify({ event, fields })),
    info: (event, fields) => logs.push(JSON.stringify({ event, fields })),
    warn: (event, fields) => logs.push(JSON.stringify({ event, fields })),
    error: (event, fields) => logs.push(JSON.stringify({ event, fields })),
  };
  const authenticatorCalls = [];
  const authorizerCalls = [];
  const service = await createSyncService({
    host: "127.0.0.1",
    port: 0,
    authenticator: {
      async authenticate(tokenRef, context) {
        authenticatorCalls.push({ tokenRef, cookie: context?.cookie });
        const cookie = context?.cookie ?? "";
        return cookie === SESSION_COOKIE ? { userId: "0192f0e7-7000-7000-8000-0000000000f1" } : null;
      },
    },
    authorizer: {
      async canJoin(userId, boardId, context) {
        authorizerCalls.push({ userId, boardId, cookie: context?.cookie });
        return context?.cookie === SESSION_COOKIE && boardId === BOARD_ID;
      },
    },
    store: {
      async serverSeq() { return 1; },
      async loadBoard() { return null; },
      async appendUpdate() { return 2; },
      async updatesAfter() { return []; },
    },
    documents: { fromContent: () => fakeDocument(), fromEmpty: () => fakeDocument() },
    logger,
  });

  const allowed = await connect(service.url, { cookie: SESSION_COOKIE });
  try {
    allowed.send(hello());
    allowed.send(join());
    const welcome = await allowed.next((message) => message.type === "welcome");
    assert.equal(welcome.serverSeq, 1);
    const snapshot = await allowed.next((message) => message.type === "snapshot");
    assert.equal(snapshot.payload.snapshotRef, `${BOARD_ID}:1`);
    assert.equal(allowed.messages.some((message) => message.type === "reject"), false, "no reject for a valid session cookie");
    assert.deepEqual(authenticatorCalls[0], { tokenRef: BROWSER_TOKEN_REF, cookie: SESSION_COOKIE }, "the upgrade cookie reaches the authenticator");
    assert.deepEqual(authorizerCalls[0], { userId: "0192f0e7-7000-7000-8000-0000000000f1", boardId: BOARD_ID, cookie: SESSION_COOKIE }, "the same session authorises the board join");
  } finally {
    allowed.close();
  }

  const foreign = await connect(service.url, { cookie: "ory_kratos_session=foreign" });
  try {
    foreign.send(hello());
    foreign.send(join());
    const reject = await foreign.next((message) => message.type === "reject");
    assert.equal(reject.payload.code, "AUTH_REQUIRED");
    assert.equal(foreign.messages.some((message) => message.type === "welcome" || message.type === "snapshot"), false, "a rejected session receives no board data");
  } finally {
    foreign.close();
  }

  const noCookie = await connect(service.url, {});
  try {
    noCookie.send(hello());
    noCookie.send(join());
    const reject = await noCookie.next((message) => message.type === "reject");
    assert.equal(reject.payload.code, "AUTH_REQUIRED", "the browser tokenRef is not a session without the cookie");
    assert.equal(noCookie.messages.some((message) => message.type === "welcome"), false);
  } finally {
    noCookie.close();
  }

  await service.close();
  const serialized = logs.join("\n");
  assert.equal(serialized.includes(SESSION_COOKIE), false, "the cookie value never reaches a log line");
  assert.equal(serialized.includes("p6-09-handshake-value"), false, "no part of the cookie is logged");
  assert.equal(authenticatorCalls.some((call) => call.cookie === SESSION_COOKIE), true);
});

test("the tokenRef path is still handed to the authenticator for test/non-browser clients", { timeout: 10_000 }, async () => {
  const seen = [];
  const service = await createSyncService({
    host: "127.0.0.1",
    port: 0,
    authenticator: {
      async authenticate(tokenRef, context) {
        seen.push({ tokenRef, cookie: context?.cookie });
        return tokenRef === "test-token-ref" ? { userId: "0192f0e7-7000-7000-8000-0000000000f1" } : null;
      },
    },
    authorizer: { async canJoin() { return true; } },
    store: { async serverSeq() { return 1; }, async loadBoard() { return null; }, async appendUpdate() { return 2; }, async updatesAfter() { return []; } },
    documents: { fromContent: () => fakeDocument(), fromEmpty: () => fakeDocument() },
  });
  const socket = await connect(service.url, {});
  try {
    socket.send({
      ...hello(),
      payload: { tokenRef: "test-token-ref", contractVersion: "0.5.0" },
    });
    socket.send(join());
    await socket.next((message) => message.type === "welcome");
    assert.deepEqual(seen[0], { tokenRef: "test-token-ref", cookie: undefined });
  } finally {
    socket.close();
    await service.close();
  }
});
