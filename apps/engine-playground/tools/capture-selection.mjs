#!/usr/bin/env node
// L10 (P4-16) deterministic multi-selection capture.
//
//   node apps/engine-playground/tools/capture-selection.mjs [--task P4-16]
//
// Starts its own static server on the slot playground port and one headless
// Chrome for Testing per viewport (1440x900 and 390x844, so the emulation is set
// before the first load), then drives trusted pointer events on the layers scene:
//
//   1. Shift-click three cards -> selection frames + count bar; screenshot
//      `P4-16-selection-<viewport>.png`;
//   2. drag one selected card -> exactly one `group` of moves; the selection
//      survives; the record stores the operation children;
//   3. click the bar's delete control -> exactly one `group` of deletes; the bar
//      disappears; screenshot `P4-16-selection-deleted-<viewport>.png`;
//   4. Shift-drag on an empty area -> live rubber band (accent-soft fill, 1 px
//      accent border); screenshot `P4-16-band-<viewport>.png`; release selects by
//      world-space intersection;
//   5. a plain drag on empty canvas still pans and writes nothing.
//
// The record `reviews/evidence/<task>-selection-<timestamp>.json` stores the
// selection ids/bounds, bar visibility, band rectangle, operation types, camera
// before/after and the checks. Exit codes: 0 pass, 1 assertion failed, 2
// usage/build, 3 infra. It starts and stops only its own server and browser.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVIDENCE_DIR = join(REPO_ROOT, "reviews", "evidence");
const PLAYWRIGHT_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");

const DESKTOP = { name: "desktop", width: 1440, height: 900, mobile: false, view: "648,664,1", layersView: "512,288,1" };
const MOBILE = { name: "mobile", width: 390, height: 844, mobile: true, view: "648,664,0.25", layersView: "512,288,0.5" };

const REQUIRED_ARTEFACTS = [
  "apps/engine-playground/index.html",
  "apps/engine-playground/main.js",
  "apps/engine-playground/playground.css",
  "packages/ui-kit/tokens.css",
  "packages/engine/dist/bridge/engine.js",
  "packages/engine/dist/bridge/input.js",
  "packages/engine/dist/bridge/text-atlas.js",
  "packages/engine/build-wasm/engine.js",
  "packages/engine/build-wasm/engine.wasm",
];

const BASE_CHROME_FLAGS = [
  "--headless=new",
  "--use-angle=metal",
  "--enable-gpu",
  "--hide-scrollbars",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--window-size=1440,900",
  "--no-sandbox",
];

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function parseTask(argv) {
  const index = argv.indexOf("--task");
  if (index < 0) {
    return "P4-16";
  }
  const task = argv[index + 1];
  if (task === undefined || task.startsWith("--") || !/^[A-Za-z0-9_.-]+$/.test(task)) {
    throw new Error("--task needs a task id such as P4-16");
  }
  return task;
}

function requireArtefacts() {
  const missing = REQUIRED_ARTEFACTS.filter((relative) => !existsSync(join(REPO_ROOT, relative)));
  if (missing.length > 0) {
    throw new Error(
      `missing build artefacts: ${missing.join(", ")}; run the bridge/WASM/test-kit builds first`,
    );
  }
}

