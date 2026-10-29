/**
 * P6-11: committed evidence for the remaining web canvas work orders.
 *
 * One explicit, deterministic capture per entry and viewport (1440×900 and
 * 390×844) at a stable ready state, written to `reviews/evidence/` as
 * `P6-11-<entry>-<viewport>.png`, plus `P6-11-canvas-capture-<stamp>.json` with
 * the entry, viewport, commit, environment, spec step and the checks taken at
 * the capture. The run reuses the e2e environment (`tools/dev/e2e-env.mjs`); it
 * is started by `playwright.capture.config.mjs`, which the task runs under the
 * exclusive `e2e` lock. Every board is created through the platform API with a
 * per-entry title and deleted afterwards, so a run is repeatable.
 *
 * The screenshots are the primary evidence; the JSON records the measured
 * checks (panel geometry, save latency, view persistence, keyboard focus, tap
 * targets, contrast) so a reviewer can see what the picture alone cannot prove.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

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
  openBoardMenu,
  readViewRecords,
  waitForBoardReady,
  waitForViewRecord,
  type ViewRecord,
} from "./support/board.ts";
import { e2eEnvironment } from "./support/env.ts";
import { expect, openAnonymousSession, test } from "./support/test.ts";

const EVIDENCE_DIR = fileURLToPath(new URL("../../../reviews/evidence/", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TOKENS = JSON.parse(readFileSync(fileURLToPath(new URL("../../../packages/ui-kit/tokens.json", import.meta.url)), "utf8")) as {
  readonly colours: Readonly<Record<string, string>>;
  readonly sizes: Readonly<Record<string, string>>;
};
const SLOT = JSON.parse(readFileSync(fileURLToPath(new URL("../../../.polier-slot", import.meta.url)), "utf8")) as {
  readonly slot: number;
  readonly db_name: string;
  readonly ports: Readonly<Record<string, number>>;
};

/** German catalogue: user-visible strings come from the message files, never from literals. */
const DE_MESSAGES = JSON.parse(readFileSync(fileURLToPath(new URL("../messages/de.json", import.meta.url)), "utf8")) as Record<string, unknown>;

function de(key: string): string {
  let node: unknown = DE_MESSAGES;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object" || !(part in (node as Record<string, unknown>))) {
      throw new Error(`the German catalogue has no ${key}`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") {
    throw new Error(`the German catalogue value ${key} is not a string`);
  }
  return node;
}

type ViewportName = "desktop" | "mobile";

interface Capture {
  readonly entry: string;
  readonly viewport: ViewportName;
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly statusText: string;
  readonly panel: { readonly x: number; readonly width: number; readonly height: number } | null;
  readonly specStep: string;
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

const record = {
  task: "P6-11",
  kind: "canvas-capture",
  spec: "apps/web/e2e/canvas-evidence.capture.ts",
  startedAt: new Date().toISOString(),
  commit: gitHead(),
  environment: {
    slot: SLOT.slot,
    database: SLOT.db_name,
    ports: SLOT.ports,
    locale: "en (e2e fixture init script); de for the L05 offline-hint capture",
    browser: "",
    baseURL: "",
    commit: "",
  } as Record<string, unknown>,
  captures: [] as Capture[],
  checks: {} as Record<string, unknown>,
  a11y: {} as Record<string, unknown>,
};

function frames(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function shot(page: Page, entry: string, viewport: ViewportName, specStep: string): Promise<void> {
  await frames(page);
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
  const size = page.viewportSize();
  const statusText = ((await boardStatus(page).textContent({ timeout: 2_000 }).catch(() => "")) ?? "").trim();
  const panelVisible = await notePanel(page).isVisible().catch(() => false);
  // Offset geometry, not getBoundingClientRect: the panel's 180 ms show transform
  // must not leak a mid-transition x/y into the capture record.
  const box = panelVisible
    ? await page.evaluate(() => {
        const panel = document.querySelector("[data-board-panel]");
        const wrap = document.querySelector(".board-canvas-wrap");
        if (!(panel instanceof HTMLElement) || !(wrap instanceof HTMLElement)) {
          return null;
        }
        const wrapRect = wrap.getBoundingClientRect();
        return { x: wrapRect.x + panel.offsetLeft, y: wrapRect.y + panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight };
      })
    : null;
  const file = `P6-11-${entry}-${viewport}.png`;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, file), animations: "disabled" });
  record.captures.push({
    entry,
    viewport,
    file: `reviews/evidence/${file}`,
    width: size?.width ?? 0,
    height: size?.height ?? 0,
    statusText,
    panel: box === null ? null : { x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height) },
    specStep,
  });
  record.environment["baseURL"] = size === null ? "" : page.url().replace(/\/boards\/.*$/u, "");
  record.environment["commit"] = record.commit;
  record.environment["browser"] = page.context().browser()?.version() ?? "";
}

