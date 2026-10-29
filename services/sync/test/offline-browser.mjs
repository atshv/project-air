#!/usr/bin/env node
// P5-07 browser proof attempt (stage exit "two offline browsers"): two headless
// Chrome pages import the built SDK/crdt ESM through an import map (bare `yjs`),
// join the real sync service, one page goes offline and edits, both reconnect and
// converge, then A undoes only its own operation. Writes reviews/evidence and
// sets browser:true/false with the exact blocker.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createYjsBoardDoc } from "../../../packages/crdt/dist/packages/crdt/src/index.js";
import { createSyncService } from "../src/service.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE = JSON.parse(readFileSync(join(ROOT, "packages/contracts/fixtures/board-content/valid.json"), "utf8")).data;
const BOARD_ID = FIXTURE.board.id;
const EMPTY = { ...FIXTURE, zones: [], blocks: [], cards: [], notes: [], edges: [] };
const CARD_A = "0192f0fc-7000-7000-8000-0000000000a1";
const CARD_B = "0192f0fc-7000-7000-8000-0000000000b1";
const CLIENT_A = "0192f0fa-7000-7000-8000-0000000000c1";
const CLIENT_B = "0192f0fa-7000-7000-8000-0000000000c2";
const assertStore = (condition, message) => { if (!condition) throw new Error(message); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json" };

function chromePath() {
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  for (const entry of readdirSync(cache).sort()) if (entry.startsWith("chromium-")) {
    const path = join(cache, entry, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
    if (existsSync(path)) return path;
  }
  throw new Error("Chrome for Testing not found");
}

function staticServer(yjsPath) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    let file = null;
    if (url.pathname === "/") file = "/page.html";
    else if (url.pathname === "/page.html") {
      response.writeHead(200, { "content-type": TYPES[".html"] });
      response.end(pageHtml(yjsPath, url.searchParams.get("clientId") ?? "", url.searchParams.get("port") ?? ""));
      return;
    } else if (url.pathname === "/vendor/yjs.mjs") file = yjsPath;
    else if (url.pathname.startsWith("/sdk/")) file = join(ROOT, "packages/sdk/dist/sdk/src", url.pathname.slice(5));
    else if (url.pathname.startsWith("/crdt/")) file = join(ROOT, "packages/crdt/dist/packages/crdt/src", url.pathname.slice(6));
    else if (url.pathname === "/vendor/isomorphic-browser.mjs") file = join(ROOT, "node_modules/.pnpm/isomorphic.js@0.2.5/node_modules/isomorphic.js/browser.mjs");
    else if (url.pathname.startsWith("/vendor/lib0/")) {
      const relative = url.pathname.slice("/vendor/lib0/".length);
      const base = join(ROOT, "node_modules/.pnpm/lib0@0.2.119/node_modules/lib0", relative);
      file = existsSync(base) ? base : `${base}.js`;
    }
    if (file === null || !existsSync(file)) { process.stderr.write(`404 ${url.pathname}\n`); response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  return new Promise((resolveServer) => server.listen(0, "127.0.0.1", () => resolveServer(server)));
}

function pageHtml(yjsPath, clientId, port) {
  void yjsPath;
  return `<!doctype html><html><head><title>starting</title>
<script type="importmap">{"imports":{"@project-air/crdt":"/crdt/index.js","yjs":"/vendor/yjs.mjs","lib0/":"/vendor/lib0/","lib0":"/vendor/lib0/","isomorphic.js":"/vendor/isomorphic-browser.mjs"}}</script></head><body>
<script>window.__fixture = ${JSON.stringify(EMPTY)}; window.__wire = [];</script>
<script type="module">
import { createBoardSyncClient } from "/sdk/index.js";
import { createYjsBoardDoc } from "/crdt/index.js";
const sockets = [];
const client = createBoardSyncClient({
  createSocket: () => {
    const ws = new WebSocket("ws://127.0.0.1:${port}/");
    sockets.push(ws);
    const log = (entry) => window.__wire.push(entry);
    ws.addEventListener("message", (event) => { const message = JSON.parse(String(event.data)); log({ dir: "in", type: message.type, seq: message.seq, serverSeq: message.serverSeq, clientId: message.clientId, boardId: message.boardId, fromServerSeq: message.payload?.fromServerSeq, batchId: message.payload?.batchId, opIds: message.payload?.operations?.map((operation) => operation.id) }); });
    const send = ws.send.bind(ws);
    ws.send = (data) => { const message = JSON.parse(String(data)); log({ dir: "out", type: message.type, seq: message.seq, serverSeq: message.serverSeq, clientId: message.clientId, boardId: message.boardId, fromServerSeq: message.payload?.fromServerSeq, batchId: message.payload?.batchId, opIds: message.payload?.operations?.map((operation) => operation.id) }); return send(data); };
    return ws;
  },
  boardId: "${BOARD_ID}", tokenRef: "test-token-ref", clientId: "${clientId}",
  createDocument: (content) => createYjsBoardDoc({ content }),
  initialContent: window.__fixture,
  backoff: { initialMs: 1500, maxMs: 1500 },
  onChange: (event) => window.__wire.push({ dir: "sdk", type: event.type, status: event.status, serverSeq: event.serverSeq }),
});
window.__browser = {
  join: () => client.start(),
  status: () => client.status(),
  serverSeq: () => client.serverSeq(),
  edit: (operation) => client.sendOperations([operation]),
  undo: () => client.undoOwn(),
  docJson: () => JSON.stringify(client.document().snapshot()),
  offlineClose: () => { const ws = sockets.at(-1); if (ws) ws.close(); },
  wire: () => window.__wire,
};
document.title = "ready";
</script></body></html>`;
}

function freePort() { const server = createServer(); return new Promise((resolvePort) => server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolvePort(port)); })); }

