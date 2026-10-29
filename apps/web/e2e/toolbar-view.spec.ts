// P6-10: L00 toolbar and zoom controls, and the L17 camera persistence across a
// reload plus the fitted view of a new board.
import {
  boardCanvas,
  createBoardWithApi,
  deleteBoardWithApi,
  gotoBoard,
  waitForBoardReady,
  waitForViewRecord,
  type ViewRecord,
} from "./support/board.ts";
import { expect, test } from "./support/test.ts";

const CLOSE = 0.0001;

async function expectViewRecord(page: import("@playwright/test").Page, boardId: string, expected: { zoom: number; panX: number; panY: number }): Promise<void> {
  await expect
    .poll(async () => {
      const current = await waitForViewRecord(page, boardId);
      return Math.abs(current.zoom - expected.zoom) < CLOSE && Math.abs(current.panX - expected.panX) < CLOSE && Math.abs(current.panY - expected.panY) < CLOSE;
    }, { message: "the L17 record should match the camera" })
    .toBe(true);
}

test.describe("toolbar and view", () => {
  test("the L00 toolbar groups the tools and the zoom controls change the persisted view", async ({ alpha }) => {
    const board = await createBoardWithApi(alpha.page, "View board");
    try {
      await gotoBoard(alpha.page, board.id);
      const toolbar = alpha.page.getByRole("toolbar", { name: "Tools" });
      await expect(toolbar.getByRole("button", { name: "Select" }).first()).toHaveAttribute("aria-pressed", "true");
      for (const name of ["Add note", "Zone", "Checklist", "Connect"]) {
        await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();
      }
      const zoom = alpha.page.getByRole("group", { name: "View controls" });
      await expect(zoom.getByRole("button", { name: "Zoom out" })).toBeVisible();
      await expect(zoom.getByRole("button", { name: "Show all" })).toBeVisible();
      await expect(zoom.getByRole("button", { name: "Zoom in" })).toBeVisible();

      const initial = await waitForViewRecord(alpha.page, board.id);
      await zoom.getByRole("button", { name: "Zoom in" }).click();
      await expectViewRecord(alpha.page, board.id, { zoom: initial.zoom * 1.1, panX: initial.panX, panY: initial.panY });
      await zoom.getByRole("button", { name: "Zoom out" }).click();
      await expectViewRecord(alpha.page, board.id, { zoom: initial.zoom * 1.1 * 0.9, panX: initial.panX, panY: initial.panY });
      await zoom.getByRole("button", { name: "Show all" }).click();
      await expectViewRecord(alpha.page, board.id, initial);
      await expect(boardCanvas(alpha.page)).toBeVisible();
    } finally {
      await deleteBoardWithApi(alpha.page, board.id);
    }
  });

  test("the L17 view survives a reload and a new board starts fitted", async ({ alpha }) => {
    const board = await createBoardWithApi(alpha.page, "L17 board");
    const second = await createBoardWithApi(alpha.page, "L17 second board");
    try {
      await gotoBoard(alpha.page, board.id);
      const initial: ViewRecord = await waitForViewRecord(alpha.page, board.id);
      const zoom = alpha.page.getByRole("group", { name: "View controls" });
      await zoom.getByRole("button", { name: "Zoom in" }).click();
      await zoom.getByRole("button", { name: "Zoom in" }).click();
      await expectViewRecord(alpha.page, board.id, { zoom: initial.zoom * 1.1 * 1.1, panX: initial.panX, panY: initial.panY });
      const beforeReload = await waitForViewRecord(alpha.page, board.id);

      await alpha.page.reload();
      await waitForBoardReady(alpha.page);
      // The restored camera is persisted again on start-up; equal values prove
      // the reload restored the stored view instead of refitting.
      await expectViewRecord(alpha.page, board.id, beforeReload);
      expect(Math.abs(beforeReload.zoom - initial.zoom) > 0.01).toBe(true);

      await gotoBoard(alpha.page, second.id);
      const fitted = await waitForViewRecord(alpha.page, second.id);
      expect(fitted.zoom).toBeCloseTo(initial.zoom, 4);
      expect(fitted.panX).toBeCloseTo(initial.panX, 4);
      expect(fitted.panY).toBeCloseTo(initial.panY, 4);
    } finally {
      await deleteBoardWithApi(alpha.page, board.id);
      await deleteBoardWithApi(alpha.page, second.id);
    }
  });
});
