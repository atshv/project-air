#!/usr/bin/env node
// L07 (P4-15) deterministic snapping capture.
//
//   node apps/engine-playground/tools/capture-snap.mjs [--task P4-15]
//
// Starts its own static server on the slot playground port and headless Chrome
// for Testing with the documented WebGL2 flags, then drives trusted pointer
// events on the layers scene so one card is dragged into the tolerance of a
// neighbour's left and top edges. It records, per viewport (1440x900 and
// 390x844):
//
//   - the live snap while dragging: snapped world position and the guides, and a
//     screenshot with the guide chrome visible (`P4-15-snap-<viewport>.png`);
//   - the same drag with Shift held: no guides, free position, and a screenshot
//     (`P4-15-snap-shift-<viewport>.png`);
//   - the committed operation after release (`__engineDrag.last()`), proving the
//     snapped release is one move operation.
//
// The JSON record `reviews/evidence/<task>-snap-<timestamp>.json` stores the
// camera, tokens, raw/snapped positions and guide lines next to the images, so
// the numbers and the pixels agree. Exit codes: 0 pass, 1 assertion failed,
// 2 usage/build, 3 infra. It starts and stops only its own server and browser.

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

// World positions of the layers scene (test-kit): card-0002 at (288, 224, 224,
// 128) inside zone-0001; block-0001 at (112, 128, 256, 160). Pressing the card
// centre and releasing it near (115, 132) puts its left/top edges within the 6 px
// tolerance of the block's left/top edges, so it snaps to (112, 128).
const CARD = { x: 288, y: 224, width: 224, height: 128 };
const PRESS_WORLD = { x: 400, y: 288 };
// Pointer world target = raw object top-left + the grab offset (112, 64), so the
// dragged card lands at (115, 132) — 3 px and 4 px from block-0001's edges.
const RAW_TARGET_WORLD = { x: 227, y: 196 };
const SNAPPED = { x: 112, y: 128 };

const requiredArtefacts = [
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
    return "P4-15";
  }
  const task = argv[index + 1];
  if (task === undefined || task.startsWith("--") || !/^[A-Za-z0-9_.-]+$/.test(task)) {
    throw new Error("--task needs a task id such as P4-15");
  }
  return task;
}

function requireArtefacts() {
  const missing = requiredArtefacts.filter((relative) => !existsSync(join(REPO_ROOT, relative)));
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
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (typeof message.id === "number" && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
    }
  });
  const failAll = (reason) => {
    for (const [id, call] of pending) {
      call.reject(new Error(`CDP call ${id} aborted: ${reason}`));
      pending.delete(id);
    }
  };
  const waiters = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
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
      last = `the ready hook did not resolve (${String(raw)})`;
    } else {
      const errorText = await evaluate(
        send,
        "document.querySelector('#error')?.textContent ?? ''",
      ).catch(() => "");
      last = `no __enginePlayground; #error: ${JSON.stringify(errorText)}`;
    }
    await delay(250);
  }
  throw new Error(`the playground did not become ready: ${last}`);
}

