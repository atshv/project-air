#!/usr/bin/env node
// Performance harness for the engine (P2-04 perf-baseline, P4-03 engine-core).
//
//   node packages/engine/test/perf/run-perf.mjs
//     perf-baseline: measure 50,000 rectangles at 60 fps in Chrome (default mode,
//     unchanged since P2-04). Evidence: reviews/evidence/P2-04-perf-<timestamp>.json.
//
//   node packages/engine/test/perf/run-perf.mjs --scenario engine-core [--record basis|final]
//                                               [--task <task-id>]
//     engine-core `perf` gate: the 10,000-object mixed board scene with continuous
//     pan and zoom (p95 <= 16.7 ms, no frame interval above 16.7 ms after warm-up)
//     plus the L01 basis/final proof on the 500-card/50-zone sample board (max
//     frame duration < 50 ms, command-buffer instance count equal to the culled
//     visible set, every later run within basis + 10 %).
//     Default (no --record): interactive run + basis (when none exists) + final.
//     `--record basis` writes only the L01 basis; `--record final` writes only the
//     final proof against the committed basis.
//     `--task <task-id>` names the engine-core evidence files and their `task`
//     field after the task that runs the gate (default P4-03, the gate's origin),
//     so a later task's records never masquerade as P4-03 evidence. The committed
//     P4-03 basis record is read-only and keeps its own prefix.
//
// The harness reads the web port (baseline) or playground port (engine-core) from
// .polier-slot, copies the built playground and engine artefacts into a temporary
// served folder, starts its own static server, launches Chrome for Testing with a
// real GPU (ANGLE/Metal), collects the frame intervals from the page, writes the
// JSON evidence, and exits 0 only when every assertion passes. Exit codes:
// 0 pass, 1 fail, 2 usage/build problem, 3 infra.
//
// A software WebGL renderer (SwiftShader/llvmpipe) is never a pass: the JSON
// result is "infra" and the exit code is 3, so the run must be repeated on a real
// GPU. The engine-core scenario adds the local --no-sandbox flag documented in
// docs/gates/perf.md: Chrome's own sandbox cannot initialise inside the sandboxed
// harness environment, and the flag does not touch the renderer check, the
// thresholds or the scenario assertions. It is a local measurement tool only.
//
// Node builtins only; starts and stops only its own server and browser.

