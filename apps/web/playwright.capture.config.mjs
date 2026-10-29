/**
 * P6-11: Playwright configuration for the committed canvas evidence.
 *
 * The capture run uses the same one-command environment as the e2e suite
 * (`tools/dev/e2e-env.mjs` on the slot's web-e2e port) but a separate test
 * directory match, so the `e2e` gate still runs exactly the six product specs
 * (`**\/*.spec.ts`). The capture suite is `**\/*.capture.ts`; it writes the
 * reviewed screenshots and the capture record under `reviews/evidence/`.
 *
 * It is run under the exclusive `e2e` lock together with the product suite:
 *
 *   pnpm --filter ./apps/web exec playwright test
 *   pnpm --filter ./apps/web exec playwright test --config playwright.capture.config.mjs
 *
 * One worker, no retries, no animations in screenshots (a capture is evidence,
 * not a flake source).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SLOT_FILE = fileURLToPath(new URL("../../.polier-slot", import.meta.url));

function readSlot() {
  const slot = JSON.parse(readFileSync(SLOT_FILE, "utf8"));
  const port = slot?.ports?.["web-e2e"];
  if (slot?.slot === 0) {
    throw new Error("capture: .polier-slot is slot 0 (the owner's checkout); refusing to run there");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("capture: .polier-slot has no valid ports['web-e2e']");
  }
  return { slot: slot.slot, port };
}

const { slot, port } = readSlot();
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.capture.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: "./test-results",
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
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
});
