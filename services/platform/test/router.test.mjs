/**
 * Router: method and path matching, JSON envelopes, request ids, body limit
 * and error mapping, exercised over a real HTTP server.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";

import { Router } from "../src/http/router.ts";
import { silentLogger } from "../src/log.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JSON_BODY_LIMIT_BYTES = 64;

let server;
let baseUrl;

async function listen(router) {
  const created = router.createServer();
  created.listen(0, "127.0.0.1");
  await once(created, "listening");
  const address = created.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return { server: created, baseUrl: `http://127.0.0.1:${address.port}` };
}

before(async () => {
  const router = new Router({ logger: silentLogger(), jsonBodyLimitBytes: JSON_BODY_LIMIT_BYTES });
  router.get("/health", (context) => ({ data: { status: "ok", requestId: context.requestId } }));
  router.get("/echo", (context) => ({ data: { query: context.query.get("q") } }));
  router.post("/echo", async (context) => ({ data: await context.readJson() }));
  router.get("/teapot", () => ({ status: 418, data: { status: "teapot" }, headers: { "x-test": "yes" } }));
  router.get("/empty", () => undefined);
  router.get("/boom", () => {
    throw new Error("kaboom with a secret");
  });
  const started = await listen(router);
  server = started.server;
  baseUrl = started.baseUrl;
});

after(async () => {
  if (server === undefined) {
    return;
  }
  server.close();
  await once(server, "close");
});

test("returns the success envelope and mirrors the request id in a header", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  const body = await response.json();
  assert.equal(body.data.status, "ok");
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  assert.match(body.requestId, UUID_PATTERN);
});

test("keeps a valid client request id and replaces an invalid one", async () => {
  const kept = await fetch(`${baseUrl}/health`, { headers: { "x-request-id": "client-request-42" } });
  assert.equal(kept.headers.get("x-request-id"), "client-request-42");
  assert.equal((await kept.json()).requestId, "client-request-42");

  const replaced = await fetch(`${baseUrl}/health`, { headers: { "x-request-id": "not a valid id" } });
  const replacedId = replaced.headers.get("x-request-id");
  assert.match(replacedId ?? "", UUID_PATTERN);
  assert.notEqual(replacedId, "not a valid id");
});

test("parses the query string", async () => {
  const response = await fetch(`${baseUrl}/echo?q=notes`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { query: "notes" });
});

test("returns a 404 envelope for an unknown path", async () => {
  const response = await fetch(`${baseUrl}/nope`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(typeof body.error.message, "string");
  assert.equal(typeof body.requestId, "string");
});

test("returns 405 with an Allow header for a known path and the wrong method", async () => {
  const response = await fetch(`${baseUrl}/health`, { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal((await response.json()).error.code, "METHOD_NOT_ALLOWED");
});

test("reads a JSON body and wraps the result", async () => {
  const response = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "note" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { title: "note" });
});

test("rejects invalid JSON with 400", async () => {
  const response = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"broken":',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "BAD_REQUEST");
});

test("rejects a non-JSON content type with 415", async () => {
  const response = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "hello",
  });
  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, "UNSUPPORTED_MEDIA_TYPE");
});

test("rejects a body above the limit with 413", async () => {
  const response = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(JSON_BODY_LIMIT_BYTES * 2) }),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
});

test("a custom status and headers are preserved", async () => {
  const response = await fetch(`${baseUrl}/teapot`);
  assert.equal(response.status, 418);
  assert.equal(response.headers.get("x-test"), "yes");
  assert.deepEqual((await response.json()).data, { status: "teapot" });
});

test("an empty handler result is a 204 without a body", async () => {
  const response = await fetch(`${baseUrl}/empty`);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("an unexpected error becomes a generic 500 envelope", async () => {
  const response = await fetch(`${baseUrl}/boom`);
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.doesNotMatch(text, /kaboom/);
  assert.equal(JSON.parse(text).error.code, "INTERNAL_ERROR");
});
