// P6-10 (optional, skipped by default): the real Kratos/Mailpit login. The
// automated gate uses the gated test-mode session; this spec is the manual proof
// that the same UI works against the real identity provider.
//
// Manual prerequisites (documented in docs/gates/playwright.md):
//   bash tools/dev/setup
//   docker compose -f infra/compose/compose.yaml --profile identity up -d --wait
//   start services/auth WITHOUT AUTH_TEST_MODE (KRATOS_* from infra/compose/.env),
//   services/platform and the e2e server, then create the account through the
//   real registration flow and set E2E_KRATOS=1 plus E2E_KRATOS_EMAIL/PASSWORD.
//
// Run: E2E_KRATOS=1 pnpm --filter ./apps/web run e2e:manual
import { expect, test } from "@playwright/test";

const enabled = process.env.E2E_KRATOS === "1";
const email = process.env.E2E_KRATOS_EMAIL ?? "";
const password = process.env.E2E_KRATOS_PASSWORD ?? "";

test.describe("real Kratos login (manual)", () => {
  test.skip(!enabled, "manual spec: set E2E_KRATOS=1 with a real Kratos environment");
  test.skip(email === "" || password === "", "set E2E_KRATOS_EMAIL and E2E_KRATOS_PASSWORD");

  test("a seeded Kratos account signs in through the login form and reaches the boards page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/boards$/);
    await expect(page.getByRole("heading", { name: "Boards" })).toBeVisible();
  });
});
