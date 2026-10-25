/**
 * Router: method and path matching, JSON envelopes, UUIDv7 request ids, body
 * limit and error mapping, exercised over a real HTTP server.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";

import { Router } from "../src/http/router.ts";
import { silentLogger } from "../src/log.ts";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIXED_REQUEST_ID = "0192f0d0-7000-7000-8000-0000000000d1";
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

test("returns the success envelope with a UUIDv7 request id in the header", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  const body = await response.json();
  assert.equal(body.data.status, "ok");
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  assert.match(body.requestId, UUID_V7_PATTERN);
});

test("keeps a valid UUIDv7 client request id and replaces anything else", async () => {
  const kept = await fetch(`${baseUrl}/health`, { headers: { "x-request-id": FIXED_REQUEST_ID } });
  assert.equal(kept.headers.get("x-request-id"), FIXED_REQUEST_ID);
  assert.equal((await kept.json()).requestId, FIXED_REQUEST_ID);

  for (const invalid of ["not a valid id", "123e4567-e89b-12d3-a456-426614174000"]) {
    const replaced = await fetch(`${baseUrl}/health`, { headers: { "x-request-id": invalid } });
    const replacedId = replaced.headers.get("x-request-id");
    assert.match(replacedId ?? "", UUID_V7_PATTERN);
    assert.notEqual(replacedId, invalid);
  }
});

test("parses the query string", async () => {
  const response = await fetch(`${baseUrl}/echo?q=notes`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { query: "notes" });
});

test("returns the contract error envelope for an unknown path", async () => {
  const response = await fetch(`${baseUrl}/nope`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["code", "messageKey", "requestId"]);
  assert.equal(body.code, "NOT_FOUND");
  assert.equal(body.messageKey, "errors.notFound");
  assert.match(body.requestId, UUID_V7_PATTERN);
});

test("returns 405 with an Allow header for a known path and the wrong method", async () => {
  const response = await fetch(`${baseUrl}/health`, { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  const body = await response.json();
  assert.equal(body.code, "FORBIDDEN");
  assert.equal(body.messageKey, "errors.forbidden");
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

test("rejects invalid JSON with a VALIDATION envelope", async () => {
  const response = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"broken":',
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "VALIDATION");
  assert.equal(body.messageKey, "errors.validation");
  assert.equal(body.details, undefined);
});

test("rejects a non-JSON content type with 415", async () => {
  const response = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "hello",
  });
  assert.equal(response.status, 415);
  assert.equal((await response.json()).code, "VALIDATION");
});

test("rejects a body above the limit with 413", async () => {
  const response = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(JSON_BODY_LIMIT_BYTES * 2) }),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "VALIDATION");
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

test("an unexpected error becomes a generic INTERNAL envelope", async () => {
  const response = await fetch(`${baseUrl}/boom`);
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.doesNotMatch(text, /kaboom/);
  const body = JSON.parse(text);
  assert.equal(body.code, "INTERNAL");
  assert.equal(body.messageKey, "errors.internal");
});
