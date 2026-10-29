/**
 * P6-10: Playwright configuration for the web-app e2e suite.
 *
 * Ports come only from the worktree's `.polier-slot` (web-e2e): nothing is
 * hardcoded. `webServer` starts `tools/dev/e2e-env.mjs`, which resets the slot
 * database, starts the slot services and serves the built app with the `/v1`
 * HTTP + WebSocket proxies; it writes the state file the specs read.
 *
 * One worker, no retries: a flaky spec is a defect and is fixed, never retried.
 * Traces and screenshots are written to the ignored `test-results/` directory on
 * failure; the HTML report goes to the ignored `playwright-report/`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SLOT_FILE = fileURLToPath(new URL("../../.polier-slot", import.meta.url));

function readSlot() {
  const slot = JSON.parse(readFileSync(SLOT_FILE, "utf8"));
  const port = slot?.ports?.["web-e2e"];
  if (slot?.slot === 0) {
    throw new Error("playwright: .polier-slot is slot 0 (the owner's checkout); refusing to run e2e there");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("playwright: .polier-slot has no valid ports['web-e2e']");
  }
  return { slot: slot.slot, port };
}

const { slot, port } = readSlot();
const baseURL = `http://127.0.0.1:${port}`;
const manualKratos = process.env.E2E_KRATOS === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: manualKratos === false && process.env.CI === "true",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "./test-results",
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "node tools/dev/e2e-env.mjs",
    cwd: REPOSITORY_ROOT,
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
  },
  metadata: { slot },
  // Keep the app directory importable for the state-file path.
  _appDir: APP_DIR,
});