function playgroundPort() {
  const slot = JSON.parse(readFileSync(join(REPO_ROOT, ".polier-slot"), "utf8"));
  const port = slot?.ports?.playground;
  if (!Number.isInteger(port)) {
    throw new Error("the .polier-slot has no integer ports.playground");
  }
  return port;
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

function startStaticServer(port) {
  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith("/")) {
        pathname += "index.html";
      }
      const filePath = resolve(REPO_ROOT, `.${pathname}`);
      if (!filePath.startsWith(resolve(REPO_ROOT) + "/")) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const body = readFileSync(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once("error", (error) => {
      rejectServer(
        error.code === "EADDRINUSE"
          ? new Error(`port ${port} is already in use; rerun the capture alone`)
          : error,
      );
    });
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

function findChrome() {
  const candidates = [];
  if (typeof process.env.CHROME_PATH === "string" && process.env.CHROME_PATH.length > 0) {
    candidates.push(process.env.CHROME_PATH);
  }
  if (existsSync(PLAYWRIGHT_CACHE)) {
    for (const entry of readdirSync(PLAYWRIGHT_CACHE).sort()) {
      if (!entry.startsWith("chromium-")) {
        continue;
      }
      for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
        candidates.push(
          join(
            PLAYWRIGHT_CACHE,
            entry,
            arch,
            "Google Chrome for Testing.app",
            "Contents",
            "MacOS",
            "Google Chrome for Testing",
          ),
        );
      }
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("no Chrome found; set CHROME_PATH");
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForDebugPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // not up yet
    }
    await delay(200);
  }
  throw new Error(`Chrome debug port ${port} did not open`);
}

function createClient(socket) {
  let nextId = 0;
  const pending = new Map();
  const waiters = new Map();
  const failAll = (reason) => {
    for (const [id, call] of pending) {
      call.reject(new Error(`CDP call ${id} aborted: ${reason}`));
      pending.delete(id);
    }
  };
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (typeof message.id === "number" && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
      return;
    }
    if (typeof message.method !== "string") {
      return;
    }
    const waiter = waiters.get(message.method);
    if (waiter !== undefined) {
      waiters.delete(message.method);
      waiter(message.params ?? {});
    }
  });
  socket.addEventListener("close", () => failAll("the DevTools socket closed"));
  socket.addEventListener("error", () => failAll("the DevTools socket errored"));
  const send = (method, params = {}) =>
    new Promise((resolveCall, rejectCall) => {
      nextId += 1;
      const id = nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCall(new Error(`CDP call ${method} timed out`));
      }, 15000);
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolveCall(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectCall(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  send.waitForEvent = (method, timeoutMs = 20000) =>
    new Promise((resolveEvent, rejectEvent) => {
      const timer = setTimeout(() => {
        waiters.delete(method);
        rejectEvent(new Error(`the ${method} event did not arrive`));
      }, timeoutMs);
      waiters.set(method, (params) => {
        clearTimeout(timer);
        resolveEvent(params);
      });
    });
  return send;
}

async function evaluate(send, expression, options = {}) {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: options.awaitPromise === true,
  });
  const details = response.result?.exceptionDetails;
  if (details !== undefined) {
    throw new Error(`page evaluation failed: ${details.text ?? JSON.stringify(details)}`);
  }
  return response.result?.result?.value;
}

async function waitForPlayground(send) {
  const deadline = Date.now() + 30000;
  let last = "the page has no __enginePlayground object yet";
  while (Date.now() < deadline) {
    const present = await evaluate(send, "typeof globalThis.__enginePlayground === 'object'");
    if (present === true) {
      const raw = await evaluate(
        send,
        "globalThis.__enginePlayground.ready.then((state) => JSON.stringify(state))",
        { awaitPromise: true },
      );
      if (typeof raw === "string") {
        const state = JSON.parse(raw);
        if (state.ok === true) {
          return state;
        }
        throw new Error(state.error ?? "the engine did not start");
      }
      last = "the ready hook did not resolve";
    }
    await delay(250);
  }
  throw new Error(`the playground did not become ready: ${last}`);
}

async function navigate(send, url) {
  const loaded = send.waitForEvent("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded.catch(() => undefined);
  const ready = await waitForPlayground(send);
  await delay(250);
  return ready;
}

async function mouse(send, type, point, extra = {}) {
  await send("Input.dispatchMouseEvent", {
    type,
    x: Math.round(point.x),
    y: Math.round(point.y),
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
    ...extra,
  });
}

async function screenshot(send, file) {
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(String(shot.result?.data ?? ""), "base64");
  if (bytes.length === 0) {
    throw new Error(`the screenshot ${file} was empty`);
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, file), bytes);
  return { file: `reviews/evidence/${file}`, bytes: bytes.length };
}

// Scans the canvas for pointer points of distinct cards, and for an empty point.
const SCAN_EXPRESSION = `(() => {
  const canvas = document.querySelector("#canvas");
  const targetAt = globalThis.__engineDrag?.targetAt;
  if (typeof targetAt !== "function") {
    return { cards: [], empty: null };
  }
  const cards = [];
  const seen = new Set();
  let empty = null;
  for (let y = 12; y < canvas.clientHeight; y += 12) {
    for (let x = 12; x < canvas.clientWidth; x += 12) {
      const hit = targetAt(x, y);
      if (hit === null) {
        if (empty === null) empty = { x, y };
        continue;
      }
      if (hit.kind !== "card" || seen.has(hit.id)) continue;
      seen.add(hit.id);
      cards.push({ id: hit.id, x, y, world: hit.world });
    }
  }
  return { cards, empty };
})()`;

