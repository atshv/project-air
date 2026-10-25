/**
 * Starts the auth service for the route tests: real router and routes, a stub
 * Kratos base URL, an ephemeral port. No database or Docker needed.
 */

import { once } from "node:events";

import { createApp } from "../../src/http/app.ts";
import { KratosClient } from "../../src/kratos.ts";
import { silentLogger } from "../../src/log.ts";

const DEFAULT_TEST_SESSION_SECRET = "s".repeat(32);

export async function startAuthApp(options) {
  const kratos = new KratosClient({
    publicUrl: options.publicUrl,
    adminUrl: options.adminUrl,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const server = createApp({
    serviceName: "auth",
    checkDatabase: async () => undefined,
    logger: silentLogger(),
    kratos,
    testMode: options.testMode ?? false,
    testSessionSecret: options.testSessionSecret ?? DEFAULT_TEST_SESSION_SECRET,
    ...(options.adminToken === undefined ? {} : { adminToken: options.adminToken }),
    ...(options.checkKratos === undefined ? {} : { checkKratos: options.checkKratos }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}
