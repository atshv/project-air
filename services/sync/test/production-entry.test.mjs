// P6-09: the real production entry point must start from its build output.
// `node services/sync/dist/index.js` resolves the built packages/crdt module
// (`dist/packages/crdt/src/index.js`, the package's `main`/`exports` target);
// the previous `dist/index.js` guess crashed the e2e-started service before it
// could listen. The test spawns the built entry, waits for `/health`, then asks
// it to shut down. PostgreSQL is never contacted.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address !== null && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

test("the built production entry starts, resolves the built CRDT and shuts down", { timeout: 30_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, "services/sync/dist/index.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      HOST: "127.0.0.1",
      SYNC_PORT: String(port),
      DATABASE_URL: "postgresql://sync:sync@127.0.0.1:1/sync-entry-test",
      AUTH_SERVICE_URL: "http://127.0.0.1:1",
      PLATFORM_SERVICE_URL: "http://127.0.0.1:1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  try {
    const deadline = Date.now() + 20_000;
    let healthy = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(healthy, true, `the production entry listened on the health route; output=${output.slice(-800)}`);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.service, "sync");
  } finally {
    child.kill("SIGTERM");
  }
  const code = await exited;
  assert.equal(code, 0, `a SIGTERM shutdown exits 0; output=${output.slice(-800)}`);
});
