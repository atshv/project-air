#!/usr/bin/env node
// L18 (P4-23) deterministic inline-comfort capture.
//
//   node apps/engine-playground/tools/capture-inline.mjs [--task P4-23]
//
// Starts its own static server on the slot playground port and one headless
// Chrome for Testing per viewport (1440x900 and 390x844, so the emulation is set
// before the first load), then drives the `?scene=layers&edit=inline` demo:
//
//   1. the anchored plain fields over the layers board (checklist, column,
//      table) plus a 24 px colour field and a scrollable note;
//   2. a field click focuses it and starts no drag (the P4-14 layer sees nothing);
//   3. Enter inserts a new entry directly below and focuses it;
//   4. Tab / Shift+Tab move focus (with the wrap rule);
//   5. Backspace removes an empty entry and focuses the previous one; on a
//      non-empty entry it only deletes characters;
//   6. Escape closes the field; the wheel over the scrollable note scrolls it and
//      does not zoom the canvas;
//   7. nothing writes board content (object count and the last operation stay).
//
// The record `reviews/evidence/<task>-inline-<timestamp>.json` stores the field
// anchors, focus/order changes, intents, colour size, camera, scroll state and
// checks next to the screenshots. Exit codes: 0 pass, 1 assertion failed, 2
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

const DESKTOP = { name: "desktop", width: 1440, height: 900, mobile: false };
const MOBILE = { name: "mobile", width: 390, height: 844, mobile: true };

