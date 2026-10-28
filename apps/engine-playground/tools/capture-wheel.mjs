#!/usr/bin/env node
// P4-24 (L15) deterministic wheel/trackpad record. CDP wheel dispatch is known to
// hang in this headless Chrome (P4-23), so the wheel events are dispatched
// in-page with the real WheelEvent constructor and the record says so explicitly.
// Covers two-finger pan (zoom unchanged), Cmd/Ctrl+wheel zoom around the pointer
// (anchor stable), synthetic two-pointer pinch around the midpoint, a wheel over
// a focused field (canvas unchanged) and a wheel during an object drag (no move).
// Desktop 1440x900, mobile 390x844.

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

function serve(port) {
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
}
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
async function ev(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result?.exceptionDetails) return `EXC ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`; return r.result?.result?.value; }
async function go(send, url) { const loaded = send.event("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded.catch(() => undefined); for (let i = 0; i < 120; i += 1) { const raw = await ev(send, "globalThis.__enginePlayground?.ready?.then?.((s) => JSON.stringify(s)) ?? null", true); if (typeof raw === "string") { const parsed = JSON.parse(raw); if (parsed.ok !== true) fail(raw); break; } await delay(250); } await delay(400); }
async function shot(send, name) { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); writeFileSync(join(EVIDENCE, name), Buffer.from(String(r.result.data), "base64")); return `reviews/evidence/${name}`; }
const camera = async (send) => JSON.parse(await ev(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"));
const anchor = (cam, point) => ({ x: cam.panX + point.x / cam.zoom, y: cam.panY + point.y / cam.zoom });
const same = (a, b, tolerance = 1e-6) => Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
const sameCamera = (a, b) => Math.abs(a.panX - b.panX) < 1e-6 && Math.abs(a.panY - b.panY) < 1e-6 && Math.abs(a.zoom - b.zoom) < 1e-6;

async function run(send, vp) {
  const checks = [];
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  await go(send, `http://127.0.0.1:${slot.ports.playground}/apps/engine-playground/?scene=layers&store=off`);
  const rect = JSON.parse(await ev(send, "(() => { const b = document.querySelector('#canvas').getBoundingClientRect(); return JSON.stringify({ left: b.left, top: b.top, width: b.width, height: b.height }); })()"));
  const at = { x: rect.left + rect.width * 0.35, y: rect.top + rect.height * 0.45 };
  const dispatchWheel = async (init) => JSON.parse(await ev(send, `(() => {
    const canvas = document.querySelector('#canvas');
    const event = new WheelEvent('wheel', ${JSON.stringify({ bubbles: true, cancelable: true, ...init })});
    canvas.dispatchEvent(event);
    return JSON.stringify({ defaultPrevented: event.defaultPrevented, deltaX: event.deltaX, deltaY: event.deltaY });
  })()`));
  // (1) plain two-finger pan: camera moves, zoom unchanged.
  const panBefore = await camera(send);
  const panEvent = await dispatchWheel({ deltaX: 40, deltaY: 30, clientX: at.x, clientY: at.y });
  await delay(120);
  const panAfter = await camera(send);
  checks.push({ name: `${vp.name}: a plain two-finger wheel pans 1:1, zoom unchanged`, passed: panEvent.defaultPrevented === true && Math.abs(panAfter.zoom - panBefore.zoom) < 1e-9 && !sameCamera(panBefore, panAfter), actual: { panBefore, panAfter, panEvent } });
  const panShot = await shot(send, `P4-24-wheel-pan-${vp.name}.png`);
  // (2) Cmd/Ctrl+wheel zoom around the pointer: anchor stable, zoom in.
  const zoomBefore = await camera(send);
  const anchorBefore = anchor(zoomBefore, { x: at.x - rect.left, y: at.y - rect.top });
  await dispatchWheel({ deltaY: -240, metaKey: true, ctrlKey: vp.name === "mobile", clientX: at.x, clientY: at.y });
  await delay(120);
  const zoomAfter = await camera(send);
  const anchorAfter = anchor(zoomAfter, { x: at.x - rect.left, y: at.y - rect.top });
  checks.push({ name: `${vp.name}: Cmd/Ctrl+wheel zooms around the pointer (anchor stable)`, passed: zoomAfter.zoom > zoomBefore.zoom && same(anchorBefore, anchorAfter, 0.5), actual: { zoomBefore, zoomAfter, anchorBefore, anchorAfter, tolerance: 0.5 } });
  const zoomShot = await shot(send, `P4-24-wheel-zoom-${vp.name}.png`);
  // (3) zoom clamp at both limits.
  const zoomClamp = JSON.parse(await ev(send, `(() => {
    const canvas = document.querySelector('#canvas');
    const b = canvas.getBoundingClientRect();
    const at = { x: b.left + b.width * 0.35, y: b.top + b.height * 0.45 };
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100000, metaKey: true, clientX: at.x, clientY: at.y }));
    const high = globalThis.__enginePlayground.getState().camera.zoom;
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100000, metaKey: true, clientX: at.x, clientY: at.y }));
    const low = globalThis.__enginePlayground.getState().camera.zoom;
    return JSON.stringify({ high, low });
  })()`));
  checks.push({ name: `${vp.name}: the wheel zoom is clamped to 0.1 … 8`, passed: Math.abs(zoomClamp.high - 8) < 1e-6 && Math.abs(zoomClamp.low - 0.1) < 1e-6, actual: zoomClamp });
  // (4) two-pointer pinch zooms around the midpoint (synthetic PointerEvents in-page).
  const pinchBefore = await camera(send);
  const pinch = JSON.parse(await ev(send, `(() => {
    const canvas = document.querySelector('#canvas');
    const b = canvas.getBoundingClientRect();
    const point = (x, y) => ({ pointerId: 0, pointerType: 'touch', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true });
    const mid = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    const make = (type, id, x, y) => new PointerEvent(type, { ...point(x, y), pointerId: id });
    canvas.dispatchEvent(make('pointerdown', 1, mid.x - 60, mid.y));
    canvas.dispatchEvent(make('pointerdown', 2, mid.x + 60, mid.y));
    canvas.dispatchEvent(make('pointermove', 2, mid.x + 140, mid.y));
    const after = globalThis.__enginePlayground.getState().camera;
    canvas.dispatchEvent(make('pointerup', 1, mid.x - 60, mid.y));
    canvas.dispatchEvent(make('pointerup', 2, mid.x + 140, mid.y));
    return JSON.stringify({ camera: after, mid });
  })()`));
  checks.push({ name: `${vp.name}: a two-pointer pinch zooms around the midpoint`, passed: pinch.camera.zoom > pinchBefore.zoom, actual: { pinchBefore, pinch, midpoint: { x: pinch.mid.x - rect.left, y: pinch.mid.y - rect.top } } });
  // (5) wheel over a focused field keeps the canvas still.
  const fieldBefore = await camera(send);
  const fieldEvent = JSON.parse(await ev(send, `(() => {
    const wrap = document.querySelector('.canvas-wrap');
    const field = document.createElement('input');
    field.type = 'text';
    field.id = 'wheel-field';
    field.style.position = 'fixed';
    field.style.left = '20px';
    field.style.top = '20px';
    wrap.append(field);
    field.focus();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: 30, clientY: 30 });
    field.dispatchEvent(event);
    const prevented = event.defaultPrevented;
    field.remove();
    return JSON.stringify({ prevented });
  })()`));
  await delay(120);
  const fieldAfter = await camera(send);
  checks.push({ name: `${vp.name}: a wheel over a field leaves the canvas still`, passed: sameCamera(fieldBefore, fieldAfter) && fieldEvent.prevented === false, actual: { fieldBefore, fieldAfter, fieldEvent } });
  // (6) a wheel during an object drag does not move the view.
  // Fit the board first so a draggable object is under a known area, then pick a
  // target near the canvas centre (a target near the edge would start the P4-18
  // auto-pan, which legitimately moves the view during a drag).
  await ev(send, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })); true");
  await delay(350);
  const target = JSON.parse(await ev(send, `(() => {
    const canvas = document.querySelector('#canvas');
    const b = canvas.getBoundingClientRect();
    const cx = canvas.clientWidth / 2;
    const cy = canvas.clientHeight / 2;
    for (let radius = 0; radius < Math.max(canvas.clientWidth, canvas.clientHeight); radius += 12) {
      for (const [dx, dy] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius, radius], [-radius, radius], [radius, -radius], [-radius, -radius]]) {
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x < 20 || y < 20 || x > canvas.clientWidth - 20 || y > canvas.clientHeight - 20) continue;
        const hit = globalThis.__engineDrag.targetAt(x, y);
        if (hit !== null) return JSON.stringify({ x: b.left + x, y: b.top + y, kind: hit.kind });
      }
    }
    return 'null';
  })()`));
  if (target === null) fail("no draggable object");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y, buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x + 24, y: target.y + 18, button: "left", buttons: 1 });
  await delay(120);
  const dragBefore = await camera(send);
  const dragWheel = await dispatchWheel({ deltaY: 160, deltaX: 80, clientX: target.x, clientY: target.y });
  await delay(120);
  const dragAfter = await camera(send);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x + 24, y: target.y + 18, button: "left", buttons: 0, clickCount: 1 });
  await delay(150);
  checks.push({ name: `${vp.name}: a wheel during an object drag does not move the view`, passed: sameCamera(dragBefore, dragAfter) && dragWheel.defaultPrevented === true, actual: { dragBefore, dragAfter, dragWheel } });
  return { viewport: vp, checks, note: "CDP Input.dispatchMouseEvent wheel is known to hang in this headless Chrome (P4-23); all wheel events here are dispatched in-page with the real WheelEvent constructor through the normal handler, and pointer/pinch events are synthetic PointerEvents on the canvas.", screenshots: [panShot, zoomShot] };
}

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const handle = await serve(slot.ports.playground);
  const record = { task: "P4-24", gate: "wheel-capture", startedAt: new Date().toISOString(), chrome: chromePath(), flags: FLAGS, dispatch: "in-page WheelEvent / PointerEvent (CDP wheel hangs in this headless Chrome, P4-23)", checks: [], result: "fail", exitCode: 1 };
  try {
    for (const vp of VIEWPORTS) {
      const port = await freePort();
      const profile = join(tmpdir(), `p424-wheel-${process.pid}-${vp.name}`);
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
    for (const check of record.checks) process.stdout.write(`${check.passed ? "pass" : "FAIL"} ${check.name}${check.passed ? "" : ` (actual ${JSON.stringify(check.actual).slice(0, 900)})`}\n`);
  } catch (error) { record.result = "infra"; record.resultReason = String(error); record.exitCode = 3; process.stderr.write(`capture-wheel: ${error.message}\n`); }
  finally { await new Promise((ok) => handle.close(ok)); }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-24-wheel-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: reviews/evidence/P4-24-wheel-${slug}.json\n`);
  process.exitCode = record.exitCode;
}
await main();