async function expectReady(page: Page, language: "en" | "de" = "en"): Promise<void> {
  const labels = language === "de" ? { toolbar: de("canvas.toolbar.label"), connected: de("board.sync.joined") } : { toolbar: "Tools", connected: "Connected" };
  await expect(page.getByRole("toolbar", { name: labels.toolbar })).toBeVisible();
  await expect(boardCanvas(page)).toBeVisible();
  await expect(page.getByText(labels.connected, { exact: true })).toBeVisible();
}

/** Waits for the 180 ms panel transform to settle before a geometry measurement. */
async function settlePanel(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const panel = document.querySelector("[data-board-panel]");
        return panel === null ? null : getComputedStyle(panel).transform;
      }),
    )
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/u);
}

async function useMobile(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await boardCanvas(page).boundingBox())?.width ?? 0).toBeGreaterThan(300);
  await frames(page);
}

interface FocusInfo {
  readonly tag: string;
  readonly role: string | null;
  readonly name: string;
  readonly inToolbar: boolean;
  readonly inPanel: boolean;
  readonly outlineStyle: string;
  readonly outlineWidth: string;
  readonly outlineColor: string;
}

function focusedInfo(page: Page): Promise<FocusInfo | null> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    const style = getComputedStyle(element);
    const label = element.getAttribute("aria-label");
    const wrappedLabel = element.closest("label")?.querySelector("span")?.textContent ?? "";
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      name: (label ?? element.textContent ?? wrappedLabel).trim().slice(0, 60),
      inToolbar: element.closest('[role="toolbar"]') !== null,
      inPanel: element.closest("[data-board-panel]") !== null,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });
}

function activeName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) {
      return "";
    }
    return (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
  });
}

async function addNoteAt(page: Page, dx = 0, dy = 0, label = "Add note"): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  const box = await boardCanvas(page).boundingBox();
  if (box === null) {
    throw new Error("the board canvas has no box");
  }
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await expect(notePanel(page)).toBeVisible();
  await expect(notePanel(page)).toHaveAttribute("data-phase", "open");
}

async function withBoard(page: Page, title: string, body: (board: { id: string; title: string }) => Promise<void>): Promise<void> {
  const board = await createBoardWithApi(page, title);
  try {
    await gotoBoard(page, board.id);
    await body(board);
  } finally {
    await deleteBoardWithApi(page, board.id);
  }
}

function round(value: number | undefined): number {
  return Math.round(value ?? 0);
}

test.describe.configure({ mode: "serial" });

