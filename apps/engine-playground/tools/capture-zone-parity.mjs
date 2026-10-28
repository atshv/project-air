#!/usr/bin/env node
// L08 (P4-29) deterministic zone-parity capture.
//
//   node apps/engine-playground/tools/capture-zone-parity.mjs [--task P4-29]
//
// One fresh headless Chrome per viewport (1440x900, 390x844) loads the layers
// scene with `?zoneParity=1`: the deterministic at-rest arrangement with its
// landing slot, the live release preview (dock -> detach -> dock), the cancel
// path (no operation, byte-identical snapshot) and one release (exactly one
// group operation with inverse). It also screenshots the read-only live demo
// (apps/web/preview) for the side-by-side evidence.

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
const REQUIRED = [
  "apps/engine-playground/main.js",
  "apps/web/preview/index.html",
  "packages/engine/dist/bridge/engine.js",
  "packages/engine/dist/bridge/input.js",
  "packages/engine/dist/bridge/overlay.js",
  "packages/engine/dist/bridge/zone-parity.js",
  "packages/engine/build-wasm/engine.js",
  "packages/engine/build-wasm/engine.wasm",
  "packages/ui-kit/tokens.css",
];
const FLAGS = ["--headless=new", "--use-angle=metal", "--enable-gpu", "--hide-scrollbars", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--window-size=1440,900", "--no-sandbox"];
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
let baseUrl = "";

function requireArtefacts() {
  const missing = REQUIRED.filter((relative) => !existsSync(join(REPO_ROOT, relative)));
  if (missing.length > 0) throw new Error(`missing build artefacts: ${missing.join(", ")}`);
}
function playgroundPort() {
  const slot = JSON.parse(readFileSync(join(REPO_ROOT, ".polier-slot"), "utf8"));
  const port = slot?.ports?.playground;
  if (!Number.isInteger(port)) throw new Error("the .polier-slot has no integer ports.playground");
  return port;
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
function startServer(port) {
  const server = createServer((request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const file = resolve(REPO_ROOT, `.${pathname}`);
      if (!file.startsWith(resolve(REPO_ROOT) + "/")) return response.writeHead(403).end("forbidden");
      response.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" });
      response.end(readFileSync(file));
    } catch {
      if (!response.headersSent) response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolveServer, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => resolveServer(server)); });
}
function findChrome() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (existsSync(PLAYWRIGHT_CACHE)) {
    for (const entry of readdirSync(PLAYWRIGHT_CACHE).sort()) {
      if (!entry.startsWith("chromium-")) continue;
      for (const arch of ["chrome-mac-arm64", "chrome-mac"]) candidates.push(join(PLAYWRIGHT_CACHE, entry, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error("no Chrome found; set CHROME_PATH");
}
async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}
async function waitDebug(port) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json`); if (response.ok) return response.json(); } catch { /* not yet */ }
    await delay(200);
  }
  throw new Error("the Chrome debug port did not open");
}
function client(socket) {
  let next = 0;
  const pending = new Map();
  const waiters = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (typeof message.id === "number" && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
    if (typeof message.method === "string" && waiters.has(message.method)) { const waiter = waiters.get(message.method); waiters.delete(message.method); waiter(message.params ?? {}); }
  });
  const send = (method, params = {}) => new Promise((resolveCall, reject) => {
    next += 1;
    const timer = setTimeout(() => { pending.delete(next); reject(new Error(`CDP call ${method} timed out`)); }, 15000);
    pending.set(next, (message) => { clearTimeout(timer); resolveCall(message); });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  send.waitForEvent = (method, timeoutMs = 20000) => new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => { waiters.delete(method); reject(new Error(`the ${method} event did not arrive`)); }, timeoutMs);
    waiters.set(method, (params) => { clearTimeout(timer); resolveEvent(params); });
  });
  return send;
}
async function evaluate(send, expression, awaitPromise = false) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (response.result?.exceptionDetails) throw new Error(`page evaluation failed: ${response.result.exceptionDetails.text}`);
  return response.result?.result?.value;
}
const asJson = (value) => (typeof value === "string" ? JSON.parse(value) : value);
async function waitReady(send) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await evaluate(send, "typeof globalThis.__enginePlayground === 'object'") === true) {
      const raw = await evaluate(send, "globalThis.__enginePlayground.ready.then((state) => JSON.stringify(state))", true);
      if (typeof raw === "string") { const state = JSON.parse(raw); if (state.ok === true) return state; throw new Error(state.error); }
    }
    await delay(250);
  }
  throw new Error("the playground did not become ready");
}
async function navigate(send, url, waitForReady = true) {
  const loaded = send.waitForEvent("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded.catch(() => undefined);
  if (!waitForReady) { await delay(1500); return null; }
  const ready = await waitReady(send);
  await delay(300);
  return ready;
}
async function mouse(send, type, point, extra = {}) {
  await send("Input.dispatchMouseEvent", { type, x: Math.round(point.x), y: Math.round(point.y), button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0, ...extra });
}
async function screenshot(send, file) {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const bytes = Buffer.from(String(shot.result?.data ?? ""), "base64");
  if (bytes.length === 0) throw new Error(`the screenshot ${file} was empty`);
  writeFileSync(join(EVIDENCE_DIR, file), bytes);
  return { file: `reviews/evidence/${file}`, bytes: bytes.length };
}
const STATE = `(() => { try { return JSON.stringify({
  parity: globalThis.__zoneParity.state(),
  snapshot: globalThis.__zoneParity.snapshot(),
  camera: globalThis.__enginePlayground.getState().camera,
  canvas: (() => { const b = document.querySelector("#canvas").getBoundingClientRect(); return { left: b.left, top: b.top }; })(),
  overlay: (() => {
    const layer = document.querySelector(".zone-parity-layer");
    const frame = document.querySelector(".zone-parity-frame");
    const slot = document.querySelector(".zone-parity-slot");
    return layer === null ? null : { hidden: layer.hidden, frame: frame ? frame.getBoundingClientRect().toJSON() : null, slot: slot && !slot.hidden ? slot.getBoundingClientRect().toJSON() : null };
  })(),
  inputPhase: globalThis.__engineInput?.phase?.() ?? null
}); } catch (error) { return JSON.stringify({ pageError: String((error && error.stack) || error) }); } })()`;
const state = async (send) => asJson(await evaluate(send, STATE));
const screenOf = (camera, canvas, world, dx = 0, dy = 0) => ({ x: canvas.left + (world.x + dx - camera.panX) * camera.zoom, y: canvas.top + (world.y + dy - camera.panY) * camera.zoom });
const insidePointFor = (stateNow, zoneNow, memberNow) => screenOf(stateNow.camera, stateNow.canvas, { x: zoneNow.world.x, y: zoneNow.world.y }, zoneNow.world.width / 2, zoneNow.world.height / 2);

async function captureViewport(send, viewport, checks) {
  const ready = await navigate(send, `${baseUrl}apps/engine-playground/?scene=layers&zoneParity=1&store=off`);
  if (ready.scene !== "layers") throw new Error(`expected layers, got ${ready.scene}`);
  const initial = await state(send);
  if (initial.parity === undefined) throw new Error(`page state: ${JSON.stringify(initial)}`);
  const restShot = await screenshot(send, `P4-29-zone-parity-rest-${viewport.name}.png`);
  const release = initial.parity.release;
  checks.push({
    name: `${viewport.name}: the at-rest arrangement is one group operation with a landing slot`,
    passed: release !== null && release.operation === "group" && release.inverse === "group" && release.children.includes("resizeZone") && initial.overlay !== null && initial.overlay.hidden === false && initial.overlay.slot !== null && initial.overlay.frame !== null,
    actual: { release, overlay: initial.overlay },
    expected: "one group (resizeZone + member moves) and a visible frame + landing slot",
  });

  const zone = initial.parity.zones.find((candidate) => candidate.members.cards.length + candidate.members.blocks.length >= 2) ?? initial.parity.zones[0];
  const memberId = zone.members.cards[0] ?? zone.members.blocks[0];
  const member = initial.parity.objects.find((object) => object.id === memberId);
  const zoneNow = initial.parity.objects.find((object) => object.id === zone.id);
  const from = screenOf(initial.camera, initial.canvas, member.world, member.world.width / 2, member.world.height / 2);
  const outPoint = screenOf(initial.camera, initial.canvas, zoneNow.world, zoneNow.world.width + 420, zoneNow.world.height + 300);
  await mouse(send, "mouseMoved", from, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", from);
  await delay(50);
  await mouse(send, "mouseMoved", insidePointFor(initial, zoneNow, member));
  await delay(80);
  await mouse(send, "mouseMoved", outPoint);
  await delay(150);
  const detached = await state(send);
  const previewShot = await screenshot(send, `P4-29-zone-parity-preview-${viewport.name}.png`);
  checks.push({
    name: `${viewport.name}: pulling the member out previews a detach and shrinks the frame`,
    passed: detached.parity.preview !== null && detached.parity.preview.inside === false && detached.parity.preview.shrinking === true && detached.parity.preview.landing === null,
    actual: detached.parity.preview,
    expected: "kind detach, shrinking true and no landing slot",
  });

  // Escape cancels the preview: no operation and the snapshot is unchanged.
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await delay(150);
  const cancelled = await state(send);
  checks.push({
    name: `${viewport.name}: Escape cancels the preview without an operation`,
    passed: cancelled.parity.preview === null && cancelled.snapshot === initial.snapshot,
    actual: { preview: cancelled.parity.preview, sameSnapshot: cancelled.snapshot === initial.snapshot },
    expected: "no preview state and a byte-identical working copy",
  });

  // One release: drag the member into the frame, then release -> one group op.
  const freshState = await state(send);
  const memberNow = freshState.parity.objects.find((object) => object.id === memberId);
  const zoneTarget = freshState.parity.objects.find((object) => object.id === zone.id);
  const start = screenOf(freshState.camera, freshState.canvas, memberNow.world, memberNow.world.width / 2, memberNow.world.height / 2);
  const inside = screenOf(freshState.camera, freshState.canvas, zoneTarget.world, zoneTarget.world.width / 2, zoneTarget.world.height / 2);
  await mouse(send, "mouseMoved", start, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", start);
  await delay(50);
  await mouse(send, "mouseMoved", inside);
  await delay(180);
  const docked = await state(send);
  await mouse(send, "mouseReleased", inside, { buttons: 0 });
  await delay(350);
  const released = await state(send);
  const moveShot = await screenshot(send, `P4-29-zone-parity-moved-${viewport.name}.png`);
  checks.push({
    name: `${viewport.name}: a release commits exactly one arrangement operation`,
    passed: docked.parity.preview !== null && docked.parity.preview.inside === true && released.parity.release !== null && released.parity.release.operation === "group" && released.parity.release.inverse === "group" && released.parity.preview === null,
    actual: { preview: docked.parity.preview?.kind, release: released.parity.release },
    expected: "a dock preview and one group operation with inverse",
  });

  // The read-only live demo for the side-by-side evidence.
  await navigate(send, new URL("apps/web/preview/index.html", baseUrl).toString(), false);
  const liveShot = await screenshot(send, `P4-29-live-demo-${viewport.name}.png`);
  checks.push({
    name: `${viewport.name}: the live-demo reference page loads for the side-by-side`,
    passed: liveShot.bytes > 1000,
    actual: liveShot,
    expected: "a non-empty live-demo screenshot",
  });

  return {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    arrangement: initial.parity.release,
    atRest: initial.parity,
    detach: detached.parity.preview,
    cancel: { preview: cancelled.parity.preview, sameSnapshot: cancelled.snapshot === initial.snapshot },
    dock: docked.parity.preview,
    release: released.parity.release,
    screenshots: [restShot, previewShot, moveShot, liveShot],
  };
}

async function withBrowser(viewport, checks) {
  const debugPort = await freePort();
  const userDataDir = join(tmpdir(), `p429-parity-${process.pid}-${viewport.name}`);
  const chrome = findChrome();
  let child = null;
  let socket = null;
  try {
    child = spawn(chrome, [...FLAGS, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, "about:blank"], { stdio: "ignore" });
    const targets = await waitDebug(debugPort);
    const target = targets.find((candidate) => candidate.type === "page");
    if (target === undefined) throw new Error("no page target in Chrome");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen) => socket.addEventListener("open", resolveOpen, { once: true }));
    const send = client(socket);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    await delay(300);
    return await captureViewport(send, viewport, checks);
  } finally {
    if (socket !== null) { try { await socket.send(JSON.stringify({ id: 999999, method: "Browser.close" })); } catch { /* closing */ } socket.close(); }
    if (child !== null) { child.kill("SIGTERM"); await new Promise((resolveExit) => { const timer = setTimeout(resolveExit, 3000); child.once("exit", () => { clearTimeout(timer); resolveExit(); }); }); }
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* temp */ }
  }
}

async function main() {
  const taskIndex = process.argv.indexOf("--task");
  const task = taskIndex >= 0 ? process.argv[taskIndex + 1] : "P4-29";
  if (task === undefined || !/^[A-Za-z0-9_.-]+$/.test(task)) throw new Error("--task needs a task id");
  requireArtefacts();
  const port = playgroundPort();
  baseUrl = `http://127.0.0.1:${port}/`;
  const server = await startServer(port);
  const record = { task, gate: "zone-parity-capture", startedAt: new Date().toISOString(), chrome: findChrome(), flags: FLAGS, viewports: [], checks: [], result: "fail", exitCode: 1 };
  try {
    for (const viewport of [DESKTOP, MOBILE]) record.viewports.push(await withBrowser(viewport, record.checks));
    const failures = record.checks.filter((check) => check.passed !== true);
    record.result = failures.length === 0 ? "pass" : "fail";
    record.exitCode = failures.length === 0 ? 0 : 1;
    for (const check of record.checks) process.stdout.write(`${check.passed ? "pass" : "FAIL"} ${check.name}${check.passed ? "" : ` (actual ${JSON.stringify(check.actual)})`}\n`);
  } catch (error) {
    record.result = "infra";
    record.resultReason = error instanceof Error ? error.message : String(error);
    record.exitCode = 3;
    process.stderr.write(`capture-zone-parity: ${record.resultReason}\n`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const relative = join("reviews", "evidence", `${task}-zone-parity-${slug}.json`);
  writeFileSync(join(REPO_ROOT, relative), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: ${relative}\n`);
  process.exitCode = record.exitCode;
}

await main();
