#!/usr/bin/env node
// P4-19 (L20) deterministic placement capture: five consecutive "Add note"
// actions on the layers scene, recording each placed position, attempt count and
// create operation id; verifies all five are visible, grid-aligned and
// non-overlapping. Desktop 1440x900, mobile 390x844.

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
const GRID = 16;

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
async function ev(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result?.exceptionDetails) return `EXC ${r.result.exceptionDetails.text}`; return r.result?.result?.value; }
async function go(send, url) { const loaded = send.event("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded.catch(() => undefined); for (let i = 0; i < 120; i += 1) { const raw = await ev(send, "globalThis.__enginePlayground?.ready.then((s) => JSON.stringify(s)) ?? null", true); if (typeof raw === "string") { if (JSON.parse(raw).ok !== true) fail(raw); break; } await delay(250); } await delay(400); }
async function shot(send, name) { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); writeFileSync(join(EVIDENCE, name), Buffer.from(String(r.result.data), "base64")); return `reviews/evidence/${name}`; }
const mouse = (send, type, point) => send("Input.dispatchMouseEvent", { type, x: Math.round(point.x), y: Math.round(point.y), button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });

const OVERLAP = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (rect, visible) =>
  rect.x >= visible.x - 1e-9 && rect.y >= visible.y - 1e-9 &&
  rect.x + rect.width <= visible.x + visible.width + 1e-9 &&
  rect.y + rect.height <= visible.y + visible.height + 1e-9;

async function run(send, vp) {
  const checks = [];
  await go(send, `http://127.0.0.1:${JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8")).ports.playground}/apps/engine-playground/?scene=layers&store=off&tools=1`);
  const button = JSON.parse(await ev(send, `(() => { const b = document.querySelector("#note-add"); if (b === null) return "null"; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
  if (button === null || typeof button !== "object") fail("note-add button missing");
  for (let index = 0; index < 5; index += 1) {
    await mouse(send, "mouseMoved", button);
    await mouse(send, "mousePressed", button);
    await mouse(send, "mouseReleased", button);
    await delay(250);
  }
  const adds = JSON.parse(await ev(send, "JSON.stringify(globalThis.__enginePlacement.adds())"));
  const lastOperation = JSON.parse(await ev(send, `(() => { const pair = typeof globalThis.__engineDrag?.last === "function" ? globalThis.__engineDrag.last() : null; return JSON.stringify(pair === null ? null : { operation: pair.operation, inverse: pair.inverse }); })()`));
  const shotPath = await shot(send, `P4-19-placement-five-${vp.name}.png`);
  checks.push({ name: `${vp.name}: five consecutive note-add actions create five cards`, passed: adds.length === 5 && adds.every((add) => add.operationId !== null), actual: adds.map((add) => add.operationId) });
  checks.push({ name: `${vp.name}: every placement is on the 16 px grid`, passed: adds.every((add) => Math.abs(add.x % GRID) < 1e-9 && Math.abs(add.y % GRID) < 1e-9), actual: adds.map((add) => [add.x, add.y]) });
  checks.push({ name: `${vp.name}: every placement is inside the visible area`, passed: adds.every((add) => inside(add, add.visible)), actual: adds.map((add) => ({ rect: { x: add.x, y: add.y, width: add.width, height: add.height }, visible: add.visible })) });
  checks.push({ name: `${vp.name}: the cascade never exceeds ten attempts`, passed: adds.every((add) => add.attempts >= 1 && add.attempts <= 10), actual: adds.map((add) => add.attempts) });
  checks.push({ name: `${vp.name}: the five cards never overlap`, passed: adds.every((add, index) => adds.every((other, otherIndex) => index === otherIndex || !OVERLAP(add, other))), actual: adds.map((add) => [add.x, add.y]) });
  checks.push({ name: `${vp.name}: the last create is one createCard operation with inverse`, passed: lastOperation?.operation === "createCard" && lastOperation?.inverse === "deleteCard", actual: lastOperation });
  return { viewport: vp, checks, adds, lastOperation, screenshot: shotPath };
}

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const handle = await serve(slot.ports.playground);
  const record = { task: "P4-19", gate: "placement-capture", startedAt: new Date().toISOString(), chrome: chromePath(), flags: FLAGS, gridPx: GRID, cascadePx: 32, maxAttempts: 10, viewports: [], checks: [], result: "fail", exitCode: 1 };
  try {
    for (const vp of VIEWPORTS) {
      const port = await freePort();
      const profile = join(tmpdir(), `p419-placement-${process.pid}-${vp.name}`);
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
    for (const check of record.checks) process.stdout.write(`${check.passed ? "pass" : "FAIL"} ${check.name}${check.passed ? "" : ` (actual ${JSON.stringify(check.actual).slice(0, 600)})`}\n`);
  } catch (error) { record.result = "infra"; record.resultReason = String(error); record.exitCode = 3; process.stderr.write(`capture-placement: ${error.message}\n`); }
  finally { await new Promise((ok) => handle.close(ok)); }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-19-placement-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: reviews/evidence/P4-19-placement-${slug}.json\n`);
  process.exitCode = record.exitCode;
}
await main();
