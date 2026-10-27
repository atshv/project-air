#!/usr/bin/env node
// Idle-rendering evidence for the engine playground (P4-07 / L19).
//
//   node packages/engine/test/idle/run-idle.mjs [--task <task-id>]
//
//   `--task <task-id>` names the evidence file and its `task` field after the
//   task that runs the harness (default P4-07, the harness's origin), the same
//   convention as run-perf.mjs and run-visual.mjs, so a later task's re-run never
//   masquerades as P4-07 evidence.
//
// The playground draws only on change (camera, document, resize) and stops
// requestAnimationFrame while idle, so an idle canvas produces no frames. This
// tool measures that in a real browser and records it:
//
//   1. load the sample scene, wait for the deterministic ready hook and let the
//      load-time resize settle;
//   2. sample `frameCount()` over a full second: the delta must be 0;
//   3. run the L19 fit action with the `f` key: the counter must advance;
//   4. sample a second idle second: the delta must be 0 again;
//   5. change the viewport through the DevTools protocol (a resize): the counter
//      must advance, and a third idle second must stay at 0;
//   6. control: load benchmark mode (`?bench=…`, untouched continuous loop) and
//      sample one second; its frame counter must advance, proving the benchmark
//      loop is still continuous and that the idle result is not a broken page.
//
// The record is written to reviews/evidence/<task-id>-idle-<timestamp>.json
// (`P4-07` is the default). Exit
// codes: 0 pass, 1 assertion failed, 3 infra (missing artefacts, no Chrome, port
// busy, page not ready). The tool starts and stops only its own server and
// browser and removes its temporary folder.
//
// Browser: Chrome for Testing from the local Playwright cache (CHROME_PATH wins)
// with the perf-baseline flags plus `--no-sandbox`, the documented local flag of
// docs/gates/perf.md; the renderer string is recorded. No baseline is involved,
// so a software renderer does not hide the frame count.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  cpus,
  homedir,
  release as osRelease,
  tmpdir,
  totalmem,
  type as osType,
  version as osVersion,
} from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const EVIDENCE_DIR = join(REPO_ROOT, "reviews", "evidence");
const HARNESS_RELATIVE = "packages/engine/test/idle/run-idle.mjs";
const DEFAULT_TASK = "P4-07";
const GATE = "idle";

// Evidence prefix/`task` field; `--task <id>` overrides it for a task that runs
// the harness, so its record does not masquerade as the P4-07 origin.
let evidenceTask = DEFAULT_TASK;

// The measurement contract mirrored in docs/engine.md: one whole idle second.
const IDLE_WINDOW_MS = 1000;
// Time a change gets to request and draw its one frame before the counter is read.
const CHANGE_SETTLE_MS = 400;
// Load-time resize/ready stragglers must be gone before the first idle window.
const LOAD_SETTLE_MS = 400;
// Benchmark control: a document small enough to start fast and a sample count
// large enough that the unchanged continuous loop is still running after 3 s.
const BENCH_CONTROL_RECTANGLES = 1000;
const BENCH_CONTROL_SAMPLES = 100000;
const PAGE_TIMEOUT_MS = 30000;

const REQUIRED_ARTEFACTS = [
  "apps/engine-playground/index.html",
  "apps/engine-playground/main.js",
  "apps/engine-playground/playground.css",
  "packages/ui-kit/tokens.css",
  "packages/engine/dist/bridge/engine.js",
  "packages/engine/dist/bridge/text-atlas.js",
  "packages/engine/build-wasm/engine.js",
  "packages/engine/build-wasm/engine.wasm",
  "packages/test-kit/dist/scenes.js",
];

const BASE_CHROME_FLAGS = [
  "--headless=new",
  "--use-angle=metal",
  "--enable-gpu",
  "--hide-scrollbars",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--window-size=1440,900",
];
const CHROME_FLAGS = [...BASE_CHROME_FLAGS, "--no-sandbox"];

const LOCAL_CHROME_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");

const RENDERER_EXPRESSION = `(() => {
  const canvas = document.querySelector("#canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return "unavailable";
  }
  const gl = canvas.getContext("webgl2");
  if (gl === null) {
    return "unavailable";
  }
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  if (extension === null) {
    return "unknown";
  }
  return String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL));
})()`;

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

class HarnessError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "HarnessError";
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new HarnessError(message, exitCode);
}

