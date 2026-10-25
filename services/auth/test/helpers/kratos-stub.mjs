/**
 * A stub Kratos server for the unit tests: the public session, readiness and
 * self-service flow endpoints plus the admin identity and recovery-link
 * endpoints. No Docker or live Kratos needed.
 *
 * The returned `state` can be mutated per test; `requests` records what the
 * service actually sent (method, path, headers) so cookie forwarding and admin
 * calls can be asserted.
 */

import { once } from "node:events";
import { createServer } from "node:http";

export const STUB_IDENTITY_ID = "0192f0d0-7000-7000-8000-00000000aa01";

export const STUB_IDENTITY = {
  id: STUB_IDENTITY_ID,
  traits: { email: "alice@example.test", display_name: "Alice", locale: "de" },
};

export async function startKratosStub(options = {}) {
  const state = {
    whoami: options.whoami ?? "identity",
    ready: options.ready ?? true,
    createIdentity: options.createIdentity ?? "created",
    delayMs: options.delayMs ?? 0,
  };
  const requests = [];

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      const respond = () => {
        handle(request, response, body);
      };
      if (state.delayMs > 0) {
        setTimeout(respond, state.delayMs);
      } else {
        respond();
      }
    });
  });

  function json(response, status, payload) {
    const text = JSON.stringify(payload);
    response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
    response.end(text);
  }

  function handle(request, response, body) {
    const url = new URL(request.url ?? "/", "http://stub");
    if (url.pathname === "/sessions/whoami") {
      if (state.whoami === "identity") {
        json(response, 200, { id: "session-1", active: true, identity: STUB_IDENTITY });
        return;
      }
      if (state.whoami === "unauthorized") {
        json(response, 401, { error: { code: 401, message: "no session" } });
        return;
      }
      if (state.whoami === "unavailable") {
        json(response, 500, { error: { code: 500, message: "boom" } });
        return;
      }
      json(response, 200, { active: true });
      return;
    }
    if (url.pathname === "/health/ready") {
      json(response, state.ready ? 200 : 503, { status: state.ready ? "ok" : "unavailable" });
      return;
    }
    if (url.pathname === "/self-service/login/api" || url.pathname === "/self-service/registration/api" || url.pathname === "/self-service/recovery/api") {
      json(response, 200, { id: "flow-1", ui: { action: `http://stub${url.pathname}` } });
      return;
    }
    if (url.pathname === "/admin/identities" && request.method === "POST") {
      if (state.createIdentity === "conflict") {
        json(response, 409, { error: { code: 409, message: "identity already exists" } });
        return;
      }
      if (state.createIdentity === "bad_request") {
        json(response, 400, { error: { code: 400, message: "invalid traits" } });
        return;
      }
      if (state.createIdentity === "error") {
        json(response, 500, { error: { code: 500, message: "boom" } });
        return;
      }
      const parsed = body === "" ? {} : JSON.parse(body);
      json(response, 201, {
        id: STUB_IDENTITY_ID,
        schema_id: parsed.schema_id,
        traits: parsed.traits,
      });
      return;
    }
    if (url.pathname === "/admin/identities" && request.method === "GET") {
      json(response, 200, [STUB_IDENTITY]);
      return;
    }
    if (url.pathname === "/admin/recovery/link" && request.method === "POST") {
      json(response, 200, {
        recovery_link: "http://127.0.0.1:8433/self-service/recovery?flow=flow-1&token=stub",
        expires_at: "2026-10-25T19:00:00Z",
      });
      return;
    }
    json(response, 404, { error: { code: 404, message: "not found" } });
  }

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    publicUrl: baseUrl,
    adminUrl: baseUrl,
    state,
    requests,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}
