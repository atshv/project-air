#!/usr/bin/env node
// L03 (P4-14) browser check for the pointer input layer.
//
//   node apps/engine-playground/tools/input-check.mjs [--task P4-14]
//
// Starts its own static server on the slot playground port and headless Chrome
// for Testing with the documented WebGL2 flags, then drives real trusted pointer
// and wheel events through the DevTools protocol against the playground:
//
//   layers  — a card-body drag commits exactly one `moveCard` operation (proved
//             by the L13 evidence hook's undo returning that operation); a block
//             body below the header and a field/scroll demo start no drag;
//             hovering a block/zone header reveals the `--faint` DOM band; the
//             scroll area keeps its own wheel (the camera does not zoom).
//   titles  — hovering a gallery card reveals its quiet delete affordance.
//
// Writes `reviews/evidence/<task>-input-<timestamp>.json` with every probe, the
// camera before/after and the token numbers; exit codes: 0 pass, 1 assertion
// failed, 2 usage/build, 3 infra (no Chrome, page not ready, port busy). It
// starts and stops only its own server and browser and removes its temp folder.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVIDENCE_DIR = join(REPO_ROOT, "reviews", "evidence");
const PLAYWRIGHT_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");

const DESKTOP = { width: 1440, height: 900 };
const BASE_URL = "http://127.0.0.1:4160/apps/engine-playground/";

