/**
 * Router: method and path matching (with `:param` segments), JSON envelopes,
 * UUIDv7 request ids, body limit and error mapping, over a real HTTP server.
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
  router.get("/health", () => ({ data: { status: "ok" } }));
  router.get("/items/:itemId", (context, match) => ({
    body: { requestId: context.requestId, item: { id: match.params.itemId } },
  }));
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

test("wraps `data` in {requestId, data} and mirrors the UUIDv7 id in the header", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, { status: "ok" });
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  assert.match(body.requestId, UUID_V7_PATTERN);
});

test("sends a `body` envelope unchanged and matches path parameters", async () => {
  const response = await fetch(`${baseUrl}/items/0192f0a4-7000-7000-8000-000000000004`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["item", "requestId"]);
  assert.equal(body.item.id, "0192f0a4-7000-7000-8000-000000000004");
  assert.match(body.requestId, UUID_V7_PATTERN);
});

test("keeps a valid UUIDv7 client request id and replaces anything else", async () => {
  const kept = await fetch(`${baseUrl}/health`, { headers: { "x-request-id": FIXED_REQUEST_ID } });
  assert.equal(kept.headers.get("x-request-id"), FIXED_REQUEST_ID);
  const replaced = await fetch(`${baseUrl}/health`, { headers: { "x-request-id": "not a valid id" } });
  assert.match(replaced.headers.get("x-request-id") ?? "", UUID_V7_PATTERN);
});

test("returns 404 for an unknown path and 405 for a known path with a wrong method", async () => {
  const missing = await fetch(`${baseUrl}/nope`);
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.deepEqual(Object.keys(missingBody).sort(), ["code", "messageKey", "requestId"]);
  assert.equal(missingBody.code, "NOT_FOUND");
  assert.equal(missingBody.messageKey, "errors.notFound");

  const wrongMethod = await fetch(`${baseUrl}/health`, { method: "POST" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");
  assert.equal((await wrongMethod.json()).code, "FORBIDDEN");
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

test("rejects invalid JSON, non-JSON content types and oversized bodies", async () => {
  const invalidJson = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"broken":',
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).code, "VALIDATION");

  const wrongType = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "hello",
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json()).code, "VALIDATION");

  const tooLarge = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(JSON_BODY_LIMIT_BYTES * 2) }),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).code, "VALIDATION");
});

test("a custom status and headers are preserved, and an empty result is 204", async () => {
  const teapot = await fetch(`${baseUrl}/teapot`);
  assert.equal(teapot.status, 418);
  assert.equal(teapot.headers.get("x-test"), "yes");

  const empty = await fetch(`${baseUrl}/empty`);
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "");
});

test("an unexpected error becomes a generic INTERNAL envelope", async () => {
  const response = await fetch(`${baseUrl}/boom`);
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.doesNotMatch(text, /kaboom/);
  assert.equal(JSON.parse(text).code, "INTERNAL");
});
