#!/usr/bin/env node
// perf-baseline gate: measure 50,000 rectangles at 60 fps in Chrome (P2-04).
//
//   node packages/engine/test/perf/run-perf.mjs
//
// The harness reads the web port from .polier-slot, copies the built playground
// and WASM artefacts into a temporary served folder, starts its own static
// server, launches Chrome for Testing with a real GPU (ANGLE/Metal), runs the
// playground benchmark query (?bench=50000&samples=600&warmup=120), collects the
// frame intervals from the page, computes p50/p95/p99 and mean fps, writes
// reviews/evidence/P2-04-perf-<timestamp>.json, and exits 0 iff p95 <= 16.7 ms.
//
// A software WebGL renderer (SwiftShader/llvmpipe) is never a pass: the JSON
// result is "infra" and the exit code is 3, so the run must be repeated on a real
// GPU. Exit codes: 0 pass, 1 fail, 2 usage/build problem, 3 infra.
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

// Documented local default: the Chrome for Testing binary in the Playwright cache
// of the measurement machine. CHROME_PATH always wins; the harness records which
// source it used so the run stays reproducible on another machine.
const LOCAL_CHROME_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");

// Thresholds are mirrored in docs/gates/perf.md; the harness fails if they drift
// apart silently only through review, so keep both in the same change.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;
const REAL_GPU_ANGLE = /^ANGLE \(/i;
const REAL_GPU_HINTS = /(apple|metal|opengl|vulkan|nvidia|amd|intel|geforce|radeon)/i;

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

function readSlotPort() {
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
  const port = slot?.ports?.web;
  if (!Number.isInteger(port)) {
    fail(`${slotPath} has no integer ports.web`);
  }
  return port;
}

function ensureArtefacts() {
  const required = [
    "apps/engine-playground/index.html",
    "apps/engine-playground/main.js",
    "apps/engine-playground/playground.css",
    "packages/ui-kit/tokens.css",
    "packages/engine/dist/bridge/engine.js",
    "packages/engine/build-wasm/engine.js",
    "packages/engine/build-wasm/engine.wasm",
  ];
  const missing = required.filter((relative) => !existsSync(join(REPO_ROOT, relative)));
  if (missing.length > 0) {
    fail(
      `missing build artefacts: ${missing.join(", ")}; run "pnpm --filter @project-air/engine run build" and "bash packages/engine/tools/build-wasm.sh" first`,
    );
  }
}

function copyArtefacts(tempRoot) {
  cpSync(join(REPO_ROOT, "apps/engine-playground"), join(tempRoot, "apps/engine-playground"), {
    recursive: true,
  });
  for (const relative of [
    "packages/ui-kit/tokens.css",
    "packages/engine/dist/bridge/engine.js",
    "packages/engine/build-wasm/engine.js",
    "packages/engine/build-wasm/engine.wasm",
  ]) {
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

async function main() {
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
    const debugPort = await getFreePort();
    const userDataDir = join(tempRoot, "chrome-profile");
    child = spawn(
      chrome.path,
      [...chromeFlags, `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debugPort}`, pageUrl],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const stderrLines = [];
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.trim().length > 0 && stderrLines.length < 20) {
          stderrLines.push(line.trim());
        }
      }
    });
    console.log(`chrome: ${chrome.path} (source: ${chrome.source})`);
    console.log(`mode: ${mode}; flags: ${chromeFlags.join(" ")}`);
    console.log(`url: ${pageUrl}`);

    const page = await waitForDebugPort(debugPort);
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen) => socket.addEventListener("open", resolveOpen, { once: true }));
    const send = cdpClient(socket);
    const pageErrors = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(
          String(message.params?.exceptionDetails?.exception?.description ?? "page exception"),
        );
      }
    });
    await send("Runtime.enable");
    await send("Page.enable");

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
    const softwareRenderer = SOFTWARE_RENDERER.test(renderer);
    const identifiedRenderer =
      !softwareRenderer && REAL_GPU_ANGLE.test(renderer) && REAL_GPU_HINTS.test(renderer);
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
      build: {
        profile: "Release",
        cmake_build_type: "Release",
        emscripten: emscriptenVersion(),
        wasmRawBytes: wasmBytes.length,
        wasmGzipBytes: gzipSync(wasmBytes, { level: 9 }).length,
        engineJsBytes: readFileSync(engineJsPath).length,
        bridgeBytes: readFileSync(bridgePath).length,
      },
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

function waitForExit(processHandle, timeoutMs) {
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs);
    processHandle.once("exit", () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`perf-baseline: ${message}`);
  process.exitCode = error instanceof HarnessError ? error.exitCode : 2;
}
