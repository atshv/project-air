/**
 * P6-10: shared e2e helpers — board navigation/readiness, the L04 note panel,
 * content creation through the real UI, the L05 status region, the L17 view
 * record and API setup for an isolated board per test.
 *
 * Selectors use roles/accessible names (from the message catalogs) first; the
 * few locators that need a structural anchor (canvas element, engine view
 * record) are documented where they are used.
 */

import type { Locator, Page } from "@playwright/test";

import { createRequestId } from "../../../../packages/sdk/src/uuid.ts";
import { e2eEnvironment } from "./env.ts";
import { expect } from "./test.ts";

export const BOARD_STATUS_MESSAGES = {
  saving: "Saving …",
  saved: "Saved",
  offline: "Offline – changes are kept and sent when the connection returns.",
} as const;

/** The canvas is the one element the engine mounts on; it carries the catalog label. */
export function boardCanvas(page: Page): Locator {
  return page.locator("canvas");
}

/** Toolbar (L00) and the connection label prove the engine is mounted and joined. */
export async function waitForBoardReady(page: Page): Promise<void> {
  await expect(page.getByRole("toolbar", { name: "Tools" })).toBeVisible();
  await expect(boardCanvas(page)).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}

export async function gotoBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/boards/${boardId}`);
  await waitForBoardReady(page);
}

/** Creates a fresh board in the seeded workspace through the platform API (isolated tests). */
export async function createBoardWithApi(page: Page, title: string): Promise<{ id: string; title: string }> {
  const environment = e2eEnvironment();
  const account = environment.accounts[0]!;
  const response = await page.request.post(`/v1/workspaces/${environment.workspaceId}/boards`, {
    data: {
      requestId: createRequestId(),
      board: { workspaceId: environment.workspaceId, ownerId: account.accountId, title, visibility: "private" },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { board: { id: string; title: string } };
  return body.board;
}

export async function deleteBoardWithApi(page: Page, boardId: string): Promise<void> {
  const response = await page.request.delete(`/v1/boards/${boardId}`, {
    data: { requestId: createRequestId(), boardId },
  });
  expect([200, 404]).toContain(response.status());
}

/** The L04 panel (complementary region labelled "Note"). */
export function notePanel(page: Page): Locator {
  return page.getByRole("complementary", { name: "Note" });
}

export function noteTitleField(page: Page): Locator {
  return notePanel(page).getByRole("textbox", { name: "Title" });
}

/** The own editor is a contenteditable with role textbox and the catalog label. */
export function noteEditor(page: Page): Locator {
  return notePanel(page).getByRole("textbox", { name: "Note content" });
}

export function boardStatus(page: Page): Locator {
  return page.getByRole("status").and(page.locator("footer"));
}

/**
 * Adds one note through the real L00 toolbar path: activate "Add note", then
 * click the canvas centre. The card is selected and the L04 panel opens.
 */
export async function addNoteViaToolbar(page: Page): Promise<void> {
  const addNote = page.getByRole("button", { name: "Add note" });
  await addNote.click();
  await expect(addNote).toHaveAttribute("aria-pressed", "true");
  const box = await boardCanvas(page).boundingBox();
  if (box === null) {
    throw new Error("the board canvas has no box");
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(notePanel(page)).toBeVisible();
}

/**
 * Closes the note panel with Escape (the panel owns its Escape). The L04 show
 * motion is awaited first: pressing Escape while the panel is still mounting
 * would hit the overlay before its key handler is active.
 */
export async function closeNotePanelWithEscape(page: Page): Promise<void> {
  await expect(notePanel(page)).toHaveAttribute("data-phase", "open");
  await noteEditor(page).focus();
  await page.keyboard.press("Escape");
  await expect(notePanel(page)).toBeHidden();
}

/** Records every L05 status text the region shows, so fast transitions are not missed. */
export async function recordSaveStatus(page: Page): Promise<void> {
  await boardStatus(page).waitFor();
  await page.evaluate(() => {
    const region = document.querySelector("footer[role='status']");
    if (region === null) {
      throw new Error("the board status region is missing");
    }
    const entries: string[] = [];
    const globals = globalThis as unknown as { __airSaveStatusLog?: string[] };
    globals.__airSaveStatusLog = entries;
    const push = (): void => {
      const text = (region.textContent ?? "").trim();
      if (text !== "" && entries.at(-1) !== text) {
        entries.push(text);
      }
    };
    push();
    new MutationObserver(push).observe(region, { subtree: true, childList: true, characterData: true });
  });
}

export async function saveStatusLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as unknown as { __airSaveStatusLog?: string[] }).__airSaveStatusLog ?? []);
}

/** Polls until every expected L05 status has appeared in the recorded transitions. */
export async function expectSaveStatusesSeen(page: Page, expected: readonly string[]): Promise<void> {
  await expect
    .poll(async () => {
      const log = await saveStatusLog(page);
      return expected.every((entry) => log.some((text) => text.includes(entry)));
    }, { message: `expected the L05 status region to show ${JSON.stringify(expected)}` })
    .toBe(true);
}

export interface ViewRecord {
  readonly version: number;
  readonly boardId: string;
  readonly deviceKey: string;
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

const VIEW_STORAGE_PREFIX = "project-air:view";

/** All L17 view records the board page persisted for this origin. */
export async function readViewRecords(page: Page): Promise<ViewRecord[]> {
  return page.evaluate((prefix) => {
    const records: ViewRecord[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null || !key.startsWith(prefix)) {
        continue;
      }
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as ViewRecord | null;
        if (parsed !== null && typeof parsed === "object") {
          records.push(parsed);
        }
      } catch {
        // Ignore an unreadable record; the assertions use the valid ones.
      }
    }
    return records;
  }, VIEW_STORAGE_PREFIX);
}

/** Waits for and returns the L17 record of one board. */
export async function waitForViewRecord(page: Page, boardId: string): Promise<ViewRecord> {
  await expect
    .poll(async () => (await readViewRecords(page)).some((record) => record.boardId === boardId))
    .toBe(true);
  const record = (await readViewRecords(page)).find((candidate) => candidate.boardId === boardId);
  if (record === undefined) {
    throw new Error(`no view record for ${boardId}`);
  }
  return record;
}

/** Clicks the canvas centre (the toolbar-created card is placed there). */
export async function clickCanvasCenter(page: Page, xOffset = 0, yOffset = 0): Promise<void> {
  const box = await boardCanvas(page).boundingBox();
  if (box === null) {
    throw new Error("the board canvas has no box");
  }
  await page.mouse.click(box.x + box.width / 2 + xOffset, box.y + box.height / 2 + yOffset);
}

/** Selects the card at the canvas centre and waits for the L04 panel. */
export async function selectCardAtCenter(page: Page): Promise<void> {
  await clickCanvasCenter(page);
  await expect(notePanel(page)).toBeVisible();
}

/** Opens the L12 context menu on the canvas (right click at the centre). */
export async function openBoardMenu(page: Page): Promise<Locator> {
  const box = await boardCanvas(page).boundingBox();
  if (box === null) {
    throw new Error("the board canvas has no box");
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const menu = page.getByRole("menu", { name: "Board actions" });
  await expect(menu).toBeVisible();
  return menu;
}

export function remoteCursors(page: Page): Locator {
  return page.locator(".remote-cursor");
}

/** Waits for the L05 region to show the given text (offline notice, saved, ...). */
export async function expectBoardStatus(page: Page, text: string | RegExp): Promise<void> {
  await expect(boardStatus(page)).toContainText(text);
}
