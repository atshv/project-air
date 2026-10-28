#!/usr/bin/env node
// P4-20 (L12) deterministic keyboard/context-menu capture: Cmd/Ctrl+D duplicate,
// Del delete, arrow nudge series (16/160 px, one operation after 300 ms) and the
// Shift+F10 context menu operated by keyboard. Desktop 1440x900, mobile 390x844.

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
  socket.addEventListener("message", (event) => { const m = JSON.parse(event.data); if (m.method === "Runtime.exceptionThrown") console.error("PAGE EXC", JSON.stringify(m.params.exceptionDetails?.exception?.description ?? m.params).slice(0, 400)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method && events.has(m.method)) { events.get(m.method)(m.params); events.delete(m.method); } });
  const send = (method, params = {}) => new Promise((ok, no) => { id += 1; const t = setTimeout(() => no(new Error(`${method} timed out`)), 15000); pending.set(id, (m) => { clearTimeout(t); ok(m); }); socket.send(JSON.stringify({ id, method, params })); });
  send.event = (method) => new Promise((ok) => { events.set(method, ok); });
  return send;
}
async function ev(send, expression, awaitPromise = false) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result?.exceptionDetails) return `EXC ${r.result.exceptionDetails.text}`; return r.result?.result?.value; }
async function go(send, url) { const loaded = send.event("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded.catch(() => undefined); for (let i = 0; i < 120; i += 1) { const raw = await ev(send, "globalThis.__enginePlayground?.ready.then((s) => JSON.stringify(s)) ?? null", true); if (typeof raw === "string") { if (JSON.parse(raw).ok !== true) fail(raw); break; } await delay(250); } await delay(400); }
async function shot(send, name) { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); writeFileSync(join(EVIDENCE, name), Buffer.from(String(r.result.data), "base64")); return `reviews/evidence/${name}`; }
const click = (send, point) => Promise.all([send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 }), send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 })]);
const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, F10: 121, Enter: 13 };
async function key(send, key, modifiers = 0) {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: VK[key] ?? 0 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: VK[key] ?? 0 });
  await delay(80);
}
const state = async (send) => JSON.parse(await ev(send, "JSON.stringify({ selection: globalThis.__engineSelection.ids(), keyboard: globalThis.__engineKeyboard.last(), menu: globalThis.__engineKeyboard.menu(), last: (() => { const p = globalThis.__engineKeyboard.lastOperation(); return p === null || p === undefined ? null : { operation: p.operation, inverse: p.inverse }; })() })"));

async function run(send, vp) {
  const checks = [];
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  await go(send, `http://127.0.0.1:${slot.ports.playground}/apps/engine-playground/?scene=layers&store=off`);
  const point = JSON.parse(await ev(send, "(() => { const c = document.querySelector('#canvas'); const b = c.getBoundingClientRect(); return JSON.stringify({ x: b.left + c.clientWidth / 2, y: b.top + c.clientHeight / 2 }); })()"));
  await click(send, point); await delay(200);
  const selected = await state(send);
  checks.push({ name: `${vp.name}: a card is selected`, passed: selected.selection.length === 1, actual: selected.selection });
  // Nudge series first (fresh selection): two arrow presses, one operation after 300 ms.
  await key(send, "ArrowRight"); await key(send, "ArrowRight");
  const pending = await state(send);
  await delay(500);
  const nudged = await state(send);
  checks.push({ name: `${vp.name}: an arrow series commits one keyboard-nudge after 300 ms`, passed: nudged.keyboard?.intent === "nudge" && nudged.keyboard?.delta?.dx === 32 && ["moveCard", "group"].includes(nudged.last?.operation ?? ""), actual: { pending, nudged } });
  // Duplicate with Cmd/Ctrl+D (+16/+16).
  await key(send, "d", 4);
  await key(send, "d", 8);
  await delay(250);
  const duplicated = await state(send);
  checks.push({ name: `${vp.name}: Cmd/Ctrl+D duplicates as one create operation`, passed: duplicated.keyboard?.intent === "duplicate" && duplicated.last?.operation === "createCard" && duplicated.last?.inverse === "deleteCard" && duplicated.keyboard?.offset?.x === 16, actual: duplicated });
  const duplicateShot = await shot(send, `P4-20-keyboard-duplicate-${vp.name}.png`);
  // Delete the selection as one operation.
  await key(send, "Delete");
  await delay(250);
  const deleted = await state(send);
  checks.push({ name: `${vp.name}: Del deletes the selection as one operation`, passed: ["deleteCard", "group"].includes(deleted.last?.operation ?? "") && ["createCard", "group"].includes(deleted.last?.inverse ?? ""), actual: deleted });
  const deleteShot = await shot(send, `P4-20-keyboard-delete-${vp.name}.png`);
  // Context menu by Shift+F10, operated by keyboard.
  await click(send, point); await delay(150);
  await key(send, "F10", 8);
  await delay(150);
  const opened = await state(send);
  await key(send, "ArrowDown");
  const moved = await state(send);
  await key(send, "Enter");
  await delay(250);
  const menuAction = await state(send);
  checks.push({
    name: `${vp.name}: the context menu opens by keyboard, navigates and duplicates`,
    passed: opened.menu.open === true && moved.menu.index === 1 && menuAction.menu.open === false && menuAction.keyboard?.intent === "duplicate" && menuAction.last?.operation === "createCard",
    actual: { opened, moved, menuAction },
  });
  const menuShot = await shot(send, `P4-20-keyboard-menu-${vp.name}.png`);
  return { viewport: vp, checks, duplicateShot, deleteShot, menuShot };
}

async function main() {
  const slot = JSON.parse(readFileSync(join(ROOT, ".polier-slot"), "utf8"));
  const handle = await serve(slot.ports.playground);
  const record = { task: "P4-20", gate: "keyboard-capture", startedAt: new Date().toISOString(), chrome: chromePath(), flags: FLAGS, checks: [], result: "fail", exitCode: 1 };
  try {
    for (const vp of VIEWPORTS) {
      const port = await freePort();
      const profile = join(tmpdir(), `p420-keyboard-${process.pid}-${vp.name}`);
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
    for (const check of record.checks) process.stdout.write(`${check.passed ? "pass" : "FAIL"} ${check.name}${check.passed ? "" : ` (actual ${JSON.stringify(check.actual).slice(0, 700)})`}\n`);
  } catch (error) { record.result = "infra"; record.resultReason = String(error); record.exitCode = 3; process.stderr.write(`capture-keyboard: ${error.message}\n`); }
  finally { await new Promise((ok) => handle.close(ok)); }
  record.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE, { recursive: true });
  const slug = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  writeFileSync(join(EVIDENCE, `P4-20-keyboard-${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`evidence: reviews/evidence/P4-20-keyboard-${slug}.json\n`);
  process.exitCode = record.exitCode;
}
await main();
