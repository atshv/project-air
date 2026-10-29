// P6-10: two signed-in accounts on one board — live edits converge, presence
// cursors are visible, the L05 status goes Saving -> Saved, and an offline edit
// is kept and converges after reconnect with the offline notice shown.
import {
  addNoteViaToolbar,
  boardCanvas,
  boardStatus,
  createBoardWithApi,
  deleteBoardWithApi,
  expectSaveStatusesSeen,
  gotoBoard,
  noteEditor,
  noteTitleField,
  recordSaveStatus,
  remoteCursors,
  selectCardAtCenter,
} from "./support/board.ts";
import { expect, test } from "./support/test.ts";

test.describe("realtime", () => {
  test("two accounts edit live, see presence and the L05 Saving -> Saved transition", async ({ alpha, beta }) => {
    const board = await createBoardWithApi(alpha.page, "Realtime board");
    try {
      await gotoBoard(alpha.page, board.id);
      await gotoBoard(beta.page, board.id);
      await recordSaveStatus(alpha.page);
      await recordSaveStatus(beta.page);

      await addNoteViaToolbar(alpha.page);
      await expect(noteTitleField(alpha.page)).toHaveValue("New note");

      await selectCardAtCenter(beta.page);
      await expect(noteTitleField(beta.page)).toHaveValue("New note");

      await noteTitleField(alpha.page).fill("Shared note");
      await expect(boardStatus(alpha.page)).toContainText("Saved");
      await expect(noteTitleField(beta.page)).toHaveValue("Shared note");

      await noteEditor(beta.page).click();
      await beta.page.keyboard.type("Hello from beta");
      await expect(noteEditor(alpha.page)).toContainText("Hello from beta");
      await expectSaveStatusesSeen(alpha.page, ["Saving …", "Saved"]);

      // Presence: beta's pointer over the canvas becomes a remote cursor on alpha.
      const box = await boardCanvas(beta.page).boundingBox();
      expect(box).not.toBeNull();
      await beta.page.mouse.move(box!.x + 80, box!.y + box!.height - 80);
      await beta.page.mouse.move(box!.x + 120, box!.y + box!.height - 120);
      await expect(remoteCursors(alpha.page)).toHaveCount(1);
      await expect(remoteCursors(alpha.page)).toContainText(/Person [A-Z0-9]{4}/);
    } finally {
      await deleteBoardWithApi(alpha.page, board.id);
    }
  });

  test("an offline edit is kept, shows the offline notice and converges after reconnect", async ({ alpha, beta }) => {
    const board = await createBoardWithApi(alpha.page, "Offline board");
    try {
      await gotoBoard(alpha.page, board.id);
      await gotoBoard(beta.page, board.id);
      await addNoteViaToolbar(alpha.page);
      await selectCardAtCenter(beta.page);
      await expect(noteTitleField(beta.page)).toHaveValue("New note");
      await recordSaveStatus(beta.page);

      await beta.context.setOffline(true);
      await expect(boardStatus(beta.page)).toContainText("Offline – changes are kept and sent when the connection returns.");

      await noteTitleField(beta.page).fill("Offline title");
      await expect(boardStatus(beta.page)).toContainText("Offline – changes are kept and sent when the connection returns.");
      await expect(noteTitleField(alpha.page)).toHaveValue("New note");

      await beta.context.setOffline(false);
      await expect(noteTitleField(alpha.page)).toHaveValue("Offline title");
      await expect(noteTitleField(beta.page)).toHaveValue("Offline title");
      await expectSaveStatusesSeen(beta.page, ["Saved"]);
    } finally {
      await deleteBoardWithApi(alpha.page, board.id);
    }
  });
});