test.describe("canvas evidence", () => {
  test.afterAll(() => {
    const file = `P6-11-canvas-capture-${stamp()}.json`;
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(path.join(EVIDENCE_DIR, file), `${JSON.stringify(record, null, 2)}\n`);
  });

  test("L00 toolbar: 300 ms tooltip, keyboard reachability and both viewports", async ({ alpha }) => {
    await withBoard(alpha.page, "P6-11 L00 toolbar board", async () => {
      await expectReady(alpha.page);
      const addNote = alpha.page.getByRole("toolbar").getByRole("button", { name: "Add note", exact: true });
      const startedAt = Date.now();
      await addNote.hover();
      await expect(alpha.page.getByRole("tooltip")).toBeVisible();
      const tooltipMs = Date.now() - startedAt;
      await alpha.page.keyboard.press("Escape");
      await expect(alpha.page.getByRole("tooltip")).toBeHidden();

      const canvasBox = await boardCanvas(alpha.page).boundingBox();
      const toolbarBox = await alpha.page.getByRole("toolbar", { name: "Tools" }).boundingBox();
      const toolbarInsideCanvas =
        canvasBox !== null &&
        toolbarBox !== null &&
        toolbarBox.x >= canvasBox.x &&
        toolbarBox.y >= canvasBox.y &&
        toolbarBox.x + toolbarBox.width <= canvasBox.x + canvasBox.width &&
        toolbarBox.y + toolbarBox.height <= canvasBox.y + canvasBox.height;
      const toolbarTopGap = canvasBox !== null && toolbarBox !== null ? Math.round(toolbarBox.y - canvasBox.y) : null;
      const buttons = await alpha.page.getByRole("toolbar").getByRole("button").count();
      const firstBox = await alpha.page.getByRole("toolbar").getByRole("button").first().boundingBox();
      await shot(alpha.page, "L00", "desktop", "board ready; tooltip visible on the Add note tool");

      await alpha.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const focused: string[] = [];
      let toolbarFocus = 0;
      let firstOutline = "";
      for (let index = 0; index < 48 && toolbarFocus < buttons; index += 1) {
        await alpha.page.keyboard.press("Tab");
        const info = await focusedInfo(alpha.page);
        if (info !== null && info.inToolbar) {
          toolbarFocus += 1;
          focused.push(info.name);
          firstOutline = firstOutline === "" ? `${info.outlineStyle} ${info.outlineWidth} ${info.outlineColor}` : firstOutline;
        }
      }
      record.checks["L00"] = {
        tooltipMs,
        tooltipShownAfterDwell: tooltipMs >= 250 && tooltipMs < 1500,
        tooltipHiddenOnEscape: true,
        toolbarButtons: buttons,
        toolbarInsideCanvas,
        toolbarTopGap,
        toolbarBarHeight: round((await alpha.page.getByRole("toolbar", { name: "Tools" }).boundingBox())?.height),
        toolbarButtonSize: { width: round(firstBox?.width), height: round(firstBox?.height) },
        keyboardReachedButtons: focused,
        keyboardReachable: toolbarFocus >= buttons,
        focusOutline: firstOutline,
      };

      await useMobile(alpha.page);
      await expectReady(alpha.page);
      await addNote.hover();
      await expect(alpha.page.getByRole("tooltip")).toBeVisible();
      await shot(alpha.page, "L00", "mobile", "390 px viewport ready; tooltip visible on the Add note tool");
      await alpha.page.keyboard.press("Escape");
    });
  });

  test("L02 visible quality: app-level canvas capture with the engine evidence cited", async ({ alpha }) => {
    await withBoard(alpha.page, "P6-11 L02 visible quality board", async () => {
      await expectReady(alpha.page);
      await addNoteAt(alpha.page, -220, -80);
      await noteTitleField(alpha.page).fill("A long note title that has to stay readable on the card");
      await expect(boardStatus(alpha.page)).toContainText("Saved");
      await closeNotePanelWithEscape(alpha.page);
      await addNoteAt(alpha.page, 220, 120);
      await noteEditor(alpha.page).click();
      await alpha.page.keyboard.type("Visible quality sample");
      await expect(boardStatus(alpha.page)).toContainText("Saved");
      await closeNotePanelWithEscape(alpha.page);
      const canvas = await boardCanvas(alpha.page).boundingBox();
      await shot(alpha.page, "L02", "desktop", "two note cards on the canvas; app-level rendering state");
      record.checks["L02"] = {
        canvas: canvas === null ? null : { width: round(canvas.width), height: round(canvas.height) },
        appProjects: "rectangles only (BoardPage.projectContent); note titles and body are not passed to the engine in P6",
        engineEvidence: [
          "reviews/evidence/P4-10-capture-before-20261027T212735Z.json",
          "reviews/evidence/P4-10-capture-after-20261027T214803Z.json",
          "reviews/evidence/P4-28-visual-final-20261028T164920Z.json",
        ],
      };
      await useMobile(alpha.page);
      await expectReady(alpha.page);
      await shot(alpha.page, "L02", "mobile", "390 px canvas with the same two cards");
    });
  });

  test("L04 panel: 400 px overlay without canvas resize, full width at 390", async ({ alpha }) => {
    await withBoard(alpha.page, "P6-11 L04 panel board", async () => {
      await expectReady(alpha.page);
      const before = await boardCanvas(alpha.page).boundingBox();
      await addNoteViaToolbar(alpha.page);
      await expect(notePanel(alpha.page)).toHaveAttribute("data-phase", "open");
      await settlePanel(alpha.page);
      const after = await boardCanvas(alpha.page).boundingBox();
      const geometry = await notePanel(alpha.page).boundingBox();
      await shot(alpha.page, "L04", "desktop", "note panel open over the canvas");
      record.checks["L04"] = {
        canvasBefore: round(before?.width),
        canvasAfter: round(after?.width),
        canvasWidthUnchanged: before !== null && after !== null && round(before.width) === round(after.width),
        canvasDesktop: before === null ? null : { x: round(before.x), y: round(before.y), width: round(before.width), height: round(before.height) },
        panelDesktop: geometry === null ? null : { x: round(geometry.x), y: round(geometry.y), width: round(geometry.width), height: round(geometry.height) },
        panelWidth400: geometry !== null && round(geometry.width) === 400,
        panelGap12: geometry !== null && before !== null && round(geometry.x + geometry.width) === round(before.x + before.width) - 12,
        panelTopGap12: geometry !== null && before !== null && round(geometry.y) === round(before.y) + 12,
      };
      await useMobile(alpha.page);
      await expect(notePanel(alpha.page)).toHaveAttribute("data-phase", "open");
      await settlePanel(alpha.page);
      const mobileCanvas = await boardCanvas(alpha.page).boundingBox();
      const mobilePanel = await notePanel(alpha.page).boundingBox();
      await shot(alpha.page, "L04", "mobile", "full-width note panel at the 390 px viewport");
      record.checks["L04"] = {
        ...(record.checks["L04"] as Record<string, unknown>),
        canvasMobile: round(mobileCanvas?.width),
        panelMobile: mobilePanel === null ? null : { x: round(mobilePanel.x), width: round(mobilePanel.width) },
        panelSpansCanvas: mobilePanel !== null && mobileCanvas !== null && round(mobilePanel.width) === round(mobileCanvas.width) && round(mobilePanel.x) === round(mobileCanvas.x),
      };
      await closeNotePanelWithEscape(alpha.page);
    });
  });

  test("L05 saving: measured save latency, reload, mobile capture and the German offline hint", async ({ alpha }) => {
    await withBoard(alpha.page, "P6-11 L05 saving board", async () => {
      await expectReady(alpha.page);
      await addNoteViaToolbar(alpha.page);
      const editor = noteEditor(alpha.page);
      await editor.click();
      await alpha.page.evaluate(() => {
        const global = globalThis as unknown as { __p611?: { lastKeyAt: number; savedAt: number; caretInEditor: boolean } };
        global.__p611 = { lastKeyAt: 0, savedAt: 0, caretInEditor: false };
        document.addEventListener(
          "keydown",
          () => {
            global.__p611!.lastKeyAt = performance.now();
            const active = document.activeElement;
            global.__p611!.caretInEditor = active instanceof HTMLElement && active.getAttribute("role") === "textbox" && active.isContentEditable;
          },
          true,
        );
        const footer = document.querySelector("footer[role='status']");
        if (footer !== null) {
          new MutationObserver(() => {
            if ((footer.textContent ?? "").includes("Saved")) {
              global.__p611!.savedAt = performance.now();
            }
          }).observe(footer, { subtree: true, childList: true, characterData: true });
        }
      });
      const typingStarted = Date.now();
      await alpha.page.keyboard.type("Saved within the deadline and kept at the cursor.");
      await expect(boardStatus(alpha.page)).toContainText("Saved");
      const observedAfterMs = Date.now() - typingStarted;
      const probe = await alpha.page.evaluate(() => (globalThis as unknown as { __p611?: { lastKeyAt: number; savedAt: number; caretInEditor: boolean } }).__p611 ?? null);
      const lastKeyToSavedMs = probe === null ? null : Math.round(probe.savedAt - probe.lastKeyAt);
      await shot(alpha.page, "L05", "desktop", "editor focused after typing; the status region shows Saved");
      record.checks["L05"] = {
        lastKeyToSavedMs,
        within500ms: lastKeyToSavedMs !== null && lastKeyToSavedMs <= 500,
        observedAfterMs,
        caretInEditor: probe?.caretInEditor === true,
      };

      await alpha.page.reload();
      await waitForBoardReady(alpha.page);
      const box = await boardCanvas(alpha.page).boundingBox();
      if (box === null) {
        throw new Error("the board canvas has no box");
      }
      await alpha.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(notePanel(alpha.page)).toBeVisible();
      const persisted = ((await noteEditor(alpha.page).innerText()) ?? "").trim();
      record.checks["L05"] = {
        ...(record.checks["L05"] as Record<string, unknown>),
        reloadKeptContent: persisted.includes("Saved within the deadline"),
        persistedText: persisted.slice(0, 80),
      };
      // The panel is still open from the reload check; the 390 px view keeps it
      // (full width) and the editor stays the focused save target.
      await useMobile(alpha.page);
      await expect(notePanel(alpha.page)).toBeVisible();
      const mobileEditor = noteEditor(alpha.page);
      await mobileEditor.click();
      await alpha.page.keyboard.type(" Mobile save.");
      await expect(boardStatus(alpha.page)).toContainText("Saved");
      await shot(alpha.page, "L05", "mobile", "editor focused at 390 px; the status region shows Saved");
      record.checks["L05"] = {
        ...(record.checks["L05"] as Record<string, unknown>),
        mobileSaved: true,
      };
    });

    // The product language is German by default, so the network-off state is
    // captured in the product language (the entry captures stay in English for
    // stable role selectors).
    const germanBoard = await createBoardWithApi(alpha.page, "P6-11 L05 German offline board");
    try {
      await gotoBoard(alpha.page, germanBoard.id);
      await expectReady(alpha.page);
      await addNoteViaToolbar(alpha.page);
      await alpha.page.getByRole("button", { name: "DE", exact: true }).click();
      await expect(alpha.page.getByRole("toolbar", { name: de("canvas.toolbar.label") })).toBeVisible();
      const germanTitle = alpha.page.getByRole("complementary", { name: de("panel.label") }).getByRole("textbox", { name: de("note.titleLabel") });
      await alpha.page.context().setOffline(true);
      await expect(boardStatus(alpha.page)).toContainText(de("board.sync.offlineChanges"));
      await germanTitle.fill("Offline title");
      await expect(boardStatus(alpha.page)).toContainText(de("board.sync.offlineChanges"));
      await shot(alpha.page, "L05-offline-de", "desktop", "the offline queue hint with the edited title kept (network off)");
      record.checks["L05"] = {
        ...(record.checks["L05"] as Record<string, unknown>),
        offlineHintShown: true,
        inputKeptWhileOffline: (await germanTitle.inputValue()) === "Offline title",
      };
      await alpha.page.context().setOffline(false);
      await expect(boardStatus(alpha.page)).toContainText(de("canvas.save.saved"));
      record.checks["L05"] = {
        ...(record.checks["L05"] as Record<string, unknown>),
        convergedAfterReconnect: true,
      };
    } finally {
      await deleteBoardWithApi(alpha.page, germanBoard.id);
    }
  });

  test("L06 empty note: placeholder, focus and the 390 px panel", async ({ alpha }) => {
    await withBoard(alpha.page, "P6-11 L06 empty note board", async () => {
      await expectReady(alpha.page);
      await addNoteViaToolbar(alpha.page);
      const editor = noteEditor(alpha.page);
      const check = async (): Promise<Record<string, unknown>> => ({
        dataEmpty: await editor.getAttribute("data-empty"),
        placeholder: await editor.getAttribute("data-placeholder"),
        editorFocused: await alpha.page.evaluate(() => {
          const active = document.activeElement;
          return active instanceof HTMLElement && active.getAttribute("role") === "textbox" && active.isContentEditable;
        }),
      });
      await expect(editor).toHaveAttribute("data-empty", "true");
      await shot(alpha.page, "L06", "desktop", "empty note with the focused own editor and its placeholder");
      const desktop = await check();
      await useMobile(alpha.page);
      await expectReady(alpha.page);
      await expect(editor).toHaveAttribute("data-empty", "true");
      const mobile = await check();
      await shot(alpha.page, "L06", "mobile", "empty note in the full-width panel at 390 px");
      record.checks["L06"] = { desktop, mobile };
    });
  });

  test("L09 title in the panel: title edit, Enter into the editor, both viewports", async ({ alpha }) => {
    await withBoard(alpha.page, "P6-11 L09 title board", async () => {
      await expectReady(alpha.page);
      await addNoteViaToolbar(alpha.page);
      const title = noteTitleField(alpha.page);
      await title.fill("Stage report note");
      await title.press("Enter");
      const afterEnter = await focusedInfo(alpha.page);
      await expect(boardStatus(alpha.page)).toContainText("Saved");
      await shot(alpha.page, "L09", "desktop", "title edited in the panel; Enter moved the focus into the editor");
      record.checks["L09"] = {
        titleValue: await title.inputValue(),
        enterFocusesEditor: afterEnter !== null && afterEnter.role === "textbox" && afterEnter.inPanel,
        titleAccessibleName: await title.getAttribute("aria-label"),
      };
      await useMobile(alpha.page);
      await expectReady(alpha.page);
      await shot(alpha.page, "L09", "mobile", "title field and editor in the full-width panel at 390 px");
    });
  });

  test("L12 keyboard and context menu: menu capture and keyboard operability", async ({ alpha }) => {
    await withBoard(alpha.page, "P6-11 L12 context menu board", async () => {
      await expectReady(alpha.page);
      await addNoteViaToolbar(alpha.page);
      await closeNotePanelWithEscape(alpha.page);
      const menu = await openBoardMenu(alpha.page);
      const menuBox = await menu.boundingBox();
      const menuItems = await menu.getByRole("menuitem").count();
      await shot(alpha.page, "L12", "desktop", "context menu open over the selected note");
      const focusSteps: string[] = [];
      let menuitemFocused = false;
      for (let index = 0; index < 40 && !menuitemFocused; index += 1) {
        await alpha.page.keyboard.press("Tab");
        const info = await focusedInfo(alpha.page);
        if (info !== null) {
          focusSteps.push(`${info.tag}:${info.name}`);
          menuitemFocused = info.role === "menuitem";
        }
      }
      let activated = false;
      if (menuitemFocused) {
        await alpha.page.keyboard.press("Enter");
        activated = await notePanel(alpha.page).isVisible().catch(() => false);
      }
      record.checks["L12"] = {
        menuWidth: menuBox === null ? null : round(menuBox.width),
        menuItems,
        keyboardReachedMenuitem: menuitemFocused,
        keyboardActivatedOpen: activated,
        focusSteps,
      };
      if (activated) {
        await closeNotePanelWithEscape(alpha.page);
      }
      await useMobile(alpha.page);
      await expectReady(alpha.page);
      const mobileMenu = await openBoardMenu(alpha.page);
      await shot(alpha.page, "L12", "mobile", "context menu inside the 390 px viewport");
      const mobileBox = await mobileMenu.boundingBox();
      record.checks["L12"] = {
        ...(record.checks["L12"] as Record<string, unknown>),
        mobileMenuWithinViewport: mobileBox !== null && mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390,
      };
      await alpha.page.keyboard.press("Escape");
    });
  });

  test("L17 remember view: a zoomed view survives a reload at both viewports", async ({ alpha }) => {
    await withBoard(alpha.page, "P6-11 L17 view board", async (board) => {
      await expectReady(alpha.page);
      const initial = await waitForViewRecord(alpha.page, board.id);
      const zoom = alpha.page.getByRole("group", { name: "View controls" });
      await zoom.getByRole("button", { name: "Zoom in" }).click();
      await zoom.getByRole("button", { name: "Zoom in" }).click();
      await expect
        .poll(async () => {
          const current = await waitForViewRecord(alpha.page, board.id);
          return Math.abs(current.zoom - initial.zoom * 1.1 * 1.1) < 0.0001;
        })
        .toBe(true);
      const beforeReload = await waitForViewRecord(alpha.page, board.id);
      await alpha.page.reload();
      await waitForBoardReady(alpha.page);
      await expect
        .poll(async () => {
          const current = await waitForViewRecord(alpha.page, board.id);
          return Math.abs(current.zoom - beforeReload.zoom) < 0.0001;
        })
        .toBe(true);
      await shot(alpha.page, "L17", "desktop", "zoomed view restored after a reload");
      const restored = await waitForViewRecord(alpha.page, board.id);
      await useMobile(alpha.page);
      await alpha.page.reload();
      await waitForBoardReady(alpha.page);
      // Two device records now exist for the board (desktop and the 390 px
      // viewport); the mobile one is the record whose deviceKey differs.
      const mobileRecord = async (): Promise<ViewRecord | undefined> =>
        (await readViewRecords(alpha.page)).find((candidate) => candidate.boardId === board.id && candidate.deviceKey !== beforeReload.deviceKey);
      await expect.poll(async () => (await mobileRecord()) !== undefined, { message: "the 390 px view record should exist after the reload" }).toBe(true);
      const mobileInitial = (await mobileRecord()) as ViewRecord;
      await zoom.getByRole("button", { name: "Zoom in" }).click();
      await zoom.getByRole("button", { name: "Zoom in" }).click();
      await expect
        .poll(async () => {
          const current = (await mobileRecord())?.zoom ?? Number.NaN;
          return Math.abs(current - mobileInitial.zoom * 1.1 * 1.1) < 0.0001;
        })
        .toBe(true);
      const mobileBeforeReload = (await mobileRecord()) as ViewRecord;
      await alpha.page.reload();
      await waitForBoardReady(alpha.page);
      await expect
        .poll(async () => {
          const current = (await mobileRecord())?.zoom ?? Number.NaN;
          return Math.abs(current - mobileBeforeReload.zoom) < 0.0001;
        })
        .toBe(true);
      await shot(alpha.page, "L17", "mobile", "zoomed view restored after a reload at 390 px");
      record.checks["L17"] = {
        desktop: { zoom: beforeReload.zoom, restoredZoom: restored.zoom },
        mobile: { zoom: mobileBeforeReload.zoom },
      };
    });
  });

  test("L18 inline comfort: app-level own-editor keyboard capture, engine evidence cited", async ({ alpha }) => {
    await withBoard(alpha.page, "P6-11 L18 inline comfort board", async () => {
      await expectReady(alpha.page);
      await addNoteViaToolbar(alpha.page);
      const editor = noteEditor(alpha.page);
      await editor.click();
      await alpha.page.keyboard.type("First point");
      await alpha.page.keyboard.press("Enter");
      await alpha.page.keyboard.type("Second point");
      await alpha.page.keyboard.press("Enter");
      await alpha.page.keyboard.type("Third point");
      await expect(boardStatus(alpha.page)).toContainText("Saved");
      const text = ((await editor.innerText()) ?? "").trim();
      await shot(alpha.page, "L18", "desktop", "own editor with three keyboard-written lines");
      record.checks["L18"] = {
        lines: text
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== ""),
        appLevelBehaviour: "own editor: keyboard-only line editing inside the note panel",
        engineEvidence: "reviews/evidence/P4-23-inline-20261028T071434Z.json (24/24 browser checks on the inline block overlay)",
      };
      await useMobile(alpha.page);
      await expectReady(alpha.page);
      await shot(alpha.page, "L18", "mobile", "the keyboard-written editor content in the full-width panel");
    });
  });

  test("a11y: keyboard path, roles and labels, focus-visible, tap targets and contrast", async ({ browser }) => {
    const { context, page } = await openAnonymousSession(browser);
    let a11yBoard: { id: string; title: string } | null = null;
    try {
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      const order: string[] = [];
      let emailSteps = 0;
      let onEmail = false;
      for (let index = 0; index < 12 && !onEmail; index += 1) {
        await page.keyboard.press("Tab");
        emailSteps += 1;
        const info = await focusedInfo(page);
        if (info !== null) {
          order.push(`${info.tag}:${info.name}`);
          onEmail = info.tag === "input" && (await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type ?? "")) === "email";
        }
      }
      if (!onEmail) {
        throw new Error(`the keyboard path did not reach the email field after ${emailSteps} tabs`);
      }
      await shot(page, "a11y-login", "desktop", "login page, keyboard focus on the email field");
      await page.keyboard.type(e2eEnvironment().accounts[0]!.email);
      await page.keyboard.press("Tab");
      await page.keyboard.type(e2eEnvironment().accounts[0]!.password);
      await page.keyboard.press("Tab");
      const submitName = await activeName(page);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/boards$/u);
      await expect(page.getByRole("heading", { name: e2eEnvironment().workspaceName })).toBeVisible();

      a11yBoard = await createBoardWithApi(page, "P6-11 a11y board");
      await page.goto("/boards");
      // Wait for the list request to render the link before tabbing through it.
      await expect(page.getByRole("link", { name: a11yBoard.title })).toBeVisible();
      let opened = false;
      for (let index = 0; index < 60 && !opened; index += 1) {
        await page.keyboard.press("Tab");
        const info = await focusedInfo(page);
        if (info !== null && info.name.includes(a11yBoard.title)) {
          await page.keyboard.press("Enter");
          opened = true;
        }
      }
      if (!opened) {
        throw new Error("the board list did not reach the board link by keyboard");
      }
      await waitForBoardReady(page);
      let toolbarFocused = false;
      for (let index = 0; index < 48 && !toolbarFocused; index += 1) {
        await page.keyboard.press("Tab");
        const info = await focusedInfo(page);
        toolbarFocused = info !== null && info.inToolbar;
      }
      const focusOutline = await focusedInfo(page);
      await shot(page, "a11y-board-focus", "desktop", "board page, keyboard focus visible on a toolbar button");
      record.a11y["keyboardPath"] = {
        login: { reachedEmailAfterTabs: emailSteps, tabOrder: order, submittedWithKeyboard: true, submitButton: submitName },
        boards: { openedBoardWithKeyboard: opened },
        board: { toolbarReachableByTab: toolbarFocused },
        focusOutline: focusOutline === null ? null : `${focusOutline.outlineStyle} ${focusOutline.outlineWidth} ${focusOutline.outlineColor}`,
        panel: "panel internals are keyboard operable once a card is selected; creating/selecting a canvas object needs a pointer (a11y gap, hardening)",
      };
      record.a11y["rolesAndLabels"] = {
        navigationMain: await page.getByRole("navigation", { name: "Main navigation" }).count(),
        toolbarTools: await page.getByRole("toolbar", { name: "Tools" }).count(),
        viewControls: await page.getByRole("group", { name: "View controls" }).count(),
        canvasLabel: await page.getByLabel("Board canvas").count(),
        status: await page.getByRole("status").count(),
        languageGroup: await page.getByRole("group", { name: "Language" }).count(),
      };

      const measureTargets = async (): Promise<Record<string, unknown>> => {
        const toolbarBoxes: { name: string; width: number; height: number }[] = [];
        for (const button of await page.getByRole("toolbar").getByRole("button").all()) {
          const box = await button.boundingBox();
          toolbarBoxes.push({ name: (await button.getAttribute("aria-label")) ?? "", width: round(box?.width), height: round(box?.height) });
        }
        const zoomBoxes: { width: number; height: number }[] = [];
        for (const button of await page.getByRole("group", { name: "View controls" }).getByRole("button").all()) {
          const box = await button.boundingBox();
          zoomBoxes.push({ width: round(box?.width), height: round(box?.height) });
        }
        return { toolbar: toolbarBoxes, zoom: zoomBoxes };
      };

      await addNoteViaToolbar(page);
      const close = await page.getByRole("button", { name: "Close" }).boundingBox();
      await page.keyboard.press("Shift+Tab");
      const afterShiftTab = await focusedInfo(page);
      await page.keyboard.press("Enter");
      await page.keyboard.type("Keyboard path");
      await expect(boardStatus(page)).toContainText("Saved");
      await page.keyboard.press("Escape");
      await expect(notePanel(page)).toBeHidden();
      record.a11y["panel"] = {
        closeTarget: close === null ? null : { width: round(close.width), height: round(close.height) },
        shiftTabFromEditor: afterShiftTab === null ? null : { tag: afterShiftTab.tag, name: afterShiftTab.name, inPanel: afterShiftTab.inPanel },
        savedWithKeyboardOnly: true,
        escapeClosedPanel: true,
      };
      record.a11y["tapTargetsDesktop"] = await measureTargets();
      await useMobile(page);
      record.a11y["tapTargetsMobile"] = await measureTargets();
      record.a11y["tokenSizes"] = { buttonBar: TOKENS.sizes["button-bar"], buttonCard: TOKENS.sizes["button-card"], headerHeight: TOKENS.sizes["header-height"] };
      record.a11y["contrast"] = contrastReport();
    } finally {
      if (a11yBoard !== null) {
        await deleteBoardWithApi(page, a11yBoard.id);
      }
      await context.close();
    }
  });
});

