#!/usr/bin/env node
// P4-18 (L16) deterministic auto-pan capture: select a card, drag it into the
// 48 px right edge band, hold so the camera pans, release and record the camera/
// drag position per sample plus the single committed move operation. Also checks
// that no auto-pan runs outside the band or without a drag. Desktop 1440x900 and
// mobile 390x844, own server and one headless Chrome per viewport.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVIDENCE = join(ROOT, "reviews", "evidence");
const CACHE = join(homedir(), "Library", "Caches", "ms-playwright");
const VIEWPORTS = [{ name: "desktop", width: 1440, height: 900, mobile: false, zoom: "1" }, { name: "mobile", width: 390, height: 844, mobile: true, zoom: "0.6" }];
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
async function ev(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result?.exceptionDetails) return `EXC ${r.result.exceptionDetails.text}`; return r.result?.result?.value; }
async function go(send, url) { const loaded = send.event("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded.catch(() => undefined); for (let i = 0; i < 120; i += 1) { const raw = await ev(send, "globalThis.__enginePlayground?.ready.then((s) => JSON.stringify(s)) ?? null", true); if (typeof raw === "string") { if (JSON.parse(raw).ok !== true) fail(raw); break; } await delay(250); } await delay(300); }
async function shot(send, name) { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); writeFileSync(join(EVIDENCE, name), Buffer.from(String(r.result.data), "base64")); return `reviews/evidence/${name}`; }
const mouse = (send, type, point, extra = {}) => send("Input.dispatchMouseEvent", { type, x: Math.round(point.x), y: Math.round(point.y), button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0, ...extra });

async function pageState(send) {
  return JSON.parse(await ev(send, `JSON.stringify({
    camera: globalThis.__enginePlayground.getState().camera,
    selection: globalThis.__engineSelection.ids(),
    drag: globalThis.__engineAutoPan.lastDrag(),
    last: (() => {
      const pair = typeof globalThis.__engineDrag?.last === "function" ? globalThis.__engineDrag.last() : null;
      if (pair === null || pair === undefined) {
        return null;
      }
      const operation = typeof pair.operation === "string" ? pair.operation : pair.operation?.type;
      const inverse = typeof pair.inverse === "string" ? pair.inverse : pair.inverse?.type;
      return { operation, inverse };
    })(),
    canvas: (() => { const c = document.querySelector("#canvas"); const b = c.getBoundingClientRect(); return { left: b.left, top: b.top, width: c.clientWidth, height: c.clientHeight }; })()
  })`));
}
async function sample(send, durationMs, intervalMs = 50) {
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    samples.push({ atMs: Date.now() - start, state: await pageState(send) });
    await delay(intervalMs);
  }
  return samples;
}