function timestampSlug(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function readSlotPort(service = "playground") {
  const slotPath = join(REPO_ROOT, ".polier-slot");
  if (!existsSync(slotPath)) {
    fail(`missing ${slotPath}; acquire a Polier slot for this worktree first`, 3);
  }
  let slot;
  try {
    slot = JSON.parse(readFileSync(slotPath, "utf8"));
  } catch {
    fail(`${slotPath} is not valid JSON`, 3);
  }
  const port = slot?.ports?.[service];
  if (!Number.isInteger(port)) {
    fail(`${slotPath} has no integer ports.${service}`, 3);
  }
  return port;
}

function ensureArtefacts() {
  const missing = REQUIRED_ARTEFACTS.filter((relative) => !existsSync(join(REPO_ROOT, relative)));
  if (missing.length > 0) {
    fail(
      `missing build artefacts: ${missing.join(", ")}; run "pnpm --filter @project-air/engine run build", "bash packages/engine/tools/build-wasm.sh" and "pnpm --filter @project-air/test-kit run build" first`,
      3,
    );
  }
}

function copyArtefacts(tempRoot) {
  cpSync(join(REPO_ROOT, "apps/engine-playground"), join(tempRoot, "apps/engine-playground"), {
    recursive: true,
  });
  const files = [
    "packages/ui-kit/tokens.css",
    "packages/engine/dist/bridge/engine.js",
    "packages/engine/dist/bridge/text-atlas.js",
    "packages/engine/build-wasm/engine.js",
    "packages/engine/build-wasm/engine.wasm",
    "packages/test-kit/dist/scenes.js",
  ];
  for (const relative of files) {
    const destination = join(tempRoot, relative);
    mkdirSync(join(destination, ".."), { recursive: true });
    cpSync(join(REPO_ROOT, relative), destination);
  }
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function startStaticServer(tempRoot, port) {
  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith("/")) {
        pathname += "index.html";
      }
      const filePath = resolve(tempRoot, `.${pathname}`);
      if (!filePath.startsWith(resolve(tempRoot) + "/")) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const body = readFileSync(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        rejectServer(
          new HarnessError(`port ${port} is already in use; rerun alone (exclusive browser tool)`, 3),
        );
        return;
      }
      rejectServer(error);
    });
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

function findChrome() {
  const candidates = [];
  const override = process.env.CHROME_PATH;
  if (typeof override === "string" && override.length > 0) {
    candidates.push({ path: override, source: "CHROME_PATH" });
  }
  if (existsSync(LOCAL_CHROME_CACHE)) {
    for (const entry of readdirSync(LOCAL_CHROME_CACHE).sort()) {
      if (!entry.startsWith("chromium-")) {
        continue;
      }
      for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
        candidates.push({
          path: join(
            LOCAL_CHROME_CACHE,
            entry,
            arch,
            "Google Chrome for Testing.app",
            "Contents",
            "MacOS",
            "Google Chrome for Testing",
          ),
          source: "local Playwright cache default",
        });
      }
    }
  }
  candidates.push({
    path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    source: "Applications fallback",
  });
  candidates.push({
    path: "/Applications/Chromium.app/Contents/MacOS/Chromium",
    source: "Applications fallback",
  });
  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return candidate;
    }
  }
  fail("no Chrome found; set CHROME_PATH to a Chrome for Testing binary", 3);
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForDebugPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (page !== undefined) {
          return page;
        }
      }
    } catch {
      // not up yet
    }
    await delay(200);
  }
  fail(`Chrome debug port ${port} did not expose a page target`, 3);
}

