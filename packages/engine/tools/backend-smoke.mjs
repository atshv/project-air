#!/usr/bin/env node
// P4-12 optional browser backend-selection smoke (extra evidence, not a gate):
// runs the real navigator.gpu probe in a WebGPU-enabled Chrome and in a plain
// WebGL2-only Chrome, selecting through the pure backend.js decision point with
// fake renderer factories. Records both outcomes under reviews/evidence/.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVIDENCE = join(ROOT, "reviews", "evidence");
const CACHE = join(homedir(), "Library", "Caches", "ms-playwright");
const BASE = ["--headless=new", "--use-angle=metal", "--enable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--window-size=1200,800", "--no-sandbox"];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const fail = (message) => { console.error(`backend-smoke: ${message}`); process.exit(1); };

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
function cdp(socket) {
  let id = 0; const pending = new Map(); const events = new Map();
  socket.addEventListener("message", (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method && events.has(m.method)) { events.get(m.method)(m.params); events.delete(m.method); } });
  const send = (method, params = {}) => new Promise((ok, no) => { id += 1; const t = setTimeout(() => no(new Error(`${method} timed out`)), 20000); pending.set(id, (m) => { clearTimeout(t); ok(m); }); socket.send(JSON.stringify({ id, method, params })); });
  send.event = (method) => new Promise((ok) => { events.set(method, ok); });
  return send;
}
async function evaluate(send, expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result?.result?.value; }

async function run(port, label, extraFlags) {
  const debugPort = await freePort();
  const profile = join(tmpdir(), `p412-backend-${process.pid}-${label}`);
  rmSync(profile, { recursive: true, force: true });
  const flags = [...BASE, ...extraFlags];
  const child = spawn(chrome(), [...flags, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let socket = null;
  try {
    const targets = await debug(debugPort);
    socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((ok) => socket.addEventListener("open", ok, { once: true }));
    const send = cdp(socket);
    await send("Page.enable"); await send("Runtime.enable");
    const loaded = send.event("Page.loadEventFired");
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/packages/engine/tools/backend-selection-probe.html${label === "webgl2-only" ? "?nogpu=1" : ""}` });
    await loaded.catch(() => undefined);
    let probe = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      probe = JSON.parse((await evaluate(send, "JSON.stringify(globalThis.__backendProbe ?? null)")) ?? "null");
      if (probe !== null) break;
      await delay(250);
    }
    return { label, flags, probe };
  } finally {
    if (socket !== null) { try { await socket.send(JSON.stringify({ id: 999, method: "Browser.close" })); } catch { /* close */ } socket.close(); }
    child.kill("SIGTERM");
    await new Promise((ok) => { const t = setTimeout(ok, 3000); child.once("exit", () => { clearTimeout(t); ok(); }); });
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const handle = await server(slot.ports.playground);
  const record = { task: "P4-12", gate: "backend-selection-smoke", startedAt: new Date().toISOString(), chrome: chrome(), runs: [], openPoints: ["Chrome 156 exposes WebGPU by default on this host, so the browser fallback run removes navigator.gpu at the page boundary (?nogpu=1) to exercise the real missing-gpu probe branch; the absent-capability branches are also covered by the injected-fake unit tests."], result: "fail", exitCode: 1 };
  try {
    record.runs.push(await run(slot.ports.playground, "webgpu", ["--enable-unsafe-webgpu"]));
    record.runs.push(await run(slot.ports.playground, "webgl2-only", []));
    const webgpu = record.runs[0].probe;
    const webgl2 = record.runs[1].probe;
    const webgpuOk = webgpu?.result?.active === "webgpu" && webgpu.result.reason === "ok" && webgpu.result.fallback === false && (webgpu.result.adapter?.vendor ?? "").length > 0;
    const fallbackOk = webgl2?.result?.active === "webgl2" && webgl2.result.fallback === true && webgl2.result.reason === "webgpu-unavailable";
    record.result = webgpuOk && fallbackOk ? "pass" : "fail";
    record.exitCode = record.result === "pass" ? 0 : 1;
  } catch (error) {
    record.result = "infra"; record.resultReason = String(error); record.exitCode = 3;
  } finally {
    await new Promise((ok) => handle.close(ok));
  }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-12-backend-selection-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  const [g, w] = record.runs;
  console.log(`backend-smoke: ${record.result} — webgpu run ${JSON.stringify(g?.probe?.result ?? g?.probe)} · webgl2-only run ${JSON.stringify(w?.probe?.result ?? w?.probe)}`);
  console.log(`evidence: reviews/evidence/P4-12-backend-selection-${slug}.json`);
  process.exitCode = record.exitCode;
}
await main();
