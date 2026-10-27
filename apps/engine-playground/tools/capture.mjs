#!/usr/bin/env node
// Screenshot helper for the engine playground (P2-03 evidence, reused by P4-02).
//
//   node apps/engine-playground/tools/capture.mjs [desktop.png] [mobile.png]
//
// It starts headless Google Chrome for Testing with WebGL via SwiftShader, waits
// for the deterministic ready hook (`window.__enginePlayground.ready`), emulates
// exact viewports through the DevTools protocol (Chrome clamps --window-size to
// 500 px, so browser flags alone are not enough), pauses the playground loop and
// captures the viewport. It prints the layout/fps measurements per shot so the
// evidence log and the PNG agree.
//
// Requirements: node builtins only; start the playground HTTP server first
// (`python3 -m http.server <slot playground port> --bind 127.0.0.1` from the
// repository root) and build the bridge, WASM and test-kit. The default URL uses
// the playground port from the worktree's `.polier-slot`; `PLAYGROUND_URL`
// overrides it and `CHROME_PATH` the browser.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PLAYWRIGHT_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");

const DESKTOP = { width: 1440, height: 900, mobile: false };
const MOBILE = { width: 390, height: 844, mobile: true };

function defaultUrl() {
  const slotPath = join(REPO_ROOT, ".polier-slot");
  if (!existsSync(slotPath)) {
    throw new Error(`missing ${slotPath}; acquire a Polier slot for this worktree first`);
  }
  const slot = JSON.parse(readFileSync(slotPath, "utf8"));
  const port = slot?.ports?.playground;
  if (!Number.isInteger(port)) {
    throw new Error(`${slotPath} has no integer ports.playground`);
  }
  return `http://127.0.0.1:${port}/apps/engine-playground/`;
}

function chromePath() {
  const override = process.env.CHROME_PATH;
  if (override !== undefined && override.length > 0) {
    return override;
  }
  const candidates = [];
  if (existsSync(PLAYWRIGHT_CACHE)) {
    for (const entry of readdirSync(PLAYWRIGHT_CACHE).sort()) {
      if (!entry.startsWith("chromium-")) {
        continue;
      }
      for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
        candidates.push(
          join(
            PLAYWRIGHT_CACHE,
            entry,
            arch,
            "Google Chrome for Testing.app",
            "Contents",
            "MacOS",
            "Google Chrome for Testing",
          ),
        );
      }
    }
  }
  candidates.push(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("no Chrome found; set CHROME_PATH to a Chrome for Testing binary");
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDebugPort(port, timeoutMilliseconds = 15000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // not up yet
    }
    await delay(200);
  }
  throw new Error(`Chrome debug port ${port} did not open`);
}

function createClient(socket) {
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
    new Promise((resolve) => {
      nextId += 1;
      pending.set(nextId, resolve);
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
}

// Waits for the page's deterministic ready hook instead of sleeping. The hook
// resolves with { ok: true, scene, objectCount, visibleCount } after the first
// full HUD second, or with { ok: false, error } when the engine failed.
async function waitForPlayground(send) {
  const deadline = Date.now() + 20000;
  let lastError = "the playground object never appeared";
  while (Date.now() < deadline) {
    const present = await send("Runtime.evaluate", {
      expression: "typeof globalThis.__enginePlayground === 'object'",
      returnByValue: true,
    });
    if (present.result?.result?.value === true) {
      const ready = await send("Runtime.evaluate", {
        expression:
          "globalThis.__enginePlayground.ready.then((state) => JSON.stringify(state))",
        awaitPromise: true,
        returnByValue: true,
      });
      const value = ready.result?.result?.value;
      if (typeof value === "string") {
        const state = JSON.parse(value);
        if (state.ok === true) {
          return state;
        }
        lastError = state.error ?? "the engine reported that it did not start";
        break;
      }
      lastError = ready.result?.exceptionDetails?.text ?? "the ready hook did not resolve";
    }
    await delay(250);
  }
  throw new Error(`the playground did not become ready: ${lastError}`);
}

async function main() {
  const args = process.argv.slice(2);
  const outputDesktop = args[0] ?? join(REPO_ROOT, "reviews/evidence/P4-02-desktop.png");
  const outputMobile = args[1] ?? join(REPO_ROOT, "reviews/evidence/P4-02-mobile.png");
  const url = process.env.PLAYGROUND_URL ?? defaultUrl();
  const port = Number(process.env.CHROME_DEBUG_PORT ?? 9333);
  const chrome = chromePath();
  const userDataDir = join("/tmp", `p402-chrome-${process.pid}`);

  rmSync(userDataDir, { recursive: true, force: true });
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      url,
    ],
    { stdio: "ignore" },
  );

  console.log(`chrome: ${chrome}`);
  console.log(`url: ${url}`);

  try {
    const targets = await waitForDebugPort(port);
    const target = targets.find((candidate) => candidate.type === "page");
    if (target === undefined) {
      throw new Error("no page target in Chrome");
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
    const send = createClient(socket);

    await send("Page.enable");
    await delay(500);

    const shots = [
      { viewport: DESKTOP, file: outputDesktop },
      { viewport: MOBILE, file: outputMobile },
    ];
    for (const shot of shots) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: shot.viewport.width,
        height: shot.viewport.height,
        deviceScaleFactor: 1,
        mobile: shot.viewport.mobile,
      });
      // Reload per viewport: the page pauses permanently for the capture, so a
      // second viewport must start a fresh loop with the new metrics.
      await send("Page.reload", { ignoreCache: true });
      await delay(1000);
      const readyState = await waitForPlayground(send);
      await send("Runtime.evaluate", { expression: "globalThis.__enginePlayground.pause()" });
      await delay(250);
      const expression = `JSON.stringify({
        width: window.innerWidth,
        height: window.innerHeight,
        docScrollWidth: document.documentElement.scrollWidth,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        ready: ${JSON.stringify(readyState)},
        hud: {
          objects: document.querySelector("#hud-objects")?.textContent,
          visible: document.querySelector("#hud-visible")?.textContent,
          frames: document.querySelector("#frames")?.textContent,
          backend: document.querySelector("#hud-backend")?.textContent
        },
        state: globalThis.__enginePlayground.getState(),
        error: document.querySelector("#error")?.textContent,
        frame: document.querySelector(".frame")?.getBoundingClientRect().toJSON(),
        canvasPixels: [document.querySelector(".canvas")?.width, document.querySelector(".canvas")?.height]
      })`;
      const layout = await send("Runtime.evaluate", { expression, returnByValue: true });
      const screenshot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      mkdirSync(dirname(shot.file), { recursive: true });
      writeFileSync(shot.file, Buffer.from(screenshot.result.data, "base64"));
      console.log(
        `${shot.file} ${shot.viewport.width}x${shot.viewport.height} ${layout.result?.result?.value}`,
      );
    }

    await send("Browser.close");
    await new Promise((resolve) => child.once("exit", resolve));
  } finally {
    child.kill("SIGTERM");
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

await main();
