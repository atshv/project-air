// P6-10: L12 context menu and keyboard shortcuts, L11 undo/redo with the 3 s
// hint, and the suppression of board shortcuts while the editor owns the keys.
import {
  addNoteViaToolbar,
  closeNotePanelWithEscape,
  createBoardWithApi,
  deleteBoardWithApi,
  gotoBoard,
  noteEditor,
  notePanel,
  noteTitleField,
  openBoardMenu,
  selectCardAtCenter,
} from "./support/board.ts";
import { expect, test } from "./support/test.ts";

const MOD = "ControlOrMeta";

test.describe("board interactions", () => {
  test("the L12 context menu offers open, duplicate, bring forward, send backward and delete", async ({ alpha }) => {
    const board = await createBoardWithApi(alpha.page, "Menu board");
    try {
      await gotoBoard(alpha.page, board.id);

      // No selection: the menu opens but its actions are disabled.
      const emptyMenu = await openBoardMenu(alpha.page);
      await expect(emptyMenu.getByRole("menuitem")).toHaveCount(5);
      for (const item of await emptyMenu.getByRole("menuitem").all()) {
        await expect(item).toBeDisabled();
      }
      await expect(emptyMenu.getByRole("menuitem", { name: "Select an object first" })).toBeVisible();
      await alpha.page.keyboard.press("Escape");

      await addNoteViaToolbar(alpha.page);
      await closeNotePanelWithEscape(alpha.page);

      let menu = await openBoardMenu(alpha.page);
      for (const label of ["Open", "Duplicate", "Bring forward", "Send backward", "Delete"]) {
        await expect(menu.getByRole("menuitem", { name: label })).toBeEnabled();
      }
      await expect(menu.getByRole("menuitem")).toHaveCount(5);
      await menu.getByRole("menuitem", { name: "Open" }).click();
      await expect(notePanel(alpha.page)).toBeVisible();
      await closeNotePanelWithEscape(alpha.page);

      menu = await openBoardMenu(alpha.page);
      await menu.getByRole("menuitem", { name: "Bring forward" }).click();
      await expect(menu).toBeHidden();
      menu = await openBoardMenu(alpha.page);
      await menu.getByRole("menuitem", { name: "Send backward" }).click();
      await expect(menu).toBeHidden();

      menu = await openBoardMenu(alpha.page);
      await menu.getByRole("menuitem", { name: "Duplicate" }).click();
      await expect(notePanel(alpha.page)).toBeVisible();
      await expect(noteTitleField(alpha.page)).toHaveValue("New note");
      await closeNotePanelWithEscape(alpha.page);

      // The duplicated card is selected: Delete removes it, the original stays.
      await alpha.page.keyboard.press("Delete");
      await expect(alpha.page.getByText("This board is still empty.")).toBeHidden();
      await selectCardAtCenter(alpha.page);
      await expect(noteTitleField(alpha.page)).toHaveValue("New note");
      await closeNotePanelWithEscape(alpha.page);

      menu = await openBoardMenu(alpha.page);
      await menu.getByRole("menuitem", { name: "Delete" }).click();
      await expect(alpha.page.getByText("This board is still empty.")).toBeVisible();
    } finally {
      await deleteBoardWithApi(alpha.page, board.id);
    }
  });

  test("keyboard shortcuts duplicate/delete, L11 undo/redo shows the 3 s hint and the editor suppresses board shortcuts", async ({ alpha }) => {
    const board = await createBoardWithApi(alpha.page, "Keyboard board");
    try {
      await gotoBoard(alpha.page, board.id);
      await addNoteViaToolbar(alpha.page);
      await closeNotePanelWithEscape(alpha.page);

      await alpha.page.keyboard.press(`${MOD}+d`);
      await expect(notePanel(alpha.page)).toBeVisible();
      await expect(noteTitleField(alpha.page)).toHaveValue("New note");
      await closeNotePanelWithEscape(alpha.page);

      await alpha.page.keyboard.press(`${MOD}+z`);
      const undoHint = alpha.page.getByRole("status").filter({ hasText: "Undo: last action" });
      await expect(undoHint).toBeVisible();
      await expect(undoHint).toBeHidden({ timeout: 8_000 });

      await alpha.page.keyboard.press(`${MOD}+Shift+z`);
      const redoHint = alpha.page.getByRole("status").filter({ hasText: "Redo: last action" });
      await expect(redoHint).toBeVisible();

      // The editor owns its keys: no board shortcut fires while it has focus.
      await selectCardAtCenter(alpha.page);
      const editor = noteEditor(alpha.page);
      await editor.click();
      await alpha.page.keyboard.type("Suppressed");
      await alpha.page.keyboard.press("Backspace");
      await alpha.page.keyboard.press(`${MOD}+d`);
      await expect(editor).toContainText("Suppresse");
      await expect(noteTitleField(alpha.page)).toHaveValue("New note");
      await expect(alpha.page.getByText("This board is still empty.")).toBeHidden();
      await alpha.page.keyboard.press("Delete");
      await expect(notePanel(alpha.page)).toBeVisible();
    } finally {
      await deleteBoardWithApi(alpha.page, board.id);
    }
  });
});