function parseColour(value: string): { r: number; g: number; b: number; a: number } {
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16), a: 1 };
  }
  const match = /^rgba?\(([^)]+)\)$/u.exec(value);
  if (match === null) {
    throw new Error(`unsupported colour value: ${value}`);
  }
  const parts = (match[1] ?? "").split(",").map((part) => Number(part.trim()));
  return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
}

function composite(foreground: { r: number; g: number; b: number; a: number }, background: { r: number; g: number; b: number; a: number }): { r: number; g: number; b: number; a: number } {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

function relativeLuminance(colour: { r: number; g: number; b: number }): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

function contrastRatio(foreground: { r: number; g: number; b: number; a: number }, background: { r: number; g: number; b: number; a: number }): number {
  const one = relativeLuminance(composite(foreground, background));
  const two = relativeLuminance(background);
  return Math.round(((Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05)) * 100) / 100;
}

function contrastReport(): Record<string, number> {
  const colours = TOKENS.colours;
  const token = (key: string): string => {
    const value = colours[key];
    if (value === undefined) {
      throw new Error(`the token ${key} is missing`);
    }
    return value;
  };
  const bg = parseColour(token("bg"));
  const surface = parseColour(token("surface"));
  return {
    "fg on bg": contrastRatio(parseColour(token("fg")), bg),
    "muted on surface": contrastRatio(parseColour(token("muted")), surface),
    "accent on surface": contrastRatio(parseColour(token("accent")), surface),
    "danger on surface": contrastRatio(parseColour(token("danger")), surface),
  };
}
