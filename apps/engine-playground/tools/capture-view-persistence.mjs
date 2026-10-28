#!/usr/bin/env node
// P4-22 (L17) deterministic capture: a user zoom is remembered on reload, a
// board without an entry starts fitted, two boards keep separate entries, and a
// throwing storage falls back to the fitted view. Desktop 1440x900, mobile 390x844.

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
  socket.addEventListener("message", (event) => { const m = JSON.parse(event.data); if (m.method === "Runtime.exceptionThrown") console.error("PAGE EXC", JSON.stringify(m.params.exceptionDetails?.exception?.description ?? m.params).slice(0, 500)); if (m.method === "Log.entryAdded") console.error("PAGE LOG", JSON.stringify(m.params.entry?.text ?? "").slice(0, 300)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method && events.has(m.method)) { events.get(m.method)(m.params); events.delete(m.method); } });
  const send = (method, params = {}) => new Promise((ok, no) => { id += 1; const t = setTimeout(() => no(new Error(`${method} timed out`)), 15000); pending.set(id, (m) => { clearTimeout(t); ok(m); }); socket.send(JSON.stringify({ id, method, params })); });
  send.event = (method) => new Promise((ok) => { events.set(method, ok); });
  return send;
}
async function ev(send, expression, awaitPromise = false) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) {
    console.error("EVAL EXC", expression.slice(0, 90), JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text).slice(0, 300));
    return null;
  }
  return r.result?.result?.value;
}
async function go(send, url) {
  const loaded = send.event("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded.catch(() => undefined);
  for (let i = 0; i < 120; i += 1) {
    const raw = await ev(send, "globalThis.__enginePlayground?.ready?.then?.((s) => JSON.stringify(s)) ?? null", true);
    if (typeof raw === "string") { if (raw.startsWith("EXC")) fail(raw); const parsed = JSON.parse(raw); if (parsed.ok !== true) fail(raw); break; }
    await delay(250);
  }
  const error = await ev(send, "document.querySelector('#error')?.textContent ?? ''");
  if (String(error).length > 0) fail(`page error: ${error}`);
  await delay(400);
}
async function shot(send, name) { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); writeFileSync(join(EVIDENCE, name), Buffer.from(String(r.result.data), "base64")); return `reviews/evidence/${name}`; }
const view = async (send) => JSON.parse(await ev(send, "JSON.stringify({ camera: globalThis.__engineView.camera(), restored: globalThis.__engineView.restored(), writes: globalThis.__engineView.writes(), identity: globalThis.__engineView.identity(), storageAvailable: globalThis.__engineView.storageAvailable })"));
const same = (left, right) => Math.abs(left.panX - right.panX) <= 1e-6 && Math.abs(left.panY - right.panY) <= 1e-6 && Math.abs(left.zoom - right.zoom) <= 1e-6;

async function run(send, vp) {
  const checks = [];
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const baseUrl = `http://127.0.0.1:${slot.ports.playground}/apps/engine-playground/`;
  const sampleUrl = `${baseUrl}?scene=sample`;
  await go(send, sampleUrl);
  const initial = await view(send);
  // A user camera action: wheel zoom in at the canvas centre.
  const point = JSON.parse(await ev(send, "(() => { const b = document.querySelector('#canvas').getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()"));
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: -420 });
  await delay(700); // debounce (300 ms) + frame
  const saved = await view(send);
  const savedShot = await shot(send, `P4-22-view-saved-${vp.name}.png`);
  // Reload: the same section is restored before the first fitted frame; no write.
  await go(send, sampleUrl);
  const reloaded = await view(send);
  checks.push({ name: `${vp.name}: reload restores the saved section without writing`, passed: reloaded.restored === true && same(reloaded.camera, saved.camera) && reloaded.writes === 0 && !same(saved.camera, initial.camera), actual: { initial, saved, reloaded } });
  const restoredShot = await shot(send, `P4-22-view-restored-${vp.name}.png`);
  // Another board has no entry: it starts fitted, not with the sample camera.
  await go(send, `${baseUrl}?scene=layers&store=off`);
  const otherBoard = await view(send);
  const otherShot = await shot(send, `P4-22-view-other-board-${vp.name}.png`);
  checks.push({ name: `${vp.name}: a board without an entry starts fitted`, passed: otherBoard.restored === false && !same(otherBoard.camera, saved.camera), actual: { saved: saved.camera, otherBoard } });
  // Back to the sample board: its separate entry is still there (no leak).
  await go(send, sampleUrl);
  const back = await view(send);
  checks.push({ name: `${vp.name}: boards keep separate entries (no leak)`, passed: back.restored === true && same(back.camera, saved.camera), actual: { saved: saved.camera, back } });
  // Storage that throws on every access: fall back to the fitted view, no error.
  await ev(send, "(() => { globalThis.__engineView.clear(); return true; })()");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "Storage.prototype.getItem = function () { throw new Error('storage unavailable'); }; Storage.prototype.setItem = function () { throw new Error('storage unavailable'); };" });
  await go(send, sampleUrl);
  const exception = await view(send);
  const exceptionShot = await shot(send, `P4-22-view-exception-${vp.name}.png`);
  await go(send, sampleUrl);
  const exceptionReload = await view(send);
  checks.push({ name: `${vp.name}: throwing storage falls back to the fitted view`, passed: exception.restored === false && exception.writes === 0 && same(exception.camera, exceptionReload.camera), actual: { exception, exceptionReload } });
  return { viewport: vp, checks, initial, saved, reloaded, otherBoard, back, exception, screenshots: [savedShot, restoredShot, otherShot, exceptionShot] };
}

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const handle = await serve(slot.ports.playground);
  const record = { task: "P4-22", gate: "view-persistence-capture", startedAt: new Date().toISOString(), chrome: chromePath(), flags: FLAGS, checks: [], result: "fail", exitCode: 1 };
  try {
    for (const vp of VIEWPORTS) {
      const port = await freePort();
      const profile = join(tmpdir(), `p422-view-${process.pid}-${vp.name}`);
      rmSync(profile, { recursive: true, force: true });
      const child = spawn(chromePath(), [...FLAGS, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
      let socket = null;
      try {
        const targets = await debug(port);
        socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
        await new Promise((ok) => socket.addEventListener("open", ok, { once: true }));
        const send = cdp(socket);
        await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
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
    for (const check of record.checks) process.stdout.write(`${check.passed ? "pass" : "FAIL"} ${check.name}${check.passed ? "" : ` (actual ${JSON.stringify(check.actual).slice(0, 700)})`}\n`);
  } catch (error) { record.result = "infra"; record.resultReason = String(error); record.exitCode = 3; process.stderr.write(`capture-view-persistence: ${error.message}\n`); }
  finally { await new Promise((ok) => handle.close(ok)); }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-22-view-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: reviews/evidence/P4-22-view-${slug}.json\n`);
  process.exitCode = record.exitCode;
}
await main();
