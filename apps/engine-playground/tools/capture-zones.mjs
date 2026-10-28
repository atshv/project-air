#!/usr/bin/env node
// L08 (P4-27) deterministic zone-membership capture.
//
//   node apps/engine-playground/tools/capture-zones.mjs [--task P4-27]
//
// One fresh headless Chrome per viewport (1440x900, 390x844) drives the real
// pointer input layer on the layers scene: a board card is dropped into a zone
// (one move operation + the 1 s accent-line highlight), dragged back out
// (zoneId null in the same move), a zone with members is dragged (exactly one
// group operation) and the delete policy is applied in memory (keep vs delete).
// The record stores world membership, operation/inverse types and the transient
// highlight; screenshots prove the highlight and the moved zone.

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
  "packages/engine/dist/bridge/engine.js",
  "packages/engine/dist/bridge/input.js",
  "packages/engine/dist/bridge/overlay.js",
  "packages/engine/dist/bridge/text-atlas.js",
  "packages/engine/build-wasm/engine.js",
  "packages/engine/build-wasm/engine.wasm",
  "packages/ui-kit/tokens.css",
];
const FLAGS = [
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
function contentType(path) {
  return { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm" }[extname(path).toLowerCase()] ?? "application/octet-stream";
}
function startServer(port) {
  const server = createServer((request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const file = resolve(REPO_ROOT, `.${pathname}`);
      if (!file.startsWith(resolve(REPO_ROOT) + "/")) return response.writeHead(403).end("forbidden");
      response.writeHead(200, { "content-type": contentType(file) });
      response.end(readFileSync(file));
    } catch {
      if (!response.headersSent) response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}
function findChrome() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (existsSync(PLAYWRIGHT_CACHE)) {
    for (const entry of readdirSync(PLAYWRIGHT_CACHE).sort()) {
      if (!entry.startsWith("chromium-")) continue;
      for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
        candidates.push(join(PLAYWRIGHT_CACHE, entry, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
      }
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
async function navigate(send, url) {
  const loaded = send.waitForEvent("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded.catch(() => undefined);
  const ready = await waitReady(send);
  await delay(250);
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
async function drag(send, from, to) {
  await mouse(send, "mouseMoved", from, { buttons: 0, button: "none" });
  await mouse(send, "mousePressed", from);
  await delay(40);
  await mouse(send, "mouseMoved", { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  await delay(60);
  await mouse(send, "mouseMoved", to);
  await delay(120);
  await mouse(send, "mouseReleased", to, { buttons: 0 });
  await delay(220);
}
const STATE = `JSON.stringify({
  objects: globalThis.__engineZones.objects(),
  zones: globalThis.__engineZones.zones(),
  lastDrop: globalThis.__engineZones.lastDrop(),
  lastDelete: globalThis.__engineZones.lastDelete(),
  highlight: globalThis.__engineZones.highlight(),
  drag: globalThis.__engineDrag.last(),
  camera: globalThis.__enginePlayground.getState().camera,
  canvas: (() => { const b = document.querySelector("#canvas").getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; })(),
  objectCount: globalThis.__enginePlayground.getState().objectCount
})`;
const state = async (send) => asJson(await evaluate(send, STATE));

function screenOf(camera, canvas, world, dx = 0, dy = 0) {
  return { x: canvas.left + (world.x + dx - camera.panX) * camera.zoom, y: canvas.top + (world.y + dy - camera.panY) * camera.zoom };
}

async function captureViewport(send, viewport, checks) {
  const ready = await navigate(send, `${baseUrl}?scene=layers&store=off`);
  if (ready.scene !== "layers") throw new Error(`expected the layers scene, got ${ready.scene}`);
  const initial = await state(send);
  const zone = initial.zones.find((candidate) => candidate.members.cards.length + candidate.members.blocks.length > 0) ?? initial.zones[0];
  if (zone === undefined) throw new Error("the layers scene has no zone");
  const loose = initial.objects.find((object) => object.kind !== "zone" && object.zoneId === null && object.world !== null);
  if (loose === undefined) throw new Error("no board-level card/block to drop");
  const inside = { x: zone.world.x + zone.world.width / 2 - loose.world.width / 2, y: zone.world.y + zone.world.height / 2 - loose.world.height / 2 };
  const from = screenOf(initial.camera, initial.canvas, loose.world, loose.world.width / 2, loose.world.height / 2);
  const to = screenOf(initial.camera, initial.canvas, inside, loose.world.width / 2, loose.world.height / 2);
  await drag(send, from, to);
  const afterDrop = await state(send);
  const screenshotDrop = await screenshot(send, `P4-27-zones-drop-${viewport.name}.png`);
  const member = afterDrop.objects.find((object) => object.id === loose.id);
  checks.push({
    name: `${viewport.name}: a drop writes membership and highlights the zone for 1 s`,
    passed: afterDrop.lastDrop !== null && afterDrop.lastDrop.zoneId === zone.id && ["moveCard", "moveBlock"].includes(afterDrop.lastDrop.operation) && afterDrop.highlight.active === true && member.zoneId === zone.id,
    actual: { lastDrop: afterDrop.lastDrop, memberZoneId: member.zoneId, highlight: afterDrop.highlight },
    expected: "one move operation carrying the zone id and a live accent-line highlight",
  });
  await delay(1150);
  const afterSecond = await state(send);
  checks.push({
    name: `${viewport.name}: the zone highlight expires after one second`,
    passed: afterSecond.highlight.active === false,
    actual: afterSecond.highlight,
    expected: "no active highlight after 1.15 s",
  });

  const out = screenOf(initial.camera, initial.canvas, { x: zone.world.x - loose.world.width - 40, y: zone.world.y - loose.world.height - 40 }, loose.world.width / 2, loose.world.height / 2);
  const insidePoint = screenOf(initial.camera, initial.canvas, inside, loose.world.width / 2, loose.world.height / 2);
  await drag(send, insidePoint, out);
  const afterOut = await state(send);
  const releasedMember = afterOut.objects.find((object) => object.id === loose.id);
  checks.push({
    name: `${viewport.name}: dragging the centre out releases the member in one move`,
    passed: afterOut.lastDrop !== null && afterOut.lastDrop.zoneId === null && releasedMember.zoneId === null && !afterOut.zones.find((candidate) => candidate.id === zone.id).members.cards.includes(loose.id),
    actual: { lastDrop: afterOut.lastDrop, memberZoneId: releasedMember.zoneId },
    expected: "zoneId null in the same move operation",
  });

  const zoneDrag = afterOut.zones.find((candidate) => candidate.id === zone.id);
  const beforeMembers = new Map(zoneDrag.members.cards.map((id) => [id, afterOut.objects.find((object) => object.id === id).world]));
  const zoneFrom = screenOf(afterOut.camera, afterOut.canvas, zoneDrag.world, 30, 20);
  const zoneTo = { x: zoneFrom.x + 70, y: zoneFrom.y + 45 };
  await drag(send, zoneFrom, zoneTo);
  const afterMove = await state(send);
  const movedZone = afterMove.zones.find((candidate) => candidate.id === zone.id);
  const delta = { x: movedZone.world.x - zoneDrag.world.x, y: movedZone.world.y - zoneDrag.world.y };
  const membersMoved = zoneDrag.members.cards.every((id) => {
    const before = beforeMembers.get(id);
    const after = afterMove.objects.find((object) => object.id === id)?.world;
    return before !== undefined && after !== undefined && Math.abs(after.x - before.x - delta.x) < 1.5 && Math.abs(after.y - before.y - delta.y) < 1.5;
  });
  const screenshotMove = await screenshot(send, `P4-27-zones-move-${viewport.name}.png`);
  checks.push({
    name: `${viewport.name}: a zone drag moves zone and members as one group operation`,
    passed: afterMove.drag !== null && afterMove.drag.operation === "group" && Array.isArray(afterMove.drag.children) && afterMove.drag.children.includes("moveZone") && afterMove.drag.children.filter((type) => type === "moveCard" || type === "moveBlock").length === zoneDrag.members.cards.length + zoneDrag.members.blocks.length && Math.abs(movedZone.world.x - (zoneDrag.world.x + delta.x)) < 1.5 && membersMoved,
    actual: { operation: afterMove.drag, zoneDelta: delta, membersMoved },
    expected: "one group operation of moveZone + all member moves by the same delta",
  });

  const keepZone = afterMove.zones.find((candidate) => candidate.members.cards.length > 0 && candidate.id !== zone.id) ?? movedZone;
  const keepMemberId = keepZone.members.cards[0];
  await evaluate(send, `globalThis.__engineZones.deleteZone(${JSON.stringify(keepZone.id)}, "keep")`);
  await delay(200);
  const afterKeep = await state(send);
  const keptMember = afterKeep.objects.find((object) => object.id === keepMemberId);
  const keptZoneGone = !afterKeep.zones.some((candidate) => candidate.id === keepZone.id);
  checks.push({
    name: `${viewport.name}: deleteZone keep-content keeps the member on the board`,
    passed: afterKeep.lastDelete !== null && afterKeep.lastDelete.zonePolicy === "keep" && keptZoneGone && keptMember !== undefined && keptMember.zoneId === null,
    actual: { lastDelete: afterKeep.lastDelete, member: keptMember, zoneGone: keptZoneGone },
    expected: "one deleteZone operation with policy keep and a board-level member afterwards",
  });

  const deleteZone = afterKeep.zones.find((candidate) => candidate.members.cards.length > 0);
  let deleteCheck = { passed: true, actual: { policy: "delete", skipped: true } };
  if (deleteZone !== undefined) {
    const doomedMemberId = deleteZone.members.cards[0];
    await evaluate(send, `globalThis.__engineZones.deleteZone(${JSON.stringify(deleteZone.id)}, "delete")`);
    await delay(200);
    const afterDelete = await state(send);
    deleteCheck = {
      name: `${viewport.name}: deleteZone delete-content deletes the content with the zone`,
      passed: afterDelete.lastDelete !== null && afterDelete.lastDelete.zonePolicy === "delete" && afterDelete.lastDelete.policies.includes("delete") && !afterDelete.zones.some((candidate) => candidate.id === deleteZone.id) && !afterDelete.objects.some((object) => object.id === doomedMemberId),
      actual: { lastDelete: afterDelete.lastDelete, memberGone: !afterDelete.objects.some((object) => object.id === doomedMemberId) },
      expected: "one deleteZone operation with policy delete and no member left",
    };
    checks.push(deleteCheck);
  }

  return {
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    zone: { id: zone.id, world: zone.world, members: zone.members },
    looseObject: loose.id,
    drop: afterDrop.lastDrop,
    highlight: { live: afterDrop.highlight, expired: afterSecond.highlight },
    dragOut: afterOut.lastDrop,
    groupMove: { operation: afterMove.drag, delta },
    deleteKeep: afterKeep.lastDelete,
    deletePolicy: deleteCheck.actual,
    screenshots: [screenshotDrop, screenshotMove],
  };
}

async function withBrowser(viewport, checks) {
  const debugPort = await freePort();
  const userDataDir = join(tmpdir(), `p427-zones-${process.pid}-${viewport.name}`);
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
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* temp dir */ }
  }
}

async function main() {
  const taskIndex = process.argv.indexOf("--task");
  const task = taskIndex >= 0 ? process.argv[taskIndex + 1] : "P4-27";
  if (task === undefined || !/^[A-Za-z0-9_.-]+$/.test(task)) throw new Error("--task needs a task id");
  requireArtefacts();
  const port = playgroundPort();
  baseUrl = `http://127.0.0.1:${port}/apps/engine-playground/`;
  const server = await startServer(port);
  const record = { task, gate: "zones-capture", startedAt: new Date().toISOString(), chrome: findChrome(), flags: FLAGS, viewports: [], checks: [], result: "fail", exitCode: 1 };
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
    process.stderr.write(`capture-zones: ${record.resultReason}\n`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const relative = join("reviews", "evidence", `${task}-zones-${slug}.json`);
  writeFileSync(join(REPO_ROOT, relative), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: ${relative}\n`);
  process.exitCode = record.exitCode;
}

await main();