async function run(send, vp) {
  const checks = [];
  await go(send, `http://127.0.0.1:${JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8")).ports.playground}/apps/engine-playground/?scene=layers&store=off&view=816,128,${vp.zoom}`);
  const canvas = await pageState(send);
  const probe = { x: Math.round(canvas.canvas.width / 2), y: Math.round(canvas.canvas.height / 2) };
  const card = JSON.parse(await ev(send, `(() => { const hit = globalThis.__engineDrag.targetAt(${probe.x}, ${probe.y}); return JSON.stringify(hit === null ? null : { id: hit.id, world: hit.world }); })()`));
  if (card === null) fail("no card at the canvas centre");
  const client = (point) => ({ x: canvas.canvas.left + point.x, y: canvas.canvas.top + point.y });
  // Select the card (plain click) and record its committed geometry.
  await mouse(send, "mouseMoved", client(probe), { buttons: 0 });
  await mouse(send, "mousePressed", client(probe));
  await mouse(send, "mouseReleased", client(probe), { buttons: 0 });
  await delay(150);
  let stateNow = await pageState(send);
  checks.push({ name: `${vp.name}: the card is selected for the drag`, passed: stateNow.selection.length === 1, actual: stateNow.selection });

  // No auto-pan without a drag: the camera must not move while idle.
  const idle = await sample(send, 250);
  checks.push({
    name: `${vp.name}: no auto-pan without a drag`,
    passed: idle.every((entry) => entry.state.camera.panX === idle[0].state.camera.panX && entry.state.camera.panY === idle[0].state.camera.panY),
    actual: idle.map((entry) => entry.state.camera),
  });

  // Press the card, drag to the right edge band, then hold without moving.
  const before = await pageState(send);
  const start = { x: probe.x, y: probe.y };
  const edge = { x: canvas.canvas.width - 16, y: probe.y };
  await mouse(send, "mouseMoved", client(start), { buttons: 0 });
  await mouse(send, "mousePressed", client(start));
  // Cross the threshold first, then move into the band and hold.
  await mouse(send, "mouseMoved", client({ x: start.x + 20, y: start.y }), {});
  await delay(30);
  await mouse(send, "mouseMoved", client(edge), {});
  const during = await sample(send, 900);
  const duringShot = await shot(send, `P4-18-autopan-drag-${vp.name}.png`);
  const lastDragDuring = during.at(-1).state.drag;
  const pans = during.map((entry) => entry.state.camera.panX - before.camera.panX);
  const dragXs = during.map((entry) => entry.state.drag?.position?.x ?? null).filter((value) => value !== null);

  await mouse(send, "mouseReleased", client(edge), { buttons: 0 });
  await delay(300);
  const after = await pageState(send);
  const afterShot = await shot(send, `P4-18-autopan-release-${vp.name}.png`);

  // Outside the band: a drag that stays around the centre must not pan.
  await mouse(send, "mouseMoved", client(probe), { buttons: 0 });
  await mouse(send, "mousePressed", client(probe));
  await mouse(send, "mouseMoved", client({ x: probe.x + 40, y: probe.y + 20 }), {});
  const outside = await sample(send, 350);
  await mouse(send, "mouseReleased", client({ x: probe.x + 40, y: probe.y + 20 }), { buttons: 0 });
  await delay(150);
  checks.push({
    name: `${vp.name}: no auto-pan outside the 48 px band`,
    passed: outside.every((entry) => entry.state.camera.panX === outside[0].state.camera.panX && entry.state.camera.panY === outside[0].state.camera.panY),
    actual: outside.map((entry) => entry.state.camera),
  });

  checks.push({
    name: `${vp.name}: dragging into the edge band pans the camera`,
    passed: pans.length > 3 && pans.at(-1) < -4 && pans.every((pan, index) => index === 0 || pan <= pans[index - 1] + 0.001),
    actual: { before: before.camera, after: after.camera, pans },
  });
  checks.push({
    name: `${vp.name}: the drag preview follows beyond the visible area`,
    passed:
      dragXs.length > 3 &&
      dragXs[dragXs.length - 1] > (lastDragDuring?.position?.x ?? Infinity) - 1 &&
      Math.abs((after.last?.operation ?? "") === "moveCard" || (after.last?.operation ?? "") === "moveGroup"),
    actual: { lastDragDuring, dragXs },
  });
  checks.push({
    name: `${vp.name}: release commits exactly one move operation with inverse`,
    passed:
      during.slice(0, -1).every((entry) => (entry.state.last?.operation ?? null) === (before.last?.operation ?? null)) &&
      (after.last?.operation === "moveCard" || after.last?.operation === "moveGroup") &&
      ["moveCard", "moveGroup"].includes(after.last?.inverse ?? ""),
    actual: { before: before.last, duringEnd: during.at(-1).state.last, after: after.last },
  });
  // The loop must stop after release: the camera stays put while no drag runs.
  const stopped = await sample(send, 250);
  checks.push({
    name: `${vp.name}: the auto-pan loop stops on release`,
    passed: stopped.every((entry) => entry.state.camera.panX === stopped[0].state.camera.panX && entry.state.camera.panY === stopped[0].state.camera.panY),
    actual: stopped.map((entry) => entry.state.camera),
  });
  return {
    viewport: vp,
    checks,
    samples: during.map((entry) => ({ atMs: entry.atMs, camera: { panX: entry.state.camera.panX, panY: entry.state.camera.panY }, drag: entry.state.drag?.position ?? null })),
    outsideBandCamera: outside.map((entry) => entry.state.camera),
    before: before.camera,
    after: { camera: after.camera, operation: after.last },
    screenshots: [duringShot, afterShot],
  };
}

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const handle = await serve(slot.ports.playground);
  const record = { task: "P4-18", gate: "auto-pan-capture", startedAt: new Date().toISOString(), chrome: chromePath(), flags: FLAGS, bandPx: 48, viewports: [], checks: [], result: "fail", exitCode: 1 };
  try {
    for (const vp of VIEWPORTS) {
      const port = await freePort();
      const profile = join(tmpdir(), `p418-autopan-${process.pid}-${vp.name}`);
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
    for (const check of record.checks) process.stdout.write(`${check.passed ? "pass" : "FAIL"} ${check.name}${check.passed ? "" : ` (actual ${JSON.stringify(check.actual).slice(0, 500)})`}\n`);
  } catch (error) { record.result = "infra"; record.resultReason = String(error); record.exitCode = 3; process.stderr.write(`capture-auto-pan: ${error.message}\n`); }
  finally { await new Promise((ok) => handle.close(ok)); }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-18-auto-pan-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: reviews/evidence/P4-18-auto-pan-${slug}.json\n`);
  process.exitCode = record.exitCode;
}
await main();