async function navigate(send, url) {
  // Register the load waiter before navigating: the ready hook lives in the new
  // document, and polling a destroyed execution context can hang in CDP.
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

const WORLD_TO_SCREEN = (world) => `(() => {
  const canvas = document.querySelector("#canvas");
  const state = globalThis.__enginePlayground.getState();
  const bounds = canvas.getBoundingClientRect();
  return {
    x: bounds.left + (${world.x} - state.camera.panX) * state.camera.zoom,
    y: bounds.top + (${world.y} - state.camera.panY) * state.camera.zoom
  };
})()`;

async function captureViewport(send, viewport, task, checks) {
  await navigate(send, `${BASE_URL}?scene=layers&store=off`);
  const camera = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
  const tokens = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__engineInput.tokens())"));
  const pressPoint = await evaluate(send, WORLD_TO_SCREEN(PRESS_WORLD));
  const targetPoint = {
    x: pressPoint.x + (RAW_TARGET_WORLD.x - PRESS_WORLD.x) * camera.zoom,
    y: pressPoint.y + (RAW_TARGET_WORLD.y - PRESS_WORLD.y) * camera.zoom,
  };
  await mouse(send, "mouseMoved", pressPoint, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", pressPoint);
  await delay(60);
  await mouse(send, "mouseMoved", targetPoint);
  await delay(250);
  const snapped = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__engineSnap.last())"));
  const snappedShot = await screenshot(send, `P4-15-snap-${viewport.name}.png`);

  // Shift: the same drag, positioned freely, keeps the pointer position and
  // clears the guides.
  const freePoint = { x: targetPoint.x + 6, y: targetPoint.y + 6 };
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 8 });
  await mouse(send, "mouseMoved", freePoint, { modifiers: 8 });
  await delay(250);
  const free = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__engineSnap.last())"));
  const freeShot = await screenshot(send, `P4-15-snap-shift-${viewport.name}.png`);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  await mouse(send, "mouseReleased", freePoint, { buttons: 0 });
  await delay(150);
  const committed = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__engineDrag.last())"));

  const guideCount = Array.isArray(snapped?.guides) ? snapped.guides.length : 0;
  const orientations = (snapped?.guides ?? []).map((guide) => guide.orientation);
  const result = {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    camera,
    tokens,
    press: { world: PRESS_WORLD, screen: pressPoint },
    rawTarget: { world: RAW_TARGET_WORLD, screen: targetPoint },
    snapped: snapped === null ? null : { position: snapped.position, guides: snapped.guides, free: snapped.free },
    free: free === null ? null : { position: free.position, guides: free.guides, free: free.free },
    committed,
    screenshots: [snappedShot, freeShot],
  };
  checks.push({
    name: `${viewport.name}: the drag snaps to the neighbour edges with guides`,
    passed:
      snapped !== null &&
      snapped.free === false &&
      Math.abs(snapped.position.x - SNAPPED.x) < 1e-6 &&
      Math.abs(snapped.position.y - SNAPPED.y) < 1e-6 &&
      guideCount === 2 &&
      orientations.includes("vertical") &&
      orientations.includes("horizontal"),
    actual: snapped,
    expected: { position: SNAPPED, guides: 2 },
  });
  checks.push({
    name: `${viewport.name}: Shift positions freely without guides`,
    passed:
      free !== null &&
      free.free === true &&
      guideCount >= 0 &&
      (free.guides ?? []).length === 0 &&
      Math.abs(free.position.x - (snapped?.position.x ?? 0)) > 1e-9,
    actual: free,
    expected: "free position, no guides",
  });
  checks.push({
    name: `${viewport.name}: the released drag is one move operation`,
    passed: committed !== null && committed.operation === "moveCard" && committed.inverse === "moveCard",
    actual: committed,
    expected: { operation: "moveCard", inverse: "moveCard" },
  });
  return result;
}

// Set in main() from the slot's playground port; never hard-coded.
let BASE_URL = "";

// One fresh Chrome for Testing per viewport: the mobile emulation is set before
// the first page load, so no renderer swap happens under the DevTools session.
async function withBrowser(viewport, task, checks) {
  const debugPort = await getFreePort();
  const userDataDir = join(tmpdir(), `p415-snap-${process.pid}-${viewport.name}`);
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
    return await captureViewport(send, viewport, task, checks);
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
  BASE_URL = `http://127.0.0.1:${port}/apps/engine-playground/`;
  const server = await startStaticServer(port);
  const record = {
    task,
    gate: "snap-capture",
    startedAt: new Date().toISOString(),
    chrome: findChrome(),
    flags: BASE_CHROME_FLAGS,
    tolerances: { snapTolerancePx: null, gridPx: null },
    viewports: [],
    checks: [],
    result: "fail",
    exitCode: 1,
  };
  try {
    record.viewports.push(await withBrowser(DESKTOP, task, record.checks));
    record.viewports.push(await withBrowser(MOBILE, task, record.checks));
    const tokens = record.viewports[0]?.tokens ?? {};
    record.tolerances = {
      snapTolerancePx: tokens["snap-tolerance"] ?? null,
      gridPx: tokens["canvas-grid"] ?? null,
    };
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
    process.stderr.write(`capture-snap: ${record.resultReason}\n`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const relative = join("reviews", "evidence", `${task}-snap-${slug}.json`);
  writeFileSync(join(REPO_ROOT, relative), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: ${relative}\n`);
  process.exitCode = record.exitCode;
}

await main();