const CHROME_FLAGS = [
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

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function parseTask(argv) {
  const index = argv.indexOf("--task");
  if (index < 0) {
    return "P4-14";
  }
  const task = argv[index + 1];
  if (task === undefined || task.startsWith("--") || !/^[A-Za-z0-9_.-]+$/.test(task)) {
    throw new Error("--task needs a task id such as P4-14");
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
    case ".png":
      return "image/png";
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
          ? new Error(`port ${port} is already in use; rerun the check alone`)
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
          join(PLAYWRIGHT_CACHE, entry, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
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
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  return (method, params = {}) =>
    new Promise((resolveCall) => {
      nextId += 1;
      pending.set(nextId, resolveCall);
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
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
    }
    await delay(250);
  }
  throw new Error("the playground did not become ready");
}

const WORLD_TO_SCREEN = (worldX, worldY) => `(() => {
  const canvas = document.querySelector("#canvas");
  const state = globalThis.__enginePlayground.getState();
  const bounds = canvas.getBoundingClientRect();
  return {
    x: bounds.left + (${worldX} - state.camera.panX) * state.camera.zoom,
    y: bounds.top + (${worldY} - state.camera.panY) * state.camera.zoom
  };
})()`;

async function navigate(send, url) {
  // `Page.navigate` resolves before the new document exists; wait until the new
  // document's `performance.timeOrigin` differs from the old one, otherwise the
  // probes would race the old execution context (and read a stale ready hook).
  const previousOrigin = await evaluate(send, "performance.timeOrigin");
  await send("Page.navigate", { url: `${BASE_URL}${url}` });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const origin = await evaluate(send, "performance.timeOrigin").catch(() => null);
    if (typeof origin === "number" && origin !== previousOrigin) {
      break;
    }
    await delay(100);
  }
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

async function drag(send, from, deltaX, deltaY) {
  await mouse(send, "mouseMoved", from, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", from);
  await delay(40);
  await mouse(send, "mouseMoved", { x: from.x + deltaX / 2, y: from.y + deltaY / 2 });
  await delay(40);
  await mouse(send, "mouseMoved", { x: from.x + deltaX, y: from.y + deltaY });
  await delay(40);
  await mouse(send, "mouseReleased", { x: from.x + deltaX, y: from.y + deltaY }, { buttons: 0 });
  await delay(120);
}

async function click(send, point) {
  await mouse(send, "mouseMoved", point, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", point);
  await delay(30);
  await mouse(send, "mouseReleased", point, { buttons: 0 });
  await delay(120);
}

async function runCheck(send, record, name, probe) {
  try {
    const result = await probe();
    record.checks.push({ name, passed: result.passed, actual: result.actual, expected: result.expected });
    process.stdout.write(`${result.passed ? "pass" : "FAIL"} ${name}${result.passed ? "" : ` (expected ${JSON.stringify(result.expected)}, actual ${JSON.stringify(result.actual)})`}\n`);
  } catch (error) {
    record.checks.push({ name, passed: false, actual: String(error), expected: "no error" });
    process.stdout.write(`FAIL ${name}: ${String(error)}\n`);
  }
}

async function main() {
  const task = parseTask(process.argv.slice(2));
  requireArtefacts();
  const port = playgroundPort();
  const server = await startStaticServer(port);
  const debugPort = await getFreePort();
  const chrome = findChrome();
  const userDataDir = join(tmpdir(), `p414-input-${process.pid}`);
  const record = { task, gate: "input", startedAt: new Date().toISOString(), chrome, flags: CHROME_FLAGS, checks: [], tokens: null, camera: {}, result: "fail", exitCode: 1 };
  let child = null;
  let socket = null;
  try {
    child = spawn(chrome, [...CHROME_FLAGS, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, `${BASE_URL}?scene=layers&store=off`], { stdio: "ignore" });
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
    await send("Emulation.setDeviceMetricsOverride", { width: DESKTOP.width, height: DESKTOP.height, deviceScaleFactor: 1, mobile: false });
    await delay(400);

    // --- layers: card body drag commits one move operation -------------------
    let ready = await navigate(send, "?scene=layers&store=off");
    record.tokens = await evaluate(send, "JSON.stringify(globalThis.__engineInput.tokens())");
    record.camera.before = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
    const cardPoint = await evaluate(send, WORLD_TO_SCREEN(400, 288)); // card-0002 body
    await drag(send, cardPoint, 48, 24);
    const undo = await evaluate(send, "JSON.stringify(globalThis.__engineLayers.undo())");
    const pair = undo === undefined ? null : JSON.parse(undo);
    await runCheck(send, record, "a card-body drag commits exactly one moveCard operation", async () => ({
      passed: pair !== null && pair.operation?.type === "moveCard" && pair.inverse?.type === "moveCard",
      expected: "moveCard with a moveCard inverse",
      actual: pair === null ? null : { operation: pair.operation?.type, inverse: pair.inverse?.type },
    }));
    const cameraAfterDrag = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
    await runCheck(send, record, "a card drag moves the object, not the camera", async () => ({
      passed: JSON.stringify(cameraAfterDrag) === JSON.stringify(record.camera.before),
      expected: record.camera.before,
      actual: cameraAfterDrag,
    }));
    record.camera.afterDrag = cameraAfterDrag;

    // --- layers: block header drag commits one moveBlock ---------------------
    ready = await navigate(send, "?scene=layers&store=off");
    const headerPoint = await evaluate(send, WORLD_TO_SCREEN(132, 148)); // block-0001 header band
    await drag(send, headerPoint, 32, 16);
    const blockUndo = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__engineLayers.undo())"));
    await runCheck(send, record, "a block-header drag commits exactly one moveBlock operation", async () => ({
      passed: blockUndo?.operation?.type === "moveBlock",
      expected: "moveBlock",
      actual: blockUndo?.operation?.type ?? null,
    }));

    // --- layers: block body below the header moves nothing -------------------
    ready = await navigate(send, "?scene=layers&store=off");
    const bodyPoint = await evaluate(send, WORLD_TO_SCREEN(132, 200)); // block-0001 body
    const beforeBody = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
    await drag(send, bodyPoint, 40, 20);
    const afterBody = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
    const bodyUndoRaw = await evaluate(send, "JSON.stringify(globalThis.__engineLayers.undo())");
    const bodyUndo = bodyUndoRaw === undefined ? undefined : JSON.parse(bodyUndoRaw);
    await runCheck(send, record, "a block body drag moves nothing (no op, no pan)", async () => ({
      passed: bodyUndo === null && JSON.stringify(beforeBody) === JSON.stringify(afterBody),
      expected: "no undo entry and an unchanged camera",
      actual: { undo: bodyUndo, cameraSame: JSON.stringify(beforeBody) === JSON.stringify(afterBody) },
    }));

    // --- layers: header hover surface after the 120 ms token -----------------
    const headerHoverPoint = await evaluate(send, WORLD_TO_SCREEN(132, 148));
    await mouse(send, "mouseMoved", headerHoverPoint, { buttons: 0, button: "none" });
    await delay(250);
    const hoverState = JSON.parse(await evaluate(send, `JSON.stringify({
      hover: globalThis.__engineInput.hover(),
      cursor: globalThis.__engineInput.cursor(),
      surface: (() => {
        const surface = document.querySelector("#header-surface");
        return { visible: surface.classList.contains("is-visible"), opacity: getComputedStyle(surface).opacity };
      })()
    })`));
    await runCheck(send, record, "hovering a block header shows the faint band after 120 ms", async () => ({
      passed: hoverState.hover?.header === true && hoverState.hover?.grip === true && hoverState.cursor === "grab" && hoverState.surface.visible === true && Number(hoverState.surface.opacity) === 1,
      expected: { header: true, grip: true, cursor: "grab", visible: true, opacity: 1 },
      actual: hoverState,
    }));

    // --- layers: input demo suppression -------------------------------------
    ready = await navigate(send, "?scene=layers&store=off&input=demo");
    const fieldPoint = await evaluate(send, `(() => {
      const field = document.querySelector(".input-demo__input");
      const bounds = field.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`);
    const cameraBeforeField = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
    await drag(send, fieldPoint, 40, 20);
    const fieldState = JSON.parse(await evaluate(send, `JSON.stringify({
      phase: globalThis.__engineInput.phase(),
      active: document.activeElement?.className ?? null,
      camera: globalThis.__enginePlayground.getState().camera,
      undo: (() => { try { return globalThis.__engineLayers.undo(); } catch { return "error"; } })()
    })`));
    await runCheck(send, record, "a field press starts no drag and writes nothing", async () => ({
      passed: fieldState.undo === null && JSON.stringify(fieldState.camera) === JSON.stringify(cameraBeforeField),
      expected: "no history entry and an unchanged camera",
      actual: fieldState,
    }));

    const scrollPoint = await evaluate(send, `(() => {
      const scroll = document.querySelector(".input-demo__scroll");
      const bounds = scroll.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`);
    const cameraBeforeScroll = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(scrollPoint.x), y: Math.round(scrollPoint.y), deltaX: 0, deltaY: 120, button: "none", buttons: 0 });
    await delay(150);
    const scrollState = JSON.parse(await evaluate(send, `JSON.stringify({
      scrollTop: document.querySelector(".input-demo__scroll").scrollTop,
      camera: globalThis.__enginePlayground.getState().camera
    })`));
    await runCheck(send, record, "the scroll area keeps its wheel and the camera does not zoom", async () => ({
      passed: scrollState.scrollTop > 0 && JSON.stringify(scrollState.camera) === JSON.stringify(cameraBeforeScroll),
      expected: "scrollTop > 0 and an unchanged camera",
      actual: scrollState,
    }));

    // --- titles: hover reveals the quiet delete affordance -------------------
    ready = await navigate(send, "?text=titles&view=512,288,1");
    const titlesPoint = await evaluate(send, WORLD_TO_SCREEN(400, 288));
    await mouse(send, "mouseMoved", titlesPoint, { buttons: 0, button: "none" });
    await delay(200);
    const titlesState = JSON.parse(await evaluate(send, `JSON.stringify({
      hover: globalThis.__engineInput.hover(),
      visibleControls: [...document.querySelectorAll(".object-action")].filter((button) => Number(getComputedStyle(button).opacity) > 0.5).length
    })`));
    await runCheck(send, record, "the titles gallery hover still reveals its delete affordance", async () => ({
      passed: titlesState.hover?.target !== null && titlesState.visibleControls >= 1,
      expected: "a hover target and at least one visible control",
      actual: titlesState,
    }));

    // --- sample: the packed-rectangle scene gets the same drag session -----
    ready = await navigate(send, "?scene=sample");
    const sampleCardPoint = await evaluate(send, `(() => {
      const canvas = document.querySelector("#canvas");
      const targetAt = globalThis.__engineDrag?.targetAt;
      if (typeof targetAt !== "function") return null;
      for (let y = 20; y < canvas.clientHeight; y += 20) {
        for (let x = 20; x < canvas.clientWidth; x += 20) {
          const hit = targetAt(x, y);
          if (hit !== null && hit.kind === "card") {
            const bounds = canvas.getBoundingClientRect();
            return { x: bounds.left + x, y: bounds.top + y };
          }
        }
      }
      return null;
    })()`);
    const sampleCameraBefore = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
    await drag(send, sampleCardPoint, 50, 25);
    const sampleState = JSON.parse(await evaluate(send, `JSON.stringify({
      last: globalThis.__engineDrag.last(),
      camera: globalThis.__enginePlayground.getState().camera
    })`));
    await runCheck(send, record, "a sample-scene card drag commits one moveCard without panning", async () => ({
      passed: sampleState.last?.operation === "moveCard" && JSON.stringify(sampleState.camera) === JSON.stringify(sampleCameraBefore),
      expected: "moveCard and an unchanged camera",
      actual: sampleState,
    }));

    // --- sample: a click below the threshold writes nothing ------------------
    ready = await navigate(send, "?scene=sample");
    const clickPoint = await evaluate(send, `(() => {
      const canvas = document.querySelector("#canvas");
      const targetAt = globalThis.__engineDrag?.targetAt;
      for (let y = 20; y < canvas.clientHeight; y += 20) {
        for (let x = 20; x < canvas.clientWidth; x += 20) {
          const hit = targetAt(x, y);
          if (hit !== null && hit.kind === "card") {
            const bounds = canvas.getBoundingClientRect();
            return { x: bounds.left + x, y: bounds.top + y };
          }
        }
      }
      return null;
    })()`);
    await click(send, clickPoint);
    const clickState = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__engineDrag.last())"));
    await runCheck(send, record, "a click below the threshold writes no operation", async () => ({
      passed: clickState === null,
      expected: null,
      actual: clickState,
    }));

    // --- sample: dragging empty canvas pans the view, never the document ----
    ready = await navigate(send, "?scene=sample");
    const emptyPoint = await evaluate(send, `(() => {
      const canvas = document.querySelector("#canvas");
      const targetAt = globalThis.__engineDrag?.targetAt;
      for (let y = 10; y < canvas.clientHeight; y += 20) {
        for (let x = 10; x < canvas.clientWidth; x += 20) {
          if (targetAt(x, y) === null) {
            const bounds = canvas.getBoundingClientRect();
            return { x: bounds.left + x, y: bounds.top + y };
          }
        }
      }
      return null;
    })()`);
    const panCameraBefore = JSON.parse(await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
    await drag(send, emptyPoint, 40, 30);
    const panState = JSON.parse(await evaluate(send, `JSON.stringify({
      last: globalThis.__engineDrag.last(),
      camera: globalThis.__enginePlayground.getState().camera
    })`));
    await runCheck(send, record, "dragging empty canvas pans the view and writes nothing", async () => ({
      passed: panState.last === null && JSON.stringify(panState.camera) !== JSON.stringify(panCameraBefore),
      expected: "no operation and a moved camera",
      actual: { last: panState.last, cameraChanged: JSON.stringify(panState.camera) !== JSON.stringify(panCameraBefore) },
    }));

    const failures = record.checks.filter((check) => check.passed !== true);
    record.result = failures.length === 0 ? "pass" : "fail";
    record.exitCode = failures.length === 0 ? 0 : 1;
  } catch (error) {
    record.result = "infra";
    record.resultReason = error instanceof Error ? error.message : String(error);
    record.exitCode = 3;
    process.stderr.write(`input-check: ${record.resultReason}\n`);
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
    rmSync(userDataDir, { recursive: true, force: true });
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const relative = join("reviews", "evidence", `${task}-input-${slug}.json`);
  writeFileSync(join(REPO_ROOT, relative), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: ${relative}\n`);
  process.exitCode = record.exitCode;
}

await main();
