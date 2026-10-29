// P6-10: session guard — the logged-out redirect, the intended-route return after
// the real login-form flow (test-mode login shim), and logout.
import { e2eEnvironment } from "./support/env.ts";
import { createBoardWithApi, deleteBoardWithApi, waitForBoardReady } from "./support/board.ts";
import { expect, openAnonymousSession, test } from "./support/test.ts";

test.describe("session guard", () => {
  test("a logged-out visitor is redirected to the login page and returns to the intended board after signing in", async ({ alpha, browser }) => {
    const board = await createBoardWithApi(alpha.page, "Guard board");
    const anonymous = await openAnonymousSession(browser);
    try {
      await anonymous.page.goto(`/boards/${board.id}`);
      await expect
        .poll(() => new URL(anonymous.page.url()).searchParams.get("next"))
        .toBe(`/boards/${board.id}`);
      await expect(anonymous.page.getByRole("heading", { name: "Sign in" })).toBeVisible();

      const account = e2eEnvironment().accounts[0]!;
      await anonymous.page.getByLabel("Email").fill(account.email);
      await anonymous.page.getByLabel("Password").fill(account.password);
      await anonymous.page.getByRole("button", { name: "Sign in" }).click();

      await expect(anonymous.page).toHaveURL(new RegExp(`/boards/${board.id}$`));
      await waitForBoardReady(anonymous.page);
      await expect(anonymous.page.getByRole("heading", { name: "Guard board" })).toBeVisible();
      await expect(anonymous.page.getByLabel("Signed in as")).toContainText("00000001");
    } finally {
      await anonymous.context.close();
      await deleteBoardWithApi(alpha.page, board.id);
    }
  });

  test("signing out returns to the login page and the session stays gone after a reload", async ({ alpha }) => {
    await alpha.page.goto("/boards");
    await expect(alpha.page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await alpha.page.getByRole("button", { name: "Sign out" }).click();
    await expect(alpha.page).toHaveURL(/\/login(\?.*)?$/);
    await expect(alpha.page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(alpha.page.getByLabel("Not signed in")).toBeVisible();

    await alpha.page.reload();
    await expect(alpha.page).toHaveURL(/\/login(\?.*)?$/);
    await expect(alpha.page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
