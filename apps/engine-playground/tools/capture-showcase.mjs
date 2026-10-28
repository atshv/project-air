#!/usr/bin/env node
// P4-28 deterministic stage showcase capture (desktop 1440x900, mobile 390x844).
// Own server and one fresh headless Chrome per viewport, paused on-demand
// scheduler, no animation; the record stores camera, counts, rendered frames,
// selection and snap guides. Not part of the visual gate (no new baselines).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVIDENCE = join(ROOT, "reviews", "evidence");
const CACHE = join(homedir(), "Library", "Caches", "ms-playwright");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, mobile: false, view: "256,200,2", zoom: 2 },
  { name: "mobile", width: 390, height: 844, mobile: true, view: "256,200,1.5", zoom: 1.5 },
];
const FLAGS = ["--headless=new", "--use-angle=metal", "--enable-gpu", "--hide-scrollbars", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--no-first-run", "--no-default-browser-check", "--window-size=1440,900", "--no-sandbox"];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json" };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { throw new Error(m); };
let base = "";

function server(port) {
  const s = createServer((request, response) => {
    try {
      let path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = resolve(ROOT, `.${path}`);
      if (!file.startsWith(resolve(ROOT) + "/")) return response.writeHead(403).end();
      response.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" });
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
  fail("no Chrome");
}
async function freePort() { const s = createServer(); await new Promise((ok) => s.listen(0, "127.0.0.1", ok)); const p = s.address().port; await new Promise((ok) => s.close(ok)); return p; }
async function debug(p) { for (let i = 0; i < 100; i += 1) { try { const r = await fetch(`http://127.0.0.1:${p}/json`, { signal: AbortSignal.timeout(1000) }); if (r.ok) return r.json(); } catch { /* wait */ } await delay(200); } fail("debug port"); }
function cdp(socket) {
  let id = 0; const pending = new Map(); const events = new Map();
  socket.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method && events.has(m.method)) { events.get(m.method)(m.params); events.delete(m.method); } });
  const send = (method, params = {}) => new Promise((ok, no) => { id += 1; const t = setTimeout(() => no(new Error(`${method} timed out`)), 15000); pending.set(id, (m) => { clearTimeout(t); ok(m); }); socket.send(JSON.stringify({ id, method, params })); });
  send.event = (method) => new Promise((ok) => { events.set(method, ok); });
  return send;
}
async function ev(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result?.exceptionDetails) fail(`page: ${r.result.exceptionDetails.text}`); return r.result?.result?.value; }
async function ready(send) { for (let i = 0; i < 120; i += 1) { if ((await ev(send, "typeof globalThis.__enginePlayground === 'object'")) === true) { const raw = await ev(send, "globalThis.__enginePlayground.ready.then((s) => JSON.stringify(s))", true); if (typeof raw === "string") { const state = JSON.parse(raw); if (state.ok) return state; fail(state.error); } } await delay(250); } fail("not ready"); }
async function go(send, url) { const loaded = send.event("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded.catch(() => undefined); return ready(send); }
async function shot(send, name) { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); const bytes = Buffer.from(String(r.result.data), "base64"); writeFileSync(join(EVIDENCE, name), bytes); return `reviews/evidence/${name}`; }

async function viewportRun(send, vp) {
  const state = await go(send, `${base}apps/engine-playground/?showcase=1&view=${vp.view}&store=off`);
  if (state.scene !== "titles") fail(`unexpected showcase scene ${state.scene}`);
  // Paused scheduler: wait until the rendered-frame counter stops changing.
  let previous = null;
  let stable = 0;
  for (let i = 0; i < 40 && stable < 3; i += 1) {
    await delay(120);
    const frames = await ev(send, "document.querySelector('#frames')?.textContent ?? ''");
    stable = frames === previous ? stable + 1 : 0;
    previous = frames;
  }
  await delay(150);
  const framesSettled = previous;
  const showcase = JSON.parse(await ev(send, "JSON.stringify(globalThis.__showcase ?? null)"));
  const after = JSON.parse(await ev(send, "JSON.stringify({ frames: document.querySelector('#frames')?.textContent ?? '', objectCount: globalThis.__enginePlayground.getState().objectCount, camera: globalThis.__enginePlayground.getState().camera })"));
  const image = await shot(send, `P4-28-showcase-${vp.name}.png`);
  const checks = {
    scene: { passed: showcase?.scene === "showcase", actual: showcase?.scene },
    counts: { passed: showcase?.counts?.total === 8 && after.objectCount === 8, actual: { counts: showcase?.counts, objectCount: after.objectCount } },
    camera: { passed: after.camera.zoom === vp.zoom, actual: after.camera },
    selection: { passed: Array.isArray(showcase?.selection) && showcase.selection.length === 3, actual: showcase?.selection },
    guides: { passed: typeof showcase?.guides === "number" && showcase.guides >= 1, actual: showcase?.guides },
    paused: { passed: stable >= 3 && after.frames === framesSettled, actual: { framesBefore: showcase?.framesBefore, framesAfter: showcase?.framesAfter, framesSettled, framesNow: after.frames } },
    screenshot: { passed: existsSync(join(ROOT, image)), actual: image },
  };
  return { viewport: vp, showcase, after, checks, image };
}

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  base = `http://127.0.0.1:${slot.ports.playground}/`;
  const handle = await server(slot.ports.playground);
  const record = { task: "P4-28", gate: "showcase-capture", startedAt: new Date().toISOString(), chrome: chrome(), viewports: [], result: "fail", exitCode: 1 };
  try {
    for (const vp of VIEWPORTS) {
      const p = await freePort();
      const dir = join(tmpdir(), `p428-showcase-${process.pid}-${vp.name}`);
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
        record.viewports.push(result);
      } finally {
        child.kill("SIGTERM");
        await new Promise((ok) => { const t = setTimeout(ok, 3000); child.once("exit", () => { clearTimeout(t); ok(); }); });
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
      }
    }
    const failures = record.viewports.flatMap((v) => Object.entries(v.checks).filter(([, c]) => !c.passed));
    record.result = failures.length === 0 ? "pass" : "fail";
    record.exitCode = failures.length === 0 ? 0 : 1;
    for (const vp of record.viewports) for (const [name, check] of Object.entries(vp.checks)) process.stdout.write(`${check.passed ? "pass" : "FAIL"} ${vp.viewport.name}: ${name}${check.passed ? "" : ` (actual ${JSON.stringify(check.actual)})`}\n`);
  } catch (error) { record.result = "infra"; record.resultReason = String(error); record.exitCode = 3; process.stderr.write(`capture-showcase: ${record.resultReason}\n`); }
  finally { await new Promise((ok) => handle.close(ok)); }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-28-showcase-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: reviews/evidence/P4-28-showcase-${slug}.json\n`);
  process.exitCode = record.exitCode;
}
await main();