function cdpClient(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (typeof message.id === "number" && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  return (method, params = {}) =>
    new Promise((resolveCall) => {
      nextId += 1;
      pending.set(nextId, resolveCall);
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
}

async function sendChecked(send, method, params = {}) {
  const response = await send(method, params);
  if (response.error !== undefined) {
    throw new HarnessError(
      `DevTools ${method} failed: ${response.error.message ?? JSON.stringify(response.error)}`,
      3,
    );
  }
  return response;
}

async function evaluate(send, expression, { awaitPromise = false } = {}) {
  const response = await sendChecked(send, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (response.result?.exceptionDetails !== undefined) {
    const text = response.result.exceptionDetails.text ?? "unknown page exception";
    throw new HarnessError(`page evaluation failed: ${text}`, 3);
  }
  return response.result?.result?.value;
}

async function waitForPlayground(send, timeoutMs = PAGE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "the playground object never appeared";
  while (Date.now() < deadline) {
    try {
      const present = await evaluate(send, "typeof globalThis.__enginePlayground === 'object'");
      if (present === true) {
        const raw = await evaluate(
          send,
          "globalThis.__enginePlayground.ready.then((state) => JSON.stringify(state))",
          { awaitPromise: true },
        );
        if (typeof raw === "string") {
          const state = JSON.parse(raw);
          if (state.ok === true) {
            return state;
          }
          lastError = state.error ?? "the engine reported that it did not start";
          break;
        }
        lastError = "the ready hook did not resolve";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  fail(`the playground did not become ready: ${lastError}`, 3);
}

async function launchChrome({ chrome, tempRoot, pageUrl, stderrLines }) {
  const debugPort = await getFreePort();
  const userDataDir = join(tempRoot, "chrome-profile");
  const child = spawn(
    chrome.path,
    [
      ...CHROME_FLAGS,
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${debugPort}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.split("\n")) {
      if (line.trim().length > 0 && stderrLines.length < 20) {
        stderrLines.push(line.trim());
      }
    }
  });
  console.log(`chrome: ${chrome.path} (source: ${chrome.source})`);
  console.log(`flags: ${CHROME_FLAGS.join(" ")}`);
  try {
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once(
        "error",
        (error) => rejectSpawn(new HarnessError(`cannot start Chrome: ${error.message}`, 3)),
      );
    });
    const page = await waitForDebugPort(debugPort);
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen) => socket.addEventListener("open", resolveOpen, { once: true }));
    const send = cdpClient(socket);
    await sendChecked(send, "Runtime.enable");
    await sendChecked(send, "Page.enable");
    const browserVersion = await sendChecked(send, "Browser.getVersion");
    console.log(`url: ${pageUrl}`);
    return { child, send, browserVersion };
  } catch (error) {
    child.kill("SIGTERM");
    await new Promise((resolveExit) => child.once("exit", resolveExit));
    throw error;
  }
}

function waitForExit(processHandle, timeoutMs) {
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs);
    processHandle.once("exit", () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

function hardwareInfo() {
  const cpuList = cpus();
  return {
    model: cpuList[0]?.model ?? "unknown",
    logicalCores: cpuList.length,
    memoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    arch: process.arch,
    os: { type: osType(), release: osRelease(), version: osVersion() },
    node: process.version,
  };
}

async function frameCount(send) {
  const value = await evaluate(send, "globalThis.__enginePlayground.frameCount()");
  if (typeof value !== "number") {
    fail("the page did not expose a numeric frame counter", 3);
  }
  return value;
}

async function idleWindow(send, label) {
  const framesBefore = await frameCount(send);
  await delay(IDLE_WINDOW_MS);
  const framesAfter = await frameCount(send);
  return {
    label,
    windowMs: IDLE_WINDOW_MS,
    framesBefore,
    framesAfter,
    framesDelta: framesAfter - framesBefore,
  };
}

function parseTaskArgument(args) {
  const index = args.indexOf("--task");
  if (index < 0) {
    return;
  }
  const task = args[index + 1];
  if (task === undefined || task.startsWith("--") || !/^[A-Za-z0-9_.-]+$/.test(task)) {
    fail("--task needs a task id such as P4-10");
  }
  evidenceTask = task;
}

async function run() {
  parseTaskArgument(process.argv.slice(2));
  const startedAt = new Date();
  const slug = timestampSlug(startedAt);
  const command = `node ${HARNESS_RELATIVE} --task ${evidenceTask}`;
  ensureArtefacts();
  const port = readSlotPort("playground");
  const baseUrl = `http://127.0.0.1:${port}/apps/engine-playground/`;
  const sampleUrl = `${baseUrl}?scene=sample`;
  const benchmarkUrl = `${baseUrl}?bench=${BENCH_CONTROL_RECTANGLES}&samples=${BENCH_CONTROL_SAMPLES}&warmup=0`;
  const stderrLines = [];
  const record = {
    task: evidenceTask,
    gate: GATE,
    command,
    timestamp: startedAt.toISOString(),
    measurement: {
      idleWindowMs: IDLE_WINDOW_MS,
      changeSettleMs: CHANGE_SETTLE_MS,
      rule: "on-demand rendering: a camera, document or resize change renders one frame; an idle canvas renders none",
      counter: "window.__enginePlayground.frameCount() (getState().framesRendered)",
    },
    urls: { sample: sampleUrl, benchmarkControl: benchmarkUrl },
    hardware: hardwareInfo(),
    browser: null,
    renderer: null,
    ready: null,
    page: null,
    windows: [],
    cameraAfterFit: null,
    benchmarkControl: null,
    assertions: [],
    result: "fail",
    resultReason: "",
  };

  let server = null;
  let child = null;
  let exitCode = 1;
  try {
    const tempRoot = mkdtempSync(join(tmpdir(), "p407-idle-"));
    copyArtefacts(tempRoot);
    console.log(`serve ${tempRoot} on ${baseUrl}`);
    server = await startStaticServer(tempRoot, port);
    const chrome = findChrome();
    const session = await launchChrome({ chrome, tempRoot, pageUrl: sampleUrl, stderrLines });
    child = session.child;
    const { send, browserVersion } = session;
    record.browser = {
      product: browserVersion.result?.product ?? "unknown",
      revision: browserVersion.result?.revision ?? "unknown",
      executable: chrome.path,
      source: chrome.source,
      flags: CHROME_FLAGS,
    };

    await sendChecked(send, "Page.navigate", { url: sampleUrl });
    record.ready = await waitForPlayground(send);
    record.renderer = String(await evaluate(send, RENDERER_EXPRESSION));
    record.page = JSON.parse(
      await evaluate(
        send,
        `JSON.stringify({
          inner: { width: window.innerWidth, height: window.innerHeight },
          devicePixelRatio: window.devicePixelRatio || 1,
          canvas: (() => {
            const canvas = document.querySelector("#canvas");
            const bounds = canvas === null ? null : canvas.getBoundingClientRect();
            return bounds === null ? null : {
              cssWidth: Math.round(bounds.width),
              cssHeight: Math.round(bounds.height),
              pixelWidth: canvas.width,
              pixelHeight: canvas.height
            };
          })(),
          state: globalThis.__enginePlayground.getState(),
          error: document.querySelector("#error")?.textContent ?? ""
        })`,
      ),
    );

    // 1) An idle second after the load settles.
    await delay(LOAD_SETTLE_MS);
    record.windows.push(await idleWindow(send, "idle-after-load"));

    // 2) The L19 fit action through the user path (`f`); the counter must advance.
    const framesBeforeFit = await frameCount(send);
    await evaluate(
      send,
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))",
    );
    await delay(CHANGE_SETTLE_MS);
    const framesAfterFit = await frameCount(send);
    record.windows.push({
      label: "fit-action",
      change: "keyboard `f`",
      framesBefore: framesBeforeFit,
      framesAfter: framesAfterFit,
      framesDelta: framesAfterFit - framesBeforeFit,
    });
    record.cameraAfterFit = JSON.parse(
      await evaluate(send, "JSON.stringify(globalThis.__enginePlayground.getState().camera)"),
    );

    // 3) Idle again after the camera change.
    record.windows.push(await idleWindow(send, "idle-after-fit"));

    // 4) A resize change must render, then the canvas must go quiet again.
    const framesBeforeResize = await frameCount(send);
    await sendChecked(send, "Emulation.setDeviceMetricsOverride", {
      width: 1200,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(CHANGE_SETTLE_MS);
    const framesAfterResize = await frameCount(send);
    record.windows.push({
      label: "resize",
      change: "Emulation.setDeviceMetricsOverride 1200x800",
      framesBefore: framesBeforeResize,
      framesAfter: framesAfterResize,
      framesDelta: framesAfterResize - framesBeforeResize,
    });
    record.windows.push(await idleWindow(send, "idle-after-resize"));

    // 5) Control: the benchmark loop is untouched and keeps rendering continuously.
    // Its own `frameTimesMs` array grows once per sampled frame, so its length is a
    // live frame counter that needs no change to the benchmark loop.
    await sendChecked(send, "Page.navigate", { url: benchmarkUrl });
    await waitForPlayground(send);
    await delay(LOAD_SETTLE_MS);
    const benchmarkFrames = () =>
      evaluate(
        send,
        "Array.isArray(window.__engineBenchmark?.frameTimesMs) ? window.__engineBenchmark.frameTimesMs.length : -1",
      );
    const benchmarkBefore = Number(await benchmarkFrames());
    await delay(IDLE_WINDOW_MS);
    const benchmarkAfter = Number(await benchmarkFrames());
    record.benchmarkControl = {
      label: "benchmark-continuous-loop",
      windowMs: IDLE_WINDOW_MS,
      framesBefore: benchmarkBefore,
      framesAfter: benchmarkAfter,
      framesDelta: benchmarkAfter - benchmarkBefore,
      note: "benchmark mode keeps its continuous rAF loop; the counter is the length of the page's own frameTimesMs sample array",
    };
    record.benchmarkUrl = benchmarkUrl;

    const windowOf = (label) => record.windows.find((window) => window.label === label);
    const idleAfterLoad = windowOf("idle-after-load");
    const fitAction = windowOf("fit-action");
    const idleAfterFit = windowOf("idle-after-fit");
    const resize = windowOf("resize");
    const idleAfterResize = windowOf("idle-after-resize");
    const check = (name, passed, expected, actual) => {
      record.assertions.push({ name, passed, expected, actual });
    };
    check(
      "idle one second after load renders zero frames",
      idleAfterLoad?.framesDelta === 0,
      0,
      idleAfterLoad?.framesDelta,
    );
    check(
      "the fit action renders a frame",
      (fitAction?.framesDelta ?? 0) >= 1,
      ">= 1",
      fitAction?.framesDelta,
    );
    check(
      "idle one second after the fit action renders zero frames",
      idleAfterFit?.framesDelta === 0,
      0,
      idleAfterFit?.framesDelta,
    );
    check(
      "a resize renders a frame",
      (resize?.framesDelta ?? 0) >= 1,
      ">= 1",
      resize?.framesDelta,
    );
    check(
      "idle one second after the resize renders zero frames",
      idleAfterResize?.framesDelta === 0,
      0,
      idleAfterResize?.framesDelta,
    );
    check(
      "the benchmark control keeps rendering continuously",
      (record.benchmarkControl?.framesDelta ?? 0) > 0,
      "> 0",
      record.benchmarkControl?.framesDelta,
    );
    check("the page reported no error", record.page?.error === "", "", record.page?.error);
    check(
      "the fit action returns the L19 camera",
      record.cameraAfterFit !== null &&
        record.cameraAfterFit.zoom <= 1.0 &&
        record.cameraAfterFit.zoom >= 0.1,
      "zoom within 0.1 … 1.0",
      record.cameraAfterFit,
    );

    record.finishedAt = new Date().toISOString();
    record.durationMs = new Date(record.finishedAt).getTime() - startedAt.getTime();
    const failures = record.assertions.filter((assertion) => !assertion.passed);
    record.result = failures.length === 0 ? "pass" : "fail";
    record.resultReason =
      failures.length === 0
        ? "every idle window rendered zero frames; both changes and the benchmark control rendered"
        : `${failures.length} assertion(s) failed`;
    exitCode = failures.length === 0 ? 0 : 1;

    for (const window of record.windows) {
      console.log(
        `${window.label}: ${window.framesBefore} -> ${window.framesAfter} (${window.framesDelta >= 0 ? "+" : ""}${window.framesDelta} frames in ${window.windowMs ?? "change"} ${window.windowMs === undefined ? "settle" : "ms"})`,
      );
    }
    console.log(
      `benchmark control: ${record.benchmarkControl.framesBefore} -> ${record.benchmarkControl.framesAfter} (+${record.benchmarkControl.framesDelta} frames)`,
    );
    console.log(
      `fit camera: panX ${record.cameraAfterFit.panX.toFixed(3)}, panY ${record.cameraAfterFit.panY.toFixed(3)}, zoom ${record.cameraAfterFit.zoom.toFixed(4)}`,
    );
    console.log(`renderer: ${record.renderer}`);
    for (const assertion of record.assertions) {
      console.log(
        `${assertion.passed ? "pass" : "FAIL"} ${assertion.name}: expected ${JSON.stringify(assertion.expected)}, actual ${JSON.stringify(assertion.actual)}`,
      );
    }
    console.log(`result: ${record.result}${record.result === "pass" ? "" : ` — ${record.resultReason}`}`);
  } catch (error) {
    record.finishedAt = new Date().toISOString();
    record.result = error instanceof HarnessError && error.exitCode === 3 ? "infra" : "fail";
    record.resultReason = error instanceof Error ? error.message : String(error);
    record.error = record.resultReason;
    exitCode = record.result === "infra" ? 3 : 1;
    console.error(`${GATE}: ${record.resultReason}`);
  } finally {
    if (server !== null) {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    if (child !== null) {
      child.kill("SIGTERM");
      await waitForExit(child, 5000);
    }
  }

  record.chromeStderr = stderrLines;
  record.exitCode = exitCode;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const relative = join("reviews", "evidence", `${evidenceTask}-idle-${slug}.json`);
  writeFileSync(join(REPO_ROOT, relative), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`evidence: ${relative}`);
  process.exitCode = exitCode;
}

await run();