const asJson = (value) => (typeof value === "string" ? JSON.parse(value) : value);

const clientPoint = async (send, local) =>
  evaluate(
    send,
    `(() => {
      const bounds = document.querySelector("#canvas").getBoundingClientRect();
      return { x: bounds.left + ${local.x}, y: bounds.top + ${local.y} };
    })()`,
  );

// A real Shift key press around the clicks: the pointer events carry
// `modifiers` too, but the keyboard state makes the modifier deterministic in
// headless Chrome.
async function shiftKey(send, down) {
  await send("Input.dispatchKeyEvent", {
    type: down ? "keyDown" : "keyUp",
    key: "Shift",
    code: "ShiftLeft",
    windowsVirtualKeyCode: 16,
    nativeVirtualKeyCode: 16,
    modifiers: down ? 8 : 0,
  });
}

async function shiftClick(send, point) {
  await mouse(send, "mouseMoved", point, { buttons: 0, button: "none", modifiers: 8 });
  await mouse(send, "mousePressed", point, { modifiers: 8 });
  await mouse(send, "mouseReleased", point, { buttons: 0, modifiers: 8 });
  await delay(120);
}

async function selectionState(send) {
  return asJson(
    await evaluate(
      send,
      `JSON.stringify({
        size: globalThis.__engineSelection.size(),
        ids: globalThis.__engineSelection.ids(),
        bounds: globalThis.__engineSelection.bounds(),
        barVisible: globalThis.__engineSelection.barVisible(),
        band: globalThis.__engineSelection.band(),
        lastOperation: globalThis.__engineSelection.lastOperation()
      })`,
    ),
  );
}

