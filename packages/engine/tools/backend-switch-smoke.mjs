#!/usr/bin/env node
// P4-13 optional browser smoke (extra evidence, not a board gate) for the
// playground backend switch:
//  1. ?backend=webgpu renders WebGPU and reports the adapter via getState(),
//  2. with navigator.gpu removed before load, ?backend=webgpu falls back to
//     WebGL2 and the HUD/getState show the fallback reason,
//  3. an unknown ?backend= value fails closed with an engine error.
// Own server and one headless Chrome; writes reviews/evidence/P4-13-backend-switch-*.json

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVIDENCE = join(ROOT, "reviews", "evidence");
const CACHE = join(homedir(), "Library", "Caches", "ms-playwright");
const FLAGS = ["--headless=new", "--use-angle=metal", "--enable-gpu", "--enable-unsafe-webgpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--window-size=1200,800", "--no-sandbox"];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm" };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { throw new Error(m); };
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
async function debug(p) { for (let i = 0; i < 100; i += 1) { try { const r = await fetch(`http://127.0.0.1:${p}/json`, { signal: AbortSignal.timeout(1000) }); if (r.ok) return r.json(); } catch { /* wait */ } await delay(200); } fail("debug port"); }
function cdp(socket) {
  let id = 0; const pending = new Map(); const events = new Map();
  socket.addEventListener("message", (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method && events.has(m.method)) { events.get(m.method)(m.params); events.delete(m.method); } });
  const send = (method, params = {}) => new Promise((ok, no) => { id += 1; const t = setTimeout(() => no(new Error(`${method} timed out`)), 20000); pending.set(id, (m) => { clearTimeout(t); ok(m); }); socket.send(JSON.stringify({ id, method, params })); });
  send.event = (method) => new Promise((ok) => { events.set(method, ok); });
  return send;
}
async function evaluate(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); return r.result?.result?.value; }
async function waitState(send) {
  let ready = null;
  for (let i = 0; i < 120; i += 1) {
    const raw = await evaluate(send, "globalThis.__enginePlayground?.ready.then((s) => JSON.stringify(s)) ?? null", true).catch(() => null);
    if (typeof raw === "string") { ready = JSON.parse(raw); break; }
    await delay(250);
  }
  let state = null;
  for (let i = 0; i < 120; i += 1) {
    const raw = await evaluate(send, "(() => { try { return JSON.stringify(globalThis.__enginePlayground?.getState?.() ?? null); } catch (e) { return null; } })()");
    if (typeof raw === "string") {
      try { state = JSON.parse(raw); if (state !== null && state.framesRendered > 0) break; } catch { /* wait */ }
    }
    await delay(250);
  }
  return { ready, state };
}
async function navigate(send, url) { const loaded = send.event("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded.catch(() => undefined); }

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const base = `http://127.0.0.1:${slot.ports.playground}/apps/engine-playground/`;
  const handle = await server(slot.ports.playground);
  const debugPort = await freePort();
  const profile = join(tmpdir(), `p413-switch-${process.pid}`);
  rmSync(profile, { recursive: true, force: true });
  const record = { task: "P4-13", gate: "backend-switch-smoke", startedAt: new Date().toISOString(), chrome: chrome(), flags: FLAGS, runs: {}, result: "fail", exitCode: 1 };
  const child = spawn(chrome(), [...FLAGS, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let socket = null;
  try {
    const targets = await debug(debugPort);
    socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((ok) => socket.addEventListener("open", ok, { once: true }));
    const send = cdp(socket);
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });

    // 1. WebGPU preferred (available): active WebGPU with the adapter identity.
    await navigate(send, `${base}?text=titles&backend=webgpu&store=off`);
    record.runs.webgpu = await waitState(send);
    // 2. navigator.gpu removed before load: ?backend=webgpu falls back to WebGL2.
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: "Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });",
    });
    await navigate(send, `${base}?text=titles&backend=webgpu&store=off`);
    record.runs.fallback = await waitState(send);
    record.runs.fallbackHud = await evaluate(send, "document.querySelector('#hud-backend')?.textContent ?? ''");
    // 3. Unknown backend fails closed (the page ready result reports the error).
    await navigate(send, `${base}?text=titles&backend=gl&store=off`);
    record.runs.invalidReady = JSON.parse(
      (await evaluate(send, "globalThis.__enginePlayground.ready.then((s) => JSON.stringify(s))", true)) ?? "null",
    );
    const webgpuOk =
      record.runs.webgpu?.ready?.ok === true &&
      record.runs.webgpu?.state?.backend === "WebGPU" &&
      record.runs.webgpu?.state?.backendReason === "ok" &&
      String(record.runs.webgpu?.state?.backendAdapter?.vendor ?? "").length > 0;
    const fallbackOk =
      record.runs.fallback?.ready?.ok === true &&
      record.runs.fallback?.state?.backend === "WebGL2" &&
      record.runs.fallback?.state?.backendFallback === true &&
      record.runs.fallback?.state?.backendReason === "webgpu-unavailable" &&
      String(record.runs.fallbackHud ?? "").includes("fallback: webgpu-unavailable");
    const invalidOk =
      record.runs.invalidReady?.ok === false &&
      String(record.runs.invalidReady?.error ?? "").includes("unknown backend");
    record.result = webgpuOk && fallbackOk && invalidOk ? "pass" : "fail";
    record.exitCode = record.result === "pass" ? 0 : 1;
  } catch (error) {
    record.result = "infra"; record.resultReason = String(error); record.exitCode = 3;
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
  writeFileSync(join(EVIDENCE, `P4-13-backend-switch-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`backend-switch-smoke: ${record.result} — webgpu ${record.runs.webgpu?.state?.backend}/${record.runs.webgpu?.state?.backendReason}/${record.runs.webgpu?.state?.backendAdapter?.vendor ?? "-"} · fallback ${record.runs.fallback?.state?.backend}/${record.runs.fallback?.state?.backendReason} hud "${record.runs.fallbackHud}" · invalid ${JSON.stringify(record.runs.invalidReady)}`);
  process.exitCode = record.exitCode;
}
await main();
