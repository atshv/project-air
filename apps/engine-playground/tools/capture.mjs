#!/usr/bin/env node
// Screenshot helper for the engine playground (P2-03 evidence, reusable by P2-04).
//
//   node apps/engine-playground/tools/capture.mjs [desktop.png] [mobile.png]
//
// It starts headless Google Chrome for Testing with WebGL via SwiftShader, waits
// for the page, emulates exact viewports through the DevTools protocol (Chrome
// clamps --window-size to 500 px, so browser flags alone are not enough), pauses
// the playground loop through window.__enginePlayground and captures the
// viewport. It prints the layout/fps measurements per shot so the evidence log
// and the PNG agree.
//
// Requirements: node builtins only; start the playground HTTP server first
// (python3 -m http.server <slot web port> --bind 127.0.0.1 from the repo root)
// and build the bridge + WASM. Set CHROME_PATH to override the browser.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_URL = "http://127.0.0.1:4100/apps/engine-playground/";
const PLAYWRIGHT_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");

const DESKTOP = { width: 1440, height: 900, mobile: false };
const MOBILE = { width: 390, height: 844, mobile: true };

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

async function waitForPlayground(send) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await send("Runtime.evaluate", {
      expression: "typeof globalThis.__enginePlayground === 'object'",
      returnByValue: true,
    });
    if (result.result?.result?.value === true) {
      return;
    }
    await delay(250);
  }
  throw new Error("the playground did not become ready");
}

async function main() {
  const args = process.argv.slice(2);
  const outputDesktop = args[0] ?? join(REPO_ROOT, "reviews/evidence/P2-03-playground.png");
  const outputMobile = args[1] ?? "/tmp/P2-03-playground-mobile.png";
  const url = process.env.PLAYGROUND_URL ?? DEFAULT_URL;
  const port = Number(process.env.CHROME_DEBUG_PORT ?? 9333);
  const chrome = chromePath();
  const userDataDir = join("/tmp", `p203-chrome-${process.pid}`);

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
    await delay(2000);

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
      await delay(3000);
      await waitForPlayground(send);
      await delay(2000);
      await send("Runtime.evaluate", { expression: "globalThis.__enginePlayground.pause()" });
      await delay(250);
      const expression = `JSON.stringify({
        width: window.innerWidth,
        height: window.innerHeight,
        docScrollWidth: document.documentElement.scrollWidth,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        fps: document.querySelector("#fps")?.textContent,
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
      console.log(`${shot.file} ${shot.viewport.width}x${shot.viewport.height} ${layout.result?.result?.value}`);
    }

    await send("Browser.close");
    await new Promise((resolve) => child.once("exit", resolve));
  } finally {
    child.kill("SIGTERM");
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

await main();