async function captureViewport(send, viewport, checks) {
  // The sample scene around the documented zone-0001 anchor, at a deterministic
  // camera per viewport: the behavioural checks run here.
  await navigate(send, `${baseUrl}?scene=sample&view=${viewport.view}`);
  const camera = asJson(
    await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"),
  );
  const scan = asJson(await evaluate(send, SCAN_EXPRESSION));
  if (scan.cards.length < 3) {
    throw new Error(
      `the scene did not yield three cards: ${JSON.stringify(scan.cards.slice(0, 3))}`,
    );
  }
  const cardPoints = [];
  for (const card of scan.cards.slice(0, 3)) {
    cardPoints.push({ id: card.id, point: await clientPoint(send, card) });
  }

  // 1. Shift-click cards until three distinct objects are selected: selection
  // frames + count bar. A candidate point covered by the growing count bar is
  // skipped (the bar is chrome, never a drag target).
  const barRectNow = async () => {
    const raw = await evaluate(
      send,
      `(() => {
        const bar = document.querySelector(".selection-bar");
        if (bar === null || bar.hidden) return null;
        const bounds = bar.getBoundingClientRect();
        return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
      })()`,
    );
    return asJson(raw);
  };
  const coveredByBar = (point, bar) =>
    bar !== null &&
    point.x >= bar.x &&
    point.x <= bar.x + bar.width &&
    point.y >= bar.y &&
    point.y <= bar.y + bar.height;
  await shiftKey(send, true);
  let lastClickedPoint = null;
  const candidates = [];
  for (const card of scan.cards.slice(0, 24)) {
    candidates.push({ id: card.id, point: await clientPoint(send, card) });
  }
  let selectedCount = 0;
  for (const candidate of candidates) {
    if (selectedCount >= 3) {
      break;
    }
    const bar = await barRectNow();
    if (coveredByBar(candidate.point, bar)) {
      continue;
    }
    await shiftClick(send, candidate.point);
    const state = await selectionState(send);
    if (state.size > selectedCount) {
      selectedCount = state.size;
      lastClickedPoint = candidate.point;
    }
  }
  await shiftKey(send, false);
  const selected = await selectionState(send);
  const barRect = asJson(
    await evaluate(
      send,
      `(() => {
        const bar = document.querySelector(".selection-bar");
        if (bar === null) return null;
        const bounds = bar.getBoundingClientRect();
        return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height, hidden: bar.hidden };
      })()`,
    ),
  );
  const selectionShot = await screenshot(send, `P4-16-selection-${viewport.name}.png`);
  checks.push({
    name: `${viewport.name}: Shift-click selects three objects and shows the count bar`,
    passed:
      selected.size === 3 &&
      selected.barVisible === true &&
      barRect !== null &&
      barRect.hidden === false &&
      Math.abs(selected.bounds.width) > 0 &&
      Math.abs(selected.bounds.height) > 0,
    actual: { selection: selected, bar: barRect },
    expected: "3 selected and a visible bar above the bounding box",
  });

  // 2. Joint drag: exactly one group of moves, selection survives.
  const beforeDrag = await selectionState(send);
  const dragPoint = lastClickedPoint;
  await mouse(send, "mouseMoved", dragPoint, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", dragPoint);
  await delay(40);
  await mouse(send, "mouseMoved", { x: dragPoint.x + 60, y: dragPoint.y + 30 });
  await delay(120);
  await mouse(send, "mouseReleased", { x: dragPoint.x + 60, y: dragPoint.y + 30 }, { buttons: 0 });
  await delay(150);
  const afterDrag = await selectionState(send);
  const moveChildren = afterDrag.lastOperation?.children ?? [];
  checks.push({
    name: `${viewport.name}: the joint drag is one group operation and keeps the selection`,
    passed:
      afterDrag.lastOperation?.operation === "group" &&
      afterDrag.lastOperation?.inverse === "group" &&
      moveChildren.length === 3 &&
      moveChildren.every((type) => type === "moveCard") &&
      afterDrag.size === beforeDrag.size &&
      afterDrag.size === 3,
    actual: { operation: afterDrag.lastOperation, size: afterDrag.size },
    expected: "one group of three moveCard children and three selected objects after release",
  });

  // 3. Delete the selection from the count bar: one group of deletes.
  const deletePoint = asJson(
    await evaluate(
      send,
      `(() => {
        const button = document.querySelector(".selection-bar__delete");
        if (button === null) return null;
        const bounds = button.getBoundingClientRect();
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      })()`,
    ),
  );
  if (deletePoint !== null) {
    await mouse(send, "mouseMoved", deletePoint, { buttons: 0, button: "none" });
    await mouse(send, "mousePressed", deletePoint);
    await mouse(send, "mouseReleased", deletePoint, { buttons: 0 });
    await delay(200);
  }
  const afterDelete = await selectionState(send);
  const deleteChildren = afterDelete.lastOperation?.children ?? [];
  const deletedShot = await screenshot(send, `P4-16-selection-deleted-${viewport.name}.png`);
  checks.push({
    name: `${viewport.name}: the bar delete writes one group of deletes and hides the bar`,
    passed:
      afterDelete.lastOperation?.operation === "group" &&
      deleteChildren.length === 3 &&
      deleteChildren.every((type) => type === "deleteCard") &&
      afterDelete.size === 0 &&
      afterDelete.barVisible === false,
    actual: { operation: afterDelete.lastOperation, selection: afterDelete },
    expected: "one group of three deleteCard children, empty selection, hidden bar",
  });

  // 4. Shift-drag an empty area: live band, then intersection selection.
  const emptyLocal = asJson(
    await evaluate(
      send,
      `(() => {
        const canvas = document.querySelector("#canvas");
        const targetAt = globalThis.__engineDrag?.targetAt;
        for (let y = 12; y < canvas.clientHeight; y += 12) {
          for (let x = 12; x < canvas.clientWidth; x += 12) {
            if (targetAt(x, y) === null) return { x, y };
          }
        }
        return null;
      })()`,
    ),
  );
  if (emptyLocal === null) {
    throw new Error("no empty canvas point for the rubber band");
  }
  const bandStart = await clientPoint(send, emptyLocal);
  const bandEnd = {
    x: bandStart.x + 320,
    y: bandStart.y + 240,
  };
  await shiftKey(send, true);
  await mouse(send, "mouseMoved", bandStart, { buttons: 0, button: "none", modifiers: 8 });
  await mouse(send, "mousePressed", bandStart, { modifiers: 8 });
  await delay(40);
  await mouse(send, "mouseMoved", bandEnd, { modifiers: 8 });
  await delay(180);
  const liveBand = asJson(await evaluate(send, "JSON.stringify(globalThis.__engineSelection.band())"));
  const bandShot = await screenshot(send, `P4-16-band-${viewport.name}.png`);
  await mouse(send, "mouseReleased", bandEnd, { buttons: 0, modifiers: 8 });
  await shiftKey(send, false);
  await delay(180);
  const afterBand = await selectionState(send);
  checks.push({
    name: `${viewport.name}: the Shift band is live, selects by intersection and disappears`,
    passed:
      liveBand !== null &&
      liveBand.width > 0 &&
      liveBand.height > 0 &&
      afterBand.band === null &&
      afterBand.size > 0 &&
      afterBand.barVisible === true,
    actual: { liveBand, afterBand },
    expected: "a live band rectangle, a non-empty intersection selection and no band after release",
  });

  // 5. A plain empty drag still pans and writes nothing.
  const cameraBeforePan = asJson(
    await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"),
  );
  const selectionBeforePan = await selectionState(send);
  const panLocal = asJson(
    await evaluate(
      send,
      `(() => {
        const canvas = document.querySelector("#canvas");
        const targetAt = globalThis.__engineDrag?.targetAt;
        for (let y = 12; y < canvas.clientHeight; y += 12) {
          for (let x = 12; x < canvas.clientWidth; x += 12) {
            if (targetAt(x, y) === null) return { x, y };
          }
        }
        return null;
      })()`,
    ),
  );
  if (panLocal === null) {
    throw new Error("no empty canvas point for the plain pan");
  }
  const panStart = await clientPoint(send, panLocal);
  await mouse(send, "mouseMoved", panStart, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", panStart);
  await delay(40);
  await mouse(send, "mouseMoved", { x: panStart.x + 50, y: panStart.y + 30 });
  await delay(80);
  await mouse(send, "mouseReleased", { x: panStart.x + 50, y: panStart.y + 30 }, { buttons: 0 });
  await delay(150);
  const cameraAfterPan = asJson(
    await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"),
  );
  const selectionAfterPan = await selectionState(send);
  checks.push({
    name: `${viewport.name}: a plain empty drag pans and writes no operation`,
    passed:
      JSON.stringify(cameraAfterPan) !== JSON.stringify(cameraBeforePan) &&
      selectionAfterPan.size === selectionBeforePan.size &&
      JSON.stringify(selectionAfterPan.lastOperation) ===
        JSON.stringify(selectionBeforePan.lastOperation),
    actual: { cameraBeforePan, cameraAfterPan, selectionAfterPan },
    expected: "a moved camera, an unchanged selection and no new operation",
  });

  return {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    camera,
    cards: cardPoints.map((card) => ({ id: card.id, world: scan.cards.find((entry) => entry.id === card.id)?.world })),
    selection: selected,
    bar: barRect,
    jointDrag: { before: beforeDrag, after: afterDrag },
    delete: afterDelete,
    band: { live: liveBand, after: afterBand },
    plainDrag: { cameraBefore: cameraBeforePan, cameraAfter: cameraAfterPan, selection: selectionAfterPan },
    screenshots: [deletedShot],
  };
}

// The layers visual phase (its own browser): on the dark board the 1 px selection
// frames and the accent-soft band read clearly in the evidence images.
async function captureLayersVisual(send, viewport, checks) {
  await navigate(send, `${baseUrl}?scene=layers&view=${viewport.layersView}`);
  const empty = asJson(
    await evaluate(
      send,
      `(() => {
        const canvas = document.querySelector("#canvas");
        const targetAt = globalThis.__engineDrag?.targetAt;
        for (let y = 12; y < canvas.clientHeight; y += 12) {
          for (let x = 12; x < canvas.clientWidth; x += 12) {
            if (targetAt(x, y) === null) return { x, y };
          }
        }
        return null;
      })()`,
    ),
  );
  if (empty === null) {
    throw new Error("the layers board has no empty canvas point for the band");
  }
  const start = await clientPoint(send, empty);
  const end = { x: start.x + 260, y: start.y + 230 };
  await shiftKey(send, true);
  await mouse(send, "mouseMoved", start, { buttons: 0, button: "none", modifiers: 8 });
  await mouse(send, "mousePressed", start, { modifiers: 8 });
  await delay(40);
  await mouse(send, "mouseMoved", end, { modifiers: 8 });
  await delay(200);
  const band = asJson(await evaluate(send, "JSON.stringify(globalThis.__engineSelection.band())"));
  const bandShot = await screenshot(send, `P4-16-band-${viewport.name}.png`);
  await mouse(send, "mouseReleased", end, { buttons: 0, modifiers: 8 });
  await shiftKey(send, false);
  await delay(220);
  const selection = await selectionState(send);
  const selectionShot = await screenshot(send, `P4-16-selection-${viewport.name}.png`);
  checks.push({
    name: `${viewport.name}: the 1 px frames and the band render in the chrome pass`,
    passed:
      band !== null &&
      band.width > 0 &&
      band.height > 0 &&
      selection.size > 0 &&
      selection.barVisible === true,
    actual: { band, selection },
    expected: "a live band and a non-empty framed selection on the dark board",
  });
  return {
    band,
    selection,
    camera: asJson(
      await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"),
    ),
    screenshots: [bandShot, selectionShot],
  };
}

// Set in main() from the slot's playground port; never hard-coded.
let baseUrl = "";

async function withBrowser(viewport, checks, scene) {
  const debugPort = await getFreePort();
  const userDataDir = join(tmpdir(), `p416-selection-${process.pid}-${viewport.name}`);
  const chrome = findChrome();
  let child = null;
  let socket = null;
  try {
    child = spawn(
      chrome,
      [
        ...BASE_CHROME_FLAGS,
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const targets = await waitForDebugPort(debugPort);
    const target = targets.find((candidate) => candidate.type === "page");
    if (target === undefined) {
      throw new Error("no page target in Chrome");
    }
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen) => socket.addEventListener("open", resolveOpen, { once: true }));
    const send = createClient(socket);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    await delay(300);
    return scene === "layers"
      ? await captureLayersVisual(send, viewport, checks)
      : await captureViewport(send, viewport, checks);
  } finally {
    if (socket !== null) {
      try {
        await socket.send(JSON.stringify({ id: 999999, method: "Browser.close" }));
      } catch {
        // closing anyway
      }
      socket.close();
    }
    if (child !== null) {
      child.kill("SIGTERM");
      await new Promise((resolveExit) => {
        const timer = setTimeout(resolveExit, 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolveExit();
        });
      });
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // The temporary profile is outside the repository; leaving it is harmless.
    }
  }
}

async function main() {
  const task = parseTask(process.argv.slice(2));
  requireArtefacts();
  const port = playgroundPort();
  baseUrl = `http://127.0.0.1:${port}/apps/engine-playground/`;
  const server = await startStaticServer(port);
  const record = {
    task,
    gate: "selection-capture",
    startedAt: new Date().toISOString(),
    chrome: findChrome(),
    flags: BASE_CHROME_FLAGS,
    viewports: [],
    checks: [],
    result: "fail",
    exitCode: 1,
  };
  try {
    for (const viewport of [DESKTOP, MOBILE]) {
      const behaviour = await withBrowser(viewport, record.checks, "sample");
      const visual = await withBrowser(viewport, record.checks, "layers");
      record.viewports.push({
        viewport: behaviour.viewport,
        camera: behaviour.camera,
        selection: behaviour.selection,
        bar: behaviour.bar,
        jointDrag: behaviour.jointDrag,
        delete: behaviour.delete,
        band: behaviour.band,
        plainDrag: behaviour.plainDrag,
        visual,
        screenshots: [...behaviour.screenshots, ...visual.screenshots],
      });
    }
    const failures = record.checks.filter((check) => check.passed !== true);
    record.result = failures.length === 0 ? "pass" : "fail";
    record.exitCode = failures.length === 0 ? 0 : 1;
    for (const check of record.checks) {
      process.stdout.write(
        `${check.passed ? "pass" : "FAIL"} ${check.name}${
          check.passed ? "" : ` (actual ${JSON.stringify(check.actual)})`
        }\n`,
      );
    }
  } catch (error) {
    record.result = "infra";
    record.resultReason = error instanceof Error ? error.message : String(error);
    record.exitCode = 3;
    process.stderr.write(`capture-selection: ${record.resultReason}\n`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const relative = join("reviews", "evidence", `${task}-selection-${slug}.json`);
  writeFileSync(join(REPO_ROOT, relative), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: ${relative}\n`);
  process.exitCode = record.exitCode;
}

await main();
