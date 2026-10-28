#!/usr/bin/env node
// P4-21 (L11) deterministic undo/redo capture: a move and a delete, undo with
// the 3 s hint, redo, a 20-depth duplicate series, and a focused field that keeps
// the browser's own undo. Desktop 1440x900, mobile 390x844.

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
async function ev(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result?.exceptionDetails) return `EXC ${r.result.exceptionDetails.text}`; return r.result?.result?.value; }
async function go(send, url) { const loaded = send.event("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded.catch(() => undefined); for (let i = 0; i < 120; i += 1) { const raw = await ev(send, "globalThis.__enginePlayground?.ready.then((s) => JSON.stringify(s)) ?? null", true); if (typeof raw === "string") { if (JSON.parse(raw).ok !== true) fail(raw); break; } await delay(250); } await delay(400); }
async function shot(send, name) { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); writeFileSync(join(EVIDENCE, name), Buffer.from(String(r.result.data), "base64")); return `reviews/evidence/${name}`; }
const VK = { z: 90 };
async function key(send, keyName, modifiers = 0) { const code = keyName.length === 1 ? `Key${keyName.toUpperCase()}` : keyName; await send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code, modifiers, windowsVirtualKeyCode: VK[keyName] ?? 0 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code, modifiers }); await delay(80); }
const click = (send, point) => Promise.all([send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 }), send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 })]);
async function drag(send, from, to) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y, buttons: 0 }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 }); await delay(30); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, button: "left", buttons: 1 }); await delay(40); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: to.x, y: to.y, button: "left", buttons: 1 }); await delay(80); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 }); await delay(200); }
const state = async (send) => JSON.parse(await ev(send, "JSON.stringify({ history: globalThis.__engineKeyboard.history(), hint: globalThis.__engineKeyboard.hint(), last: (() => { const p = globalThis.__engineSelection.lastOperation(); return p === null || p === undefined ? null : p.operation; })(), selection: globalThis.__engineSelection.size() })"));

async function run(send, vp) {
  const checks = [];
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  await go(send, `http://127.0.0.1:${slot.ports.playground}/apps/engine-playground/?scene=layers&store=off`);
  const point = JSON.parse(await ev(send, "(() => { const c = document.querySelector('#canvas'); const b = c.getBoundingClientRect(); return JSON.stringify({ x: b.left + c.clientWidth / 2, y: b.top + c.clientHeight / 2 }); })()"));
  await click(send, point); await delay(150);
  // Move and delete through the existing gestures.
  await drag(send, point, { x: point.x + 40, y: point.y + 20 });
  const moved = await state(send);
  await key(send, "Delete");
  const deleted = await state(send);
  // Undo the delete: one inverse, hint visible with the label.
  await key(send, "z", 4); // Meta (Cmd) on macOS; Ctrl is 2
  const undone = await state(send);
  const hintShot = await shot(send, `P4-21-history-hint-${vp.name}.png`);
  await delay(3200);
  const hidden = await state(send);
  // Redo re-applies the delete.
  await key(send, "z", 4 | 8); // Shift+Cmd
  const redone = await state(send);
  checks.push({ name: `${vp.name}: move/delete work, undo applies one inverse with the 3 s hint, redo re-applies`, passed: moved.last !== null && deleted.last === "group" && undone.history.undoDepth === 2 && undone.history.redoDepth === 1 && undone.hint?.visible === true && String(undone.hint?.text ?? "").startsWith("Undo: ") && hidden.hint?.visible === false && redone.history.undoDepth === 3 && redone.history.redoDepth === 0, actual: { moved, deleted, undone, hidden, redone } });
  // 20-step series on a fresh session: 21 duplicates -> depth 20; 20 undos -> empty.
  await go(send, `http://127.0.0.1:${slot.ports.playground}/apps/engine-playground/?scene=layers&store=off`);
  await click(send, point); await delay(150);
  for (let index = 0; index < 21; index += 1) await key(send, "d", 4);
  const capped = await state(send);
  for (let index = 0; index < 20; index += 1) await key(send, "z", 4);
  const emptied = await state(send);
  checks.push({ name: `${vp.name}: the history keeps 20 steps and 20 undos empty it`, passed: capped.history.undoDepth === 20 && emptied.history.undoDepth === 0, actual: { capped: capped.history, emptied: emptied.history } });
  // Field focus: Cmd/Ctrl+Z stays with the field (no board action).
  await ev(send, "(() => { const input = document.createElement('input'); input.id = 'field-probe'; document.body.append(input); input.focus(); return true; })()");
  const beforeField = await state(send);
  await key(send, "z", 4);
  const afterField = await state(send);
  await ev(send, "document.querySelector('#field-probe')?.remove()");
  checks.push({ name: `${vp.name}: a focused field keeps its own undo`, passed: afterField.history.undoDepth === beforeField.history.undoDepth && afterField.history.redoDepth === beforeField.history.redoDepth, actual: { beforeField, afterField } });
  const finalShot = await shot(send, `P4-21-history-final-${vp.name}.png`);
  return { viewport: vp, checks, hintShot, finalShot };
}

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const handle = await serve(slot.ports.playground);
  const record = { task: "P4-21", gate: "history-capture", startedAt: new Date().toISOString(), chrome: chromePath(), flags: FLAGS, checks: [], result: "fail", exitCode: 1 };
  try {
    for (const vp of VIEWPORTS) {
      const port = await freePort();
      const profile = join(tmpdir(), `p421-history-${process.pid}-${vp.name}`);
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
    for (const check of record.checks) process.stdout.write(`${check.passed ? "pass" : "FAIL"} ${check.name}${check.passed ? "" : ` (actual ${JSON.stringify(check.actual).slice(0, 800)})`}\n`);
  } catch (error) { record.result = "infra"; record.resultReason = String(error); record.exitCode = 3; process.stderr.write(`capture-history: ${error.message}\n`); }
  finally { await new Promise((ok) => handle.close(ok)); }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-21-history-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: reviews/evidence/P4-21-history-${slug}.json\n`);
  process.exitCode = record.exitCode;
}
await main();
