/**
 * P6-10: the e2e serving choice. One small Node server, started by
 * `tools/dev/e2e-env.mjs` as Playwright's `webServer`:
 *
 *  - serves the built app (`apps/web/dist`) as an SPA on the slot's `web-e2e`
 *    port, plus `packages/engine/build-wasm/` at `/build-wasm/` (the engine
 *    module URL resolves there from the built bundle),
 *  - proxies `/v1/auth/*` to the slot auth service and every other `/v1` route
 *    to the slot platform service, and the `/v1/sync` WebSocket upgrade to the
 *    slot sync service, so the app is same-origin,
 *  - injects the gated test-mode session: the browser context carries a
 *    non-HttpOnly `air_e2e_session` cookie whose value is the HMAC test session
 *    minted by the auth service's `POST /test/session` (AUTH_TEST_MODE=1). The
 *    server turns that cookie into the `x-test-session` header for the
 *    platform/auth requests and strips it from the sync upgrade, where the
 *    client's hello `tokenRef` (contract 0.4.0's test/non-browser path) is the
 *    credential. The production guard stays untouched: the test mode is only
 *    enabled in this environment and the auth service refuses it in production.
 *  - serves the test-mode login shim (`POST /v1/auth/login|logout`) so the real
 *    login-page redirect/logout flow can be exercised without Kratos. The real
 *    Kratos/Mailpit login stays the optional manual spec.
 *
 * No product code knows about this server; the page init script in
 * `apps/web/e2e/support/test.ts` only fills the contract tokenRef.
 */

import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

const TEST_SESSION_COOKIE = "air_e2e_session";
const TEST_SESSION_HEADER = "x-test-session";

function parseCookies(header) {
  const cookies = new Map();
  if (typeof header !== "string" || header === "") {
    return cookies;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function withoutTestCookie(cookieHeader) {
  if (typeof cookieHeader !== "string" || cookieHeader === "") {
    return "";
  }
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith(`${TEST_SESSION_COOKIE}=`))
    .join("; ");
}

function testSessionOf(request) {
  const token = parseCookies(request.headers.cookie).get(TEST_SESSION_COOKIE);
  return typeof token === "string" && token !== "" ? token : null;
}

function json(response, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": payload.length, ...headers });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolveBody) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
  });
}

function proxyHttp(request, response, target, headers) {
  const forwarded = httpRequest(
    { host: target.host, port: target.port, method: request.method, path: request.url, headers },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  forwarded.on("error", () => {
    if (!response.headersSent) {
      json(response, 502, { code: "INTERNAL", messageKey: "e2e proxy: the target service is not reachable" });
    } else {
      response.destroy();
    }
  });
  request.pipe(forwarded);
}

function serveFile(response, filePath, extraHeaders = {}) {
  const stats = statSync(filePath);
  response.writeHead(200, {
    "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
    "content-length": stats.size,
    ...extraHeaders,
  });
  createReadStream(filePath).pipe(response);
}

function insideRoot(root, candidate) {
  const base = resolve(root) + sep;
  return candidate === resolve(root) || candidate.startsWith(base);
}

/**
 * Starts the server. Resolves once it listens; `accounts` supplies the login
 * shim credentials (email + password + minted test session token).
 */
export function createE2eServer(options) {
  const { distDir, wasmDir, targets, accounts, host = "127.0.0.1", port } = options;
  const indexFile = join(distDir, "index.html");
  if (!existsSync(indexFile)) {
    throw new Error(`e2e-server: the built app is missing (${indexFile}); run pnpm build`);
  }

  const loginAccounts = new Map(accounts.map((account) => [account.email, account]));

  const server = createServer(async (request, response) => {
    const url = request.url ?? "/";
    const pathname = decodeURIComponent((url.split("?")[0] ?? "/"));

    if (pathname === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("ok");
      return;
    }

    // Test-mode login/logout shim: the LoginPage's form drives the real
    // redirect/deferred-route flow, the session itself stays the same gated
    // test-mode token the proxy injects.
    if (request.method === "POST" && pathname === "/v1/auth/login") {
      let body = null;
      try {
        body = JSON.parse(await readBody(request));
      } catch {
        body = null;
      }
      const email = body !== null && typeof body === "object" ? body.email : undefined;
      const password = body !== null && typeof body === "object" ? body.password : undefined;
      const account = typeof email === "string" ? loginAccounts.get(email) : undefined;
      if (account === undefined || password !== account.password) {
        json(response, 401, { requestId: randomUUID(), code: "AUTH_REQUIRED", messageKey: "the e2e credentials are invalid" });
        return;
      }
      json(response, 200, { requestId: randomUUID(), data: { signedIn: true } }, {
        "set-cookie": `${TEST_SESSION_COOKIE}=${account.token}; Path=/; SameSite=Lax; Max-Age=3600`,
      });
      return;
    }
    if (request.method === "POST" && pathname === "/v1/auth/logout") {
      json(response, 200, { requestId: randomUUID(), data: { signedOut: true } }, {
        "set-cookie": `${TEST_SESSION_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
      });
      return;
    }

    const token = testSessionOf(request);

    if (pathname.startsWith("/v1/auth/")) {
      proxyHttp(request, response, targets.auth, { ...request.headers, host: `${targets.auth.host}:${targets.auth.port}` });
      return;
    }
    if (pathname === "/v1" || pathname.startsWith("/v1/")) {
      const headers = { ...request.headers, host: `${targets.platform.host}:${targets.platform.port}` };
      if (token !== null) {
        headers[TEST_SESSION_HEADER] = token;
      }
      proxyHttp(request, response, targets.platform, headers);
      return;
    }

    if (pathname.startsWith("/build-wasm/")) {
      const relative = pathname.slice("/build-wasm/".length);
      const filePath = resolve(join(wasmDir, normalize(relative)));
      if (!insideRoot(wasmDir, filePath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        json(response, 404, { code: "NOT_FOUND", messageKey: "e2e-server: no such engine artifact" });
        return;
      }
      serveFile(response, filePath);
      return;
    }

    // Static app: assets by path, every other route gets the SPA document.
    const candidate = resolve(join(distDir, normalize(pathname)));
    if (insideRoot(distDir, candidate) && pathname !== "/" && existsSync(candidate) && statSync(candidate).isFile()) {
      serveFile(response, candidate);
      return;
    }
    if (pathname === "/" || extname(pathname) === "") {
      serveFile(response, indexFile, { "cache-control": "no-store" });
      return;
    }
    json(response, 404, { code: "NOT_FOUND", messageKey: "e2e-server: no such asset" });
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = (request.url ?? "").split("?")[0] ?? "";
    if (pathname !== "/v1/sync") {
      socket.destroy();
      return;
    }
    const upstream = connect(targets.sync.port, targets.sync.host, () => {
      const headers = { ...request.headers, host: `${targets.sync.host}:${targets.sync.port}` };
      // The sync service prefers a cookie over the hello tokenRef; strip the
      // e2e cookie so the contract test-session path is used (the browser
      // cannot set an auth header on a WebSocket upgrade).
      const cookie = withoutTestCookie(headers.cookie);
      if (cookie === "") {
        delete headers.cookie;
      } else {
        headers.cookie = cookie;
      }
      const lines = [`GET ${request.url ?? "/"} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) lines.push(`${name}: ${item}`);
        } else {
          lines.push(`${name}: ${value}`);
        }
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolveServer({
        url: `http://${host}:${port}`,
        port,
        close: () =>
          new Promise((resolveClose) => {
            server.closeAllConnections?.();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