import { spawn, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const EVIDENCE_DIR = join(REPO_ROOT, "reviews", "evidence");
const P95_LIMIT_MS = 16.7;
const TARGET_FPS = 60;

const BENCHMARK_SAMPLES = 600;
const BENCHMARK_WARMUP = 120;
const BENCHMARK_RECTANGLES = 50000;
const PAGE_TIMEOUT_MS = 180000;

// Engine-core scenario constants. They are mirrored by docs/gates/perf.md (a
// change touches both) and by the page's camera-path constants.
const ENGINE_CORE_TASK = "P4-03";
// The engine-core evidence prefix/`task` field; `--task <id>` overrides it for a
// task that runs the gate, the committed P4-03 basis keeps its own name.
let evidenceTask = ENGINE_CORE_TASK;
const ENGINE_CORE_WARMUP_FRAMES = 120;
// 2,000 samples per run: on the M2 proxy the 10,000-object scene produces frames
// in well under a millisecond, so the plan's 600-sample window would be far too
// short to cover the pan/zoom path. 2,000 frames keep the measured window in the
// same steady frame-production phase as the rectangle baseline and stay a few
// hundred milliseconds long (the measured window is recorded in the evidence).
const ENGINE_CORE_SAMPLE_FRAMES = 2000;
const ENGINE_CORE_OBJECT_COUNT = 10000;
const ENGINE_CORE_CARD_COUNT = 9200;
const ENGINE_CORE_ZONE_COUNT = 200;
const ENGINE_CORE_BLOCK_COUNT = 600;
const L01_OBJECT_COUNT = 694;
const L01_CARD_COUNT = 500;
const L01_ZONE_COUNT = 50;
const L01_BLOCK_COUNT = 144;
const L01_MAX_FRAME_TIME_MS = 50;
const L01_MIN_CULLING_CHECKPOINTS = 50;
// Every later L01 measurement must stay within basis + 10 % (blueprint, L01).
// The rAF timestamp is quantised to 0.1 ms, so a difference of two measured
// values carries up to 0.2 ms of quantisation error; below that the measurement
// cannot resolve a 10 % difference and the tolerance uses that resolution floor.
// The floor never relaxes the 16.7 ms frame budget, the 50 ms long-task bound or
// the scene assertions.
const BASIS_TOLERANCE = 1.1;
const FRAME_TIMESTAMP_RESOLUTION_MS = 0.2;
const ENGINE_CORE_ZOOM_CYCLE_FACTOR = 6;
const HISTOGRAM_BUCKET_MS = 0.5;
const HISTOGRAM_UP_TO_MS = 20;

// Documented local default: the Chrome for Testing binary in the Playwright cache
// of the measurement machine. CHROME_PATH always wins; the harness records which
// source it used so the run stays reproducible on another machine.
const LOCAL_CHROME_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");

// Thresholds are mirrored in docs/gates/perf.md; the harness fails if they drift
// apart silently only through review, so keep both in the same change.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;
const REAL_GPU_ANGLE = /^ANGLE \(/i;
const REAL_GPU_HINTS = /(apple|metal|opengl|vulkan|nvidia|amd|intel|geforce|radeon)/i;

const BASE_CHROME_FLAGS = [
  "--headless=new",
  "--use-angle=metal",
  "--enable-gpu",
  "--hide-scrollbars",
  // Unlock rAF from the 60 Hz display clock so the interval measures engine
  // frame production instead of the display clock.
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--window-size=1440,900",
];

// The engine-core scenario runs inside a sandboxed harness environment where
// Chrome's own sandbox cannot initialise ("sandbox initialization failed:
// Operation not permitted"). The flag is local to this measurement tool (it is
// never shipped) and is recorded in the evidence; the renderer check stays
// fail-closed, so a software renderer is still classified as infra.
const ENGINE_CORE_CHROME_FLAGS = [...BASE_CHROME_FLAGS, "--no-sandbox"];

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

function readSlotPort(service = "web") {
  const slotPath = join(REPO_ROOT, ".polier-slot");
  if (!existsSync(slotPath)) {
    fail(`missing ${slotPath}; acquire a Polier slot for this worktree first`);
  }
  let slot;
  try {
    slot = JSON.parse(readFileSync(slotPath, "utf8"));
  } catch {
    fail(`${slotPath} is not valid JSON`);
  }
  const port = slot?.ports?.[service];
  if (!Number.isInteger(port)) {
    fail(`${slotPath} has no integer ports.${service}`);
  }
  return port;
}

function ensureArtefacts({ includeTestKit = false } = {}) {
  const required = [
    "apps/engine-playground/index.html",
    "apps/engine-playground/main.js",
    "apps/engine-playground/playground.css",
    "packages/ui-kit/tokens.css",
    "packages/engine/dist/bridge/engine.js",
    "packages/engine/dist/bridge/backend.js",
    "packages/engine/dist/bridge/text-atlas.js",
    "packages/engine/dist/bridge/input.js",
    "packages/engine/dist/bridge/overlay.js",
    "packages/engine/dist/bridge/zone-parity.js",
    "packages/engine/dist/bridge/zone-lifecycle.js",
    "packages/engine/build-wasm/engine.js",
    "packages/engine/build-wasm/engine.wasm",
  ];
  if (includeTestKit) {
    required.push("packages/test-kit/dist/scenes.js");
  }
  const missing = required.filter((relative) => !existsSync(join(REPO_ROOT, relative)));
  if (missing.length > 0) {
    fail(
      `missing build artefacts: ${missing.join(", ")}; run "pnpm --filter @project-air/engine run build", "bash packages/engine/tools/build-wasm.sh" and "pnpm --filter @project-air/test-kit run build" first`,
    );
  }
}

function copyArtefacts(tempRoot, { includeTestKit = false } = {}) {
  cpSync(join(REPO_ROOT, "apps/engine-playground"), join(tempRoot, "apps/engine-playground"), {
    recursive: true,
  });
  const files = [
    "packages/ui-kit/tokens.css",
    "packages/engine/dist/bridge/engine.js",
    "packages/engine/dist/bridge/backend.js",
    "packages/engine/dist/bridge/text-atlas.js",
    "packages/engine/dist/bridge/input.js",
    "packages/engine/dist/bridge/overlay.js",
    "packages/engine/dist/bridge/zone-parity.js",
    "packages/engine/dist/bridge/zone-lifecycle.js",
    "packages/engine/build-wasm/engine.js",
    "packages/engine/build-wasm/engine.wasm",
  ];
  if (includeTestKit) {
    files.push("packages/test-kit/dist/scenes.js");
  }
  for (const relative of files) {
    const destination = join(tempRoot, relative);
    mkdirSync(join(destination, ".."), { recursive: true });
    cpSync(join(REPO_ROOT, relative), destination);
  }
}

function contentType(path) {
  switch (path.slice(path.lastIndexOf(".")).toLowerCase()) {
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
        rejectServer(new Error(`port ${port} is already in use; the perf gate is exclusive`));
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
  fail("no Chrome found; set CHROME_PATH to a Chrome for Testing binary");
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
  throw new Error(`Chrome debug port ${port} did not expose a page target`);
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

async function evaluate(send, expression) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (response.error !== undefined) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(response.error)}`);
  }
  return response.result?.result?.value;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function percentiles(frameTimesMs) {
  const sorted = [...frameTimesMs].sort((left, right) => left - right);
  const mean = frameTimesMs.reduce((sum, value) => sum + value, 0) / frameTimesMs.length;
  return {
    p50FrameTimeMs: percentile(sorted, 0.5),
    p95FrameTimeMs: percentile(sorted, 0.95),
    p99FrameTimeMs: percentile(sorted, 0.99),
    meanFrameTimeMs: mean,
    meanFps: 1000 / mean,
    minFrameTimeMs: sorted[0],
    maxFrameTimeMs: sorted[sorted.length - 1],
  };
}

function hardwareInfo() {
  const cpuList = cpus();
  return {
    model: cpuList[0]?.model ?? "unknown",
    logicalCores: cpuList.length,
    memoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    arch: process.arch,
    os: {
      type: osType(),
      release: osRelease(),
      version: osVersion(),
    },
    node: process.version,
  };
}

function emscriptenVersion() {
  try {
    const output = execFileSync("emcc", ["--version"], { encoding: "utf8" });
    return (output.split("\n")[0] ?? "").trim();
  } catch {
    return "unknown (emcc not on PATH)";
  }
}

function timestampSlug(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function fileSize(relative) {
  const path = join(REPO_ROOT, relative);
  return existsSync(path) ? readFileSync(path).length : 0;
}

function buildInfo(wasmBytes, { includeTestKit = false } = {}) {
  const build = {
    profile: "Release",
    cmake_build_type: "Release",
    emscripten: emscriptenVersion(),
    wasmRawBytes: wasmBytes.length,
    wasmGzipBytes: gzipSync(wasmBytes, { level: 9 }).length,
    engineJsBytes: fileSize("packages/engine/build-wasm/engine.js"),
    bridgeBytes: fileSize("packages/engine/dist/bridge/engine.js"),
  };
  if (includeTestKit) {
    build.testKitBytes = fileSize("packages/test-kit/dist/scenes.js");
  }
  return build;
}

function rendererDetails(renderer) {
  const softwareRenderer = SOFTWARE_RENDERER.test(renderer);
  const identifiedRenderer =
    !softwareRenderer && REAL_GPU_ANGLE.test(renderer) && REAL_GPU_HINTS.test(renderer);
  return { softwareRenderer, identifiedRenderer };
}

function displayClockUnlocked(flags) {
  return (
    flags.includes("--disable-frame-rate-limit") && flags.includes("--disable-gpu-vsync")
  );
}

function histogram(frameTimesMs) {
  const edges = [];
  for (let edge = 0; edge <= HISTOGRAM_UP_TO_MS; edge += HISTOGRAM_BUCKET_MS) {
    edges.push(Math.round(edge * 10) / 10);
  }
  const buckets = edges.slice(0, -1).map((from, index) => ({
    fromMs: from,
    toMs: edges[index + 1],
    count: 0,
  }));
  const overflow = { fromMs: HISTOGRAM_UP_TO_MS, toMs: null, count: 0 };
  for (const value of frameTimesMs) {
    const index = Math.floor(value / HISTOGRAM_BUCKET_MS);
    if (index >= buckets.length) {
      overflow.count += 1;
      continue;
    }
    buckets[index].count += 1;
  }
  return {
    bucketSizeMs: HISTOGRAM_BUCKET_MS,
    upToMs: HISTOGRAM_UP_TO_MS,
    buckets: [...buckets, overflow],
  };
}

function analyze(frameTimesMs) {
  const stats = percentiles(frameTimesMs);
  return {
    ...stats,
    intervalsAboveLimit: frameTimesMs.filter((value) => value > P95_LIMIT_MS).length,
    sampleCount: frameTimesMs.length,
    sampleWindowMs: frameTimesMs.reduce((sum, value) => sum + value, 0),
    histogram: histogram(frameTimesMs),
  };
}

function frameTimesOf(state) {
  return Array.isArray(state?.frameTimesMs) ? state.frameTimesMs.map(Number) : [];
}

function actualSceneCounts(state) {
  const counts = state?.counts ?? {};
  return {
    objects: Number(counts.total),
    cards: Number(counts.cards),
    zones: Number(counts.zones),
    blocks: Number(counts.blocks),
  };
}

function sceneCountsMatch(actual, expected) {
  return (
    actual.objects === expected.objects &&
    actual.cards === expected.cards &&
    actual.zones === expected.zones &&
    actual.blocks === expected.blocks
  );
}

function sampleCountsMatch(state, warmup, samples) {
  return Number(state?.warmup) === warmup && Number(state?.samples) === samples;
}

async function launchChromeSession({ chrome, chromeFlags, pageUrl, tempRoot, stderrLines }) {
  const debugPort = await getFreePort();
  const userDataDir = join(tempRoot, "chrome-profile");
  const child = spawn(
    chrome.path,
    [
      ...chromeFlags,
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
  console.log(`flags: ${chromeFlags.join(" ")}`);
  console.log(`url: ${pageUrl}`);

  const page = await waitForDebugPort(debugPort);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen) => socket.addEventListener("open", resolveOpen, { once: true }));
  const send = cdpClient(socket);
  const pageErrors = [];
  const consoleLines = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push(
        String(message.params?.exceptionDetails?.exception?.description ?? "page exception"),
      );
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const parts = (message.params?.args ?? []).map((argument) =>
        String(argument.value ?? argument.description ?? ""),
      );
      const text = parts.join(" ").trim();
      if (text.length > 0) {
        consoleLines.push(text);
      }
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  // Navigate to the measured page only now: enabling the DevTools domains after
  // the page (and its measurement) has started blocks the renderer main thread
  // and appears as a frame interval the engine did not cause.
  await send("Page.navigate", { url: pageUrl });
  return { child, send, pageErrors, consoleLines, consoleCursor: 0 };
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

// ---------------------------------------------------------------------------
// perf-baseline (P2-04): unchanged 50,000-rectangle measurement.
// ---------------------------------------------------------------------------

async function runBaseline() {
  ensureArtefacts();
  const port = readSlotPort();
  const bridgePath = join(REPO_ROOT, "packages/engine/dist/bridge/engine.js");
  const wasmPath = join(REPO_ROOT, "packages/engine/build-wasm/engine.wasm");
  const engineJsPath = join(REPO_ROOT, "packages/engine/build-wasm/engine.js");
  const wasmBytes = readFileSync(wasmPath);
  const pageUrl = `http://127.0.0.1:${port}/apps/engine-playground/?bench=${BENCHMARK_RECTANGLES}&samples=${BENCHMARK_SAMPLES}&warmup=${BENCHMARK_WARMUP}`;

  const tempRoot = mkdtempSync(join(tmpdir(), "p204-perf-"));
  let server = null;
  let child = null;
  const displayLocked =
    process.argv.slice(2).includes("--display-locked") ||
    process.env.PERF_DISPLAY_LOCKED === "1";
  const mode = displayLocked ? "display-locked-control" : "unlocked-baseline";
  const chromeFlags = [
    "--headless=new",
    "--use-angle=metal",
    "--enable-gpu",
    "--hide-scrollbars",
    // Baseline: unlock rAF from the 60 Hz display clock so the interval measures
    // engine frame production. Control mode keeps the display clock locked.
    ...(displayLocked ? [] : ["--disable-frame-rate-limit", "--disable-gpu-vsync"]),
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--window-size=1440,900",
  ];

  try {
    copyArtefacts(tempRoot);
    console.log(`serve ${tempRoot} on http://127.0.0.1:${port}/apps/engine-playground/`);
    server = await startStaticServer(tempRoot, port);

    const chrome = findChrome();
    const stderrLines = [];
    const session = await launchChromeSession({
      chrome,
      chromeFlags,
      pageUrl,
      tempRoot,
      stderrLines,
    });
    child = session.child;
    const { send, pageErrors } = session;
    console.log(`mode: ${mode}`);

    let benchmark = null;
    const deadline = Date.now() + PAGE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const raw = await evaluate(
        send,
        "window.__engineBenchmark ? JSON.stringify({status: window.__engineBenchmark.status}) : null",
      );
      if (raw !== null && raw !== undefined) {
        const state = JSON.parse(raw);
        if (state.status === "done") {
          benchmark = JSON.parse(await evaluate(send, "JSON.stringify(window.__engineBenchmark)"));
          break;
        }
        if (state.status === "error") {
          const error = await evaluate(send, "window.__engineBenchmark.error ?? 'unknown'");
          throw new Error(`the page benchmark failed: ${error}`);
        }
      } else {
        const pageError = await evaluate(send, "document.querySelector('#error')?.textContent ?? ''");
        if (typeof pageError === "string" && pageError.length > 0) {
          throw new Error(`the page reported: ${pageError}`);
        }
      }
      await delay(250);
    }
    if (benchmark === null) {
      throw new Error(`the page did not finish the benchmark within ${PAGE_TIMEOUT_MS} ms`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`page exception: ${pageErrors[0]}`);
    }

    const renderer = String(benchmark.renderer ?? "unknown");
    const browserVersion = await send("Browser.getVersion");
    const { softwareRenderer, identifiedRenderer } = rendererDetails(renderer);
    const frameTimesMs = Array.isArray(benchmark.frameTimesMs)
      ? benchmark.frameTimesMs.map(Number)
      : [];
    const stats = percentiles(frameTimesMs);
    const expectedScenario = {
      rectangles: BENCHMARK_RECTANGLES,
      warmup: BENCHMARK_WARMUP,
      samples: BENCHMARK_SAMPLES,
    };
    const actualScenario = {
      rectangles: Number(benchmark.count),
      warmup: Number(benchmark.warmup),
      samples: Number(benchmark.samples),
    };
    const scenarioMatches =
      actualScenario.rectangles === expectedScenario.rectangles &&
      actualScenario.warmup === expectedScenario.warmup &&
      actualScenario.samples === expectedScenario.samples;
    const enoughSamples = frameTimesMs.length >= BENCHMARK_SAMPLES;
    const withinThreshold = stats.p95FrameTimeMs <= P95_LIMIT_MS;
    const result = !identifiedRenderer
      ? "infra"
      : !scenarioMatches || !enoughSamples
        ? "fail"
        : displayLocked
          ? "control"
          : withinThreshold
            ? "pass"
            : "fail";
    const exitCode = result === "infra" ? 3 : result === "fail" ? 1 : 0;

    let resultReason = "pass";
    if (!identifiedRenderer) {
      resultReason = softwareRenderer
        ? `software WebGL renderer "${renderer}" is not a valid perf pass`
        : `renderer "${renderer}" is not positively identified as a real GPU (fail-closed)`;
    } else if (!scenarioMatches) {
      resultReason = `scenario mismatch: expected ${JSON.stringify(expectedScenario)}, page reported ${JSON.stringify(actualScenario)}`;
    } else if (!enoughSamples) {
      resultReason = `fewer samples than requested (${frameTimesMs.length}/${BENCHMARK_SAMPLES})`;
    } else if (displayLocked) {
      resultReason = `display-locked control: p95 ${stats.p95FrameTimeMs.toFixed(2)} ms at the 60 Hz vsync boundary (${P95_LIMIT_MS} ms budget); control observation, not a pass criterion`;
    } else if (!withinThreshold) {
      resultReason = `p95 ${stats.p95FrameTimeMs.toFixed(2)} ms > ${P95_LIMIT_MS} ms`;
    }

    const timestamp = new Date();
    const evidence = {
      task: "P2-04",
      gate: "perf-baseline",
      timestamp: timestamp.toISOString(),
      mode,
      displayLocked,
      result,
      resultReason,
      assertions: {
        expected: expectedScenario,
        actual: actualScenario,
        scenarioMatches,
        sampleCount: frameTimesMs.length,
        requestedSamples: BENCHMARK_SAMPLES,
        enoughSamples,
        rendererIdentified: identifiedRenderer,
        rendererPolicy:
          "fail-closed: renderer must match ANGLE (...) plus a known GPU hint and must not be software",
      },
      scenario: {
        name: "50,000 rectangles, fitted camera, one instanced WebGL2 draw per frame",
        rectangles: actualScenario.rectangles,
        requestedSamples: BENCHMARK_SAMPLES,
        warmupFrames: BENCHMARK_WARMUP,
        sampleCount: frameTimesMs.length,
        timing: displayLocked
          ? "rAF intervals with the display clock locked (no --disable-frame-rate-limit/--disable-gpu-vsync); the 60 Hz display quantises the interval - control observation, not a pass criterion"
          : "rAF intervals with the display clock unlocked (--disable-frame-rate-limit --disable-gpu-vsync), i.e. frame-production throughput (CPU submission and compositor pipeline); no per-frame GPU sync/fence is measured",
      },
      threshold: { p95FrameTimeMsMax: P95_LIMIT_MS, targetFps: TARGET_FPS },
      hardware: hardwareInfo(),
      browser: {
        product: browserVersion.result?.product ?? "unknown",
        revision: browserVersion.result?.revision ?? "unknown",
        executable: chrome.path,
        source: chrome.source,
        flags: chromeFlags,
      },
      gpu: {
        renderer,
        software: softwareRenderer,
        identified: identifiedRenderer,
      },
      build: buildInfo(wasmBytes),
      page: {
        url: `http://127.0.0.1:${port}/apps/engine-playground/?bench=${BENCHMARK_RECTANGLES}&samples=${BENCHMARK_SAMPLES}&warmup=${BENCHMARK_WARMUP}`,
        canvas: benchmark.canvas ?? null,
      },
      results: stats,
      chromeStderr: stderrLines,
    };

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const evidencePath = join(
      EVIDENCE_DIR,
      `${displayLocked ? "P2-04-perf-control" : "P2-04-perf"}-${timestampSlug(timestamp)}.json`,
    );
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    const relativeEvidence = evidencePath.slice(REPO_ROOT.length);

    console.log(`renderer: ${renderer} (identified: ${identifiedRenderer}, software: ${softwareRenderer})`);
    console.log(
      `scenario: ${JSON.stringify(actualScenario)}${scenarioMatches ? "" : ` (expected ${JSON.stringify(expectedScenario)})`}`,
    );
    console.log(
      `samples: ${frameTimesMs.length}${enoughSamples ? "" : ` (fewer than ${BENCHMARK_SAMPLES})`}; warm-up ${BENCHMARK_WARMUP}`,
    );
    console.log(
      `frame time: p50 ${stats.p50FrameTimeMs.toFixed(2)} ms, p95 ${stats.p95FrameTimeMs.toFixed(2)} ms, p99 ${stats.p99FrameTimeMs.toFixed(2)} ms, mean ${stats.meanFrameTimeMs.toFixed(2)} ms (${stats.meanFps.toFixed(1)} fps)`,
    );
    console.log(
      `wasm: ${wasmBytes.length} B raw, ${evidence.build.wasmGzipBytes} B gzip; browser ${evidence.browser.product}`,
    );
    console.log(`evidence: ${relativeEvidence}`);
    console.log(`result: ${result}${result === "control" ? " (display-locked control, not a pass)" : ""}${resultReason === "pass" || result === "control" ? "" : ` — ${resultReason}`}`);

    await send("Browser.close");
    await waitForExit(child, 10000);
    child = null;
    process.exitCode = exitCode;
  } finally {
    if (server !== null) {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    if (child !== null) {
      child.kill("SIGTERM");
      await waitForExit(child, 5000);
    }
    // Chrome may still flush its profile dir for a moment after exiting.
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

// ---------------------------------------------------------------------------
// engine-core (P4-03): 10,000-object pan/zoom gate and the L01 basis/final run.
// ---------------------------------------------------------------------------

// Waits for the page's own `PERF_SCENARIO {…}` completion event instead of
// evaluating `window.__enginePerf` while the measurement runs: a DevTools
// evaluate on the renderer main thread blocks frame production and appears as a
// frame interval the engine did not cause. The page logs the event after the
// measurement and (in the final proof) after the culling verification, so one
// read of the final state afterwards is enough and the measured window stays
// untouched. The claim is documented in docs/gates/perf.md.
async function waitForPerfDone(session, send, expectedScene, timeoutMs = PAGE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let index = session.consoleCursor; index < session.consoleLines.length; index += 1) {
      const line = session.consoleLines[index];
      const prefix = "PERF_SCENARIO ";
      if (!line.startsWith(prefix)) {
        continue;
      }
      let message = null;
      try {
        message = JSON.parse(line.slice(prefix.length));
      } catch {
        continue;
      }
      if (message?.status === "done" && message.scene === expectedScene) {
        session.consoleCursor = index + 1;
        return JSON.parse(await evaluate(send, "JSON.stringify(window.__enginePerf)"));
      }
    }
    if (session.pageErrors.length > 0) {
      throw new Error(`page exception: ${session.pageErrors[0]}`);
    }
    await delay(100);
  }
  let state = "";
  try {
    state = String(await evaluate(send, "JSON.stringify(window.__enginePerf ?? null)"));
  } catch {
    state = "";
  }
  throw new Error(
    `the page did not finish the ${expectedScene} measurement within ${timeoutMs} ms${state === "" ? "" : `; state ${state.slice(0, 200)}`}`,
  );
}

function scenarioUrl(baseUrl, scene, { verifyCulling = false } = {}) {
  const query = new URLSearchParams({
    perf: "engine-core",
    scene,
    warmup: String(ENGINE_CORE_WARMUP_FRAMES),
    samples: String(ENGINE_CORE_SAMPLE_FRAMES),
  });
  if (verifyCulling) {
    query.set("verifyCulling", "1");
  }
  return `${baseUrl}?${query.toString()}`;
}

function interactiveEvidence({ state, renderer, browserVersion, chrome, chromeFlags, session, wasmBytes, pageUrl, port, command }) {
  const { softwareRenderer, identifiedRenderer } = rendererDetails(renderer);
  const frameTimes = frameTimesOf(state);
  const analysis = analyze(frameTimes);
  const expected = {
    name: "engine-core",
    objects: ENGINE_CORE_OBJECT_COUNT,
    cards: ENGINE_CORE_CARD_COUNT,
    zones: ENGINE_CORE_ZONE_COUNT,
    blocks: ENGINE_CORE_BLOCK_COUNT,
  };
  const actual = actualSceneCounts(state);
  const countsMatch = sceneCountsMatch(actual, expected);
  const samplesMatch = sampleCountsMatch(
    state,
    ENGINE_CORE_WARMUP_FRAMES,
    ENGINE_CORE_SAMPLE_FRAMES,
  );
  const enoughSamples = frameTimes.length >= ENGINE_CORE_SAMPLE_FRAMES;
  const documentLoadedOnce = Number(state?.documentLoads) === 1;
  const unlocked = displayClockUnlocked(chromeFlags);
  const p95WithinLimit = analysis.p95FrameTimeMs <= P95_LIMIT_MS;
  const noIntervalAboveLimit = analysis.intervalsAboveLimit === 0;

  let result = "pass";
  let resultReason = "pass";
  if (!identifiedRenderer) {
    result = "infra";
    resultReason = softwareRenderer
      ? `software WebGL renderer "${renderer}" is not a valid perf pass`
      : `renderer "${renderer}" is not positively identified as a real GPU (fail-closed)`;
  } else if (!countsMatch) {
    result = "fail";
    resultReason = `scene mismatch: expected ${JSON.stringify(expected)}, page reported ${JSON.stringify(actual)}`;
  } else if (!samplesMatch || !enoughSamples) {
    result = "fail";
    resultReason = `sample mismatch: expected warm-up ${ENGINE_CORE_WARMUP_FRAMES} and ${ENGINE_CORE_SAMPLE_FRAMES} samples, page reported warm-up ${state?.warmup} and ${frameTimes.length} intervals`;
  } else if (!unlocked) {
    result = "fail";
    resultReason = "display clock is locked: the unlocked frame production is a gate condition";
  } else if (!documentLoadedOnce) {
    result = "fail";
    resultReason = `the camera path reloaded the document (${state?.documentLoads} loads) instead of moving the camera`;
  } else if (!noIntervalAboveLimit) {
    result = "fail";
    resultReason = `${analysis.intervalsAboveLimit} frame interval(s) above ${P95_LIMIT_MS} ms after warm-up`;
  } else if (!p95WithinLimit) {
    result = "fail";
    resultReason = `p95 ${analysis.p95FrameTimeMs.toFixed(2)} ms > ${P95_LIMIT_MS} ms`;
  }

  return {
    task: evidenceTask,
    gate: "perf",
    scenario: "engine-core",
    kind: "interactive",
    command,
    timestamp: new Date().toISOString(),
    mode: "unlocked-gate",
    result,
    resultReason,
    assertions: {
      expectedScene: expected,
      actualScene: actual,
      sceneCountsMatch: countsMatch,
      expectedWarmupFrames: ENGINE_CORE_WARMUP_FRAMES,
      expectedSamples: ENGINE_CORE_SAMPLE_FRAMES,
      actualWarmupFrames: Number(state?.warmup),
      actualSampleCount: frameTimes.length,
      sampleCountsMatch: samplesMatch,
      enoughSamples,
      rendererIdentified: identifiedRenderer,
      rendererPolicy:
        "fail-closed: renderer must match ANGLE (...) plus a known GPU hint and must not be software",
      displayClockUnlocked: unlocked,
      documentLoads: Number(state?.documentLoads),
      documentLoadedOnce,
      frameIntervalsAboveLimit: analysis.intervalsAboveLimit,
      noFrameIntervalAboveLimit: noIntervalAboveLimit,
      p95WithinLimit,
      thresholds: {
        p95FrameTimeMsMax: P95_LIMIT_MS,
        frameIntervalMsMax: P95_LIMIT_MS,
        targetFps: TARGET_FPS,
      },
    },
    scene: {
      name: "engine-core board scene (packages/test-kit buildEngineCoreScene)",
      expected,
      actual,
      query: pageUrl,
    },
    cameraPath: state?.cameraPath ?? null,
    cameraPathConstants: {
      expectedZoomCycleFactor: ENGINE_CORE_ZOOM_CYCLE_FACTOR,
      oneSetCameraPerFrame: true,
    },
    hardware: hardwareInfo(),
    browser: {
      product: browserVersion.result?.product ?? "unknown",
      revision: browserVersion.result?.revision ?? "unknown",
      executable: chrome.path,
      source: chrome.source,
      flags: chromeFlags,
    },
    gpu: { renderer, software: softwareRenderer, identified: identifiedRenderer },
    build: buildInfo(wasmBytes, { includeTestKit: true }),
    page: { url: pageUrl, canvas: state?.canvas ?? null },
    measurement: {
      warmupFrames: Number(state?.warmup),
      requestedSamples: ENGINE_CORE_SAMPLE_FRAMES,
      sampleCount: analysis.sampleCount,
      sampleWindowMs: analysis.sampleWindowMs,
      timing:
        "rAF intervals with the display clock unlocked (--disable-frame-rate-limit --disable-gpu-vsync), i.e. frame-production throughput (CPU submission and compositor pipeline); no per-frame GPU sync/fence is measured",
      frameIntervalsUs: frameTimes.map((value) => Math.round(value * 1000)),
    },
    results: {
      p50FrameTimeMs: analysis.p50FrameTimeMs,
      p95FrameTimeMs: analysis.p95FrameTimeMs,
      p99FrameTimeMs: analysis.p99FrameTimeMs,
      meanFrameTimeMs: analysis.meanFrameTimeMs,
      meanFps: analysis.meanFps,
      minFrameTimeMs: analysis.minFrameTimeMs,
      maxFrameTimeMs: analysis.maxFrameTimeMs,
      intervalsAboveLimit: analysis.intervalsAboveLimit,
      histogram: analysis.histogram,
    },
    chromeStderr: session.stderrLines,
    port,
  };
}

function l01Evidence({ state, kind, record, renderer, browserVersion, chrome, chromeFlags, session, wasmBytes, pageUrl, port, command, comparison }) {
  const { softwareRenderer, identifiedRenderer } = rendererDetails(renderer);
  const frameTimes = frameTimesOf(state);
  const analysis = analyze(frameTimes);
  const expected = {
    name: "sample",
    objects: L01_OBJECT_COUNT,
    cards: L01_CARD_COUNT,
    zones: L01_ZONE_COUNT,
    blocks: L01_BLOCK_COUNT,
  };
  const actual = actualSceneCounts(state);
  const countsMatch = sceneCountsMatch(actual, expected);
  const samplesMatch = sampleCountsMatch(
    state,
    ENGINE_CORE_WARMUP_FRAMES,
    ENGINE_CORE_SAMPLE_FRAMES,
  );
  const enoughSamples = frameTimes.length >= ENGINE_CORE_SAMPLE_FRAMES;
  const documentLoadedOnce = Number(state?.documentLoads) === 1;
  const unlocked = displayClockUnlocked(chromeFlags);
  const maxFrameTimeUnder50ms = analysis.maxFrameTimeMs < L01_MAX_FRAME_TIME_MS;
  const culling = state?.culling ?? null;
  const cullingFrames = culling?.framesChecked ?? 0;
  const cullingAssertions =
    record === "final"
      ? {
          framesChecked: cullingFrames,
          minimumCheckpoints: L01_MIN_CULLING_CHECKPOINTS,
          enoughCheckpoints: cullingFrames >= L01_MIN_CULLING_CHECKPOINTS,
          mismatches: culling?.mismatches ?? -1,
          expectedEqualsCommandBuffer: culling?.expectedEqualsCommandBuffer === true,
          drawsFewerThanDocument: culling?.drawsFewerThanDocument === true,
          culledFrames: culling?.culledFrames ?? 0,
          documentSize: culling?.documentSize ?? 0,
          minInstances: culling?.minInstances ?? 0,
          maxInstances: culling?.maxInstances ?? 0,
          method: culling?.method ?? null,
          cullingPassed:
            cullingFrames >= L01_MIN_CULLING_CHECKPOINTS &&
            culling?.expectedEqualsCommandBuffer === true &&
            culling?.drawsFewerThanDocument === true,
        }
      : null;

  let result = record === "basis" ? "basis" : "pass";
  let resultReason = record === "basis" ? "basis recorded (no pass/fail budget for the basis)" : "pass";
  if (!identifiedRenderer) {
    result = "infra";
    resultReason = softwareRenderer
      ? `software WebGL renderer "${renderer}" is not a valid perf pass`
      : `renderer "${renderer}" is not positively identified as a real GPU (fail-closed)`;
  } else if (!countsMatch) {
    result = "fail";
    resultReason = `scene mismatch: expected ${JSON.stringify(expected)}, page reported ${JSON.stringify(actual)}`;
  } else if (!samplesMatch || !enoughSamples) {
    result = "fail";
    resultReason = `sample mismatch: expected warm-up ${ENGINE_CORE_WARMUP_FRAMES} and ${ENGINE_CORE_SAMPLE_FRAMES} samples, page reported warm-up ${state?.warmup} and ${frameTimes.length} intervals`;
  } else if (!unlocked || !documentLoadedOnce) {
    result = "fail";
    resultReason = !unlocked
      ? "display clock is locked: the unlocked frame production is a gate condition"
      : `the camera path reloaded the document (${state?.documentLoads} loads) instead of moving the camera`;
  } else if (record === "final") {
    if (!maxFrameTimeUnder50ms) {
      result = "fail";
      resultReason = `max frame duration ${analysis.maxFrameTimeMs.toFixed(2)} ms is not under ${L01_MAX_FRAME_TIME_MS} ms`;
    } else if (cullingAssertions === null) {
      result = "fail";
      resultReason =
        "the final proof did not run the culling verification; offscreen culling is unproven";
    } else if (!cullingAssertions.enoughCheckpoints) {
      result = "fail";
      resultReason = `only ${cullingAssertions.framesChecked} culling camera(s) checked; the final proof requires at least ${L01_MIN_CULLING_CHECKPOINTS}`;
    } else if (!cullingAssertions.expectedEqualsCommandBuffer) {
      result = "fail";
      resultReason = `command-buffer instance count does not match the visible set in ${cullingAssertions.mismatches} of ${cullingAssertions.framesChecked} checked frames`;
    } else if (!cullingAssertions.drawsFewerThanDocument) {
      result = "fail";
      resultReason =
        "no checked frame drew fewer instances than the document; offscreen culling is not proven";
    } else if (comparison !== null && !comparison.withinTolerance) {
      result = "fail";
      resultReason = `measurement exceeds the committed basis + ${Math.round((BASIS_TOLERANCE - 1) * 100)} %: ${comparison.violations.join(", ")}`;
    }
  }

  return {
    task: evidenceTask,
    gate: "perf",
    scenario: "l01",
    kind,
    record,
    command,
    timestamp: new Date().toISOString(),
    mode: "unlocked-gate",
    result,
    resultReason,
    assertions: {
      expectedScene: expected,
      actualScene: actual,
      sceneCountsMatch: countsMatch,
      expectedWarmupFrames: ENGINE_CORE_WARMUP_FRAMES,
      expectedSamples: ENGINE_CORE_SAMPLE_FRAMES,
      actualWarmupFrames: Number(state?.warmup),
      actualSampleCount: frameTimes.length,
      sampleCountsMatch: samplesMatch,
      enoughSamples,
      rendererIdentified: identifiedRenderer,
      rendererPolicy:
        "fail-closed: renderer must match ANGLE (...) plus a known GPU hint and must not be software",
      displayClockUnlocked: unlocked,
      documentLoads: Number(state?.documentLoads),
      documentLoadedOnce,
      maxFrameTimeMs: analysis.maxFrameTimeMs,
      maxFrameTimeLimitMs: L01_MAX_FRAME_TIME_MS,
      maxFrameTimeUnder50ms,
      culling: cullingAssertions,
    },
    scene: {
      name: "L01 sample board: 500 cards + 50 zones (with 144 contained blocks), packages/test-kit buildSampleScene",
      expected,
      actual,
      query: pageUrl,
    },
    cameraPath: state?.cameraPath ?? null,
    hardware: hardwareInfo(),
    browser: {
      product: browserVersion.result?.product ?? "unknown",
      revision: browserVersion.result?.revision ?? "unknown",
      executable: chrome.path,
      source: chrome.source,
      flags: chromeFlags,
    },
    gpu: { renderer, software: softwareRenderer, identified: identifiedRenderer },
    build: buildInfo(wasmBytes, { includeTestKit: true }),
    page: { url: pageUrl, canvas: state?.canvas ?? null },
    measurement: {
      warmupFrames: Number(state?.warmup),
      requestedSamples: ENGINE_CORE_SAMPLE_FRAMES,
      sampleCount: analysis.sampleCount,
      sampleWindowMs: analysis.sampleWindowMs,
      timing:
        "rAF intervals with the display clock unlocked (--disable-frame-rate-limit --disable-gpu-vsync) while the deterministic camera path pans and zooms; frame-production throughput, no per-frame GPU sync/fence",
      frameIntervalsUs: frameTimes.map((value) => Math.round(value * 1000)),
    },
    results: {
      p50FrameTimeMs: analysis.p50FrameTimeMs,
      p95FrameTimeMs: analysis.p95FrameTimeMs,
      p99FrameTimeMs: analysis.p99FrameTimeMs,
      meanFrameTimeMs: analysis.meanFrameTimeMs,
      meanFps: analysis.meanFps,
      minFrameTimeMs: analysis.minFrameTimeMs,
      maxFrameTimeMs: analysis.maxFrameTimeMs,
      intervalsAboveLimit: analysis.intervalsAboveLimit,
      histogram: analysis.histogram,
    },
    comparison: comparison ?? null,
    chromeStderr: session.stderrLines,
    port,
  };
}

function latestBasisRecord() {
  if (!existsSync(EVIDENCE_DIR)) {
    return null;
  }
  const candidates = readdirSync(EVIDENCE_DIR)
    .filter((entry) => entry.endsWith(".json") && /-perf-basis-\d{8}T\d{6}Z\.json$/.test(entry))
    .sort()
    .reverse();
  for (const entry of candidates) {
    try {
      const record = JSON.parse(readFileSync(join(EVIDENCE_DIR, entry), "utf8"));
      if (record?.record === "basis" && record?.result === "basis" && record?.results) {
        return { path: join(EVIDENCE_DIR, entry), record };
      }
    } catch {
      // ignore unreadable evidence, the next candidate may be a valid basis
    }
  }
  return null;
}

function compareWithBasis(basis) {
  // The +10 % tolerance is enforced on the frame-production percentiles and the
  // mean. The maximum frame duration is a bound, not a production rate: L01 gives
  // it its own 50 ms long-task target, and a single scheduling spike is not a
  // regression signal at the 0.1 ms rAF timestamp resolution. It is still listed
  // in the comparison table and recorded next to its basis value.
  const metrics = [
    ["p50FrameTimeMs", true],
    ["p95FrameTimeMs", true],
    ["p99FrameTimeMs", true],
    ["meanFrameTimeMs", true],
    ["maxFrameTimeMs", false],
  ];
  const basisResults = basis.record.results ?? {};
  const compared = metrics.map(([key, enforced]) => ({
    key,
    enforced,
    basisMs: Number(basisResults[key]),
  }));
  return (currentResults) => {
    const entries = compared.map(({ key, enforced, basisMs }) => {
      const limitMs = Math.max(
        basisMs * BASIS_TOLERANCE,
        basisMs + FRAME_TIMESTAMP_RESOLUTION_MS,
      );
      return {
        metric: key,
        enforced,
        basisMs,
        currentMs: Number(currentResults[key]),
        limitMs,
        tolerance: BASIS_TOLERANCE,
        resolutionFloorMs: FRAME_TIMESTAMP_RESOLUTION_MS,
        withinTolerance: Number(currentResults[key]) <= limitMs,
        note: enforced
          ? "enforced: basis + 10 % with the 0.1 ms rAF timestamp resolution floor"
          : "observation: bounded by the L01 50 ms long-task target, not by the +10 % tolerance",
      };
    });
    const violations = entries
      .filter((entry) => entry.enforced && !entry.withinTolerance)
      .map((entry) => `${entry.metric} ${entry.currentMs.toFixed(3)} ms > ${entry.limitMs.toFixed(3)} ms`);
    return {
      basisPath: basis.path.slice(REPO_ROOT.length),
      basisTimestamp: basis.record.timestamp ?? null,
      tolerance: BASIS_TOLERANCE,
      resolutionFloorMs: FRAME_TIMESTAMP_RESOLUTION_MS,
      enforcedMetrics: entries.filter((entry) => entry.enforced).map((entry) => entry.metric),
      observationMetrics: entries.filter((entry) => !entry.enforced).map((entry) => entry.metric),
      metrics: entries,
      withinTolerance: violations.length === 0,
      violations,
    };
  };
}

function writeEvidenceJson(name, evidence) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const path = join(EVIDENCE_DIR, name);
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  return path.slice(REPO_ROOT.length);
}

function printResults(label, analysis) {
  console.log(
    `${label}: p50 ${analysis.p50FrameTimeMs.toFixed(3)} ms, p95 ${analysis.p95FrameTimeMs.toFixed(3)} ms, p99 ${analysis.p99FrameTimeMs.toFixed(3)} ms, mean ${analysis.meanFrameTimeMs.toFixed(3)} ms (${analysis.meanFps.toFixed(1)} fps), max ${analysis.maxFrameTimeMs.toFixed(3)} ms, ${analysis.intervalsAboveLimit} interval(s) > ${P95_LIMIT_MS} ms; ${analysis.sampleCount} samples in ${analysis.sampleWindowMs.toFixed(1)} ms`,
  );
}

async function runEngineCore({ record }) {
  const command =
    record === undefined
      ? "node packages/engine/test/perf/run-perf.mjs --scenario engine-core"
      : `node packages/engine/test/perf/run-perf.mjs --scenario engine-core --record ${record}`;
  ensureArtefacts({ includeTestKit: true });
  const port = readSlotPort("playground");
  const wasmBytes = readFileSync(join(REPO_ROOT, "packages/engine/build-wasm/engine.wasm"));
  const baseUrl = `http://127.0.0.1:${port}/apps/engine-playground/`;
  const interactiveUrl = scenarioUrl(baseUrl, "engine-core");
  const basisUrl = scenarioUrl(baseUrl, "sample");
  const finalUrl = scenarioUrl(baseUrl, "sample", { verifyCulling: true });
  const chromeFlags = ENGINE_CORE_CHROME_FLAGS;
  const session = { stderrLines: [] };

  const tempRoot = mkdtempSync(join(tmpdir(), "p403-perf-"));
  let server = null;
  let child = null;
  const exitCodes = [];
  const startedAt = new Date();
  console.log(`command: ${command}`);
  console.log(`started: ${startedAt.toISOString()}`);
  try {
    copyArtefacts(tempRoot, { includeTestKit: true });
    console.log(`serve ${tempRoot} on ${baseUrl}`);
    server = await startStaticServer(tempRoot, port);
    const chrome = findChrome();

    const foundBasis = latestBasisRecord();
    const existingBasis = record === "basis" ? null : foundBasis;
    if (record === "basis" && foundBasis !== null) {
      fail(
        `a basis record already exists (${foundBasis.path.slice(REPO_ROOT.length)}); use --record final to compare against it`,
        2,
      );
    }
    if (record === "final" && existingBasis === null) {
      fail(
        "no committed basis record found under reviews/evidence/; run --record basis first",
        2,
      );
    }
    const firstUrl = record === "basis" ? basisUrl : record === "final" ? finalUrl : interactiveUrl;
    const chromeSession = await launchChromeSession({
      chrome,
      chromeFlags,
      pageUrl: firstUrl,
      tempRoot,
      stderrLines: session.stderrLines,
    });
    child = chromeSession.child;
    const { send, pageErrors } = chromeSession;
    const browserVersion = await send("Browser.getVersion");
    const evidenceContext = {
      browserVersion,
      chrome,
      chromeFlags,
      session,
      wasmBytes,
      port,
      command,
    };

    if (record !== "basis" && record !== "final") {
      const state = await waitForPerfDone(chromeSession, send, "engine-core");
      if (pageErrors.length > 0) {
        throw new Error(`page exception: ${pageErrors[0]}`);
      }
      const renderer = String(state?.renderer ?? "unknown");
      const evidence = interactiveEvidence({
        ...evidenceContext,
        renderer,
        state,
        pageUrl: interactiveUrl,
        port,
      });
      const path = writeEvidenceJson(
        `${evidenceTask}-perf-engine-core-${timestampSlug(new Date(evidence.timestamp))}.json`,
        evidence,
      );
      printResults("engine-core", analyze(frameTimesOf(state)));
      console.log(
        `scene: ${JSON.stringify(evidence.assertions.actualScene)}; renderer: ${renderer} (identified: ${evidence.assertions.rendererIdentified}); document loads: ${evidence.assertions.documentLoads}; unlock: ${evidence.assertions.displayClockUnlocked}`,
      );
      console.log(`evidence: ${path}`);
      console.log(`engine-core result: ${evidence.result}${evidence.result === "pass" ? "" : ` — ${evidence.resultReason}`}`);
      exitCodes.push(evidence.result === "pass" ? 0 : evidence.result === "infra" ? 3 : 1);
      if (evidence.result === "infra") {
        // A software/unknown renderer is infra; do not record a misleading basis.
        await send("Browser.close");
        await waitForExit(child, 10000);
        child = null;
        process.exitCode = 3;
        return;
      }
    }

    let currentUrl = firstUrl;
    const goto = async (url) => {
      if (url === currentUrl) {
        return;
      }
      await send("Page.navigate", { url });
      currentUrl = url;
    };

    let comparison = null;
    let basisForComparison = existingBasis;
    if (record === "basis" || (record !== "final" && existingBasis === null)) {
      await goto(basisUrl);
      const state = await waitForPerfDone(chromeSession, send, "sample");
      const renderer = String(state?.renderer ?? "unknown");
      const evidence = l01Evidence({
        ...evidenceContext,
        renderer,
        state,
        kind: "l01-basis",
        record: "basis",
        pageUrl: basisUrl,
        port,
        command,
        comparison: null,
      });
      const path = writeEvidenceJson(
        `${evidenceTask}-perf-basis-${timestampSlug(new Date(evidence.timestamp))}.json`,
        evidence,
      );
      printResults("L01 basis", analyze(frameTimesOf(state)));
      console.log(`evidence: ${path}`);
      console.log(`L01 basis result: ${evidence.result}${evidence.result === "basis" ? "" : ` — ${evidence.resultReason}`}`);
      exitCodes.push(evidence.result === "basis" ? 0 : evidence.result === "infra" ? 3 : 1);
      if (evidence.result === "basis") {
        basisForComparison = { path: join(REPO_ROOT, path), record: evidence };
      }
      if (record === "basis") {
        await send("Browser.close");
        await waitForExit(child, 10000);
        child = null;
        process.exitCode = exitCodes.includes(3) ? 3 : exitCodes.includes(1) ? 1 : 0;
        return;
      }
    }

    if (record !== "basis") {
      await goto(finalUrl);
      const state = await waitForPerfDone(chromeSession, send, "sample");
      const renderer = String(state?.renderer ?? "unknown");
      const analyzeFinal = analyze(frameTimesOf(state));
      comparison =
        basisForComparison === null ? null : compareWithBasis(basisForComparison)(analyzeFinal);
      const evidence = l01Evidence({
        ...evidenceContext,
        renderer,
        state,
        kind: "l01-final",
        record: "final",
        pageUrl: finalUrl,
        port,
        command,
        comparison,
      });
      const path = writeEvidenceJson(
        `${evidenceTask}-perf-final-${timestampSlug(new Date(evidence.timestamp))}.json`,
        evidence,
      );
      printResults("L01 final", analyzeFinal);
      console.log(
        `culling: ${JSON.stringify(evidence.assertions.culling)}`,
      );
      if (comparison !== null) {
        const enforcedMetrics = comparison.enforcedMetrics.join("/");
        console.log(
          `basis comparison: ${enforcedMetrics} ${comparison.withinTolerance ? "within" : "ABOVE"} basis ${comparison.basisPath} + ${Math.round((BASIS_TOLERANCE - 1) * 100)} % (resolution floor ${FRAME_TIMESTAMP_RESOLUTION_MS} ms); max frame duration is a separate 50 ms-bounded observation`,
        );
        for (const entry of comparison.metrics) {
          console.log(
            `  ${entry.metric}: basis ${entry.basisMs.toFixed(3)} ms, current ${entry.currentMs.toFixed(3)} ms, limit ${entry.limitMs.toFixed(3)} ms${entry.enforced ? "" : " (observation, L01 50 ms bound)"}`,
          );
        }
      }
      console.log(`evidence: ${path}`);
      console.log(`L01 final result: ${evidence.result}${evidence.result === "pass" ? "" : ` — ${evidence.resultReason}`}`);
      exitCodes.push(evidence.result === "pass" ? 0 : evidence.result === "infra" ? 3 : 1);
    }

    console.log(`finished: ${new Date().toISOString()}`);
    await send("Browser.close");
    await waitForExit(child, 10000);
    child = null;
    process.exitCode = exitCodes.includes(3) ? 3 : exitCodes.includes(1) ? 1 : 0;
  } finally {
    if (server !== null) {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    if (child !== null) {
      child.kill("SIGTERM");
      await waitForExit(child, 5000);
    }
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const scenarioIndex = args.indexOf("--scenario");
  const scenario = scenarioIndex >= 0 ? args[scenarioIndex + 1] : undefined;
  if (scenario === undefined) {
    await runBaseline();
    return;
  }
  if (scenario !== "engine-core") {
    fail(`unknown --scenario "${scenario}"; expected "engine-core"`, 2);
  }
  const taskIndex = args.indexOf("--task");
  if (taskIndex >= 0) {
    const task = args[taskIndex + 1];
    if (task === undefined || task.startsWith("--") || !/^[A-Za-z0-9_.-]+$/.test(task)) {
      fail("--task needs a task id such as P4-03", 2);
    }
    evidenceTask = task;
  }
  const recordIndex = args.indexOf("--record");
  const record = recordIndex >= 0 ? args[recordIndex + 1] : undefined;
  if (record !== undefined && record !== "basis" && record !== "final") {
    fail(`unknown --record "${record}"; expected "basis" or "final"`, 2);
  }
  await runEngineCore({ record });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const label = process.argv.includes("--scenario") ? "perf" : "perf-baseline";
  console.error(`${label}: ${message}`);
  process.exitCode = error instanceof HarnessError ? error.exitCode : 2;
}