async function connectPage(chrome, pageUrl) {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "p507-browser-"));
  const child = spawn(chrome, ["--headless=new", "--no-sandbox", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
  const target = await (async () => {
    for (let index = 0; index < 100; index += 1) {
      try { const response = await fetch(`http://127.0.0.1:${port}/json/list`); const targets = await response.json(); const page = targets.find((entry) => entry.type === "page"); if (page !== undefined) return page; } catch { /* starting */ }
      await delay(150);
    }
    throw new Error("browser DevTools target never appeared");
  })();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen) => ws.addEventListener("open", resolveOpen, { once: true }));
  let nextId = 0; const pending = new Map();
  const pageErrors = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") pageErrors.push(String(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text).slice(0, 300));
    if (message.method === "Log.entryAdded") pageErrors.push(String(message.params?.entry?.text ?? "").slice(0, 300));
    if (message.method === "Network.responseReceived" && message.params?.response?.status === 404) pageErrors.push(`404 ${message.params.response.url}`);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const send = (method, params = {}) => new Promise((resolveSend) => { nextId += 1; pending.set(nextId, resolveSend); ws.send(JSON.stringify({ id: nextId, method, params })); });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 500));
    return result.result?.result?.value;
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
  await send("Page.navigate", { url: pageUrl });
  let ready = false;
  for (let index = 0; index < 100; index += 1) { if (await evaluate("document.title") === "ready") { ready = true; break; } await delay(150); }
  if (!ready) throw new Error(`page module failed: ${pageErrors.slice(0, 3).join(" | ")}`);
  return { child, ws, send, evaluate, targetId: target.id, pageErrors };
}

const card = (id) => ({ id, boardId: BOARD_ID, noteId: "0192f0fc-7000-7000-8000-0000000000d1", x: 0, y: 0, width: 176, height: 80, z: "a", createdAt: "2027-01-10T09:30:00.000Z", updatedAt: "2027-01-10T09:30:00.000Z" });
const createCard = (actor, id, tail) => ({
  id: `0192f0fc-7000-7000-8000-${String(tail).padStart(12, "0")}`, boardId: BOARD_ID,
  actorId: actor === "a" ? CLIENT_A : CLIENT_B, createdAt: new Date().toISOString(),
  type: "createCard", payload: { card: card(id) },
  inverse: { boardId: BOARD_ID, type: "deleteCard", payload: { card: card(id) } },
});
const move = (actor, cardId, x) => ({
  id: `0192f0fb-7000-7000-8000-${String(x).padStart(12, "0")}`, boardId: BOARD_ID,
  actorId: actor === "a" ? CLIENT_A : CLIENT_B, createdAt: new Date().toISOString(),
  type: "moveCard", payload: { cardId, x, y: 0 },
  inverse: { boardId: BOARD_ID, type: "moveCard", payload: { cardId, x: 0, y: 0 } },
});