const REQUIRED_ARTEFACTS = [
  "apps/engine-playground/index.html",
  "apps/engine-playground/main.js",
  "apps/engine-playground/playground.css",
  "packages/ui-kit/tokens.css",
  "packages/engine/dist/bridge/engine.js",
  "packages/engine/dist/bridge/input.js",
  "packages/engine/dist/bridge/overlay.js",
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
    return "P4-23";
  }
  const task = argv[index + 1];
  if (task === undefined || task.startsWith("--") || !/^[A-Za-z0-9_.-]+$/.test(task)) {
    throw new Error("--task needs a task id such as P4-23");
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

const asJson = (value) => (typeof value === "string" ? JSON.parse(value) : value);

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

async function key(send, keyName, code, virtualKeyCode, modifiers = 0) {
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: keyName,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: keyName,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
  await delay(120);
}

async function pressEnter(send) {
  await key(send, "Enter", "Enter", 13);
}

const STATE_EXPRESSION = `JSON.stringify({
  fields: globalThis.__inlineDemo.fields(),
  focusedId: globalThis.__inlineDemo.focusedId(),
  lastIntent: globalThis.__inlineDemo.lastIntent(),
  colourSize: globalThis.__inlineDemo.colourSize(),
  counts: globalThis.__inlineDemo.counts(),
  boardWrites: globalThis.__inlineDemo.boardWrites(),
  activeElement: (() => {
    const active = document.activeElement;
    if (active === null) return null;
    return { tag: active.tagName.toLowerCase(), label: active.getAttribute("aria-label") };
  })(),
  camera: globalThis.__enginePlayground.getState().camera,
  objectCount: globalThis.__enginePlayground.getState().objectCount,
  lastOperation: globalThis.__engineDrag ? globalThis.__engineDrag.last() : null,
  inputPhase: globalThis.__engineInput ? globalThis.__engineInput.phase() : null
})`;

async function state(send) {
  return asJson(await evaluate(send, STATE_EXPRESSION));
}

async function focusFieldId(send, id) {
  await evaluate(send, `globalThis.__inlineDemo.focus(${JSON.stringify(id)})`);
  await delay(80);
}

async function captureViewport(send, viewport, checks) {
  const ready = await navigate(send, `${baseUrl}?scene=layers&edit=inline`);
  if (ready.scene !== "layers") {
    throw new Error(`the inline demo did not load the layers scene: ${ready.scene}`);
  }
  // 2. The wheel over the scrollable note is not prevented and never zooms the
  // canvas. The check is dispatched in the page (a synthetic WheelEvent) because
  // this headless build does not answer CDP wheel dispatches; the routing unit
  // test proves the same listener behaviour.
  const wheelProbe = asJson(
    await evaluate(
      send,
      `(() => {
        const note = document.querySelector(".inline-scroll");
        const bounds = note.getBoundingClientRect();
        note.focus();
        const cameraBefore = JSON.stringify(globalThis.__enginePlayground.getState().camera);
        const event = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
        note.dispatchEvent(event);
        return {
          defaultPrevented: event.defaultPrevented,
          cameraBefore,
          cameraAfter: JSON.stringify(globalThis.__enginePlayground.getState().camera),
          scrollable: note.scrollHeight > note.clientHeight,
          focused: document.activeElement === note,
          scrollTop: note.scrollTop,
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2
        };
      })()`,
    ),
  );
  checks.push({
    name: `${viewport.name}: the scrollable field keeps its wheel and the canvas does not zoom`,
    passed:
      wheelProbe.focused === true &&
      wheelProbe.defaultPrevented === false &&
      wheelProbe.scrollable === true &&
      wheelProbe.cameraBefore === wheelProbe.cameraAfter,
    actual: wheelProbe,
    expected: "the field scrollable, its wheel default allowed and the camera unchanged",
  });

  const initial = await state(send);
  const firstShot = await screenshot(send, `P4-23-inline-${viewport.name}.png`);

  checks.push({
    name: `${viewport.name}: the overlay anchors plain fields over the board`,
    passed:
      initial.counts.text === 7 &&
      initial.counts.colour === 1 &&
      initial.counts.scroll === 1 &&
      initial.fields.every((field) => field.visible === true) &&
      initial.fields.every((field) => field.screen.visible === true) &&
      initial.objectCount > 0,
    actual: { counts: initial.counts, objectCount: initial.objectCount },
    expected: "7 text entries + 1 colour + 1 scrollable field, all visible",
  });
  checks.push({
    name: `${viewport.name}: the colour field is the 24 px token size`,
    passed:
      Math.abs(initial.colourSize.width - 24) < 0.01 &&
      Math.abs(initial.colourSize.height - 24) < 0.01,
    actual: initial.colourSize,
    expected: { width: 24, height: 24 },
  });

  // 3. A click focuses a field and starts no drag/selection on the canvas.
  const firstField = initial.fields[0];
  const fieldPoint = {
    x: firstField.screen.x + firstField.screen.width / 2,
    y: firstField.screen.y + firstField.screen.height / 2,
  };
  const canvasOrigin = asJson(
    await evaluate(
      send,
      `(() => { const bounds = document.querySelector("#canvas").getBoundingClientRect(); return { left: bounds.left, top: bounds.top }; })()`,
    ),
  );
  const clientFieldPoint = { x: canvasOrigin.left + fieldPoint.x, y: canvasOrigin.top + fieldPoint.y };
  await mouse(send, "mouseMoved", clientFieldPoint, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", clientFieldPoint);
  await mouse(send, "mouseReleased", clientFieldPoint, { buttons: 0 });
  await delay(120);
  const afterClick = await state(send);
  checks.push({
    name: `${viewport.name}: clicking a field focuses it and starts no drag`,
    passed:
      afterClick.activeElement?.label !== null &&
      afterClick.inputPhase === "idle" &&
      afterClick.lastOperation === null &&
      afterClick.objectCount === initial.objectCount,
    actual: {
      activeElement: afterClick.activeElement,
      inputPhase: afterClick.inputPhase,
      lastOperation: afterClick.lastOperation,
      objectCount: afterClick.objectCount,
    },
    expected: "the field focused, the input layer idle and no operation",
  });

  // 4. Enter inserts a new entry directly below and focuses it.
  const beforeEnter = await state(send);
  await pressEnter(send);
  const afterEnter = await state(send);
  const focusedAfterEnter = afterEnter.fields.find((field) => field.focused);
  const previousField = beforeEnter.fields.find((field) => field.focused);
  checks.push({
    name: `${viewport.name}: Enter creates a new entry below and focuses it`,
    passed:
      afterEnter.counts.text === beforeEnter.counts.text + 1 &&
      focusedAfterEnter !== undefined &&
      previousField !== undefined &&
      focusedAfterEnter.id !== previousField.id &&
      Math.abs(focusedAfterEnter.screen.y - previousField.screen.y - 30 * initial.camera.zoom) < 0.5,
    actual: { counts: afterEnter.counts, focused: focusedAfterEnter?.id, intent: afterEnter.lastIntent },
    expected: "one more text entry, focused, directly below the previous one",
  });
  await evaluate(send, `document.activeElement.value = "New entry";`);
  const focusedShot = await screenshot(send, `P4-23-inline-focused-${viewport.name}.png`);

  // 5. Tab / Shift+Tab move focus with the wrap rule.
  const beforeTab = await state(send);
  await key(send, "Tab", "Tab", 9);
  const afterTab = await state(send);
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Shift",
    code: "ShiftLeft",
    windowsVirtualKeyCode: 16,
    nativeVirtualKeyCode: 16,
    modifiers: 8,
  });
  await key(send, "Tab", "Tab", 9, 8);
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Shift",
    code: "ShiftLeft",
    windowsVirtualKeyCode: 16,
    nativeVirtualKeyCode: 16,
  });
  const afterShiftTab = await state(send);
  checks.push({
    name: `${viewport.name}: Tab and Shift+Tab move focus with the wrap rule`,
    passed:
      afterTab.focusedId !== beforeTab.focusedId &&
      afterShiftTab.focusedId === beforeTab.focusedId &&
      afterTab.lastIntent?.kind === "focus" &&
      afterShiftTab.lastIntent?.kind === "focus",
    actual: {
      before: beforeTab.focusedId,
      afterTab: afterTab.focusedId,
      afterShiftTab: afterShiftTab.focusedId,
    },
    expected: "focus moves forward on Tab and back to the same field on Shift+Tab",
  });

  // 6. Backspace: empty entry removed with focus on the previous; non-empty only
  //    deletes characters.
  await pressEnter(send);
  const afterSecondEnter = await state(send);
  const createdId = afterSecondEnter.focusedId;
  await key(send, "Backspace", "Backspace", 8);
  const afterEmptyBackspace = await state(send);
  checks.push({
    name: `${viewport.name}: Backspace removes an empty entry and focuses the previous`,
    passed:
      afterEmptyBackspace.counts.text === afterSecondEnter.counts.text - 1 &&
      afterEmptyBackspace.focusedId !== createdId &&
      afterEmptyBackspace.lastIntent?.kind === "remove",
    actual: {
      before: afterSecondEnter.counts,
      after: afterEmptyBackspace.counts,
      focused: afterEmptyBackspace.focusedId,
      intent: afterEmptyBackspace.lastIntent,
    },
    expected: "the empty entry removed and the previous entry focused",
  });

  await focusFieldId(send, initial.fields[1].id);
  await evaluate(send, `document.activeElement.value = "Keep me";`);
  const beforeNonEmpty = await state(send);
  await key(send, "Backspace", "Backspace", 8);
  const afterNonEmpty = await state(send);
  const beforeValue = beforeNonEmpty.fields.find((field) => field.focused)?.value ?? "";
  const afterValue = afterNonEmpty.fields.find((field) => field.focused)?.value ?? "";
  checks.push({
    name: `${viewport.name}: Backspace in a non-empty entry only deletes a character`,
    passed:
      afterNonEmpty.counts.text === beforeNonEmpty.counts.text &&
      afterValue === beforeValue.slice(0, -1) &&
      afterNonEmpty.lastIntent?.kind === "none",
    actual: {
      counts: afterNonEmpty.counts,
      focusedValue: afterValue,
      intent: afterNonEmpty.lastIntent,
    },
    expected: "the entry stays and its text loses one character",
  });

  // 7. Escape closes the field without writing anything.
  await key(send, "Escape", "Escape", 27);
  const afterEscape = await state(send);
  checks.push({
    name: `${viewport.name}: Escape closes the editing field`,
    passed:
      afterEscape.activeElement?.tag !== "input" &&
      afterEscape.activeElement?.tag !== "textarea" &&
      afterEscape.lastIntent?.kind === "close",
    actual: { activeElement: afterEscape.activeElement, intent: afterEscape.lastIntent },
    expected: "focus leaves the field and no operation is written",
  });

  const emptyPoint = asJson(
    await evaluate(
      send,
      `(() => {
        const canvas = document.querySelector("#canvas");
        const bounds = canvas.getBoundingClientRect();
        const targetAt = globalThis.__engineDrag?.targetAt;
        for (let y = 20; y < canvas.clientHeight; y += 20) {
          for (let x = 20; x < canvas.clientWidth; x += 20) {
            const element = document.elementFromPoint(bounds.left + x, bounds.top + y);
            if (element !== null && element.closest(".inline-field") !== null) continue;
            if (targetAt(x, y) === null) return { x: bounds.left + x, y: bounds.top + y };
          }
        }
        return null;
      })()`,
    ),
  );
  // 8. Anchoring while the camera pans: a 300 px empty-canvas drag moves the
  // camera and the field screen position follows (world - pan) * zoom. A second
  // pass pans far enough that every field leaves the viewport and must hide.
  const canvasWidth = asJson(
    await evaluate(send, "document.querySelector('#canvas').clientWidth"),
  );
  const panPoint = asJson(
    await evaluate(
      send,
      `(() => {
        const canvas = document.querySelector("#canvas");
        const bounds = canvas.getBoundingClientRect();
        const targetAt = globalThis.__engineDrag?.targetAt;
        for (let y = 20; y < canvas.clientHeight; y += 20) {
          for (let x = 20; x < canvas.clientWidth; x += 20) {
            const element = document.elementFromPoint(bounds.left + x, bounds.top + y);
            if (element !== null && element.closest(".inline-field") !== null) continue;
            if (targetAt(x, y) === null) return { x: bounds.left + x, y: bounds.top + y };
          }
        }
        return null;
      })()`,
    ),
  );
  const panDistance = Math.max(40, Math.round(canvasWidth * 0.2));
  await mouse(send, "mouseMoved", panPoint, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", panPoint);
  await delay(30);
  await mouse(send, "mouseMoved", { x: panPoint.x - panDistance, y: panPoint.y });
  await delay(60);
  await mouse(send, "mouseReleased", { x: panPoint.x - panDistance, y: panPoint.y }, { buttons: 0 });
  await delay(250);
  const afterPanOne = await state(send);
  const anchoredField = afterPanOne.fields.find((field) => field.visible && field.kind === "text");
  const expectedX =
    anchoredField === undefined
      ? null
      : (anchoredField.world.x - afterPanOne.camera.panX) * afterPanOne.camera.zoom;
  checks.push({
    name: `${viewport.name}: the fields stay anchored while the camera pans`,
    passed:
      anchoredField !== undefined &&
      expectedX !== null &&
      Math.abs(anchoredField.screen.x - expectedX) < 0.5,
    actual: {
      camera: afterPanOne.camera,
      fieldScreenX: anchoredField?.screen.x,
      expectedX,
    },
    expected: "a field at (world - pan) * zoom after the pan",
  });

  for (let step = 0; step < 3; step += 1) {
    const point = asJson(
      await evaluate(
        send,
        `(() => {
          const canvas = document.querySelector("#canvas");
          const bounds = canvas.getBoundingClientRect();
          const targetAt = globalThis.__engineDrag?.targetAt;
          for (let y = 20; y < canvas.clientHeight; y += 20) {
            for (let x = 20; x < canvas.clientWidth; x += 20) {
              const element = document.elementFromPoint(bounds.left + x, bounds.top + y);
              if (element !== null && element.closest(".inline-field") !== null) continue;
              if (targetAt(x, y) === null) return { x: bounds.left + x, y: bounds.top + y };
            }
          }
          return null;
        })()`,
      ),
    );
    if (point === null) {
      break;
    }
    await mouse(send, "mouseMoved", point, { buttons: 0, button: "none" });
    await mouse(send, "mousePressed", point);
    await delay(30);
    await mouse(send, "mouseMoved", { x: point.x + 900, y: point.y });
    await delay(60);
    await mouse(send, "mouseReleased", { x: point.x + 900, y: point.y }, { buttons: 0 });
    await delay(200);
  }
  const afterPan = await state(send);
  checks.push({
    name: `${viewport.name}: fields hide when their objects leave the viewport`,
    passed: afterPan.fields.every((field) => field.visible === false),
    actual: afterPan.fields.map((field) => ({ id: field.id, visible: field.visible })),
    expected: "every anchored field hidden after the camera pan",
  });

  const final = await state(send);
  checks.push({
    name: `${viewport.name}: the inline demo writes no board content`,
    passed:
      final.objectCount === initial.objectCount &&
      final.lastOperation === null &&
      final.boardWrites === 0,
    actual: {
      objectCount: final.objectCount,
      lastOperation: final.lastOperation,
      boardWrites: final.boardWrites,
    },
    expected: "the same object count, no operation, zero board writes",
  });

  return {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    camera: initial.camera,
    fields: initial.fields,
    counts: { initial: initial.counts, final: final.counts },
    colourSize: initial.colourSize,
    focus: {
      afterClick: afterClick.activeElement,
      afterEnter: focusedAfterEnter?.id ?? null,
      afterTab: afterTab.focusedId,
      afterShiftTab: afterShiftTab.focusedId,
      afterEscape: afterEscape.activeElement,
    },
    intents: {
      afterEnter: afterEnter.lastIntent,
      afterTab: afterTab.lastIntent,
      afterEmptyBackspace: afterEmptyBackspace.lastIntent,
      afterNonEmptyBackspace: afterNonEmpty.lastIntent,
      afterEscape: afterEscape.lastIntent,
    },
    scroll: {
      scrollable: wheelProbe.scrollable,
      scrollTop: wheelProbe.scrollTop,
      defaultPrevented: wheelProbe.defaultPrevented,
    },
    boardWrites: final.boardWrites,
    screenshots: [firstShot, focusedShot],
  };
}

let baseUrl = "";

async function withBrowser(viewport, checks) {
  const debugPort = await getFreePort();
  const userDataDir = join(tmpdir(), `p423-inline-${process.pid}-${viewport.name}`);
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
    return await captureViewport(send, viewport, checks);
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
    gate: "inline-capture",
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
      record.viewports.push(await withBrowser(viewport, record.checks));
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
    process.stderr.write(`capture-inline: ${record.resultReason}\n`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const relative = join("reviews", "evidence", `${task}-inline-${slug}.json`);
  writeFileSync(join(REPO_ROOT, relative), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: ${relative}\n`);
  process.exitCode = record.exitCode;
}

await main();
