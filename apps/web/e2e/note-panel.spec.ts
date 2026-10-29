// P6-10: the L04 note panel with the own editor — toolbar add, overlay geometry,
// Escape, empty-note placeholder, typing, title edit and reload persistence.
import {
  addNoteViaToolbar,
  boardCanvas,
  boardStatus,
  closeNotePanelWithEscape,
  createBoardWithApi,
  deleteBoardWithApi,
  gotoBoard,
  noteEditor,
  notePanel,
  noteTitleField,
  selectCardAtCenter,
  waitForBoardReady,
} from "./support/board.ts";
import { expect, test } from "./support/test.ts";

test.describe("note panel and editor", () => {
  test("a note added from the toolbar opens the 400 px overlay without changing the canvas width and closes on Escape", async ({ alpha }) => {
    const board = await createBoardWithApi(alpha.page, "Panel board");
    try {
      await gotoBoard(alpha.page, board.id);
      const canvasBoxBefore = await boardCanvas(alpha.page).boundingBox();
      expect(canvasBoxBefore).not.toBeNull();

      await addNoteViaToolbar(alpha.page);
      const panel = notePanel(alpha.page);
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-phase", "open");
      const panelBox = await panel.boundingBox();
      expect(panelBox).not.toBeNull();
      expect(Math.round(panelBox!.width)).toBe(400);

      const canvasBoxWithPanel = await boardCanvas(alpha.page).boundingBox();
      expect(canvasBoxWithPanel).not.toBeNull();
      expect(Math.round(canvasBoxWithPanel!.width)).toBe(Math.round(canvasBoxBefore!.width));

      await closeNotePanelWithEscape(alpha.page);
      await expect(panel).toBeHidden();
    } finally {
      await deleteBoardWithApi(alpha.page, board.id);
    }
  });

  test("an empty note shows the placeholder, then typing and the title survive a reload", async ({ alpha }) => {
    const board = await createBoardWithApi(alpha.page, "Persistence board");
    try {
      await gotoBoard(alpha.page, board.id);
      await addNoteViaToolbar(alpha.page);

      const editor = noteEditor(alpha.page);
      await expect(editor).toHaveAttribute("data-empty", "true");
      await expect(editor).toHaveAttribute("data-placeholder", "Start writing …");

      await editor.click();
      await alpha.page.keyboard.type("First paragraph");
      await expect(editor).toHaveAttribute("data-empty", "false");
      await expect(editor).toContainText("First paragraph");

      await noteTitleField(alpha.page).fill("Reload note");
      await expect(boardStatus(alpha.page)).toContainText("Saved");

      await alpha.page.reload();
      await waitForBoardReady(alpha.page);
      await expect(alpha.page.getByText("This board is still empty.")).toBeHidden();

      await selectCardAtCenter(alpha.page);
      await expect(noteTitleField(alpha.page)).toHaveValue("Reload note");
      await expect(noteEditor(alpha.page)).toContainText("First paragraph");
    } finally {
      await deleteBoardWithApi(alpha.page, board.id);
    }
  });
});