async function waitJoined(page, timeoutMs = 12_000) {
  const started = Date.now();
  for (;;) {
    if (await page.evaluate("window.__browser.status()") === "joined") return;
    if (Date.now() - started > timeoutMs) throw new Error(`page did not join (status ${await page.evaluate("window.__browser.status()")})`);
    await delay(150);
  }
}

async function run() {
  const yjsPath = join(ROOT, "node_modules/.pnpm/yjs@13.6.27/node_modules/yjs/dist/yjs.mjs");
  const fixtureStore = (() => {
    let seq = 1; const updates = [];
    return {
      async serverSeq() { return seq; },
      async loadBoard() { return { serverSeq: seq, snapshotSeq: 1, boardContent: EMPTY }; },
      async appendUpdate(input) { seq += 1; updates.push({ serverSeq: seq, update: input.update }); return seq; },
      async updatesAfter(_board, from) { return updates.filter((entry) => entry.serverSeq > from); },
      get count() { return updates.length; },
    };
  })();
  const service = await createSyncService({
    host: "127.0.0.1", port: 0,
    authenticator: { authenticate: async (tokenRef) => (tokenRef === "test-token-ref" ? { userId: CLIENT_A } : null) },
    authorizer: { canJoin: async () => true },
    store: fixtureStore,
    documents: { fromContent: (content) => createYjsBoardDoc({ content }), fromEmpty: () => createYjsBoardDoc({ content: EMPTY }) },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const http = await staticServer(yjsPath);
  const serverPort = http.address().port;
  const chrome = chromePath();
  const evidence = { task: "P5-07", proof: "browser-offline", browser: false, servicePort: service.port, httpPort: serverPort, finishedAt: new Date().toISOString() };
  let pageA = null; let pageB = null;
  try {
    const urlA = `http://127.0.0.1:${serverPort}/page.html?clientId=${CLIENT_A}&port=${service.port}`;
    const urlB = `http://127.0.0.1:${serverPort}/page.html?clientId=${CLIENT_B}&port=${service.port}`;
    pageA = await connectPage(chrome, urlA);
    pageB = await connectPage(chrome, urlB);
    evidence.targets = { a: pageA.targetId, b: pageB.targetId };
    await pageA.evaluate("window.__browser.join()");
    await pageB.evaluate("window.__browser.join()");
    await waitJoined(pageA); await waitJoined(pageB);
    // Seed both cards through committed operations (empty baseline, so the join
    // replay can rebuild them from the update log deterministically).
    await pageA.evaluate(`window.__browser.edit(${JSON.stringify(createCard("a", CARD_A, 0x1001))})`);
    await pageB.evaluate(`window.__browser.edit(${JSON.stringify(createCard("b", CARD_B, 0x1002))})`);
    await delay(600);
    evidence.stateHashesBefore = { a: hash(await pageA.evaluate("window.__browser.docJson()")), b: hash(await pageB.evaluate("window.__browser.docJson()")) };

    // A edits online, then goes offline (socket closed); both edit offline.
    await pageA.evaluate(`window.__browser.edit(${JSON.stringify(move("a", CARD_A, 123))})`);
    await delay(700);
    // Unambiguous offline simulation: A's socket is closed (SDK offline path)
    // and its reconnect is delayed to 1500 ms by the injected backoff. B edits
    // and we WAIT until the service has durably appended that update, so the
    // reconnect moment is controlled and the welcome snapshot must contain B.
    const updatesBeforeOffline = fixtureStore.count;
    await pageA.evaluate("window.__browser.offlineClose()");
    await delay(150);
    await pageA.evaluate(`window.__browser.edit(${JSON.stringify(move("a", CARD_A, 200))})`);
    await pageB.evaluate(`window.__browser.edit(${JSON.stringify(move("b", CARD_B, 77))})`);
    for (let index = 0; index < 100 && fixtureStore.count <= updatesBeforeOffline + 1; index += 1) await delay(50);
    evidence.missedUpdatesWhileOffline = fixtureStore.count - updatesBeforeOffline;
    assertStore(evidence.missedUpdatesWhileOffline >= 1, "B's update is durable before A reconnects");
    await waitJoined(pageA);
    evidence.wireA = await pageA.evaluate("window.__browser.wire()");
    evidence.wireB = await pageB.evaluate("window.__browser.wire()");
    await delay(1500);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const [jsonA, jsonB] = [await pageA.evaluate("window.__browser.docJson()"), await pageB.evaluate("window.__browser.docJson()")];
      if (jsonA === jsonB) break;
      if (Date.now() > deadline) {
        evidence.debug = { statusA: await pageA.evaluate("window.__browser.status()"), statusB: await pageB.evaluate("window.__browser.status()"),
          seqA: await pageA.evaluate("window.__browser.serverSeq()"), seqB: await pageB.evaluate("window.__browser.serverSeq()"),
          cardsA: JSON.parse(jsonA).cards.map((card) => [card.id, card.x]), cardsB: JSON.parse(jsonB).cards.map((card) => [card.id, card.x]) };
        throw new Error("browser documents did not converge after reconnect");
      }
      await delay(200);
    }
    const docA = JSON.parse(await pageA.evaluate("window.__browser.docJson()"));
    const docB = JSON.parse(await pageB.evaluate("window.__browser.docJson()"));
    evidence.stateHashesAfterReconnect = { a: hash(JSON.stringify(docA)), b: hash(JSON.stringify(docB)) };
    const welcomeA = evidence.wireA.find((entry) => entry.dir === "in" && entry.type === "welcome" && entry.serverSeq >= 3);
    evidence.offlineRecovery = {
      welcomeAtCurrentSeq: welcomeA !== undefined,
      welcomeServerSeq: welcomeA?.serverSeq,
      snapshotServerSeq: evidence.wireA.find((entry) => entry.dir === "in" && entry.type === "snapshot" && entry.serverSeq >= 3)?.serverSeq,
      resyncFromServerSeq: evidence.wireA.find((entry) => entry.dir === "out" && entry.type === "resyncRequest")?.fromServerSeq,
      queuedOpSentCount: evidence.wireA.filter((entry) => entry.dir === "out" && entry.type === "operationBatch" && (entry.opIds ?? []).includes("0192f0fb-7000-7000-8000-000000000200")).length,
    };
    evidence.cardsAfterOffline = { a: docA.cards.find((card) => card.id === CARD_A).x, b: docB.cards.find((card) => card.id === CARD_B).x };

    // A undoes only its own newest op; B's edit stays and both converge.
    evidence.undoReturned = await pageA.evaluate("window.__browser.undo()");
    const undoDeadline = Date.now() + 10_000;
    for (;;) {
      const [jsonA, jsonB] = [await pageA.evaluate("window.__browser.docJson()"), await pageB.evaluate("window.__browser.docJson()")];
      if (jsonA === jsonB) break;
      if (Date.now() > undoDeadline) throw new Error("browser documents did not converge after undo");
      await delay(200);
    }
    const undoA = JSON.parse(await pageA.evaluate("window.__browser.docJson()"));
    const undoB = JSON.parse(await pageB.evaluate("window.__browser.docJson()"));
    evidence.stateHashesAfterUndo = { a: hash(JSON.stringify(undoA)), b: hash(JSON.stringify(undoB)) };
    evidence.cardsAfterUndo = { a: undoA.cards.find((card) => card.id === CARD_A).x, b: undoB.cards.find((card) => card.id === CARD_B).x };
    evidence.passed = evidence.cardsAfterUndo.a === 0 && evidence.cardsAfterUndo.b === 77 && evidence.cardsAfterOffline.b === 77 && evidence.stateHashesAfterUndo.a === evidence.stateHashesAfterUndo.b;
    evidence.browser = evidence.passed === true;
    if (!evidence.passed) throw new Error("browser proof assertions failed");
  } catch (error) {
    evidence.browser = false;
    evidence.blocker = String(error.message ?? error).slice(0, 500);
  } finally {
    for (const page of [pageA, pageB]) if (page !== null) { try { page.ws.close(); } catch { /* closed */ } page.child.kill("SIGTERM"); }
    await new Promise((done) => http.close(done));
    await service.close();
  }
  mkdirSync(join(ROOT, "reviews/evidence"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const path = join(ROOT, "reviews/evidence", `P5-07-browser-${stamp}.json`);
  writeFileSync(path, JSON.stringify(evidence, null, 2) + "\n");
  process.stdout.write(`browser proof: passed=${evidence.passed === true} browser=${evidence.browser} evidence=reviews/evidence/P5-07-browser-${stamp}.json\n`);
  if (evidence.blocker !== undefined) process.stdout.write(`blocker: ${evidence.blocker}\n`);
  process.exit(evidence.passed === true ? 0 : 1);
}

await run();
