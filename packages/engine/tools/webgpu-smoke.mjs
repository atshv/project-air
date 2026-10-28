#!/usr/bin/env node
// P4-11 optional WebGPU browser smoke (extra evidence, not a board gate).
//
//   node packages/engine/tools/webgpu-smoke.mjs
//
// Starts its own static server on the slot playground port and one headless
// Chrome for Testing with WebGPU enabled (--enable-unsafe-webgpu, ANGLE Metal),
// loads tools/webgpu-probe.html, waits for the probe record (adapter, pipeline,
// frame, visible instances, non-background pixels), screenshots the rendered
// canvas and writes reviews/evidence/P4-11-webgpu-<timestamp>.json.
// Exit codes: 0 rendered, 1 not rendered, 3 infrastructure.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVIDENCE = join(ROOT, "reviews", "evidence");
const CACHE = join(homedir(), "Library", "Caches", "ms-playwright");
const FLAGS = [
  "--headless=new", "--use-angle=metal", "--enable-gpu", "--enable-unsafe-webgpu",
  "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,1000", "--no-sandbox",
];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".json": "application/json" };
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function fail(message) { console.error(`webgpu-smoke: ${message}`); process.exit(1); }
function chrome() {
  const list = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);
  if (existsSync(CACHE)) for (const entry of readdirSync(CACHE).sort()) if (entry.startsWith("chromium-")) for (const arch of ["chrome-mac-arm64", "chrome-mac"]) list.push(join(CACHE, entry, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
  list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  for (const candidate of list) if (existsSync(candidate)) return candidate;
  fail("no Chrome");
}
function server(port) {
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
async function freePort() { const s = createServer(); await new Promise((ok) => s.listen(0, "127.0.0.1", ok)); const p = s.address().port; await new Promise((ok) => s.close(ok)); return p; }
async function debug(p) { for (let i = 0; i < 100; i += 1) { try { const r = await fetch(`http://127.0.0.1:${p}/json`, { signal: AbortSignal.timeout(1000) }); if (r.ok) return r.json(); } catch { /* wait */ } await delay(200); } throw new Error("debug port"); }
function client(socket) {
  let id = 0; const pending = new Map(); const events = new Map();
  socket.addEventListener("message", (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method && events.has(m.method)) { events.get(m.method)(m.params); events.delete(m.method); } });
  const send = (method, params = {}) => new Promise((ok, no) => { id += 1; const t = setTimeout(() => no(new Error(`${method} timed out`)), 20000); pending.set(id, (m) => { clearTimeout(t); ok(m); }); socket.send(JSON.stringify({ id, method, params })); });
  send.event = (method) => new Promise((ok) => { events.set(method, ok); });
  return send;
}
async function evaluate(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); return r.result?.result?.value; }

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const port = slot.ports.playground;
  const handle = await server(port);
  const debugPort = await freePort();
  const profile = join(tmpdir(), `p411-webgpu-${process.pid}`);
  rmSync(profile, { recursive: true, force: true });
  const record = { task: "P4-11", gate: "webgpu-browser-smoke", startedAt: new Date().toISOString(), chrome: chrome(), flags: FLAGS, probe: null, screenshot: null, openPoints: ["Headless Chrome drawImage readback of the WebGPU canvas is transparent; the committed screenshot is the visual proof of the rendered layers scene.", "The WebGPU glyph/atlas and chrome passes are P4-12/P4-13 scope."], result: "fail", exitCode: 1 };
  const child = spawn(chrome(), [...FLAGS, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let socket = null;
  try {
    const targets = await debug(debugPort);
    socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((ok) => socket.addEventListener("open", ok, { once: true }));
    const send = client(socket);
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const loaded = send.event("Page.loadEventFired");
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/packages/engine/tools/webgpu-probe.html` });
    await loaded.catch(() => undefined);
    let probe = null;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      probe = JSON.parse((await evaluate(send, "JSON.stringify(globalThis.__webgpuProbe ?? null)")) ?? "null");
      if (probe !== null && probe.stage === "rendered") break;
      if (probe !== null && probe.stage === "create" ) break;
      if (probe !== null && probe.stage === "ready") break;
      if (probe !== null && probe.stage === "load") break;
      if (probe !== null && probe.stage === "frame") break;
      if (probe !== null && probe.stage === "exception") break;
      await delay(250);
    }
    record.probe = probe;
    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const bytes = Buffer.from(String(shot.result?.data ?? ""), "base64");
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(join(EVIDENCE, "P4-11-webgpu-frame.png"), bytes);
    record.screenshot = "reviews/evidence/P4-11-webgpu-frame.png";
    record.result = probe !== null && probe.ok === true && probe.frame === 1 && probe.instances > 0 ? "pass" : "fail";
    record.exitCode = record.result === "pass" ? 0 : 1;
  } catch (error) {
    record.result = "infra";
    record.resultReason = String(error);
    record.exitCode = 3;
  } finally {
    if (socket !== null) { try { await socket.send(JSON.stringify({ id: 999, method: "Browser.close" })); } catch { /* close */ } socket.close(); }
    child.kill("SIGTERM");
    await new Promise((ok) => { const t = setTimeout(ok, 3000); child.once("exit", () => { clearTimeout(t); ok(); }); });
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
    await new Promise((ok) => handle.close(ok));
  }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const file = join(EVIDENCE, `P4-11-webgpu-${slug}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`webgpu-smoke: ${record.result} — adapter ${JSON.stringify(record.probe?.adapter)} pipeline ${record.probe?.pipeline} instances ${record.probe?.instances} pixels ${record.probe?.nonBackgroundPixels} firstPixel ${JSON.stringify(record.probe?.firstPixel)} clear ${JSON.stringify(record.probe?.clear)} gpuError ${record.probe?.webgpuError ?? ""} frame ${record.probe?.frame}${record.probe?.error ? ` error ${record.probe.error}` : ""}`);
  console.log(`evidence: reviews/evidence/P4-11-webgpu-${slug}.json · reviews/evidence/P4-11-webgpu-frame.png`);
  process.exitCode = record.exitCode;
}
await main();
