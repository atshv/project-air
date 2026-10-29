// P6-10: boards start page — the seeded workspace/board, create a board through
// the real dialog and open it; a missing board redirects back to the list.
import { waitForBoardReady } from "./support/board.ts";
import { expect, test } from "./support/test.ts";

test.describe("boards list", () => {
  test("shows the seeded workspace and board, creates a board and opens it", async ({ alpha }) => {
    await alpha.page.goto("/boards");
    await expect(alpha.page.getByRole("heading", { name: "E2E workspace" })).toBeVisible();
    await expect(alpha.page.getByRole("link", { name: "E2E seeded board" })).toBeVisible();

    await alpha.page.getByRole("button", { name: "New board" }).click();
    const dialog = alpha.page.getByRole("dialog", { name: "New board" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Board title").fill("Created board");
    await dialog.getByRole("button", { name: "Save" }).click();

    const boardLink = alpha.page.getByRole("link", { name: "Created board" });
    await expect(boardLink).toBeVisible();
    await boardLink.click();

    await expect(alpha.page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
    await waitForBoardReady(alpha.page);
    await expect(alpha.page.getByRole("heading", { name: "Created board" })).toBeVisible();
    await expect(alpha.page.getByText("This board is still empty.")).toBeVisible();
  });

  test("a missing board redirects back to the boards list", async ({ alpha }) => {
    await alpha.page.goto("/boards/0192f0a4-7000-7000-8000-0000000000ff");
    await expect(alpha.page).toHaveURL(/\/boards$/);
    await expect(alpha.page.getByRole("heading", { name: "E2E workspace" })).toBeVisible();
  });
});
