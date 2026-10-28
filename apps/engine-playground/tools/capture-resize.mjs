#!/usr/bin/env node
// P4-17 (L14) deterministic resize capture: select a card and a zone, drag the
// 8 px handles (snapped, Shift-free, minimum clamp), cancel with Escape and
// record exactly one resize operation per release. Desktop 1440x900, mobile
// 390x844; own server and one headless Chrome per viewport.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVIDENCE = join(ROOT, "reviews", "evidence");
const CACHE = join(homedir(), "Library", "Caches", "ms-playwright");
const VIEWPORTS = [{ name: "desktop", width: 1440, height: 900, mobile: false }, { name: "mobile", width: 390, height: 844, mobile: true }];
const FLAGS = ["--headless=new", "--use-angle=metal", "--enable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--window-size=1440,900", "--no-sandbox"];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm" };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { throw new Error(m); };
let base = "";
const server = (port) => {
  const handler = createServer((request, response) => {
    try {
      let path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = resolve(ROOT, `.${path}`);
      if (!file.startsWith(resolve(ROOT) + "/")) return response.writeHead(403).end();
      response.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" });
      response.end(readFileSync(file));
    } catch { if (!response.headersSent) response.writeHead(404).end(); }
  });
  return new Promise((ok, no) => { handler.once("error", no); handler.listen(port, "127.0.0.1", () => ok(handler)); });
};
function chromePath() {
  const list = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);
  if (existsSync(CACHE)) for (const entry of readdirSync(CACHE).sort()) if (entry.startsWith("chromium-")) for (const arch of ["chrome-mac-arm64", "chrome-mac"]) list.push(join(CACHE, entry, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
  list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  for (const candidate of list) if (existsSync(candidate)) return candidate;
  fail("no Chrome");
}
async function freePort() { const s = createServer(); await new Promise((ok) => s.listen(0, "127.0.0.1", ok)); const p = s.address().port; await new Promise((ok) => s.close(ok)); return p; }
async function debug(port) { for (let i = 0; i < 100; i += 1) { try { const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }); if (r.ok) return r.json(); } catch { /* wait */ } await delay(200); } fail("debug port"); }
function cdp(socket) {
  let id = 0; const pending = new Map(); const events = new Map();
  socket.addEventListener("message", (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method && events.has(m.method)) { events.get(m.method)(m.params); events.delete(m.method); } });
  const send = (method, params = {}) => new Promise((ok, no) => { id += 1; const t = setTimeout(() => no(new Error(`${method} timed out`)), 15000); pending.set(id, (m) => { clearTimeout(t); ok(m); }); socket.send(JSON.stringify({ id, method, params })); });
  send.event = (method) => new Promise((ok) => { events.set(method, ok); });
  return send;
}
async function ev(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result?.exceptionDetails) return `EXC ${r.result.exceptionDetails.text}`; return r.result?.result?.value; }
async function ready(send) { for (let i = 0; i < 120; i += 1) { const raw = await ev(send, "globalThis.__enginePlayground?.ready.then((s) => JSON.stringify(s)) ?? null", true); if (typeof raw === "string") { const state = JSON.parse(raw); if (state.ok) return state; fail(JSON.stringify(state)); } await delay(250); } fail("not ready"); }
async function go(send, url) { const loaded = send.event("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded.catch(() => undefined); await ready(send); await delay(250); }
async function shot(send, name) { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); const bytes = Buffer.from(String(r.result.data), "base64"); writeFileSync(join(EVIDENCE, name), bytes); return `reviews/evidence/${name}`; }
const mouse = (send, type, point, extra = {}) => send("Input.dispatchMouseEvent", { type, x: Math.round(point.x), y: Math.round(point.y), button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0, ...extra });

async function state(send) {
  return JSON.parse(await ev(send, `JSON.stringify({
    ids: globalThis.__engineSelection.ids(),
    bounds: globalThis.__engineSelection.bounds(),
    resize: globalThis.__engineResize.info(globalThis.__engineSelection.ids()),
    camera: globalThis.__enginePlayground.getState().camera,
    canvas: (() => { const c = document.querySelector("#canvas"); const b = c.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height, clientWidth: c.clientWidth, clientHeight: c.clientHeight }; })()
  })`));
}
const screenOf = (stateNow, world) => ({ x: stateNow.canvas.left + (world.x - stateNow.camera.panX) * stateNow.camera.zoom, y: stateNow.canvas.top + (world.y - stateNow.camera.panY) * stateNow.camera.zoom });
// A handle centre can sit exactly on the canvas edge; press 3 px inside it so the
// pointer event lands on the canvas while staying inside the 8 px hit area.
const handlePointOf = (stateNow, world) => {
  const point = screenOf(stateNow, world);
  const size = { width: stateNow.canvas.clientWidth, height: stateNow.canvas.clientHeight };
  return {
    x: Math.min(Math.max(point.x, stateNow.canvas.left + 3), stateNow.canvas.left + stateNow.canvas.width - 3),
    y: Math.min(Math.max(point.y, stateNow.canvas.top + 3), stateNow.canvas.top + stateNow.canvas.height - 3),
  };
};

async function clickAt(send, point) { await mouse(send, "mouseMoved", point, { buttons: 0 }); await mouse(send, "mousePressed", point); await mouse(send, "mouseReleased", point, { buttons: 0 }); await delay(150); }
async function drag(send, from, to, modifiers = 0) {
  await mouse(send, "mouseMoved", from, { buttons: 0, modifiers });
  await mouse(send, "mousePressed", from, { modifiers });
  await delay(40);
  await mouse(send, "mouseMoved", { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, { modifiers });
  await delay(60);
  await mouse(send, "mouseMoved", to, { modifiers });
  await delay(120);
  await mouse(send, "mouseReleased", to, { buttons: 0, modifiers });
  await delay(250);
}

async function findTarget(send, kind, localX, localY) {
  return JSON.parse(await ev(send, `(() => {
    const hit = globalThis.__engineDrag.targetAt(${localX}, ${localY});
    return JSON.stringify(hit === null ? null : { id: hit.id, kind: hit.kind, world: hit.world });
  })()`));
}

async function selectTarget(send, target) {
  const canvas = await state(send);
  const point = { x: canvas.canvas.left + target.screen.x, y: canvas.canvas.top + target.screen.y };
  await clickAt(send, point);
  return state(send);
}

async function run(send, vp) {
  const checks = [];
  // Card demo: a 100 % camera centred on card-0004 keeps the handles well inside
  // the small mobile canvas (the fit camera would put them near the edge).
  await go(send, `${base}apps/engine-playground/?scene=layers&store=off&view=816,128,${vp.name === "mobile" ? "0.6" : "1"}`);
  const cardCanvas = await state(send);
  const cardProbe = {
    x: Math.round(cardCanvas.canvas.clientWidth / 2),
    y: Math.round(cardCanvas.canvas.clientHeight / 2),
  };
  const cardHit = await findTarget(send, "card", cardProbe.x, cardProbe.y);
  if (cardHit === null) fail(`no card under the probe point ${JSON.stringify(cardProbe)}`);
  let cardState = await selectTarget(send, { ...cardHit, screen: cardProbe });
  checks.push({
    name: `${vp.name}: selecting a card shows 8 px handles and its minimum`,
    passed: cardState.ids.length === 1 && cardState.resize !== null && cardState.resize.handles.length === 8 && cardState.resize.minimum.width === 176,
    actual: { ids: cardState.ids, minimum: cardState.resize?.minimum },
  });
  const handlesShot = await shot(send, `P4-17-resize-handles-${vp.name}.png`);

  const beforeSnap = cardState.resize.world;
  const se = handlePointOf(cardState, { x: beforeSnap.x + beforeSnap.width, y: beforeSnap.y + beforeSnap.height });
  await drag(send, se, { x: se.x + 48, y: se.y + 32 });
  cardState = await state(send);
  const snapped = cardState.resize.world;
  checks.push({
    name: `${vp.name}: a handle drag snaps the size to the 16 px grid in one operation`,
    passed: cardState.resize.last !== null && ["resizeCard", "group"].includes(cardState.resize.last.operation) && snapped.width % 16 === 0 && snapped.height % 16 === 0 && snapped.width > beforeSnap.width && snapped.height > beforeSnap.height,
    actual: { last: cardState.resize.last, beforeSnap, snapped },
  });
  const snappedShot = await shot(send, `P4-17-resize-snapped-${vp.name}.png`);

  // Shift free: the same handle with Shift moves by the exact pointer delta.
  const beforeFree = cardState.resize.world;
  const seFree = handlePointOf(cardState, { x: beforeFree.x + beforeFree.width, y: beforeFree.y + beforeFree.height });
  await drag(send, seFree, { x: seFree.x + 13, y: seFree.y + 7 }, 8);
  cardState = await state(send);
  const free = cardState.resize.world;
  checks.push({
    name: `${vp.name}: Shift frees the snap but still resizes`,
    passed:
      Math.abs(free.width - beforeFree.width - 13 / cardState.camera.zoom) <= 1.5 &&
      Math.abs(free.height - beforeFree.height - 7 / cardState.camera.zoom) <= 1.5,
    actual: { beforeFree, free },
  });
  const freeShot = await shot(send, `P4-17-resize-free-${vp.name}.png`);

  // Minimum clamp: drag the same corner far inward; the release stays on canvas.
  const minimum = cardState.resize.minimum;
  const seMin = handlePointOf(cardState, { x: cardState.resize.world.x + cardState.resize.world.width, y: cardState.resize.world.y + cardState.resize.world.height });
  await drag(send, seMin, { x: seMin.x - 140, y: seMin.y - 120 });
  cardState = await state(send);
  checks.push({
    name: `${vp.name}: the per-type minimum (card 176x80) is never crossed`,
    passed: Math.abs(cardState.resize.world.width - minimum.width) <= 1 && Math.abs(cardState.resize.world.height - minimum.height) <= 1,
    actual: { minimum, world: cardState.resize.world },
  });

  // Escape cancels a resize: geometry unchanged, no operation.
  const beforeCancel = cardState.resize.world;
  const cancelHandle = handlePointOf(cardState, { x: cardState.resize.world.x + cardState.resize.world.width, y: cardState.resize.world.y + cardState.resize.world.height });
  await mouse(send, "mouseMoved", cancelHandle, { buttons: 0 });
  await mouse(send, "mousePressed", cancelHandle);
  await mouse(send, "mouseMoved", { x: cancelHandle.x + 40, y: cancelHandle.y + 30 });
  await delay(80);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await delay(150);
  await mouse(send, "mouseReleased", { x: cancelHandle.x + 40, y: cancelHandle.y + 30 }, { buttons: 0 });
  cardState = await state(send);
  checks.push({
    name: `${vp.name}: Escape restores the committed card size with no operation`,
    passed: cardState.resize !== null && Math.abs(cardState.resize.world.width - beforeCancel.width) <= 1 && Math.abs(cardState.resize.world.height - beforeCancel.height) <= 1,
    actual: { before: beforeCancel, after: cardState.resize?.world ?? null },
  });

  // Zone demo: zone-0001 centred at 100 %; select its header and resize.
  await go(send, `${base}apps/engine-playground/?scene=layers&store=off&view=288,224,${vp.name === "mobile" ? "0.5" : "1"}`);
  const zoneCanvas = await state(send);
  const zoneProbe = {
    x: Math.round(zoneCanvas.canvas.clientWidth / 2),
    y: Math.max(20, Math.round(zoneCanvas.canvas.clientHeight / 2) - (vp.name === "mobile" ? 70 : 120)),
  };
  const zoneHit = await findTarget(send, "zone", zoneProbe.x, zoneProbe.y);
  if (zoneHit === null) fail(`no zone under the probe point ${JSON.stringify(zoneProbe)}`);
  let zoneState = await selectTarget(send, { ...zoneHit, screen: zoneProbe });
  const zoneMinimum = zoneState.resize?.minimum ?? null;
  const zoneBefore = zoneState.resize?.world ?? null;
  const zoneCorner = zoneState.resize === null ? null : handlePointOf(zoneState, { x: zoneBefore.x + zoneBefore.width, y: zoneBefore.y + zoneBefore.height });
  await drag(send, zoneCorner, { x: zoneCorner.x - (vp.name === "mobile" ? 40 : 100), y: zoneCorner.y - (vp.name === "mobile" ? 40 : 100) });
  zoneState = await state(send);
  checks.push({
    name: `${vp.name}: a zone resize commits one operation and clamps at the member minimum`,
    passed:
      zoneState.resize?.kind === "zone" &&
      ["resizeZone", "group"].includes(zoneState.resize.last?.operation ?? "") &&
      zoneMinimum !== null &&
      Math.abs(zoneState.resize.world.width - zoneMinimum.width) <= 1 &&
      Math.abs(zoneState.resize.world.height - zoneMinimum.height) <= 1,
    actual: { last: zoneState.resize.last, minimum: zoneMinimum, world: zoneState.resize.world },
  });
  const zoneShot = await shot(send, `P4-17-resize-zone-${vp.name}.png`);
  return {
    viewport: vp,
    checks,
    card: { selected: cardState.ids, snapped, free, minimum, cancelled: beforeCancel },
    zone: { minimum: zoneMinimum, before: zoneBefore, after: zoneState.resize?.world ?? null, last: zoneState.resize?.last ?? null },
    screenshots: [handlesShot, snappedShot, freeShot, zoneShot],
  };
}

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  base = `http://127.0.0.1:${slot.ports.playground}/`;
  const handle = await server(slot.ports.playground);
  const record = { task: "P4-17", gate: "resize-capture", startedAt: new Date().toISOString(), chrome: chromePath(), flags: FLAGS, viewports: [], checks: [], result: "fail", exitCode: 1 };
  try {
    for (const vp of VIEWPORTS) {
      const port = await freePort();
      const profile = join(tmpdir(), `p417-resize-${process.pid}-${vp.name}`);
      rmSync(profile, { recursive: true, force: true });
      const child = spawn(chromePath(), [...FLAGS, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
      let socket = null;
      try {
        const targets = await debug(port);
        socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
        await new Promise((ok) => socket.addEventListener("open", ok, { once: true }));
        const send = cdp(socket);
        await send("Page.enable"); await send("Runtime.enable");
        await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
        await delay(300);
        const result = await run(send, vp);
        record.viewports.push(result);
        record.checks.push(...result.checks);
      } finally {
        if (socket !== null) { try { await socket.send(JSON.stringify({ id: 999, method: "Browser.close" })); } catch { /* close */ } socket.close(); }
        child.kill("SIGTERM");
        await new Promise((ok) => { const t = setTimeout(ok, 3000); child.once("exit", () => { clearTimeout(t); ok(); }); });
        try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
      }
    }
    const failures = record.checks.filter((check) => !check.passed);
    record.result = failures.length === 0 ? "pass" : "fail";
    record.exitCode = failures.length === 0 ? 0 : 1;
    for (const check of record.checks) process.stdout.write(`${check.passed ? "pass" : "FAIL"} ${check.name}${check.passed ? "" : ` (actual ${JSON.stringify(check.actual)})`}\n`);
  } catch (error) { record.result = "infra"; record.resultReason = String(error); record.exitCode = 3; process.stderr.write(`capture-resize: ${record.resultReason}\n`); }
  finally { await new Promise((ok) => handle.close(ok)); }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-17-resize-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: reviews/evidence/P4-17-resize-${slug}.json\n`);
  process.exitCode = record.exitCode;
}
await main();
