#!/usr/bin/env node
// L08 (P4-30) deterministic lifecycle/name capture: grouping ghost, one-operation
// zone creation, emptied-zone removal and the inline rename rules, at 1440x900
// and 390x844, plus a screenshot of the read-only live demo for the comparison.

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
const FLAGS = ["--headless=new", "--use-angle=metal", "--enable-gpu", "--hide-scrollbars", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--no-first-run", "--no-default-browser-check", "--window-size=1440,900", "--no-sandbox"];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const REQUIRED = ["apps/engine-playground/main.js", "apps/web/preview/index.html", "packages/engine/dist/bridge/zone-lifecycle.js", "packages/engine/build-wasm/engine.js", "packages/engine/build-wasm/engine.wasm"];
let base = "";

const fail = (message) => { throw new Error(message); };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json" };
function server(port) {
  const s = createServer((request, response) => {
    try {
      let path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = resolve(ROOT, `.${path}`);
      if (!file.startsWith(resolve(ROOT) + "/")) return response.writeHead(403).end();
      response.writeHead(200, { "content-type": types[extname(file).toLowerCase()] ?? "application/octet-stream" });
      response.end(readFileSync(file));
    } catch { if (!response.headersSent) response.writeHead(404).end(); }
  });
  return new Promise((ok, no) => { s.once("error", no); s.listen(port, "127.0.0.1", () => ok(s)); });
}
function chrome() {
  const list = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);
  if (existsSync(CACHE)) for (const entry of readdirSync(CACHE).sort()) if (entry.startsWith("chromium-")) for (const arch of ["chrome-mac-arm64", "chrome-mac"]) list.push(join(CACHE, entry, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
  list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  for (const candidate of list) if (existsSync(candidate)) return candidate;
  fail("no Chrome; set CHROME_PATH");
}
async function port() {
  const s = createServer();
  await new Promise((ok) => s.listen(0, "127.0.0.1", ok));
  const p = s.address().port;
  await new Promise((ok) => s.close(ok));
  return p;
}
async function debug(p) { for (let i = 0; i < 100; i += 1) { try { const r = await fetch(`http://127.0.0.1:${p}/json`); if (r.ok) return r.json(); } catch { /* wait */ } await delay(200); } fail("debug port"); }
function cdp(socket) {
  let id = 0; const pending = new Map(); const events = new Map();
  socket.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method && events.has(m.method)) { events.get(m.method)(m.params); events.delete(m.method); } });
  const send = (method, params = {}) => new Promise((ok, no) => { id += 1; const t = setTimeout(() => no(new Error(`${method} timed out`)), 15000); pending.set(id, (m) => { clearTimeout(t); ok(m); }); socket.send(JSON.stringify({ id, method, params })); });
  send.event = (method) => new Promise((ok) => { events.set(method, ok); });
  return send;
}
async function ev(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result?.exceptionDetails) fail(`page: ${r.result.exceptionDetails.text}`); return r.result?.result?.value; }
async function ready(send) { for (let i = 0; i < 120; i += 1) { if ((await ev(send, "typeof globalThis.__enginePlayground === 'object'")) === true) { const raw = await ev(send, "globalThis.__enginePlayground.ready.then((s) => JSON.stringify(s))", true); if (typeof raw === "string") { const state = JSON.parse(raw); if (state.ok) return state; fail(state.error); } } await delay(250); } fail("not ready"); }
async function go(send, url, waitReady = true) { const loaded = send.event("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded.catch(() => undefined); if (waitReady) { const s = await ready(send); await delay(300); return s; } await delay(1500); }
async function shot(send, name) { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); const bytes = Buffer.from(String(r.result.data), "base64"); writeFileSync(join(EVIDENCE, name), bytes); return `reviews/evidence/${name}`; }
const checks = [];
const check = (name, passed, actual) => checks.push({ name, passed, actual });
async function viewportRun(send, vp) {
  const r = await go(send, `${base}apps/engine-playground/?scene=layers&zoneLifecycle=demo&store=off`);
  if (r.scene !== "layers") fail(`scene ${r.scene}`);
  const initial = JSON.parse(await ev(send, "JSON.stringify({ state: globalThis.__zoneLifecycle.state(), snapshot: globalThis.__zoneLifecycle.snapshot() })"));
  const ghost = await shot(send, `P4-30-lifecycle-grouping-${vp.name}.png`);
  check(`${vp.name}: grouping shows the dashed ghost frame and landing slot`, initial.state.freeObjects.length >= 2, { free: initial.state.freeObjects.length });
  const [a, b] = initial.state.freeObjects;
  const grouped = JSON.parse(await ev(send, `JSON.stringify(globalThis.__zoneLifecycle.groupTwo(${JSON.stringify(a.objectId)}, ${JSON.stringify(b.objectId)}))`));
  check(`${vp.name}: grouping creates one zone operation with inverse and the default title`, grouped !== null && grouped.applied.operation === "group" && grouped.applied.inverse === "group" && grouped.title === "New zone", grouped);
  const groupedShot = await shot(send, `P4-30-lifecycle-grouped-${vp.name}.png`);
  const zoneId = grouped.zoneId;
  const renamed = JSON.parse(await ev(send, `JSON.stringify(globalThis.__zoneLifecycle.renameZone(${JSON.stringify(zoneId)}, "  Lake   trip  "))`));
  check(`${vp.name}: rename normalises and commits one operation with inverse`, renamed !== null && renamed.title === "Lake trip" && renamed.applied.operation === "group" && renamed.applied.inverse === "group", renamed);
  const nameShot = await shot(send, `P4-30-lifecycle-renamed-${vp.name}.png`);
  const emptiedSetup = JSON.parse(await ev(send, `JSON.stringify(globalThis.__zoneLifecycle.removeAllMembers(${JSON.stringify(zoneId)}))`));
  check(`${vp.name}: emptying removes the members in one operation`, emptiedSetup !== null && emptiedSetup.operation === "group", emptiedSetup);
  const emptiedShot = await shot(send, `P4-30-lifecycle-emptied-${vp.name}.png`);
  const removed = JSON.parse(await ev(send, "JSON.stringify(globalThis.__zoneLifecycle.removeEmptyZones())"));
  check(`${vp.name}: the emptied zone is removed as one undoable operation`, removed.length === 1 && removed[0].operation === "deleteZone" && removed[0].inverse === "group", removed);
  await go(send, `${base}apps/web/preview/index.html`, false);
  const liveShot = await shot(send, `P4-30-live-demo-${vp.name}.png`);
  check(`${vp.name}: the live-demo reference page loads`, liveShot !== undefined, liveShot);
  return { viewport: vp, initial, grouped, emptied: emptiedSetup, removed, renamed, screenshots: [ghost, groupedShot, emptiedShot, nameShot, liveShot] };
}
async function run(vp) {
  const p = await port();
  const dir = join(tmpdir(), `p430-${process.pid}-${vp.name}`);
  const child = spawn(chrome(), [...FLAGS, `--remote-debugging-port=${p}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  try {
    const targets = await debug(p);
    const socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((ok) => socket.addEventListener("open", ok, { once: true }));
    const send = cdp(socket);
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    await delay(300);
    const result = await viewportRun(send, vp);
    try { await socket.send(JSON.stringify({ id: 999, method: "Browser.close" })); } catch { /* close */ }
    socket.close();
    return result;
  } finally {
    child.kill("SIGTERM");
    await new Promise((ok) => { const t = setTimeout(ok, 3000); child.once("exit", () => { clearTimeout(t); ok(); }); });
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}
async function main() {
  for (const relative of REQUIRED) if (!existsSync(join(ROOT, relative))) fail(`missing ${relative}`);
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  base = `http://127.0.0.1:${slot.ports.playground}/`;
  const serverHandle = await server(slot.ports.playground);
  const record = { task: "P4-30", gate: "zone-lifecycle-capture", startedAt: new Date().toISOString(), chrome: chrome(), viewports: [], checks, result: "fail", exitCode: 1 };
  try {
    for (const vp of VIEWPORTS) record.viewports.push(await run(vp));
    const failures = checks.filter((c) => !c.passed);
    record.result = failures.length === 0 ? "pass" : "fail";
    record.exitCode = failures.length === 0 ? 0 : 1;
    for (const c of checks) process.stdout.write(`${c.passed ? "pass" : "FAIL"} ${c.name}\n`);
  } catch (error) { record.result = "infra"; record.resultReason = String(error); record.exitCode = 3; process.stderr.write(`capture-zone-lifecycle: ${record.resultReason}\n`); }
  finally { await new Promise((ok) => serverHandle.close(ok)); }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-30-zone-lifecycle-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: reviews/evidence/P4-30-zone-lifecycle-${slug}.json\n`);
  process.exitCode = record.exitCode;
}
await main();
